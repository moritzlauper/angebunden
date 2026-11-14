// Führt die Migrationen gegen DATABASE_URL aus (getDb macht das sonst beim ersten Aufruf).
import { getDb } from '../lib/db/index.ts'

process.env.SEED_ON_EMPTY ??= '0'
await getDb()
console.log('Migrationen ausgeführt.')
process.exit(0)
