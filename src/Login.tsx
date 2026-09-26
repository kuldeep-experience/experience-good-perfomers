import { useState } from 'react'
import { ACCOUNTS, signIn, type Session } from './session'

/** Sign-in for the two demo roles. Click a card to fill the form, or type. */
export default function Login({ onIn }: { onIn: (s: Session) => void }) {
  const [email, setEmail] = useState(ACCOUNTS[0].email)
  const [password, setPassword] = useState(ACCOUNTS[0].password)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const s = signIn(email, password)
    if (s) return onIn(s)
    setError('That email and password do not match a demo account.')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-gradient-to-r from-violet-700 to-fuchsia-600 px-6 py-2.5 text-center text-sm text-white">
        <strong>The Next Era of Search Has Arrived</strong>{' '}
        <span className="opacity-90">
          Customers are searching right now. Don't get left out of the AI answers.
        </span>
      </div>

      <div className="mx-auto grid max-w-4xl gap-8 px-6 py-16 md:grid-cols-2">
        <div>
          <p className="text-2xl font-semibold tracking-tight">
            e<span className="text-blue-700">X</span>perience.com
          </p>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-slate-500">
            Two demo accounts. The tier sets campaigns up; its user sends surveys from them.
          </p>

          <div className="mt-6 space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-700"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-700"
              />
            </label>
            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <button
              onClick={submit}
              className="w-full rounded-lg bg-blue-800 px-4 py-2.5 text-sm font-medium text-white"
            >
              Sign in
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Demo credentials
          </p>
          <div className="mt-2 space-y-3">
            {ACCOUNTS.map((a) => (
              <button
                key={a.email}
                onClick={() => {
                  setEmail(a.email)
                  setPassword(a.password)
                  setError(null)
                }}
                className={`block w-full rounded-lg border bg-white p-4 text-left hover:border-blue-700 ${
                  email === a.email ? 'border-blue-700' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-sm font-semibold text-blue-800">
                    {a.name[0]}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{a.name}</p>
                    <p className="text-xs text-slate-500">{a.title}</p>
                  </div>
                </div>
                <dl className="mt-3 space-y-0.5 text-xs text-slate-500">
                  <div>
                    <dt className="inline">Email: </dt>
                    <dd className="inline font-mono text-slate-700">{a.email}</dd>
                  </div>
                  <div>
                    <dt className="inline">Password: </dt>
                    <dd className="inline font-mono text-slate-700">{a.password}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-slate-500">
                  {a.role === 'tier'
                    ? 'Creates and activates campaigns, builds audiences.'
                    : 'Sends surveys from the campaigns the tier activated.'}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
