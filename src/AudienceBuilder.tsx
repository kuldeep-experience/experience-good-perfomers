import { useEffect, useState } from 'react'

// Every example here is also a scored case in evals/cases.mjs, so what the
// demo shows is exactly what the eval suite measures.
const EXAMPLES = [
  'everyone in Florida who got a review in the last 90 days but never replied to it',
  'PRO subscribers in Texas with an average rating of at least 4.5',
  'professionals with no reviews at all',
  'mortgage professionals in Florida who joined this year',
  'top 100 by search rank score in California',
  'anyone who hasn\'t logged in for 60 days',
]

type Result = {
  provider: string
  ms: number
  filter: Record<string, unknown>
  sql: string
  count: number
  rows: Record<string, unknown>[]
}

type Audience = {
  id: number
  name: string
  saved_count: number
  live_count: number | null
  created_at: string
}

type Provider = {
  name: string
  label: string
  group: string
  model?: string
  ready: boolean
  envKey: string
}

export default function AudienceBuilder() {
  const [prompt, setPrompt] = useState(EXAMPLES[0])
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [provider, setProvider] = useState('')
  const [audiences, setAudiences] = useState<Audience[]>([])

  const loadAudiences = () =>
    fetch('/api/audiences')
      .then((r) => r.json())
      .then((d: { rows: Audience[] }) => setAudiences(d.rows))
      .catch(() => {})

  useEffect(() => {
    loadAudiences()
    fetch('/api/providers')
      .then((r) => r.json())
      .then((d: { all: Provider[]; available: string[] }) => {
        setProviders(d.all)
        setProvider(d.available[0] ?? '')
      })
      .catch(() => {})
  }, [])

  async function build(text = prompt) {
    if (loading) return
    setLoading(true)
    setError(null)
    setSaved(null)
    setResult(null)
    try {
      const res = await fetch('/api/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: text, provider: provider || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function approve() {
    if (!result) return
    await fetch('/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, ...result }),
    })
    setSaved(`Saved — ${result.count.toLocaleString()} recipients`)
    loadAudiences()
  }

  // Only the fields the model actually set are worth showing back.
  const active = result
    ? Object.entries(result.filter).filter(([, v]) => v !== null && v !== undefined)
    : []

  return (
    <div>

      <main className="mx-auto max-w-3xl px-6 py-6">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-slate-500"
          placeholder="e.g. everyone in Florida who got a review in the last 90 days but never replied"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => build()}
            disabled={loading}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Building…' : 'Build audience'}
          </button>

          {/* Same prompt, same schema, different model — the point is that the
              filter contract is the product and the provider is swappable. */}
          {/* Same prompt, same JSON Schema, different model — the filter contract
              is the product and the provider is a replaceable part. */}
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
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
          {/* A build in flight owns the screen: starting a second one would leave
              two answers racing for the same result box, and the slower one wins. */}
          {EXAMPLES.slice(1, 4).map((ex) => (
            <button
              key={ex}
              disabled={loading}
              onClick={() => {
                setPrompt(ex)
                build(ex)
              }}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-400 disabled:opacity-40 disabled:hover:border-slate-300"
            >
              {ex.length > 44 ? `${ex.slice(0, 44)}…` : ex}
            </button>
          ))}
        </div>

        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
          <strong>Always applied:</strong> <code>consent_status = 'granted'</code> and{' '}
          <code>unsubscribed_at is null</code>. These are added by the compiler on every query — the
          model has no field that can switch them off.
        </p>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {result && (
          <section className="mt-6 space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-3xl font-semibold">{result.count.toLocaleString()}</p>
              <p className="text-sm text-slate-500">
                people match · parsed by{' '}
                {providers.find((p) => p.name === result.provider)?.model ?? result.provider} in{' '}
                {(result.ms / 1000).toFixed(1)}s
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">What it understood</h2>
              <div className="flex flex-wrap gap-2">
                {active.map(([k, v]) => (
                  <span
                    key={k}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                  >
                    <span className="text-slate-500">{k}</span>{' '}
                    <span className="font-medium">{JSON.stringify(v)}</span>
                  </span>
                ))}
              </div>
            </div>

            <details className="rounded-lg border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold">Generated query</summary>
              <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                {result.sql}
              </pre>
            </details>

            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    {['name', 'email', 'city', 'state', 'subscription_status', 'review_count'].map(
                      (h) => (
                        <th key={h} className="px-3 py-2 font-medium">
                          {h.replace(/_/g, ' ')}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={String(r.id)} className="border-t border-slate-100">
                      <td className="px-3 py-2">{String(r.name)}</td>
                      <td className="px-3 py-2 text-slate-500">{String(r.email)}</td>
                      <td className="px-3 py-2">{String(r.city)}</td>
                      <td className="px-3 py-2">{String(r.state)}</td>
                      <td className="px-3 py-2">{String(r.subscription_status)}</td>
                      <td className="px-3 py-2">{String(r.review_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.count > result.rows.length && (
                <p className="px-3 py-2 text-xs text-slate-500">
                  Showing {result.rows.length} of {result.count.toLocaleString()}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={approve}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
              >
                Approve &amp; save audience
              </button>
              {saved && <span className="text-sm text-emerald-700">{saved}</span>}
            </div>
          </section>
        )}

        {audiences.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold">Saved audiences</h2>
            {/* What is stored is the query, not the people it matched. Every
                row here is re-run on load, which is why "when saved" and "now"
                can disagree — a static list would never show you that. */}
            <p className="mb-2 text-xs text-slate-500">
              Stored as a query, re-run on every load. A saved list of people would still
              be showing the left-hand number.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Audience</th>
                    <th className="px-3 py-2 font-medium">When saved</th>
                    <th className="px-3 py-2 font-medium">Now</th>
                    <th className="px-3 py-2 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {audiences.map((a) => {
                    const drift = a.live_count === null ? null : a.live_count - a.saved_count
                    return (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{a.name}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {a.saved_count.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {a.live_count === null ? '—' : a.live_count.toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          {drift === null ? (
                            <span className="text-red-700">filter no longer runs</span>
                          ) : drift === 0 ? (
                            <span className="text-slate-400">no change</span>
                          ) : (
                            <span className={drift > 0 ? 'text-emerald-700' : 'text-amber-700'}>
                              {drift > 0 ? '+' : ''}
                              {drift.toLocaleString()}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
