/**
 * Bringt die Datenbank im Supabase-Projekt auf den Stand von `supabase/migrations/`.
 *
 * Läuft von selbst bei jedem Build für die Produktion auf Vercel (`prebuild`), dort liefert die
 * Supabase-Integration die Adresse der Datenbank. Von Hand, gegen eine beliebige Datenbank:
 *
 *   SUPABASE_DB_URL=postgresql://… node scripts/datenbank.mjs --pflicht
 *
 * Jede Migration läuft einmal, in einer eigenen Transaktion, und wird in
 * `supabase_migrations.schema_migrations` vermerkt, derselben Tabelle wie bei `supabase db push`.
 * Die Migrationen sind wiederholbar geschrieben (`if not exists`, `drop policy if exists`): Wer sie
 * früher von Hand im SQL-Editor ausgeführt hat, dem schadet der zweite Lauf nicht.
 *
 * Ohne Adresse passiert nichts. Kommt beim Build keine Verbindung zustande, warnt das Skript und
 * der Build läuft weiter. Scheitert eine Migration selbst, bricht es ab: Die Seite soll nicht
 * live gehen, bevor die Datenbank passt, die sie erwartet.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const pflicht = process.argv.includes('--pflicht')
const ORDNER = join(import.meta.dirname, '..', 'supabase', 'migrations')

// Eigene Angabe zuerst, dann die Namen der Vercel-Integration, mit oder ohne Präfix (etwa STORAGE_).
// Die Adresse ohne Pooler oder mit Pooler im Sitzungsmodus ist die bessere, der Transaktionsmodus geht auch.
function adresse() {
  if (process.env.SUPABASE_DB_URL) return ['SUPABASE_DB_URL', process.env.SUPABASE_DB_URL]
  const namen = Object.keys(process.env)
  for (const endung of ['POSTGRES_URL_NON_POOLING', 'POSTGRES_URL']) {
    const name = namen.find((n) => (n === endung || n.endsWith(`_${endung}`)) && process.env[n])
    if (name) return [name, process.env[name]]
  }
  return null
}

function ende(text, fehler) {
  console[fehler ? 'error' : 'log'](`[datenbank] ${text}`)
  process.exit(fehler ? 1 : 0)
}

if (!pflicht && process.env.VERCEL_ENV !== 'production') ende('Kein Build für die Produktion, die Datenbank bleibt, wie sie ist.')
const gefunden = adresse()
if (!gefunden) ende('Keine Adresse der Datenbank (SUPABASE_DB_URL oder POSTGRES_URL_NON_POOLING), nichts zu tun.', pflicht)
const [quelle, roh] = gefunden

const dateien = readdirSync(ORDNER)
  .filter((d) => /^\d+_.+\.sql$/.test(d))
  .sort()

// Supabase verlangt TLS mit einem eigenen Zertifikat. `sslmode` in der Adresse würde pg zur vollen
// Prüfung gegen die üblichen Zertifizierungsstellen bringen, daran scheitert es.
const url = new URL(roh)
url.searchParams.delete('sslmode')
const lokal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
const { default: pg } = await import('pg')
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: lokal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
  statement_timeout: 120_000,
})

try {
  await client.connect()
} catch (e) {
  const text = `Keine Verbindung zur Datenbank über ${quelle} (${url.hostname}): ${e.message}`
  if (pflicht) ende(text, true)
  console.warn(`[datenbank] WARNUNG ${text}. Die Migrationen sind NICHT eingespielt.`)
  process.exit(0)
}

let neu = 0
try {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
  `)
  for (const datei of dateien) {
    const [, version, name] = datei.match(/^(\d+)_(.+)\.sql$/)
    const sql = readFileSync(join(ORDNER, datei), 'utf8')
    await client.query('begin')
    try {
      // Zwei Builds zugleich: Der zweite wartet hier und sieht dann, dass es schon erledigt ist.
      await client.query(`select pg_advisory_xact_lock(hashtext('velonavi-migrationen'))`)
      const { rowCount } = await client.query('select 1 from supabase_migrations.schema_migrations where version = $1', [version])
      if (rowCount) {
        await client.query('rollback')
        continue
      }
      await client.query(sql)
      await client.query('insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)', [version, [sql], name])
      await client.query('commit')
      neu++
      console.log(`[datenbank] eingespielt: ${datei}`)
    } catch (e) {
      await client.query('rollback').catch(() => {})
      throw new Error(`${datei}: ${e.message}`)
    }
  }
} catch (e) {
  await client.end().catch(() => {})
  ende(`Migration gescheitert, ${e.message}`, true)
}
await client.end()
ende(neu ? `${neu} Migration(en) eingespielt, ${dateien.length} insgesamt.` : `Auf dem neuesten Stand (${dateien.length} Migrationen).`)
