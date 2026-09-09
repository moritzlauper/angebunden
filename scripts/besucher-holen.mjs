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
 * Vor dem Abruf prüft das Script über /api/v0/me, welche Rechte am Token hängen,
 * damit ein Fehler nicht geraten werden muss. Antwortet /api/v0/stats/total mit
 * 404, rechnet es die Tageswerte ersatzweise aus /api/v0/stats/hits zusammen.
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

// Rechte am Token, wie GoatCounter sie in /api/v0/me als Bitmaske zurückgibt
// (goatcounter/api_token.go). «Read statistics» ist das, was die Statistik-
// Endpunkte verlangen.
const RECHTE = [
  [2, 'Count pageviews'],
  [4, 'Export'],
  [8, 'Read sites'],
  [16, 'Create sites'],
  [32, 'Update sites'],
  [64, 'Read statistics'],
]
const RECHT_STATISTIK = 64

let tokenName = '?'
let rechteText = '?'

/** Bricht mit einer Diagnose ab, die zum HTTP-Status passt. */
function abbruch(antwort, hinweis) {
  console.error(`Anfrage : ${antwort.url}`)
  console.error(`Antwort : HTTP ${antwort.status}`)
  console.error(`          ${klartext(antwort.text)}`)
  console.error(`Token   : «${tokenName}», ${TOKEN.length} Zeichen, Rechte: ${rechteText}`)
  console.error(`Site    : ${CODE}.goatcounter.com`)
  if (hinweis) console.error(`\n${hinweis}`)
  process.exit(1)
}

// Erst den Token selbst anschauen. /api/v0/me verlangt kein besonderes Recht und
// liefert Name und Rechte, damit ein Fehler weiter unten nicht geraten werden muss.
const me = await hole('/api/v0/me')
if (!me.ok) {
  abbruch(
    me,
    'Der Token selbst wird nicht akzeptiert. Prüfen:\n' +
      '  • Ist das Secret GOATCOUNTER_TOKEN der Token-Wert (nicht der Name)?\n' +
      `  • Auf demselben Konto angelegt, dem ${CODE}.goatcounter.com gehört?\n` +
      '  • E-Mail-Adresse bei GoatCounter bestätigt?\n' +
      `  • Stimmt der Code «${CODE}» (Repo-Variable GOATCOUNTER_CODE oder Standard)?`,
  )
}

const token = JSON.parse(me.text)?.token ?? {}
const rechte = token.permissions ?? 0
tokenName = token.name || 'ohne Namen'
rechteText = RECHTE.filter(([bit]) => rechte & bit).map(([, name]) => name).join(', ') || 'keine'

if (!(rechte & RECHT_STATISTIK)) {
  console.error(`Token «${tokenName}» hat die Rechte: ${rechteText}.`)
  console.error(
    `Es fehlt «Read statistics». Unter https://${CODE}.goatcounter.com/user/api einen\n` +
      'neuen Token mit diesem Häkchen anlegen und als Secret GOATCOUNTER_TOKEN hinterlegen.',
  )
  process.exit(1)
}

// Der eigentliche Abruf. /api/v0/stats/total liefert die Tageswerte der ganzen
// Site. Antwortet er mit 404, wird ersatzweise über /api/v0/stats/hits gerechnet:
// dieselben Tage, aber als Summe über die einzelnen Seiten. Wer an einem Tag die
// Karte und /methode ansieht, zählt dort zweimal, der Wert liegt also etwas höher.
let quelle = 'stats/total'
let stats = []

const antwort = await hole(`/api/v0/stats/total?start=${start}&end=${ende}`)
if (antwort.ok) {
  stats = JSON.parse(antwort.text).stats ?? []
} else if (antwort.status !== 404) {
  abbruch(
    antwort,
    antwort.status === 403
      ? 'GoatCounter weist den Token für diesen Endpunkt ab, obwohl er «Read statistics» trägt.'
      : antwort.status === 429
        ? 'Ratenlimite von GoatCounter. Der nächste Lauf holt die Tage nach.'
        : '',
  )
} else {
  console.error('/api/v0/stats/total: HTTP 404. Ersatzweise über /api/v0/stats/hits.')
  const hits = await hole(`/api/v0/stats/hits?start=${start}&end=${ende}&limit=200`)
  if (!hits.ok) {
    abbruch(
      hits,
      'Beide Statistik-Endpunkte antworten nicht, obwohl der Token «Read statistics» hat.\n' +
        'Das deutet auf GoatCounter selbst hin, nicht auf die Einrichtung hier.',
    )
  }
  const daten = JSON.parse(hits.text)
  if (daten.more) console.error('Achtung: mehr Seiten als abgefragt, limit erhöhen.')
  const proTag = new Map()
  for (const seite of daten.hits ?? []) {
    for (const s of seite.stats ?? []) {
      if (typeof s.day !== 'string' || typeof s.daily !== 'number') continue
      proTag.set(s.day, (proTag.get(s.day) ?? 0) + s.daily)
    }
  }
  stats = [...proTag].map(([day, daily]) => ({ day, daily }))
  quelle = 'stats/hits'
}

if (stats.length === 0) {
  console.error('Keine Tageswerte in der Antwort.')
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
  quelle: `goatcounter/${CODE} (${quelle})`,
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
