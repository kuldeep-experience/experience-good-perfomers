/**
 * Who is signed in. Two roles, because the two halves of the job belong to two
 * different people:
 *
 *   tier — sets the campaign up: the survey, the email, the set conditions.
 *   user — a child of the tier. Picks an active campaign and sends from it.
 *
 * ponytail: a demo sign-in, kept in localStorage. Nothing here is a security
 * boundary — the server does not read it. Swap for real auth before it guards
 * anything that matters.
 */
export type Role = 'tier' | 'user'

export type Session = {
  role: Role
  name: string
  email: string
  title: string
  org: string
}

export const ACCOUNTS: (Session & { password: string })[] = [
  {
    role: 'tier',
    email: 'tier@ddhotel.com',
    password: 'demo1234',
    name: 'Kuldeep Goha',
    title: 'Admin',
    org: 'ORG - DD CAMPAIGN',
  },
  {
    role: 'user',
    email: 'agent@ddhotel.com',
    password: 'demo1234',
    name: 'Riya Sharma',
    title: 'Front Desk',
    org: 'ORG - DD CAMPAIGN',
  },
]

const KEY = 'campaign-demo-session'

export function signIn(email: string, password: string): Session | null {
  const found = ACCOUNTS.find(
    (a) => a.email.toLowerCase() === email.trim().toLowerCase() && a.password === password,
  )
  if (!found) return null
  const { password: _pw, ...session } = found
  localStorage.setItem(KEY, JSON.stringify(session))
  return session
}

export function currentSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}

export const signOut = () => localStorage.removeItem(KEY)
