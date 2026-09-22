// Scores the extractor against hand-written expected forms.
//   npm run eval:extract              all cases, default provider
//   npm run eval:extract -- 4 claude  one case, one provider
// Each case is one API call.
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseDrafts, resolveProvider } from '../server/parse.mjs'
import { cases } from './extract-cases.mjs'

const FIELDS = Object.keys(cases[0].expect[0])

// Trailing spaces and casing in a city name are not errors worth failing on;
// a wrong email address is. Compare normalised, but never treat null and a
// value as equal.
const same = (got, want) => {
  if (got === null || got === undefined) return want === null
  if (want === null) return false
  return String(got).trim().toLowerCase() === String(want).trim().toLowerCase()
}

// Who a draft is about, for pairing it with its expectation. The order two
// people come back in is not a mistake — pairing by position would score a
// correct answer as two wrong rows.
const identity = (d) => (d.email ?? d.recipient_first_name ?? '').trim().toLowerCase()

const args = process.argv.slice(2)
const only = args.find((a) => /^\d+$/.test(a))
const provider = resolveProvider(args.find((a) => !/^\d+$/.test(a)))
const selected = only ? [cases[Number(only) - 1]] : cases

console.log(`\nprovider: ${provider}   cases: ${selected.length}\n`)

const results = []
for (const [i, c] of selected.entries()) {
  const started = Date.now()
  let row
  try {
    const { drafts } = await parseDrafts(c.text, provider)
    const loose = new Set(c.loose ?? [])
    const wrong = []
    // Wrong number of people is its own failure: comparing field by field
    // against a shifted list would report dozens of errors for one mistake.
    if (drafts.length !== c.expect.length) {
      wrong.push({ field: 'count', got: drafts.length, want: c.expect.length })
    } else {
      const byIdentity = new Map(drafts.map((d) => [identity(d), d]))
      c.expect.forEach((expected, n) => {
        const actual = byIdentity.get(identity(expected)) ?? drafts[n]
        for (const f of FIELDS) {
          const got = actual[f] ?? null
          const want = expected[f]
          if (loose.has(f)) {
            // Only assert presence, not the value.
            if ((got === null) !== (want === null)) {
              wrong.push({ row: n + 1, field: f, got, want: want === null ? 'empty' : 'anything' })
            }
          } else if (!same(got, want)) {
            wrong.push({ row: n + 1, field: f, got, want })
          }
        }
      })
    }
    const total = c.expect.length * FIELDS.length || 1
    row = {
      name: c.name,
      passed: wrong.length === 0,
      wrong,
      fieldAccuracy: (total - wrong.filter((w) => w.field !== 'count').length) / total,
      drafts,
      ms: Date.now() - started,
    }
  } catch (err) {
    row = { name: c.name, passed: false, error: err.message, fieldAccuracy: 0, ms: Date.now() - started }
  }
  results.push(row)

  console.log(`${row.passed ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${c.name}`)
  if (row.error) console.log(`        error: ${row.error}`)
  for (const w of row.wrong ?? []) {
    const where = w.row ? `row ${w.row} ` : ''
    console.log(`        ${where}${w.field}: got ${JSON.stringify(w.got)}, want ${JSON.stringify(w.want)}`)
  }
}

const passed = results.filter((r) => r.passed).length
const acc = results.reduce((a, r) => a + r.fieldAccuracy, 0) / results.length
const avgMs = Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length)
console.log(
  `\n${passed}/${results.length} perfect   ${(acc * 100).toFixed(1)}% of fields correct   avg ${avgMs}ms/case\n`,
)

mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
const slug = (v) => String(v).replace(/[^a-z0-9]+/gi, '-')
const out = new URL(`./results/extract-${slug(provider)}-${Date.now()}.json`, import.meta.url)
writeFileSync(out, JSON.stringify({ provider, passed, total: results.length, acc, avgMs, results }, null, 2))
console.log(`saved ${out.pathname.split('/').slice(-2).join('/')}\n`)

process.exit(passed === results.length ? 0 : 1)
