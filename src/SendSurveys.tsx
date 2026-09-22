import { useEffect, useState } from 'react'

type Draft = Record<string, string | null>
type Note = { field: string; message: string }
type Preview = {
  from: string
  to: string | null
  subject: string
  intro: string
  question: string
  campaign: string
  expires: string | null
  reminders: number
}
type Checked = { draft: Draft; blockers: Note[]; warnings: Note[]; preview: Preview }
type Campaign = {
  id: number
  name: string
  status: string
  source_type: string
  allowed_participant_types: string[]
  allowed_transaction_types: string[]
  expiry_days: number
  cooldown_days: number
  sent: number
}
type Provider = { name: string; label: string; group: string; ready: boolean; envKey: string }

// The Send Manual Survey drawer, field for field.
const FIELDS: [key: string, label: string, required?: boolean][] = [
  ['recipient_first_name', 'First Name', true],
  ['recipient_last_name', 'Last Name'],
  ['email', 'Email Address', true],
  ['contact_number', 'Contact Number'],
  ['transaction_id', 'Transaction Id', true],
  ['transaction_type', 'Transaction type'],
  ['transaction_date', 'Transaction Date', true],
  ['participant_type', 'Participant Type'],
  ['city', 'City of transactions'],
  ['state', 'State of transaction'],
]

const EXAMPLES: Record<string, string> = {
  'One person, written as a sentence':
    'Send a survey to John Smith, john.smith@example.com, 555-0134. He closed a purchase yesterday, transaction TXN-77401, borrower, Austin TX.',
  'A forwarded email':
    `Hi team — please survey the borrower on the Delgado file.

Rosa Delgado (rosa.delgado@example.com) closed her refinance on the 15th of this month.
Loan number TXN-55120. Property is in Tampa, Florida. Her cell is 555-0199.

Her co-borrower Luis Delgado should get one too — luis.delgado@example.com, same loan.`,
  'A pasted spreadsheet':
    `name,email,loan,type,closed,role,city,state
Ana Reyes,ana.reyes@example.com,TXN-60011,Purchase,2026-09-18,borrower,Miami,FL
Marcus Chen,marcus.chen@example.com,TXN-60012,Refinance,2026-09-19,borrower,Tampa,FL
Nina Kowalski,nina.kowalski@example.com,TXN-60013,Purchase,2026-09-20,borrower,Orlando,FL
Grace Sato,grace.sato@example.com,TXN-60014,Listing,2026-09-21,seller,Austin,TX`,
  'Details missing on purpose':
    'Please survey the guest from room 402 who checked out last Friday. I think the booking was 4471.',
}

export default function SendSurveys() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState(0)
  const [text, setText] = useState(Object.values(EXAMPLES)[1])
  const [providers, setProviders] = useState<Provider[]>([])
  const [provider, setProvider] = useState('')
  const [checked, setChecked] = useState<Checked[] | null>(null)
  // Which campaign the verdicts on screen were computed against. Not always
  // campaignId: a check in flight when the user switches lands afterwards.
  const [checkedFor, setCheckedFor] = useState<number | null>(null)
  const [meta, setMeta] = useState<{ provider: string | null; ms: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  // Two stages: fix the forms, then look at what will actually land in an
  // inbox and approve it. Nothing sends from the editing stage.
  const [stage, setStage] = useState<'edit' | 'review'>('edit')
  const [approved, setApproved] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetch('/api/campaigns')
      .then((r) => r.json())
      .then((d: { rows: Campaign[] }) => {
        setCampaigns(d.rows)
        setCampaignId(d.rows.find((c) => c.status === 'Active')?.id ?? d.rows[0]?.id ?? 0)
      })
      .catch(() => {})
    fetch('/api/providers')
      .then((r) => r.json())
      .then((d: { all: Provider[]; available: string[] }) => {
        setProviders(d.all)
        setProvider(d.available[0] ?? '')
      })
      .catch(() => {})
  }, [])

  const campaign = campaigns.find((c) => c.id === campaignId)

  // Switching campaign changes the rules, so the verdicts on screen are stale
  // the moment it changes. Re-check against the new one — no model call.
  useEffect(() => {
    if (checked?.length && checkedFor !== null && checkedFor !== campaignId) {
      post({ drafts: checked.map((c) => c.draft) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, checkedFor])

  async function post(body: Record<string, unknown>) {
    setLoading(true)
    setError(null)
    setSent(null)
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, provider: provider || undefined, ...body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setChecked(data.checked)
      // Any re-check can change who is sendable, so approvals do not survive it.
      setApproved(
        new Set(
          (data.checked as Checked[])
            .map((c, i) => (c.blockers.length ? -1 : i))
            .filter((i: number) => i >= 0),
        ),
      )
      setStage('edit')
      setCheckedFor(data.campaign?.id ?? null)
      setMeta({ provider: data.provider, ms: data.ms })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // Editing a field re-runs the same checks, without paying the model again.
  const edit = (i: number, key: string, value: string) => {
    if (!checked) return
    const drafts = checked.map((c, j) => (i === j ? { ...c.draft, [key]: value || null } : c.draft))
    setChecked(checked.map((c, j) => (i === j ? { ...c, draft: drafts[i] } : c)))
    post({ drafts })
  }

  const clean = checked?.filter((c) => !c.blockers.length) ?? []
  const toSend = (checked ?? []).filter((c, i) => !c.blockers.length && approved.has(i))

  async function send() {
    if (!toSend.length) return
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId, drafts: toSend.map((c) => c.draft) }),
    })
    const data = await res.json()
    // Re-check first — it clears `sent` — then show the confirmation, so the
    // "now a duplicate" verdicts and the receipt appear together.
    await post({ drafts: checked!.map((c) => c.draft) })
    setSent(`Sent ${data.sent} survey${data.sent === 1 ? '' : 's'}.`)
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Paste anything that names the recipients
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            className="w-full resize-none rounded-lg border border-slate-300 p-3 font-mono text-xs outline-none focus:border-slate-500"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(EXAMPLES).map(([label, body]) => (
              <button
                key={label}
                onClick={() => setText(body)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-400"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Campaign</label>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.status === 'Active' ? '' : ` — ${c.status}`}
                </option>
              ))}
            </select>
          </div>

          {/* The rules that decide whether a survey actually arrives. In XMP
              these live on a different screen, which is why the drawer asks the
              user to go and check them by hand. */}
          {campaign && (
            <dl className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
              <p className="mb-2 font-semibold text-slate-700">Set conditions</p>
              {[
                ['Source type', campaign.source_type],
                ['Participants', campaign.allowed_participant_types.join(', ')],
                [
                  'Transaction types',
                  campaign.allowed_transaction_types.length
                    ? campaign.allowed_transaction_types.join(', ')
                    : 'any',
                ],
                ['Expires after', `${campaign.expiry_days} days`],
                ['Cooldown', `${campaign.cooldown_days} days`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-t border-slate-100 py-1">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {providers.length === 0 && <option value="">no provider configured</option>}
            {[...new Set(providers.map((p) => p.group))].map((group) => (
              <optgroup key={group} label={group}>
                {providers
                  .filter((p) => p.group === group)
                  .map((p) => (
                    <option key={p.name} value={p.name} disabled={!p.ready}>
                      {p.label}
                      {p.ready ? '' : ` — set ${p.envKey}`}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>

          <button
            onClick={() => post({ text })}
            disabled={loading || !campaignId}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Reading…' : 'Fill the forms'}
          </button>
        </div>
      </div>

      <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
        <strong>The agent never sends.</strong> It fills the form and checks it against the
        campaign's set conditions, the unsubscribe list and what has already gone out. You press
        send, and every draft is checked again on the server before anything is written.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {checked && (
        <section className="mt-6 space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm">
              <strong>{checked.length}</strong> recipient{checked.length === 1 ? '' : 's'} ·{' '}
              <span className="text-emerald-700">{clean.length} ready</span> ·{' '}
              <span className="text-red-700">{checked.length - clean.length} blocked</span>
              {meta?.provider && (
                <span className="text-slate-500">
                  {' '}
                  · read in {(meta.ms / 1000).toFixed(1)}s
                </span>
              )}
            </p>
            {stage === 'edit' ? (
              <button
                onClick={() => setStage('review')}
                disabled={!clean.length}
                className="ml-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Preview {clean.length} survey{clean.length === 1 ? '' : 's'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => setStage('edit')}
                  className="ml-auto rounded-lg border border-slate-300 px-4 py-2 text-sm"
                >
                  Back to details
                </button>
                <button
                  onClick={send}
                  disabled={!toSend.length}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Send {toSend.length} approved
                </button>
              </>
            )}
            {sent && <span className="text-sm text-emerald-700">{sent}</span>}
          </div>

          {stage === 'review' &&
            checked.map((c, i) =>
              c.blockers.length ? (
                <article key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                  <strong>{c.draft.recipient_first_name ?? 'Unnamed'}</strong> will not be sent —{' '}
                  {c.blockers[0].message}
                </article>
              ) : (
                <article
                  key={i}
                  className={`rounded-lg border bg-white ${
                    approved.has(i) ? 'border-emerald-300' : 'border-slate-200'
                  }`}
                >
                  <label className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={approved.has(i)}
                      onChange={(e) => {
                        const next = new Set(approved)
                        e.target.checked ? next.add(i) : next.delete(i)
                        setApproved(next)
                      }}
                    />
                    Approve this one
                    {c.warnings.length > 0 && (
                      <span className="ml-auto text-xs text-amber-700">
                        {c.warnings.length} warning{c.warnings.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </label>

                  {/* What the recipient sees. Filled in by code from the
                      campaign's own template — the model writes no part of it. */}
                  <div className="px-4 py-3 text-sm">
                    <dl className="mb-3 space-y-0.5 text-xs text-slate-500">
                      <div>
                        <dt className="inline">From: </dt>
                        <dd className="inline text-slate-700">{c.preview.from}</dd>
                      </div>
                      <div>
                        <dt className="inline">To: </dt>
                        <dd className="inline text-slate-700">{c.preview.to}</dd>
                      </div>
                    </dl>
                    <p className="mb-2 text-base font-semibold">{c.preview.subject}</p>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <p className="text-slate-700">{c.preview.intro}</p>
                      <p className="mt-3 font-medium">{c.preview.question}</p>
                      <div className="mt-2 flex gap-1 text-2xl text-amber-400" aria-hidden>
                        {'★★★★★'.split('').map((star, n) => (
                          <span key={n}>{star}</span>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] text-slate-400">
                        {c.preview.campaign}
                        {c.preview.expires && ` · expires ${c.preview.expires}`}
                        {c.preview.reminders > 0
                          ? ` · ${c.preview.reminders} reminder${c.preview.reminders === 1 ? '' : 's'}`
                          : ' · no reminders'}{' '}
                        · Unsubscribe
                      </p>
                    </div>
                  </div>

                  {c.warnings.map((w, j) => (
                    <p key={j} className="mx-4 mb-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      <strong>{w.field.replace(/_/g, ' ')}:</strong> {w.message}
                    </p>
                  ))}
                </article>
              ),
            )}

          {stage === 'edit' && checked.map((c, i) => (
            <article
              key={i}
              className={`rounded-lg border bg-white p-4 ${
                c.blockers.length ? 'border-red-300' : 'border-slate-200'
              }`}
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map(([key, label, required]) => {
                  const bad = c.blockers.some((b) => b.field === key)
                  return (
                    <label key={key} className="block">
                      <span className="text-[11px] text-slate-500">
                        {label}
                        {required && <span className="text-red-500"> *</span>}
                      </span>
                      <input
                        value={c.draft[key] ?? ''}
                        onChange={(e) => edit(i, key, e.target.value)}
                        placeholder="—"
                        className={`w-full rounded border px-2 py-1 text-sm outline-none focus:border-slate-500 ${
                          bad ? 'border-red-400 bg-red-50' : 'border-slate-200'
                        }`}
                      />
                    </label>
                  )
                })}
              </div>

              {c.blockers.map((b, j) => (
                <p key={j} className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
                  <strong>{b.field.replace(/_/g, ' ')}:</strong> {b.message}
                </p>
              ))}
              {c.warnings.map((w, j) => (
                <p key={j} className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  <strong>{w.field.replace(/_/g, ' ')}:</strong> {w.message}
                </p>
              ))}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
