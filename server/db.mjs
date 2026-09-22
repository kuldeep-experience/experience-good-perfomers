import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

let ready

const load = (name) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8')

/** Single in-process Postgres, seeded once per server start. */
export function getDb() {
  if (!ready) {
    ready = (async () => {
      const db = await PGlite.create()
      await db.exec(load('schema.sql'))
      await db.exec(load('campaigns.sql'))
      return db
    })()
  }
  return ready
}
