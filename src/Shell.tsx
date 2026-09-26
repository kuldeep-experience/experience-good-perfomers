import type { ReactNode } from 'react'
import type { Session } from './session'

/**
 * The frame around every screen: promo bar, sidebar, account header. It is the
 * XMP chrome, so the prototype is read as a change to the product rather than
 * a different product.
 */
type Tab = { id: string; label: string }

// Sidebar items that are not part of this prototype. They are here because the
// screen they sit on is, and a nav with two items would not be that screen.
// The tier and the agent see different sidebars in XMP, so they do here too.
const CHROME: Record<Session['role'], { group: string; items: string[] }[]> = {
  tier: [
    { group: '', items: ['Dashboard', 'Hierarchy', 'Transactions', 'Settings'] },
    { group: 'Apps', items: [] },
    { group: '', items: ['Listings', 'Transaction Monitor', 'Social Posts', 'Reviews Management'] },
  ],
  user: [
    { group: '', items: ['Home'] },
    { group: 'Command Center', items: ['Search Ranking', 'AI Visibility'] },
    { group: '', items: ['Social Posts', 'Insights', 'Network'] },
    { group: 'Account Center', items: ['Profile', 'Connections', 'Learning Hub'] },
  ],
}

// Campaigns sub-items that exist in XMP but not here. Shown greyed, because a
// sidebar that silently loses half its rows reads as a different product.
const SUB = ['Campaign Analytics', 'Incomplete Survey', 'Expired Survey', 'Bounced Transactions']

export default function Shell({
  session,
  tabs,
  tab,
  onTab,
  onSignOut,
  children,
}: {
  session: Session
  tabs: Tab[]
  tab: string
  onTab: (id: string) => void
  onSignOut: () => void
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex items-center justify-center gap-3 bg-gradient-to-r from-violet-700 to-fuchsia-600 px-6 py-2.5 text-sm text-white">
        <strong>The Next Era of Search Has Arrived</strong>
        <span className="hidden opacity-90 md:inline">
          Customers are searching right now. Don't get left out of the AI answers.
        </span>
        <span className="rounded bg-white px-3 py-1 text-xs font-semibold text-violet-800">
          Learn about AI Visibility →
        </span>
      </div>

      <div className="flex">
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">
          <p className="px-5 py-5 text-lg font-semibold tracking-tight">
            e<span className="text-blue-700">X</span>perience.com
          </p>
          <nav className="pb-8 text-sm">
            {CHROME[session.role].map(({ group, items }, gi) => (
              <div key={gi}>
                {group && (
                  <p className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {group}
                  </p>
                )}
                {items.map((label) => (
                  <p key={label} className="px-5 py-2.5 text-slate-400">
                    {label}
                  </p>
                ))}
                {/* Campaigns is the one live branch, so it sits where XMP puts
                    it rather than at the top of a prototype-shaped nav. */}
                {gi === 0 && (
                  <div className="mt-2 bg-blue-50/70">
                    <p className="px-5 py-2.5 font-medium text-blue-800">Campaigns</p>
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => onTab(t.id)}
                        className={`block w-full px-5 py-2 pl-10 text-left ${
                          t.id === tab
                            ? 'font-semibold text-blue-800'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                    {SUB.map((label) => (
                      <p key={label} className="px-5 py-2 pl-10 text-slate-400">
                        {label}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
            <div>
              <h1 className="text-lg font-semibold">DD Hotel</h1>
              <p className="text-xs text-slate-500">
                Organizations <span className="text-slate-300">›</span> Accounts{' '}
                <span className="text-slate-300">›</span> Campaigns
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-800">
                {session.org}
              </span>
              <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs">Help</span>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-sky-500 text-sm font-semibold text-white">
                {session.name[0]}
              </span>
              <div className="leading-tight">
                <p className="text-xs text-slate-500">
                  {session.role === 'user' ? 'Viewing as' : session.title}
                </p>
                <p className="text-sm font-medium">{session.name}</p>
              </div>
              <button onClick={onSignOut} className="text-xs text-slate-500 hover:text-slate-900">
                Sign out
              </button>
            </div>
          </header>

          {/* The sidebar is the real navigation; this repeats it for narrow
              screens where the sidebar is not there. */}
          <nav className="flex gap-4 border-b border-slate-200 bg-white px-6 lg:hidden">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                className={`border-b-2 py-2 text-sm ${
                  t.id === tab
                    ? 'border-blue-800 font-medium text-blue-800'
                    : 'border-transparent text-slate-500'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {children}
        </div>
      </div>
    </div>
  )
}
