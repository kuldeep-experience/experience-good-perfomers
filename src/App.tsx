import { useState } from 'react'
import AudienceBuilder from './AudienceBuilder'
import Campaigns from './Campaigns'
import Login from './Login'
import SendSurveys from './SendSurveys'
import Shell from './Shell'
import { currentSession, signOut, type Role, type Session } from './session'
import type { Campaign } from './shared'

/**
 * Two roles, because the work splits in two:
 *
 *   tier — builds the campaign and the audience, then activates it.
 *   user — a child of that tier. Sends surveys from what the tier activated,
 *          and cannot change the rules those sends are checked against.
 */
const TABS: { id: string; label: string; roles: Role[] }[] = [
  { id: 'campaigns', label: 'Campaigns', roles: ['tier'] },
  // The agent's send flow starts on the campaign list, so that is what the
  // nav calls it for them.
  { id: 'send', label: 'Send survey', roles: ['tier', 'user'] },
  { id: 'audience', label: 'Audience builder', roles: ['tier'] },
]

export default function App() {
  const [session, setSession] = useState<Session | null>(currentSession)
  const [tab, setTab] = useState('campaigns')
  // Handed over by the campaign editor: the campaign to send from, so the send
  // screen opens on the one that was just activated.
  const [handoff, setHandoff] = useState<Campaign | null>(null)

  if (!session)
    return (
      <Login
        onIn={(s) => {
          setSession(s)
          setTab(s.role === 'tier' ? 'campaigns' : 'send')
        }}
      />
    )

  const tabs = TABS.filter((t) => t.roles.includes(session.role)).map((t) =>
    t.id === 'send' && session.role === 'user' ? { ...t, label: 'Campaigns' } : t,
  )
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0].id

  return (
    <Shell
      session={session}
      tabs={tabs}
      tab={active}
      onTab={(id) => {
        setTab(id)
        if (id !== 'send') setHandoff(null)
      }}
      onSignOut={() => {
        signOut()
        setSession(null)
      }}
    >
      {active === 'campaigns' ? (
        <Campaigns
          onSend={(c) => {
            setHandoff(c)
            setTab('send')
          }}
        />
      ) : active === 'send' ? (
        <SendSurveys key={handoff?.id ?? 'any'} preset={handoff} />
      ) : (
        <AudienceBuilder />
      )}
    </Shell>
  )
}
