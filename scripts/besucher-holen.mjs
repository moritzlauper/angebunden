/**
 * Holt bei GoatCounter die Zahl der Besuche pro Tag und schreibt sie nach
 * `analytics/besucher.json` (Rohdaten) und `analytics/besucher.csv` (zum
 * schnellen Reinschauen). Die GitHub-Action `besucher-zahlen.yml` ruft das
 * einmal pro Tag auf; von Hand geht es genauso:
 *
 *   GOATCOUNTER_TOKEN=… node scripts/besucher-holen.mjs
 *
 * Nötig:
 *   GOATCOUNTER_TOKEN   API-Token, anzulegen unter
 *                       https://<code>.goatcounter.com/user/api  mit dem Recht
 *                       «Read statistics». Der Token muss auf demselben Konto
 *                       liegen, dem die Site gehört.
 *   GOATCOUNTER_CODE    Subdomain vor .goatcounter.com; ohne Angabe «angebunden».
 *
 * GoatCounter zählt cookielos: die Kennung ist ein Hash aus IP, Browser und
 * einem täglich wechselnden Salt, nichts davon wird gespeichert. Eine Sitzung
 * hält acht Stunden und wird pro Seite einmal gezählt – wer erst die Karte und
 * dann /methode ansieht, zählt an dem Tag also zweimal. Für «wie viele Leute
 * waren heute da» ist das eine Näherung nach oben, kein exakter Wert. Die Zahlen
 * decken sich mit dem Balkendiagramm im GoatCounter-Dashboard.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ORDNER = join(dirname(fileURLToPath(import.meta.url)), '..', 'analytics')
const JSON_PFAD = join(ORDNER, 'besucher.json')
const CSV_PFAD = join(ORDNER, 'besucher.csv')

const CODE = (process.env.GOATCOUNTER_CODE || 'angebunden').trim()
// .trim() gegen ein versehentlich mitkopiertes Leerzeichen / Newline im Secret.
const TOKEN = (process.env.GOATCOUNTER_TOKEN || '').trim()
// So weit zurück wird bei jedem Lauf neu abgeglichen: gross genug, um ein paar
// ausgefallene Läufe und nachträglich korrigierte Tage aufzuholen.
const FENSTER_TAGE = 45
const ZEITZONE = 'Europe/Zurich'

if (!TOKEN) {
  console.error(
    `GOATCOUNTER_TOKEN fehlt. Token anlegen unter https://${CODE}.goatcounter.com/user/api (Recht «Read statistics»).`,
  )
  process.exit(1)
}

/** Ein GET gegen die GoatCounter-API; gibt Status und Rohtext zurück. */
async function hole(pfad) {
  const url = `https://${CODE}.goatcounter.com${pfad}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  })
  return { url, status: res.status, ok: res.ok, text: await res.text() }
}

const klartext = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)

const tag = (datum) => new Intl.DateTimeFormat('en-CA', { timeZone: ZEITZONE }).format(datum)
const heute = tag(new Date())
const start = tag(new Date(Date.now() - FENSTER_TAGE * 864e5))
const ende = tag(new Date(Date.now() + 2 * 864e5)) // grosszügig, der laufende Tag fliegt unten raus

const antwort = await hole(`/api/v0/stats/total?start=${start}&end=${ende}`)

if (!antwort.ok) {
  console.error(`Anfrage : ${antwort.url}`)
  console.error(`Antwort : HTTP ${antwort.status}`)
  console.error(`          ${klartext(antwort.text)}`)
  console.error(`Token   : ${TOKEN.length} Zeichen, Code «${CODE}»`)

  // Prüfen, ob wenigstens der Token an sich gilt.
  const me = await hole('/api/v0/me')
  if (me.ok) {
    console.error(
      '\n/api/v0/me geht – der Token gilt, aber nicht für /stats/total.\n' +
        'Dem Token fehlt das Recht «Read statistics». Unter /user/api einen neuen\n' +
        'Token mit diesem Häkchen anlegen und als Secret GOATCOUNTER_TOKEN hinterlegen.',
    )
  } else {
    console.error(
      `\n/api/v0/me : HTTP ${me.status} – der Token selbst wird nicht akzeptiert.\n` +
        `Prüfen:\n` +
        `  • Ist das Secret GOATCOUNTER_TOKEN der Token-Wert (nicht der Name)?\n` +
        `  • Auf demselben Konto angelegt, dem ${CODE}.goatcounter.com gehört?\n` +
        `  • E-Mail-Adresse bei GoatCounter bestätigt?\n` +
        `  • Stimmt der Code «${CODE}» (Repo-Variable GOATCOUNTER_CODE oder Standard)?`,
    )
  }
  process.exit(1)
}

const daten = JSON.parse(antwort.text)
const stats = Array.isArray(daten.stats) ? daten.stats : []
if (stats.length === 0) {
  console.error('Antwort ohne stats-Array:', JSON.stringify(daten).slice(0, 500))
  process.exit(1)
}

// Bestehende Zahlen lesen, das frische Fenster drüberlegen.
let tage = {}
if (existsSync(JSON_PFAD)) {
  try {
    tage = JSON.parse(await readFile(JSON_PFAD, 'utf8')).tage ?? {}
  } catch {
    // kaputte oder leere Datei – neu aufbauen
  }
}

for (const s of stats) {
  if (typeof s.day !== 'string' || typeof s.daily !== 'number') continue
  if (s.day >= heute) continue // der laufende Tag ist noch unvollständig
  tage[s.day] = s.daily
}

// Führende Nullen wegschneiden: die Tage vor dem ersten echten Besuch waren
// nicht «0 Leute», sondern noch gar nicht gemessen. Spätere Null-Tage (echt
// niemand da) bleiben drin.
const alleTage = Object.keys(tage).sort()
const ersterEchte = alleTage.find((d) => tage[d] > 0)
const sortiert = ersterEchte ? alleTage.filter((d) => d >= ersterEchte) : []
for (const d of alleTage) if (!sortiert.includes(d)) delete tage[d]
const ausgabe = {
  aktualisiert: new Date().toISOString(),
  quelle: `goatcounter/${CODE}`,
  hinweis:
    'besucher = Besuche pro Tag, cookielos gezählt (8-Stunden-Sitzung, pro Seite einmal). ' +
    `Näherung nach oben für die Zahl verschiedener Leute. Zeitzone ${ZEITZONE}.`,
  tage: Object.fromEntries(sortiert.map((d) => [d, tage[d]])),
}

await mkdir(ORDNER, { recursive: true })
await writeFile(JSON_PFAD, JSON.stringify(ausgabe, null, 2) + '\n')
await writeFile(CSV_PFAD, 'datum,besucher\n' + sortiert.map((d) => `${d},${tage[d]}`).join('\n') + '\n')

const letzter = sortiert.at(-1)
console.log(
  letzter
    ? `${sortiert.length} Tage geschrieben, zuletzt ${letzter} = ${tage[letzter]} Besuche.`
    : 'Noch keine abgeschlossenen Tage.',
)
