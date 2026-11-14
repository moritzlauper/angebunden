// Legt Klinische Biopsychologie mit der bestehenden Aussagenbank an, falls die DB leer ist.
import { getDb } from '../lib/db/index.ts'

process.env.SEED_ON_EMPTY = '1'
await getDb()
console.log('Fertig.')
process.exit(0)
