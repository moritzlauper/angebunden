/**
 * Prüft `velo-korrekturen.json`, ohne die Pipeline laufen zu lassen.
 * `pnpm korrekturen:pruefen`, läuft auch in der CI bei jedem Pull Request.
 *
 * Fehler brechen ab: unbekannte Felder (meist Tippfehler, die die Pipeline
 * stillschweigend ignorieren würde), falsche Typen, vertauschte Bbox-Ecken,
 * fehlender `grund`. Warnungen brechen nicht ab: Strassennamen, die im
 * aktuellen Graphen nicht vorkommen. Das kann ein Tippfehler sein oder eine
 * Strasse, die die Stadt umbenannt hat. Die Regel wirkt dann nicht.
 *
 * Die Feldliste entspricht `velo-korrekturen.schema.json` und dem, was
 * `11-velo-netz.ts` tatsächlich liest.
 */
import { existsSync, readFileSync } from 'node:fs'

const DATEI = new URL('./velo-korrekturen.json', import.meta.url).pathname
const GRAPH = new URL('../public/data/zuerich/velo.json', import.meta.url).pathname

const fehler: string[] = []
const warnungen: string[] = []

let daten: Record<string, unknown>
try {
  daten = JSON.parse(readFileSync(DATEI, 'utf8'))
} catch (err) {
  console.error(`velo-korrekturen.json ist kein gültiges JSON: ${(err as Error).message}`)
  process.exit(1)
}

/** Stadtgebiet mit Rand, grob genug, um vertauschte lon/lat zu erwischen. */
const LON = [8.3, 8.8]
const LAT = [47.2, 47.6]
const istLon = (v: unknown) => typeof v === 'number' && v >= LON[0] && v <= LON[1]
const istLat = (v: unknown) => typeof v === 'number' && v >= LAT[0] && v <= LAT[1]
const istStufe = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 4

type Pruefer = (v: unknown) => string | null

const wahr: Pruefer = (v) => (v === true ? null : 'muss true sein (oder weglassen)')
const boolesch: Pruefer = (v) => (typeof v === 'boolean' ? null : 'muss true oder false sein')
const text: Pruefer = (v) => (typeof v === 'string' && v.trim() ? null : 'muss ein nicht leerer Text sein')
const stufe: Pruefer = (v) => (istStufe(v) ? null : 'muss eine ganze Zahl von 1 bis 4 sein')
const grund: Pruefer = (v) =>
  typeof v === 'string' && v.trim().length >= 10 ? null : 'braucht eine Begründung (mindestens ein kurzer Satz)'
const bbox: Pruefer = (v) => {
  if (!Array.isArray(v) || v.length !== 4) return 'muss [minLon, minLat, maxLon, maxLat] sein'
  const [a, b, c, d] = v
  if (!istLon(a) || !istLon(c) || !istLat(b) || !istLat(d)) return 'liegt nicht in Zürich, lon und lat vertauscht?'
  if (a >= c || b >= d) return 'Ecken vertauscht: min muss kleiner als max sein'
  return null
}
const punkt: Pruefer = (v) =>
  Array.isArray(v) && v.length === 2 && istLon(v[0]) && istLat(v[1]) ? null : 'muss [lon, lat] in Zürich sein'
const netz: Pruefer = (v) =>
  ['keins', 'basis', 'haupt', 'vorzug'].includes(v as string) ? null : 'muss keins, basis, haupt oder vorzug sein'

const FELDER: Record<string, { pflicht: string[]; felder: Record<string, Pruefer> }> = {
  regeln: {
    pflicht: ['strasse', 'grund'],
    felder: {
      strasse: text,
      bbox,
      beideRichtungen: wahr,
      veloweg: wahr,
      velostreifen: wahr,
      gesperrt: wahr,
      offen: wahr,
      stress: stufe,
      stressMin: stufe,
      stressMax: stufe,
      netz,
      fussgaenger: boolesch,
      nurFahrbahn: wahr,
      grund,
    },
  },
  verbindungen: {
    pflicht: ['von', 'nach', 'grund'],
    felder: { von: punkt, nach: punkt, name: text, stress: stufe, grund },
  },
  abbiegeverbotAusnahmen: {
    pflicht: ['von', 'nach', 'grund'],
    felder: { von: text, nach: text, bbox, grund },
  },
}

for (const schluessel of Object.keys(daten)) {
  if (!(schluessel in FELDER) && schluessel !== 'hinweis' && schluessel !== '$schema') {
    fehler.push(`Unbekannter Abschnitt "${schluessel}". Erlaubt: ${Object.keys(FELDER).join(', ')}`)
  }
}
if (!Array.isArray(daten.regeln)) fehler.push('Der Abschnitt "regeln" fehlt oder ist keine Liste.')

for (const [abschnitt, { pflicht, felder }] of Object.entries(FELDER)) {
  const liste = daten[abschnitt] ?? []
  if (!Array.isArray(liste)) {
    fehler.push(`"${abschnitt}" muss eine Liste sein.`)
    continue
  }
  liste.forEach((eintrag: Record<string, unknown>, i: number) => {
    const wo = `${abschnitt}[${i}]${typeof eintrag?.strasse === 'string' ? ` (${eintrag.strasse})` : ''}`
    if (typeof eintrag !== 'object' || eintrag === null || Array.isArray(eintrag)) {
      fehler.push(`${wo}: muss ein Objekt sein`)
      return
    }
    for (const f of pflicht) if (!(f in eintrag)) fehler.push(`${wo}: Feld "${f}" fehlt`)
    for (const [f, v] of Object.entries(eintrag)) {
      const pruefe = felder[f]
      if (!pruefe) {
        fehler.push(`${wo}: unbekanntes Feld "${f}". Erlaubt: ${Object.keys(felder).join(', ')}`)
        continue
      }
      const meldung = pruefe(v)
      if (meldung) fehler.push(`${wo}: "${f}" ${meldung}`)
    }
    if (abschnitt === 'regeln') {
      const { stress: s, stressMin: lo, stressMax: hi, gesperrt, offen } = eintrag
      if (istStufe(lo) && istStufe(hi) && (lo as number) > (hi as number)) {
        fehler.push(`${wo}: stressMin ist grösser als stressMax`)
      }
      if (s !== undefined && (lo !== undefined || hi !== undefined)) {
        warnungen.push(`${wo}: stress setzt die Stufe fest, stressMin und stressMax haben daneben keine Wirkung`)
      }
      if (gesperrt && offen) fehler.push(`${wo}: gesperrt und offen widersprechen sich`)
    }
  })
}

// Strassennamen gegen den zuletzt gebauten Graphen halten. Fehlt er (frischer
// Klon ohne Daten), wird dieser Teil übersprungen.
if (existsSync(GRAPH)) {
  const namen = new Set<string>(JSON.parse(readFileSync(GRAPH, 'utf8')).namen)
  const pruefeName = (wo: string, name: unknown) => {
    if (typeof name === 'string' && !namen.has(name)) {
      warnungen.push(`${wo}: "${name}" kommt im Velonetz nicht vor, die Regel wirkt nicht`)
    }
  }
  ;(daten.regeln as Record<string, unknown>[] | undefined)?.forEach((r, i) => pruefeName(`regeln[${i}]`, r.strasse))
  ;(daten.abbiegeverbotAusnahmen as Record<string, unknown>[] | undefined)?.forEach((r, i) => {
    pruefeName(`abbiegeverbotAusnahmen[${i}]`, r.von)
    pruefeName(`abbiegeverbotAusnahmen[${i}]`, r.nach)
  })
}

for (const w of warnungen) console.warn(`Warnung  ${w}`)
for (const f of fehler) console.error(`Fehler   ${f}`)

const anzahl = (k: string) => (Array.isArray(daten[k]) ? (daten[k] as unknown[]).length : 0)
console.log(
  `\n${anzahl('regeln')} Regeln, ${anzahl('verbindungen')} Verbindungen, ` +
    `${anzahl('abbiegeverbotAusnahmen')} Abbiegeausnahmen: ` +
    `${fehler.length} Fehler, ${warnungen.length} Warnungen`
)
if (fehler.length) process.exit(1)
