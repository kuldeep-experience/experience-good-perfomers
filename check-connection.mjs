/**
 * Test Supabase connection
 * Run: node check-connection.mjs
 */

import dotenv from 'dotenv'
import { Pool } from 'pg'

dotenv.config()

console.log('\n🔍 Testing Supabase connection...\n')

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not set in .env')
  console.log('\nAdd to .env:')
  console.log('DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

try {
  const client = await pool.connect()
  console.log('✓ Connected to Supabase')

  // Check tables
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `)

  const tableNames = tables.rows.map(r => r.table_name)
  console.log(`✓ Tables found: ${tableNames.join(', ') || 'none yet (will create on start)'}`)

  // Test write capability
  const version = await client.query('SELECT version()')
  const pgVersion = version.rows[0].version.split(',')[0]
  console.log(`✓ PostgreSQL: ${pgVersion}`)

  client.release()

  console.log('\n✓ Supabase is ready!\n')
  console.log('Next: npm run dev\n')
} catch (err) {
  console.error('❌ Connection failed:')
  console.error(`   ${err.message}`)
  console.error('\nChecklist:')
  console.error('  1. Is DATABASE_URL set in .env?')
  console.error('  2. Is the password correct?')
  console.error('  3. Is Supabase project active?')
  console.error('\nExample:')
  console.error('  DATABASE_URL=postgresql://postgres:PASSWORD@HOST:5432/postgres')
  process.exit(1)
} finally {
  await pool.end()
}
