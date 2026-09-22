// Scores the parser against hand-written reference queries.
//   node --env-file-if-exists=.env evals/run.mjs
//   npm run eval
// Each case is one API call.
import { mkdirSync, writeFileSync } from 'node:fs'
import { getDb } from '../server/db.mjs'
import { compile } from '../server/filter.mjs'
import { parsePrompt, resolveProvider } from '../server/parse.mjs'
import { cases } from './cases.mjs'

const ids = async (db, sql, params = []) =>
  new Set((await db.query(sql, params)).rows.map((r) => r.id))

const score = (got, want) => {
  const hit = [...got].filter((id) => want.has(id)).length
  return {
    precision: got.size ? hit / got.size : want.size ? 0 : 1,
    recall: want.size ? hit / want.size : 1,
    extra: got.size - hit,
    missing: want.size - hit,
  }
}

const db = await getDb()

// node evals/run.mjs [caseNumber] [provider]   e.g. `npm run eval -- 3 grok`
const args = process.argv.slice(2)
const only = args.find((a) => /^\d+$/.test(a))
const provider = resolveProvider(args.find((a) => !/^\d+$/.test(a)))
const effort = provider === 'claude' ? process.env.PARSE_EFFORT || 'low' : 'n/a'
const selected = only ? [cases[Number(only) - 1]] : cases

console.log(`\nprovider: ${provider}   effort: ${effort}   cases: ${selected.length}\n`)

const results = []
for (const [i, c] of selected.entries()) {
  const started = Date.now()
  let row
  try {
    const { filter } = await parsePrompt(c.prompt, provider)
    const { sql, params } = compile(filter)
    const got = await ids(db, sql, params)
    const want = await ids(db, c.reference)
    const s = score(got, want)
    const passed = s.extra === 0 && s.missing === 0
    row = { ...c, filter, passed, ...s, want: want.size, got: got.size, ms: Date.now() - started }
  } catch (err) {
    row = { ...c, passed: false, error: err.message, ms: Date.now() - started }
  }
  results.push(row)

  const mark = row.passed ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${String(i + 1).padStart(2)}. ${c.name}`)
  if (!row.passed) {
    if (row.error) console.log(`        error: ${row.error}`)
    else
      console.log(
        `        expected ${row.want}, got ${row.got}  (${row.extra} extra, ${row.missing} missing)`,
      )
    if (row.filter) console.log(`        filter: ${JSON.stringify(compact(row.filter))}`)
  }
}

function compact(f) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null))
}

const passed = results.filter((r) => r.passed).length
const avgMs = Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length)
console.log(`\n${passed}/${results.length} exact matches   avg ${avgMs}ms/case\n`)

mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
// Provider names ("or/gemini") and the non-Claude effort placeholder ("n/a")
// both contain a slash, which turns into a directory in a filename.
const slug = (v) => String(v).replace(/[^a-z0-9]+/gi, '-')
const out = new URL(`./results/${slug(provider)}-${slug(effort)}-${Date.now()}.json`, import.meta.url)
writeFileSync(
  out,
  JSON.stringify({ provider, effort, passed, total: results.length, avgMs, results }, null, 2),
)
console.log(`saved ${out.pathname.split('/').slice(-2).join('/')}\n`)

process.exit(passed === results.length ? 0 : 1)
