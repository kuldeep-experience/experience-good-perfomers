import type { ReactNode } from 'react'
import type { Campaign } from './shared'

/**
 * The campaigns screen, shared by both sides of the job.
 *
 * The tier opens a campaign to edit it; the agent picks one to send from. Same
 * table, same numbers — so what the tier activates is exactly what the agent
 * sees, and neither is reading its own private copy.
 */
const day = (v: string | null | undefined) => {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(+d)
    ? '-'
    : `${d.getFullYear()} ${d.toLocaleString('en', { month: 'short' })} ${d.getDate()}`
}

export function Stats({ rows }: { rows: Campaign[] }) {
  const sent = rows.reduce((n, c) => n + c.sent, 0)
  const responses = rows.reduce((n, c) => n + c.responses, 0)
  return (
    <section className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-lg border border-slate-200 bg-white px-6 py-5">
      {[
        [sent.toLocaleString(), 'Total Surveys Sent'],
        [responses.toLocaleString(), 'Total Responses'],
        [sent ? ((responses / sent) * 100).toFixed(2) : '0.00', 'Average Completion Rate'],
        [(sent - responses).toLocaleString(), 'Incomplete Surveys'],
      ].map(([value, label]) => (
        <div
          key={label}
          className="border-slate-200 pr-10 last:border-0 [&:not(:last-child)]:border-r"
        >
          <p className="text-3xl font-semibold">{value}</p>
          <p className="text-sm text-slate-500">{label}</p>
        </div>
      ))}
    </section>
  )
}

const Stars = ({ score }: { score: number | null }) =>
  score === null ? (
    <span className="text-slate-300">-</span>
  ) : (
    <span className="flex items-center gap-2">
      <span className="text-blue-700" aria-hidden>
        {'★'.repeat(Math.round(score))}
        <span className="text-slate-200">{'★'.repeat(5 - Math.round(score))}</span>
      </span>
      <span className="text-slate-600">{score}</span>
    </span>
  )

export function CampaignTable({
  rows,
  onOpen,
  action,
}: {
  rows: Campaign[]
  onOpen: (c: Campaign) => void
  action?: (c: Campaign) => ReactNode
}) {
  return (
    <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-100 px-6 py-3 text-base font-medium">
        Campaigns
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr className="border-b border-slate-200">
            {[
              'Name',
              'Completion Rate',
              'Average Score',
              'Status',
              'Last Modified',
              'Last Activity',
              'Actions',
            ].map((h) => (
              <th key={h} className="whitespace-nowrap px-6 py-3 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const pct = c.sent ? Math.round((c.responses / c.sent) * 1000) / 10 : 0
            return (
              <tr key={c.id} className="border-b border-slate-100 last:border-0">
                <td className="px-6 py-4">
                  <button
                    onClick={() => onOpen(c)}
                    className="text-base text-blue-700 hover:underline"
                  >
                    {c.name}
                  </button>
                  <div className="mt-1 flex gap-6 text-xs text-slate-500">
                    <span>
                      Recipients <span className="block text-blue-700">{c.sent || '-'}</span>
                    </span>
                    <span className="border-l border-slate-200 pl-6">
                      Responses <span className="block text-blue-700">{c.responses || '-'}</span>
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {c.sent ? (
                    <>
                      <p className="text-xs">{pct}%</p>
                      <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={`h-full ${
                            pct >= 50 ? 'bg-emerald-500' : pct >= 25 ? 'bg-amber-400' : 'bg-red-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-300">-</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <Stars score={c.avg_score} />
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs ${
                      c.status === 'Active'
                        ? 'border-emerald-300 text-emerald-700'
                        : c.status === 'Draft'
                          ? 'border-blue-300 text-blue-700'
                          : 'border-slate-300 text-slate-500'
                    }`}
                  >
                    {c.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-slate-600">{day(c.updated_at)}</td>
                <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                  {day(c.last_activity)}
                </td>
                <td className="px-6 py-4">{action?.(c)}</td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-500">
                No campaigns yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
