// Self-check for the validator. Pure function, no database, no model.
// Run: npm run check
import assert from 'node:assert/strict'
import { validate } from './draft.mjs'

const NOW = Date.parse('2026-09-23T12:00:00Z')
const iso = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString().slice(0, 10)

const campaign = {
  name: 'Public Reviews Campaign',
  status: 'Active',
  source_type: 'Encompass',
  allowed_participant_types: ['BORROWER', 'COBORROWER'],
  allowed_transaction_types: ['Purchase', 'Refinance'],
  expiry_days: 21,
  cooldown_days: 180,
}

const ctx = (over = {}) => ({
  campaign,
  suppressed: new Map(),
  sentKeys: new Set(),
  lastSentTo: new Map(),
  ...over,
})

const good = {
  recipient_first_name: 'John',
  recipient_last_name: 'Smith',
  email: 'john@example.com',
  contact_number: '555-0100',
  transaction_id: 'TXN-1',
  transaction_type: 'Purchase',
  transaction_date: iso(2),
  participant_type: 'BORROWER',
  city: 'Austin',
  state: 'TX',
}

const fields = (r) => r.blockers.map((b) => b.field)
const check = (draft, over) => validate(draft, ctx(over), NOW)

// A complete, matching draft is clean.
let r = check(good)
assert.deepEqual(r.blockers, [], 'a valid draft must have no blockers')
assert.deepEqual(r.warnings, [], 'a complete valid draft must have no warnings')

// The headline rule: participant type outside the campaign's set conditions.
// This is the case the UI accepts and then silently never sends.
r = check({ ...good, participant_type: 'BUYER' })
assert.deepEqual(fields(r), ['participant_type'])
assert.match(r.blockers[0].message, /BORROWER or COBORROWER/)

r = check({ ...good, participant_type: null })
assert.deepEqual(fields(r), ['participant_type'])

// Transaction type outside set conditions.
assert.deepEqual(fields(check({ ...good, transaction_type: 'Listing' })), ['transaction_type'])
// Missing transaction type is a warning, not a blocker.
r = check({ ...good, transaction_type: null })
assert.deepEqual(r.blockers, [])
assert.deepEqual(r.warnings.map((w) => w.field), ['transaction_type'])

// Required fields.
assert.deepEqual(fields(check({ ...good, email: null })), ['email'])
assert.deepEqual(fields(check({ ...good, email: 'not-an-email' })), ['email'])
assert.deepEqual(fields(check({ ...good, recipient_first_name: '  ' })), ['recipient_first_name'])
assert.deepEqual(fields(check({ ...good, transaction_id: null })), ['transaction_id'])
assert.deepEqual(fields(check({ ...good, transaction_date: null })), ['transaction_date'])

// Expiry: older than expiry_days is dead on arrival.
r = check({ ...good, transaction_date: iso(22) })
assert.deepEqual(fields(r), ['transaction_date'])
assert.match(r.blockers[0].message, /expire on arrival/)
// Exactly at the limit still sends, with a warning.
r = check({ ...good, transaction_date: iso(21) })
assert.deepEqual(r.blockers, [])
assert.deepEqual(r.warnings.map((w) => w.field), ['transaction_date'])
// Future dates are wrong.
assert.deepEqual(fields(check({ ...good, transaction_date: iso(-1) })), ['transaction_date'])

// Suppression and duplicates.
r = check(good, { suppressed: new Map([['john@example.com', 'unsubscribed']]) })
assert.deepEqual(fields(r), ['email'])
r = check(good, { sentKeys: new Set(['TXN-1|BORROWER']) })
assert.deepEqual(fields(r), ['transaction_id'])

// Cooldown warns but does not block.
r = check(good, { lastSentTo: new Map([['john@example.com', NOW - 30 * 86_400_000]]) })
assert.deepEqual(r.blockers, [])
assert.match(r.warnings[0].message, /Cooldown is 180 days/)
// Outside the cooldown window, nothing to say.
r = check(good, { lastSentTo: new Map([['john@example.com', NOW - 200 * 86_400_000]]) })
assert.deepEqual(r.warnings, [])

// Email matching is case-insensitive — a capitalised paste must not slip past
// the suppression list.
r = check({ ...good, email: 'John@Example.com' }, {
  suppressed: new Map([['john@example.com', 'bounced']]),
})
assert.deepEqual(fields(r), ['email'])

// A paused campaign sends nothing at all.
r = validate(good, ctx({ campaign: { ...campaign, status: 'Paused' } }), NOW)
assert.deepEqual(fields(r), ['campaign'])

// Optional fields downgrade to warnings.
r = check({ ...good, recipient_last_name: null, city: null })
assert.deepEqual(r.blockers, [])
assert.deepEqual(r.warnings.map((w) => w.field), ['recipient_last_name', 'city'])

console.log('validator: all checks passed')

// --- the same rules against the real seeded database ---
// Covers loadContext's queries and the array round-trip, which the pure tests
// above fake out.
const { getDb } = await import('./db.mjs')
const { loadContext, sendKey } = await import('./draft.mjs')
const db = await getDb()

const today = new Date().toISOString().slice(0, 10)
const base = {
  recipient_first_name: 'Maya',
  recipient_last_name: 'Lund',
  email: 'maya.lund@example.com',
  contact_number: null,
  transaction_id: 'TXN-NEW-1',
  transaction_type: 'Purchase',
  transaction_date: today,
  participant_type: 'BORROWER',
  city: 'Austin',
  state: 'TX',
}
// Public Reviews Campaign (id 4): Encompass, BORROWER/COBORROWER, Purchase/Refinance.
const batch = [
  base,
  { ...base, transaction_id: 'TXN-88213' },                       // already sent
  { ...base, transaction_id: 'TXN-NEW-2', participant_type: 'BUYER' }, // wrong for conditions
  { ...base, transaction_id: 'TXN-NEW-3', email: 'nina.kowalski@example.com' }, // unsubscribed
  { ...base, transaction_id: 'TXN-NEW-1' },                       // duplicate within this paste
  // Same loan, different participant. Real, and must not be treated as a dupe.
  { ...base, transaction_id: 'TXN-88213', participant_type: 'COBORROWER', email: 'co@example.com' },
]
const live = await loadContext(db, 4, batch)
assert.equal(live.campaign.name, 'Public Reviews Campaign')
assert.deepEqual(live.campaign.allowed_participant_types, ['BORROWER', 'COBORROWER'])

const verdicts = batch.map((d) => {
  const v = validate(d, live)
  if (!v.blockers.length) live.sentKeys.add(sendKey(d)) // same rule as the API
  return v.blockers.map((b) => b.field)
})
assert.deepEqual(verdicts, [
  [],
  ['transaction_id'],
  ['participant_type'],
  ['email'],
  ['transaction_id'], // caught against the earlier row in its own batch
  [],                 // co-borrower on an already-surveyed loan is a different person
])

// --- the graph boundary (discipline 08) ---
// Twelve disciplines read the graph and any one of them writing to it breaks
// the other eleven. "We only read" is worth nothing as a comment, so assert it:
// every query the compiler can emit is a select against the one read view, and
// every table this app writes is campaign-owned.
const { compile, GRAPH_VIEW } = await import('./filter.mjs')
const { readFileSync } = await import('node:fs')

const EVERY_FIELD = {
  states: ['FL'], cities: ['Miami'], industries: ['Mortgage'],
  subscription_status: ['active'], is_pro: true,
  joined_after: '2026-01-01', joined_before: '2026-12-31',
  min_avg_rating: 4, max_avg_rating: 5, min_reviews: 1, max_reviews: 50,
  has_reviews: true, reviewed_within_days: 90, unreplied_review_within_days: 90,
  has_unreplied_reviews: true, inactive_days: 60, min_srs: 100, max_srs: 800,
  order_by: 'srs_score', limit: 10,
}
for (const forCount of [false, true]) {
  const { sql } = compile(EVERY_FIELD, { forCount })
  assert.match(sql, /^select /, 'the compiler must only ever emit a select')
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i)
  // Exactly one source, and it is the read view — never a graph base table.
  assert.deepEqual([...sql.matchAll(/\bfrom\s+(\w+)/gi)].map((m) => m[1]), [GRAPH_VIEW])
}

// Nothing this app writes may target a graph-owned table.
const graphTables = [...readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8')
  .matchAll(/create table (\w+)/g)].map((m) => m[1])
const writes = [...['./api.mjs', './draft.mjs']
  .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
  .join('\n')
  .matchAll(/\b(?:insert into|update|delete from)\s+(\w+)/gi)].map((m) => m[1])
assert.ok(writes.length > 0, 'expected to find some writes to check')
for (const t of writes) {
  assert.ok(!graphTables.includes(t), `writes to graph-owned table "${t}"`)
}

console.log(`graph boundary: reads only ${GRAPH_VIEW}, writes none of [${graphTables}]`)
console.log('validator + database: all checks passed')
