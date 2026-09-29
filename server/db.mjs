import { Pool } from 'pg'
import { readFileSync } from 'node:fs'

let ready

const load = (name) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8')

/** Connect to Supabase PostgreSQL. Initialize schema once per server start. */
export function getDb() {
  if (!ready) {
    ready = (async () => {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      })
      // Initialize schema (idempotent — CREATE TABLE IF NOT EXISTS)
      const client = await pool.connect()
      try {
        await client.query(load('schema.sql'))
        await client.query(load('campaigns.sql'))
      } finally {
        client.release()
      }
        
      return pool
    })()
  }
  return ready
}
