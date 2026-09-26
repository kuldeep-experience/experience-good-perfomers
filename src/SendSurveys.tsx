import { useEffect, useRef, useState } from 'react'
import { CampaignTable, Stats } from './CampaignTable'
import SurveyPreview from './SurveyPreview'
import { ACCEPTED, fileToText } from './upload'
import { FIELDS, suggestionsFor, type Campaign, type Checked, type Provider } from './shared'

/**
 * The agent's side of the job.
 *
 * Pick one of the campaigns the tier activated, then say who to survey — typed,
 * pasted, or uploaded as a spreadsheet. Every route ends in the same extractor
 * and the same server-side checks, and nothing sends until a person approves it.
 *
 * Every choice offered here comes off the selected campaign. Nothing about a
 * campaign's rules is written down twice.
 */
const EXAMPLES: Record<string, string> = {
  'One person, written as a sentence':
    'Send a survey to John Smith, john.smith@example.com, 555-0134. He closed a purchase yesterday, transaction TXN-77401, borrower, Austin TX.',
  'A forwarded email': `Hi team — please survey the borrower on the Delgado file.

Rosa Delgado (rosa.delgado@example.com) closed her refinance on the 15th of this month.
Loan number TXN-55120. Property is in Tampa, Florida. Her cell is 555-0199.

Her co-borrower Luis Delgado should get one too — luis.delgado@example.com, same loan.`,
  'A pasted spreadsheet': `name,email,loan,type,closed,role,city,state
Ana Reyes,ana.reyes@example.com,TXN-60011,Purchase,2026-09-18,borrower,Miami,FL
Marcus Chen,marcus.chen@example.com,TXN-60012,Refinance,2026-09-19,borrower,Tampa,FL
Nina Kowalski,nina.kowalski@example.com,TXN-60013,Purchase,2026-09-20,borrower,Orlando,FL
Grace Sato,grace.sato@example.com,TXN-60014,Listing,2026-09-21,seller,Austin,TX`,
  'Details missing on purpose':
    'Please survey the guest from room 402 who checked out last Friday. I think the booking was 4471.',
}

export default function SendSurveys({ preset }: { preset?: Campaign | null }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaign, setCampaign] = useState<Campaign | null>(preset ?? null)
  const [text, setText] = useState(Object.values(EXAMPLES)[1])
  const [file, setFile] = useState<string | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [provider, setProvider] = useState('')
  const [checked, setChecked] = useState<Checked[] | null>(null)
  const [meta, setMeta] = useState<{ provider: string | null; ms: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  // Two stages: fix the forms, then look at what will actually land in an
  // inbox and approve it. Nothing sends from the editing stage.
  const [stage, setStage] = useState<'edit' | 'review'>('edit')
  const [approved, setApproved] = useState<Set<number>>(new Set())
  // Editing fires a check; an older response must not overwrite a newer one.
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    fetch('/api/campaigns')
      .then((r) => r.json())
      .then((d: { rows: Campaign[] }) => {
        // Only what the tier activated. A paused campaign accepts nothing, so
        // offering it would mean a send the form takes and never delivers.
        const live = d.rows.filter((c) => c.status === 'Active')
        setCampaigns(live)
        if (preset) setCampaign(live.find((c) => c.id === preset.id) ?? preset)
      })
      .catch(() => {})
    fetch('/api/providers')
      .then((r) => r.json())
      .then((d: { all: Provider[]; available: string[] }) => {
        setProviders(d.all)
        setProvider(d.available[0] ?? '')
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function post(body: Record<string, unknown>, quiet = false) {
    if (!campaign) return
    const mine = ++seq.current
    if (!quiet) setLoading(true)
    setError(null)
    setSent(null)
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaign.id,
          provider: provider || undefined,
          ...body,
        }),
      })
      const data = await res.json()
      if (mine !== seq.current) return // superseded by a later check
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
      // A debounced edit-check can land after the user has moved on to the
      // preview. It must not drag them back to the form.
      if (!quiet) setStage('edit')
      setMeta({ provider: data.provider, ms: data.ms })
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  const edit = (i: number, key: string, value: string) => {
    if (!checked) return
    const drafts = checked.map((c, j) => (i === j ? { ...c.draft, [key]: value || null } : c.draft))
    setChecked(checked.map((c, j) => (i === j ? { ...c, draft: drafts[i] } : c)))
    // Retire any check already in flight — its answer describes text the user
    // has since changed — and wait for a pause before asking for a new one.
    seq.current++
    clearTimeout(timer.current)
    timer.current = setTimeout(() => post({ drafts }, true), 400)
  }

  async function onFile(f: File | undefined) {
    if (!f) return
    setError(null)
    try {
      const body = await fileToText(f)
      setFile(`${f.name} — ${body.split('\n').filter(Boolean).length} rows`)
      setText(body)
    } catch (e) {
      setError(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const clean = checked?.filter((c) => !c.blockers.length) ?? []
  const toSend = (checked ?? []).filter((c, i) => !c.blockers.length && approved.has(i))

  async function send() {
    if (!toSend.length || !campaign) return
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaign.id, drafts: toSend.map((c) => c.draft) }),
    })
    const data = await res.json()
    // Re-check first — it clears `sent` — then show the confirmation, so the
    // "now a duplicate" verdicts and the receipt appear together.
    await post({ drafts: checked!.map((c) => c.draft) })
    setSent(`Sent ${data.sent} survey${data.sent === 1 ? '' : 's'}.`)
  }

  // ------------------------------------------------------- pick a campaign
  if (!campaign) {
    return (
      <main className="px-6 py-5">
        <Stats rows={campaigns} />
        <p className="mt-5 text-sm text-slate-500">
          The campaigns your tier has activated. Pick one to send a survey from.
        </p>
        <div className="mt-3">
          <CampaignTable
            rows={campaigns}
            onOpen={setCampaign}
            action={(c) => (
              <button
                onClick={() => setCampaign(c)}
                className="whitespace-nowrap rounded-lg bg-blue-800 px-3 py-1.5 text-xs font-medium text-white"
              >
                Send survey
              </button>
            )}
          />
        </div>
      </main>
    )
  }

  // ------------------------------------------------------------ send from it
  return (
    <main className="px-6 py-5">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white px-6 py-4">
        <button onClick={() => setCampaign(null)} className="text-sm text-slate-500">
          ‹ All campaigns
        </button>
        <div className="border-l border-slate-200 pl-4">
          <p className="text-xs text-slate-500">Sending from</p>
          <p className="text-lg font-semibold">{campaign.name}</p>
        </div>
        <span className="rounded-full border border-emerald-300 px-3 py-1 text-xs text-emerald-700">
          {campaign.status}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Say who to survey — type it, paste it, or upload a sheet
          </label>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setFile(null)
            }}
            rows={10}
            className="w-full resize-none rounded-lg border border-slate-300 p-3 font-mono text-xs outline-none focus:border-blue-700"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-dashed border-slate-400 px-3 py-1.5 text-xs text-slate-600 hover:border-blue-700">
              Upload .xlsx / .csv
              <input
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            {file && <span className="text-xs text-emerald-700">{file}</span>}
            {Object.entries(EXAMPLES).map(([label, body]) => (
              <button
                key={label}
                onClick={() => {
                  setText(body)
                  setFile(null)
                }}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-400"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {/* The rules that decide whether a survey actually arrives. They are
              read off the campaign, never restated here — a second copy is a
              second thing to get wrong. */}
          <dl className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <p className="mb-2 font-semibold text-slate-700">Set conditions</p>
            {[
              ['Source type', campaign.source_type],
              ['Participants', campaign.allowed_participant_types.join(', ') || 'none set'],
              ['Transaction types', campaign.allowed_transaction_types.join(', ') || 'any'],
              ['Expires after', `${campaign.expiry_days} days`],
              ['Cooldown', `${campaign.cooldown_days} days`],
              ['Reminders', String(campaign.reminders)],
              ['Questions', String(campaign.questions?.length ?? 0)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-t border-slate-100 py-1">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
            <p className="mt-2 text-[11px] text-slate-500">
              Set by your tier on the campaign. You cannot change them here, and a send that does
              not match them is blocked rather than quietly dropped.
            </p>
          </dl>

          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {providers.length === 0 && <option value="">no provider configured</option>}
            {providers.map((p) => (
              <option key={p.name} value={p.name} disabled={!p.ready}>
                {p.label}
                {p.ready ? '' : ` — set ${p.envKey}`}
              </option>
            ))}
          </select>

          <button
            onClick={() => post({ text })}
            disabled={loading}
            className="w-full rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Reading…' : 'Fill the forms'}
          </button>
        </div>
      </div>

      <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
        <strong>The agent never sends.</strong> It fills the form and checks it against this
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
                <span className="text-slate-500"> · read in {(meta.ms / 1000).toFixed(1)}s</span>
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
                <article
                  key={i}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500"
                >
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
                  <div className="px-4 py-3">
                    <SurveyPreview preview={c.preview} />
                  </div>
                  {c.warnings.map((w, j) => (
                    <p
                      key={j}
                      className="mx-4 mb-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
                    >
                      <strong>{w.field.replace(/_/g, ' ')}:</strong> {w.message}
                    </p>
                  ))}
                </article>
              ),
            )}

          {stage === 'edit' &&
            checked.map((c, i) => (
              <article
                key={i}
                className={`rounded-lg border bg-white p-4 ${
                  c.blockers.length ? 'border-red-300' : 'border-slate-200'
                }`}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {FIELDS.map(([key, label, required]) => {
                    const bad = c.blockers.some((b) => b.field === key)
                    // Click-to-fill values, taken off this campaign — so a
                    // suggestion can never be something it would reject.
                    const chips = suggestionsFor(key, campaign)
                    return (
                      <div key={key}>
                        <span className="text-[11px] text-slate-500">
                          {label}
                          {required && <span className="text-red-500"> *</span>}
                        </span>
                        <input
                          value={c.draft[key] ?? ''}
                          onChange={(e) => edit(i, key, e.target.value)}
                          placeholder="—"
                          className={`w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-700 ${
                            bad ? 'border-red-400 bg-red-50' : 'border-slate-200'
                          }`}
                        />
                        {chips.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {chips.map(([chipLabel, value]) => (
                              <button
                                key={value}
                                onClick={() => edit(i, key, value)}
                                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                  c.draft[key] === value
                                    ? 'border-blue-800 bg-blue-800 text-white'
                                    : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'
                                }`}
                              >
                                {chipLabel}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
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
