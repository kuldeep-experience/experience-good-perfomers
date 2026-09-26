import { useState } from 'react'
import type { Gateway, Preview, Question } from './shared'

/**
 * What the recipient sees. Assembled server-side by renderSurvey() from the
 * campaign's own template — the model writes no part of it, so this is the
 * message rather than an impression of it.
 */
export default function SurveyPreview({ preview }: { preview: Preview }) {
  return (
    <div className="text-sm">
      <dl className="mb-3 space-y-0.5 text-xs text-slate-500">
        <div>
          <dt className="inline">From: </dt>
          <dd className="inline text-slate-700">{preview.from}</dd>
        </div>
        <div>
          <dt className="inline">To: </dt>
          <dd className="inline text-slate-700">{preview.to}</dd>
        </div>
      </dl>
      <p className="mb-2 text-base font-semibold">{preview.subject}</p>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-slate-700">{preview.intro}</p>
        <p className="mt-3 font-medium">{preview.question}</p>
        <div className="mt-2 flex gap-1 text-2xl text-amber-400" aria-hidden>
          {'★★★★★'.split('').map((star, n) => (
            <span key={n}>{star}</span>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          {preview.campaign}
          {preview.expires && ` · expires ${preview.expires}`}
          {preview.reminders > 0
            ? ` · ${preview.reminders} reminder${preview.reminders === 1 ? '' : 's'}`
            : ' · no reminders'}{' '}
          · Unsubscribe
        </p>
      </div>
    </div>
  )
}

/**
 * What the recipient answers, one question per step — the screen XMP shows
 * behind the eye icon. Reads the campaign's own questions, so the preview and
 * the thing that gets sent cannot drift apart.
 */
export function SurveyScreen({
  title,
  intro,
  questions,
  gateway,
}: {
  title: string
  intro: string
  questions: Question[]
  gateway?: Gateway
}) {
  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  // The gateway question is the secondary workflow: it comes after the survey
  // and decides which closing message the recipient lands on.
  const withGateway = gateway?.enabled && gateway.options.length > 0
  const total = questions.length + (withGateway ? 1 : 0)
  const onGateway = withGateway && step === questions.length
  const q = questions[step]
  const pct = total ? Math.round((step / total) * 100) : 0

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-6">
      <p className="text-center text-sm font-semibold tracking-tight text-slate-800">
        e<span className="text-blue-700">X</span>perience.com
      </p>

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 p-3">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-50 text-blue-700">
          ●
        </div>
        <div>
          <p className="text-sm font-semibold">John Doe</p>
          <p className="text-xs text-slate-500">Designer</p>
        </div>
      </div>

      <h3 className="mt-5 text-2xl font-bold tracking-tight">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{intro}</p>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
        <span>
          Step {Math.min(step + 1, total || 1)} of {total || 1}
        </span>
        <span>{pct}% complete</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-blue-700" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5">
        {onGateway ? (
          <>
            <p className="text-center text-base font-bold">
              {step + 1}. {gateway!.question}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {gateway!.options.map((o, i) => (
                <button
                  key={o.label}
                  onClick={() => setPicked(i)}
                  style={{
                    borderColor: o.color,
                    background: picked === i ? o.color : 'white',
                    color: picked === i ? 'white' : o.color,
                  }}
                  className="rounded-lg border-2 px-4 py-2 text-sm font-medium"
                >
                  {o.label}
                </button>
              ))}
            </div>
            {picked !== null && (
              <p className="mt-4 text-center text-sm text-slate-600">
                {gateway!.options[picked].message}
              </p>
            )}
          </>
        ) : q ? (
          <>
            <p className="text-center text-base font-bold">
              {step + 1}. {q.text || 'Untitled question'}
            </p>
            <div className="mt-4">
              <QuestionInput question={q} />
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-slate-500">No questions yet.</p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
        >
          ‹ Previous
        </button>
        <button
          onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
          disabled={step >= total - 1}
          className="rounded-lg bg-blue-800 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Next ›
        </button>
      </div>
    </div>
  )
}

/** One control per question type. Display only — nothing here is submitted. */
function QuestionInput({ question }: { question: Question }) {
  const options = question.options ?? []
  switch (question.type) {
    case 'rating':
      return (
        <div>
          <div className="flex justify-center gap-3">
            {[0, 1, 2, 3, 4].map((n) => (
              <span
                key={n}
                className="grid h-12 w-12 place-items-center rounded-full border border-slate-200 bg-white text-xl text-slate-400"
              >
                ☆
              </span>
            ))}
          </div>
          <div className="mt-2 flex justify-between px-2 text-xs text-slate-500">
            <span>poor</span>
            <span>awesome</span>
          </div>
        </div>
      )
    case 'slider':
      return (
        <div>
          <input type="range" min={0} max={10} defaultValue={5} className="w-full" />
          <div className="flex justify-between text-xs text-slate-500">
            <span>0</span>
            <span>10</span>
          </div>
        </div>
      )
    case 'open_ended':
      return (
        <textarea
          rows={3}
          placeholder="Type your answer…"
          className="w-full resize-none rounded-lg border border-slate-200 p-3 text-sm"
        />
      )
    case 'dropdown':
      return (
        <select className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm">
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )
    case 'ranking':
      return (
        <ol className="space-y-2">
          {options.map((o, i) => (
            <li
              key={o}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span className="text-slate-400">⠿</span>
              <span className="text-slate-400">{i + 1}.</span>
              {o}
            </li>
          ))}
        </ol>
      )
    default:
      // multiple_choice and likert are the same control, different wording.
      return (
        <div className={question.type === 'likert' ? 'flex flex-wrap justify-center gap-2' : 'space-y-2'}>
          {options.map((o) => (
            <label
              key={o}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <input type="radio" name={question.text} />
              {o}
            </label>
          ))}
        </div>
      )
  }
}
