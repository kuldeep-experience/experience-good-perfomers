import { useEffect, useState } from 'react'
import { CampaignTable, Stats } from './CampaignTable'
import { SurveyScreen } from './SurveyPreview'
import {
  BLANK_QUESTION,
  PARTICIPANT_TYPES,
  QUESTION_LABELS,
  QUESTION_TYPES,
  SOURCE_TYPES,
  type Campaign,
  type Provider,
  type Question,
  type QuestionType,
} from './shared'

/**
 * The tier's half of the job: set the campaign up, write the survey, preview
 * it, activate it.
 *
 * Today that is a five-step wizard filled in by hand, which is why campaigns
 * get built by the handful of people who know it. Here the same form can be
 * written by the agent from one sentence — and then edited, because what the
 * agent produces is a draft, not a decision.
 */
type Draft = Partial<Campaign> & { questions: Question[] }

const NEW_CAMPAIGN: Draft = {
  name: '',
  status: 'Draft',
  source_type: 'Manual',
  allowed_participant_types: [],
  allowed_transaction_types: [],
  expiry_days: 30,
  cooldown_days: 90,
  reminders: 2,
  send_as: 'DD Hotel <surveys@ddhotel.com>',
  subject: 'How did we do, {{first_name}}?',
  intro: 'Thanks for working with us. It takes ten seconds.',
  questions: [],
  gateway: {
    enabled: true,
    question: 'How would you rate your overall experience?',
    options: [
      { label: 'Great', color: '#47BA78', message: 'Thank you for your great feedback!' },
      { label: 'OK', color: '#FFBE4B', message: 'Thank you for your feedback.' },
      { label: 'Unpleasant', color: '#DC3232', message: 'We are sorry to hear that.' },
    ],
  },
  sms: { enabled: false, text: 'Hi {{first_name}}, how did we do?' },
}

const STEPS = [
  'Primary Questions',
  'Secondary Workflow',
  'Email Setup',
  'SMS setup',
  'Setup Configuration',
] as const

type Step = (typeof STEPS)[number]

const STEP_ICON: Record<Step, string> = {
  'Primary Questions': '▤',
  'Secondary Workflow': '⇥',
  'Email Setup': '✉',
  'SMS setup': '💬',
  'Setup Configuration': '⚙',
}

const IDEAS = [
  'Post-stay survey for hotel guests — rate the room, rate the staff, and one open question about what we could do better. Two reminders, expires after 21 days.',
  'Ask borrowers who just closed a refinance how their loan officer did and whether they would recommend us. Answers may be published as public reviews.',
  'Short NPS for sellers after a listing closes. One score question and one open ended.',
]

export default function Campaigns({ onSend }: { onSend: (c: Campaign) => void }) {
  const [rows, setRows] = useState<Campaign[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [step, setStep] = useState<Step>(STEPS[0])
  const [adding, setAdding] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [text, setText] = useState(IDEAS[0])
  const [providers, setProviders] = useState<Provider[]>([])
  const [provider, setProvider] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = () =>
    fetch('/api/campaigns')
      .then((r) => r.json())
      .then((d: { rows?: Campaign[]; error?: string }) =>
        d.rows ? setRows(d.rows) : setError(d.error ?? 'Could not load campaigns.'),
      )
      .catch(() => {})

  useEffect(() => {
    load()
    fetch('/api/providers')
      .then((r) => r.json())
      .then((d: { all: Provider[]; available: string[] }) => {
        setProviders(d.all)
        setProvider(d.available[0] ?? '')
      })
      .catch(() => {})
  }, [])

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  /** One sentence in, the whole setup form out. Saved only when the user says so. */
  async function build() {
    if (busy) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch('/api/campaign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, provider: provider || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDraft({ ...data.campaign, status: 'Draft' })
      setStep(STEPS[0])
      setCreating(false)
      setNote(`Filled in for you in ${(data.ms / 1000).toFixed(1)}s — change anything before you activate it.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function save(status?: string) {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/campaign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campaign: { ...draft, status: status ?? draft.status } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      // Reload first, so the list is already current when the editor closes.
      await load()
      if (status === 'Active') {
        setDraft(null)
        setNote(`"${data.row.name}" is active. Agents can send from it now.`)
      } else {
        setDraft(data.row)
        setNote('Saved.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const editQuestion = (i: number, patch: Partial<Question>) =>
    set({ questions: draft!.questions.map((q, j) => (i === j ? { ...q, ...patch } : q)) })

  const editGateway = (patch: Partial<NonNullable<Draft['gateway']>>) =>
    set({ gateway: { ...draft!.gateway!, ...patch } })

  // ---------------------------------------------------------------- list view
  if (!draft) {
    return (
      <main className="px-6 py-5">
        <Stats rows={rows} />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-500">
            Filters
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-500">
              Columns
            </span>
            <button
              onClick={() => {
                setCreating((c) => !c)
                setNote(null)
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium"
            >
              Create new ⌄
            </button>
          </div>
        </div>

        {creating && (
          <section className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Describe the campaign you want</h2>
            <p className="mb-2 text-xs text-slate-500">
              The agent fills in the whole wizard — questions, secondary workflow, email, set
              conditions. You read it, change what you like, and press Activate.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-700"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={build}
                disabled={busy}
                className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? 'Building…' : 'Survey Campaign — with agent'}
              </button>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={busy}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
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
                onClick={() => {
                  setDraft({ ...NEW_CAMPAIGN })
                  setStep(STEPS[0])
                  setCreating(false)
                }}
                disabled={busy}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-50"
              >
                Survey Campaign — blank
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {IDEAS.map((idea) => (
                <button
                  key={idea}
                  disabled={busy}
                  onClick={() => setText(idea)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-400 disabled:opacity-40"
                >
                  {idea.slice(0, 46)}…
                </button>
              ))}
            </div>
            {error && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
          </section>
        )}

        {note && (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
            ✓ {note}
          </p>
        )}

        <div className="mt-4">
          <CampaignTable
            rows={rows}
            onOpen={(c) => {
              setDraft(c)
              setStep(STEPS[0])
              setNote(null)
            }}
            action={(c) =>
              c.status === 'Active' ? (
                <button
                  onClick={() => onSend(c)}
                  className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:border-blue-700 hover:text-blue-700"
                >
                  Add a survey
                </button>
              ) : null
            }
          />
        </div>
      </main>
    )
  }

  // -------------------------------------------------------------- editor view
  return (
    <main className="px-6 py-5">
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-slate-200 bg-white px-6 py-4">
        <div>
          <p className="text-xs text-slate-500">Public Campaign Title:</p>
          <input
            value={draft.name ?? ''}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Untitled campaign"
            className="w-56 rounded border border-transparent px-1 py-0.5 text-lg font-semibold outline-none hover:border-slate-200 focus:border-slate-400"
          />
        </div>
        <div className="border-l border-slate-200 pl-6">
          <p className="text-xs text-slate-500">Campaign ID</p>
          <p className="text-lg font-semibold">{draft.id ?? '—'}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs ${
              draft.status === 'Active'
                ? 'border-emerald-300 text-emerald-700'
                : 'border-blue-300 text-blue-700'
            }`}
          >
            {draft.status}
          </span>
          <button
            onClick={() => setShowPreview(true)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            title="Preview the survey"
          >
            👁
          </button>
          <button
            onClick={() => save()}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => save('Active')}
            disabled={busy}
            className="rounded-lg bg-blue-800 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Activate
          </button>
          <button
            onClick={() => {
              setDraft(null)
              setNote(null)
            }}
            className="px-2 text-sm text-slate-500"
          >
            Close
          </button>
        </div>
      </div>

      <nav className="mt-4 flex items-center rounded-lg border border-slate-200 bg-slate-50 px-6 py-5">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center last:flex-none">
            <button onClick={() => setStep(s)} className="flex flex-col items-center gap-2">
              <span
                className={`grid h-12 w-12 place-items-center rounded-full border text-lg ${
                  s === step ? 'border-blue-700 text-blue-700' : 'border-slate-300 text-slate-400'
                }`}
              >
                {STEP_ICON[s]}
              </span>
              <span
                className={`text-sm ${s === step ? 'font-medium text-blue-800' : 'text-slate-400'}`}
              >
                {s}
              </span>
            </button>
            {i < STEPS.length - 1 && <span className="mb-6 h-px flex-1 bg-slate-200" />}
          </div>
        ))}
      </nav>

      {note && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
          {note}
          {draft.id && draft.status === 'Active' && (
            <button
              onClick={() => onSend(draft as Campaign)}
              className="ml-2 font-semibold underline"
            >
              Add a survey →
            </button>
          )}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {step === 'Primary Questions' && (
        <section className="mt-4 rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between bg-slate-100 px-6 py-3">
            <p className="text-base font-medium">
              Primary Questions{' '}
              <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                Survey Campaign
              </span>
            </p>
            <button
              onClick={() => setStep('Secondary Workflow')}
              className="text-sm text-blue-700"
            >
              Go to Secondary Workflow →
            </button>
          </div>

          <div className="space-y-3 p-6">
            {draft.questions.map((q, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-slate-300">⠿</span>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-800 text-xs font-semibold text-white">
                    {i + 1}
                  </span>
                  <input
                    value={q.text}
                    onChange={(e) => editQuestion(i, { text: e.target.value })}
                    placeholder="Ask something…"
                    className="min-w-[14rem] flex-1 rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-700"
                  />
                  <select
                    value={q.type}
                    onChange={(e) =>
                      editQuestion(i, {
                        ...BLANK_QUESTION(e.target.value as QuestionType),
                        text: q.text,
                      })
                    }
                    className="rounded-full border border-slate-300 bg-blue-50 px-3 py-1 text-xs text-blue-800"
                  >
                    {QUESTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {QUESTION_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-slate-500">
                    Required
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) => editQuestion(i, { required: e.target.checked })}
                    />
                  </label>
                  <button
                    onClick={() => set({ questions: draft.questions.filter((_, j) => j !== i) })}
                    className="text-sm text-slate-400 hover:text-red-600"
                  >
                    🗑
                  </button>
                </div>
                {q.options && (
                  <div className="mt-2 flex flex-wrap gap-2 pl-12">
                    {q.options.map((o, oi) => (
                      <input
                        key={oi}
                        value={o}
                        onChange={(e) =>
                          editQuestion(i, {
                            options: q.options!.map((v, vi) => (vi === oi ? e.target.value : v)),
                          })
                        }
                        className="w-40 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-blue-700"
                      />
                    ))}
                    <button
                      onClick={() =>
                        editQuestion(i, {
                          options: [...q.options!, `Option ${q.options!.length + 1}`],
                        })
                      }
                      className="rounded border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500"
                    >
                      + option
                    </button>
                  </div>
                )}
              </div>
            ))}

            <div className="rounded-lg border border-slate-200 p-4">
              <button
                onClick={() => setAdding((a) => !a)}
                className="flex items-center gap-3 text-sm font-medium text-blue-800"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100">+</span>
                Add New Question
              </button>
              {adding && (
                <>
                  <p className="mt-4 text-base font-medium">Select Question Type</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {QUESTION_TYPES.map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          set({ questions: [...draft.questions, BLANK_QUESTION(t)] })
                          setAdding(false)
                        }}
                        className="rounded-lg border border-slate-200 px-3 py-3 text-left text-sm hover:border-blue-700"
                      >
                        {QUESTION_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {step === 'Secondary Workflow' && draft.gateway && (
        <section className="mt-4 space-y-5 rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <p className="text-base font-medium">🛡 Gateway Question</p>
            <input
              type="checkbox"
              checked={draft.gateway.enabled}
              onChange={(e) => editGateway({ enabled: e.target.checked })}
              className="h-5 w-9"
            />
          </div>

          <label className="block">
            <span className="text-sm text-slate-600">Question</span>
            <input
              value={draft.gateway.question}
              onChange={(e) => editGateway({ question: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-700"
            />
          </label>

          <div>
            <div className="mb-2 flex gap-8 text-sm text-slate-600">
              <span className="w-56">Options</span>
              <span>Colour Indication</span>
            </div>
            {draft.gateway.options.map((o, i) => (
              <div key={i} className="mb-3 flex flex-wrap items-center gap-8">
                <input
                  value={o.label}
                  onChange={(e) =>
                    editGateway({
                      options: draft.gateway!.options.map((v, j) =>
                        i === j ? { ...v, label: e.target.value } : v,
                      ),
                    })
                  }
                  className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-700"
                />
                <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <input
                    type="color"
                    value={o.color}
                    onChange={(e) =>
                      editGateway({
                        options: draft.gateway!.options.map((v, j) =>
                          i === j ? { ...v, color: e.target.value } : v,
                        ),
                      })
                    }
                    className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
                  />
                  {o.color.toUpperCase()}
                </label>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 pt-5">
            <p className="text-base font-medium">Final conclusion/review</p>
            {draft.gateway.options.map((o, i) => (
              <div key={i} className="mt-4">
                <p className="text-sm text-slate-600">
                  If a recipient selects <span style={{ color: o.color }}>{o.label}</span>
                </p>
                <textarea
                  value={o.message}
                  rows={2}
                  onChange={(e) =>
                    editGateway({
                      options: draft.gateway!.options.map((v, j) =>
                        i === j ? { ...v, message: e.target.value } : v,
                      ),
                    })
                  }
                  className="mt-1 w-full max-w-xl resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-700"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {step === 'Email Setup' && (
        <section className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-6">
          {(
            [
              ['send_as', 'Send as'],
              ['subject', 'Subject'],
              ['intro', 'Intro'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block max-w-xl">
              <span className="text-xs text-slate-500">{label}</span>
              <input
                value={(draft[key] as string) ?? ''}
                onChange={(e) => set({ [key]: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-700"
              />
            </label>
          ))}
          <p className="text-xs text-slate-500">
            <code>{'{{first_name}}'}</code> and <code>{'{{transaction_id}}'}</code> are the only
            slots. They are filled in by code, never by the model.
          </p>
        </section>
      )}

      {step === 'SMS setup' && draft.sms && (
        <section className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-white p-6">
          <label className="flex items-center gap-3 text-base font-medium">
            <input
              type="checkbox"
              checked={draft.sms.enabled}
              onChange={(e) => set({ sms: { ...draft.sms!, enabled: e.target.checked } })}
              className="h-5 w-9"
            />
            Also invite by SMS
          </label>
          <textarea
            value={draft.sms.text}
            rows={3}
            onChange={(e) => set({ sms: { ...draft.sms!, text: e.target.value } })}
            className="w-full max-w-xl resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-700"
          />
          <p className="text-xs text-slate-500">
            {/* ponytail: stored and previewed, not delivered. Wire a gateway
                here when there is one to wire. */}
            Stored with the campaign and shown in the preview. This prototype has no SMS gateway,
            so nothing is texted.
          </p>
        </section>
      )}

      {step === 'Setup Configuration' && (
        <section className="mt-4 space-y-5 rounded-lg border border-slate-200 bg-white p-6">
          <label className="block">
            <span className="text-xs text-slate-500">Source type</span>
            <select
              value={draft.source_type}
              onChange={(e) => set({ source_type: e.target.value })}
              className="block rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>

          {(
            [
              ['allowed_participant_types', 'Participant types', PARTICIPANT_TYPES],
              [
                'allowed_transaction_types',
                'Transaction types (none = any)',
                ['Purchase', 'Refinance', 'Listing', 'Rental'],
              ],
            ] as const
          ).map(([key, label, all]) => (
            <div key={key}>
              <span className="text-xs text-slate-500">{label}</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {all.map((t) => {
                  const on = (draft[key] as string[] | undefined)?.includes(t)
                  return (
                    <button
                      key={t}
                      onClick={() =>
                        set({
                          [key]: on
                            ? (draft[key] as string[]).filter((v) => v !== t)
                            : [...((draft[key] as string[]) ?? []), t],
                        })
                      }
                      className={`rounded-full border px-3 py-1 text-xs ${
                        on ? 'border-blue-800 bg-blue-800 text-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-4">
            {(
              [
                ['expiry_days', 'Expires after (days)'],
                ['cooldown_days', 'Cooldown (days)'],
                ['reminders', 'Reminders'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-xs text-slate-500">{label}</span>
                <input
                  type="number"
                  value={(draft[key] as number) ?? 0}
                  onChange={(e) => set({ [key]: Number(e.target.value) })}
                  className="block w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-700"
                />
              </label>
            ))}
          </div>
        </section>
      )}

      {showPreview && (
        <div className="fixed inset-0 z-10 overflow-y-auto bg-slate-900/40 p-6">
          <div className="mx-auto max-w-xl rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3">
              <p className="font-semibold">Survey Preview</p>
              <button onClick={() => setShowPreview(false)} className="text-slate-400">
                ✕
              </button>
            </div>
            <SurveyScreen
              title={draft.name || 'Untitled campaign'}
              intro={draft.intro ?? ''}
              questions={draft.questions}
              gateway={draft.gateway}
            />
            <button
              onClick={() => setShowPreview(false)}
              className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm"
            >
              ← Close
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
