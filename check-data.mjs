/**
 * Check what's stored in PGlite
 * Run: node check-data.mjs
 */

import { getDb } from './server/db.mjs'

const db = await getDb()

console.log('\n=== CAMPAIGNS ===\n')
const campaigns = await db.query(`
  SELECT id, name, status, created_at, updated_at
  FROM campaigns
  ORDER BY id DESC
`)
console.log(`Total campaigns: ${campaigns.rows.length}`)
campaigns.rows.forEach(c => {
  console.log(`  ${c.id}. ${c.name} [${c.status}] - Updated: ${c.updated_at}`)
})

console.log('\n=== SURVEY SENDS ===\n')
const sends = await db.query(`
  SELECT
    id, campaign_id, recipient_first_name, recipient_last_name,
    email, transaction_type, sent_at, status
  FROM survey_sends
  ORDER BY sent_at DESC
  LIMIT 20
`)
console.log(`Total sends: ${sends.rows.length} (showing last 20)`)
sends.rows.forEach(s => {
  console.log(`  ${s.id}. ${s.recipient_first_name} ${s.recipient_last_name} (${s.email}) - ${s.transaction_type} - ${s.sent_at} [${s.status}]`)
})

console.log('\n=== STATS BY CAMPAIGN ===\n')
const stats = await db.query(`
  SELECT
    c.name,
    COUNT(s.id) as total_sent,
    COUNT(s.id) FILTER (WHERE s.status = 'completed') as completed,
    ROUND(AVG(s.rating)::numeric, 2) as avg_rating
  FROM campaigns c
  LEFT JOIN survey_sends s ON c.id = s.campaign_id
  GROUP BY c.id, c.name
  ORDER BY c.id
`)
console.log('Campaign Statistics:')
stats.rows.forEach(row => {
  console.log(`  ${row.name}: ${row.total_sent} sent, ${row.completed} completed, avg rating: ${row.avg_rating}`)
})

console.log('\n')
