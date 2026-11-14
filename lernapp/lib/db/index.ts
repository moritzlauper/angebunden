import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema.ts'

/**
 * Eine Datenbank für alle: Postgres, wenn DATABASE_URL auf postgres:// zeigt
 * (Neon, Supabase, eigener Server), sonst PGlite – Postgres als WebAssembly,
 * lokal in ./.data oder mit `memory://` nur im Speicher (Tests).
 * Beide sprechen dasselbe SQL, die Migrationen in ./drizzle gelten für beide.
 */

export type Db = NodePgDatabase<typeof schema>

type Holder = { db?: Promise<Db>; ready?: Promise<void> }
const holder = ((globalThis as unknown as { __lernappDb?: Holder }).__lernappDb ??= {})

const MIGRATIONS = path.join(process.cwd(), 'drizzle')

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim() || ''
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { Pool } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const pool = new Pool({ connectionString: url, max: 5 })
    const db = drizzle(pool, { schema })
    await migrate(db, { migrationsFolder: MIGRATIONS })
    return db
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  const dataDir = url || path.join(process.cwd(), '.data', 'pglite')
  if (dataDir !== 'memory://') mkdirSync(dataDir, { recursive: true })
  const client = dataDir === 'memory://' ? new PGlite() : new PGlite(dataDir)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  // Gleiche Abfrage-API wie node-postgres; der Typ wird vereinheitlicht.
  return db as unknown as Db
}

/** Verbindet einmal pro Prozess, führt Migrationen aus und legt bei leerer DB das Startfach an. */
export async function getDb(): Promise<Db> {
  holder.db ??= connect().catch((e) => {
    holder.db = undefined // nächster Aufruf versucht es neu
    throw e
  })
  const db = await holder.db
  holder.ready ??= (async () => {
    if (process.env.SEED_ON_EMPTY !== '0') {
      const { seedIfEmpty } = await import('../seed.ts')
      await seedIfEmpty(db)
    }
  })().catch((e) => {
    holder.ready = undefined
    throw e
  })
  await holder.ready
  return db
}

/** Nur für Tests: frische In-Memory-Datenbank. */
export function resetDbForTests() {
  holder.db = undefined
  holder.ready = undefined
}

export { schema }
