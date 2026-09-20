/**
 * Baut aus den Rohdaten von `10-velo-daten.ts` den Routinggraphen des Velonavi.
 *
 * Das Gerüst ist das Fuss- und Velowegnetz der Stadt Zürich, Kante für Kante
 * übernommen: 40'000 Linien, an den Enden verknotet. Jede Kante bekommt
 * dazu, was die Stadt nicht mitliefert:
 *
 * * Strassenklasse, Belag, Brücke und Tunnel aus der OSM-Linie, die ihr
 *   entlang am nächsten liegt (gleiche Richtung, höchstens 9 m daneben).
 * * Das signalisierte Tempo aus dem städtischen Datensatz, sonst aus OSM.
 * * Ob Tramgleise in der Fahrbahn liegen.
 * * Ob sie zu Vorzugsroute, Hauptnetz oder Basisnetz der Velonetzplanung gehört.
 * * Velounfälle der letzten zehn Jahre, nach Schwere gewichtet.
 * * Höhenmeter auf und ab, auf Brücken und in Tunnels linear zwischen den Enden
 *   statt über das Geländemodell, das dort den Talgrund zeigen würde.
 *
 * Daraus entsteht je Richtung eine Stressstufe von 1 (abgetrennt oder ruhig)
 * bis 4 (Mischverkehr auf Tempo 50 und mehr), angelehnt an das
 * Level-of-Traffic-Stress-Schema.
 *
 * Lichtsignale werden zu Kreuzungen zusammengefasst: alle Strassenknoten im
 * Umkreis eines städtischen Signalknotens oder einer OSM-Ampel. Ob man an
 * einer Kreuzung warten muss, entscheidet erst der Router im Browser, weil es
 * vom Abbiegen abhängt: geradeaus über die Kreuzung ja, rechts meist nicht.
 *
 * Ausgabe: `public/data/zuerich/velo.bin` (Graph, binär), `velo.json`
 * (Aufbau der Binärdatei, Namen, Ampeln), `velo-vorzug.geojson` (Karte) und
 * `velo-adressen.json` (Suche).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Readable } from 'node:stream'
import { toXY, toLonLat } from './lib/geo.ts'
import { ladeHoehen, hoehe } from './lib/elevation.ts'
import { readCsv } from './lib/csv.ts'

const RAW = new URL('../data/raw/velo/', import.meta.url).pathname
const OUT = new URL('../public/data/zuerich/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const json = (datei: string) => JSON.parse(readFileSync(RAW + datei, 'utf8'))

// ------------------------------------------------------------ Kodierung
// Die Werte hier und in `app/velonavi/graph.ts` müssen übereinstimmen.

/** Strassenklasse, 3 Bit. */
const KLASSE = {
  weg: 0, // Fuss- und Parkwege, Plätze
  veloweg: 1, // highway=cycleway
  wohnstrasse: 2, // Begegnungszone, Fussgängerzone, living_street
  neben: 3, // residential, unclassified, service
  sammel: 4, // tertiary
  haupt: 5, // primary, secondary
  feldweg: 6, // track
  treppe: 7,
} as const

/** Belag, 3 Bit. */
const BELAG = { gut: 0, platten: 1, kopfstein: 2, kies: 3, naturweg: 4 } as const

/** Tempo, 3 Bit: 0 unbekannt oder kein Motorverkehr vorgesehen. */
const TEMPO = { keins: 0, fahrverbot: 1, t20: 2, t30: 3, t50: 4, t60plus: 5 } as const

/** Velonetzplanung, 2 Bit. */
const NETZ = { keins: 0, basis: 1, haupt: 2, vorzug: 3 } as const

/**
 * Sekunden, die eine Hürde kostet. Ein Poller zwingt zum Ausweichen und
 * Abbremsen, ein Drängelgitter zum Schritttempo, ein Umlaufgitter praktisch
 * zum Absteigen und Anheben.
 */
const HUERDE: Record<string, number> = {
  bollard: 3, block: 4, chain: 5, bar: 4, log: 6, swing_gate: 6, entrance: 2,
  gate: 8, lift_gate: 8, cycle_barrier: 15,
  stile: 60, kissing_gate: 45, turnstile: 60, 'full-height_turnstile': 60,
  // Bahnübergänge: Schienen queren, oft im spitzen Winkel.
  level_crossing: 6, railway_crossing: 5,
  // Fahrbahn ohne Ampel queren oder eine Trottoirkante hinauf.
  crossing: 3, kerb: 2,
}

/** Infrastruktur je Richtung, 2 Bit. */
const INFRA = { keine: 0, streifen: 1, getrennt: 2 } as const

// ------------------------------------------------------------ Geometrie

type Linie = { xy: Float64Array; id: number }

/**
 * Raster über Liniensegmenten, 20 m Zellen. Ein Segment steht in jeder Zelle,
 * die seine Hülle berührt – bei den kurzen Segmenten städtischer Linien sind
 * das selten mehr als vier.
 */
class LinienIndex {
  zellen = new Map<number, number[]>() // Schlüssel -> [linie, segment, linie, segment, …]
  linien: Linie[] = []
  zelle: number
  constructor(zelle = 20) {
    this.zelle = zelle
  }
  private schluessel(cx: number, cy: number) {
    return (cx + 5000) * 10000 + (cy + 5000)
  }
  add(xy: Float64Array, id: number) {
    const li = this.linien.push({ xy, id }) - 1
    for (let s = 0; s + 3 < xy.length; s += 2) {
      const x0 = Math.floor(Math.min(xy[s], xy[s + 2]) / this.zelle)
      const x1 = Math.floor(Math.max(xy[s], xy[s + 2]) / this.zelle)
      const y0 = Math.floor(Math.min(xy[s + 1], xy[s + 3]) / this.zelle)
      const y1 = Math.floor(Math.max(xy[s + 1], xy[s + 3]) / this.zelle)
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const k = this.schluessel(cx, cy)
          let z = this.zellen.get(k)
          if (!z) this.zellen.set(k, (z = []))
          z.push(li, s)
        }
    }
  }
  /**
   * Nächstes Segment zu (x, y) im Umkreis `maxD`, dessen Richtung höchstens
   * `maxWinkel` Grad von `richtung` abweicht (ungerichtet). `richtung < 0`
   * heisst: Richtung egal.
   */
  naechstes(x: number, y: number, richtung: number, maxD: number, maxWinkel: number) {
    const r = Math.ceil(maxD / this.zelle)
    const cx = Math.floor(x / this.zelle)
    const cy = Math.floor(y / this.zelle)
    let beste = -1
    let besteD = maxD
    const gesehen = new Set<number>()
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        const z = this.zellen.get(this.schluessel(cx + dx, cy + dy))
        if (!z) continue
        for (let i = 0; i < z.length; i += 2) {
          const li = z[i]
          const s = z[i + 1]
          const k = li * 100000 + s
          if (gesehen.has(k)) continue
          gesehen.add(k)
          const xy = this.linien[li].xy
          const ax = xy[s], ay = xy[s + 1], bx = xy[s + 2], by = xy[s + 3]
          if (richtung >= 0 && winkelDiff(richtung, peilung(ax, ay, bx, by)) > maxWinkel) continue
          const d = abstandZuSegment(x, y, ax, ay, bx, by)
          if (d < besteD) {
            besteD = d
            beste = li
          }
        }
      }
    return beste < 0 ? null : { linie: this.linien[beste], d: besteD }
  }
}

function peilung(ax: number, ay: number, bx: number, by: number) {
  return ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360
}

/** Ungerichtete Abweichung zweier Peilungen, 0–90 Grad. */
function winkelDiff(a: number, b: number) {
  let d = Math.abs(a - b) % 180
  if (d > 90) d = 180 - d
  return d
}

function abstandZuSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

function projiziere(coords: number[][]): Float64Array {
  const xy = new Float64Array(coords.length * 2)
  coords.forEach(([lon, lat], i) => {
    const [x, y] = toXY(lon, lat)
    xy[2 * i] = x
    xy[2 * i + 1] = y
  })
  return xy
}

function laengeVon(xy: Float64Array) {
  let l = 0
  for (let i = 2; i < xy.length; i += 2) l += Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1])
  return l
}

/**
 * Stichproben entlang einer Linie alle `schritt` Meter, mit der Richtung des
 * Segments. Die ersten und letzten 3 m bleiben aus, dort liegt die Kreuzung
 * und damit die Querstrasse.
 */
function stichproben(xy: Float64Array, schritt: number) {
  const gesamt = laengeVon(xy)
  const rand = gesamt > 10 ? 3 : 0
  const punkte: { x: number; y: number; r: number }[] = []
  let bisher = 0
  let naechste = gesamt > 10 ? rand : gesamt / 2
  for (let i = 2; i < xy.length; i += 2) {
    const ax = xy[i - 2], ay = xy[i - 1], bx = xy[i], by = xy[i + 1]
    const l = Math.hypot(bx - ax, by - ay)
    while (naechste <= bisher + l && naechste <= gesamt - rand + 1e-9) {
      const t = l > 0 ? (naechste - bisher) / l : 0
      punkte.push({ x: ax + t * (bx - ax), y: ay + t * (by - ay), r: peilung(ax, ay, bx, by) })
      naechste += schritt
    }
    bisher += l
  }
  if (!punkte.length) {
    const n = xy.length / 2
    const m = Math.floor((n - 1) / 2) * 2
    punkte.push({ x: (xy[m] + xy[m + 2]) / 2, y: (xy[m + 1] + xy[m + 3]) / 2, r: peilung(xy[m], xy[m + 1], xy[m + 2], xy[m + 3]) })
  }
  return punkte
}

/**
 * Welche Linie des Index einer Kante am besten folgt: die, die bei den
 * meisten Stichproben die nächste ist. `null`, wenn keine auf mindestens
 * `minAnteil` der Stichproben kommt.
 */
function abgleich(index: LinienIndex, xy: Float64Array, maxD: number, maxWinkel: number, minAnteil: number) {
  const punkte = stichproben(xy, 5)
  const stimmen = new Map<number, number>()
  for (const p of punkte) {
    const t = index.naechstes(p.x, p.y, p.r, maxD, maxWinkel)
    if (t) stimmen.set(t.linie.id, (stimmen.get(t.linie.id) ?? 0) + 1)
  }
  let beste = -1
  let anzahl = 0
  for (const [id, n] of stimmen) if (n > anzahl) (beste = id), (anzahl = n)
  return anzahl / punkte.length >= minAnteil ? beste : null
}

// ------------------------------------------------------------ Netz der Stadt

type NetzFeature = {
  geometry: { coordinates: number[][] }
  properties: {
    name: string | null
    map_velo: number | string | null
    velo: number
    fuss: number
    veloweg: number
    velostreifen: string | null
    einbahn: string | null
  }
}

console.log('Netz der Stadt')
const netz: NetzFeature[] = json('netz.geojson').features
const knotenIndex = new Map<string, number>()
const knotenLonLat: number[] = []
const schluesselVon = (c: number[]) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`
function knoten(c: number[]) {
  const k = schluesselVon(c)
  let i = knotenIndex.get(k)
  if (i === undefined) {
    i = knotenLonLat.length / 2
    knotenIndex.set(k, i)
    knotenLonLat.push(c[0], c[1])
  }
  return i
}

type Kante = {
  von: number
  nach: number
  coords: number[][]
  xy: Float64Array
  laenge: number
  name: string
  velo: boolean
  fuss: boolean
  einbahn: 'FT' | 'TF' | null
  streifen: 'FT' | 'TF' | 'BOTH' | null
  veloweg: boolean
  // aus dem Abgleich
  klasse: number
  belag: number
  tempo: number
  tram: boolean
  bruecke: boolean
  tunnel: boolean
  osmVelo: 'weg' | 'streifen' | null
  netz: number
  unfall: number
  unfallAnzahl: number
  /** Sekunden für Poller, Tore, Bahnübergänge und Querungen auf dieser Kante. */
  huerde: number
  /** Fussgängerzone: fahren erlaubt, aber im Schritttempo zwischen Leuten. */
  fussgaenger: boolean
  /** Kategorie der städtischen Velokarte (`map_velo`), 0 heisst nicht darin. */
  velokarte: number
  /** OSM `cycleway=shared_lane`: Velopiktogramme auf der Fahrbahn, kein eigener Streifen. */
  piktogramm: boolean
  /** Fest vorgegebene Stufe aus den eigenen Korrekturen. */
  stressFest?: number
  /** Explizit gesperrte Kante, auch vor dem automatischen Lückenschluss. */
  gesperrt?: boolean
  /** Bahnhofshalle, Perron, Ladenpassage, Lift: mit dem Velo tabu. */
  innen: boolean
  /** Fahrspuren für den Autoverkehr, 0 wenn unbekannt. */
  spuren: number
  /** OSM sagt ausdrücklich, dass die Einbahn auch fürs Velo gilt. */
  einbahnStreng: boolean
  /** Einbahn, die für Velos in Gegenrichtung offen ist. */
  gegenverkehr: boolean
  /** Ob die Gegenrichtung einen eigenen Streifen hat. */
  gegenStreifen: boolean
  hoehen: number[] // je Geometriepunkt, Meter
  hoch: number
  runter: number
}

/**
 * Wege, die durch Gebäude führen. Das Netz der Stadt enthält Bahnhofshallen,
 * Perrons, Ladenpassagen, Lifte und Rolltreppen, weil es auch dem Fussverkehr
 * dient. Mit dem Velo fährt und schiebt dort niemand, deshalb fliegen sie
 * ganz aus dem Routinggraphen.
 */
const INNEN = /Bahnhofshalle|Perron|Rail City|Ladenpassage|Bahnhofpassage|Passage |Shopville|Lift|Aufzug|Rolltreppe/i

/**
 * Das Trassee selbst, im Netz der Stadt als «Tram <Haltestelle>» geführt. Ein
 * Teil davon ist dort für Velos freigegeben, gemeint ist aber das Gleisfeld
 * neben dem Perron. Querungen darüber bleiben erlaubt.
 */
const TRAMKOERPER = /^Tram .*(?<!Überquerung)$/i

const kanten: Kante[] = []
for (const f of netz) {
  const p = f.properties
  if (!p.velo && !p.fuss) continue
  const c = f.geometry.coordinates
  if (c.length < 2) continue
  const xy = projiziere(c)
  const laenge = laengeVon(xy)
  if (laenge < 0.05) continue
  const e = (p.einbahn ?? '').trim()
  const s = (p.velostreifen ?? '').trim()
  kanten.push({
    von: knoten(c[0]),
    nach: knoten(c[c.length - 1]),
    coords: c,
    xy,
    laenge,
    name: (p.name ?? '').trim(),
    velo: p.velo === 1,
    fuss: p.fuss === 1,
    einbahn: e === 'FT' || e === 'TF' ? e : null,
    streifen: s === 'FT' || s === 'TF' || s === 'BOTH' ? s : null,
    veloweg: p.veloweg === 1,
    klasse: KLASSE.weg,
    belag: BELAG.gut,
    tempo: TEMPO.keins,
    tram: false,
    bruecke: false,
    tunnel: false,
    osmVelo: null,
    netz: NETZ.keins,
    unfall: 0,
    unfallAnzahl: 0,
    huerde: 0,
    fussgaenger: false,
    velokarte: Math.min(3, Number(p.map_velo) || 0),
    piktogramm: false,
    innen: INNEN.test((p.name ?? '').trim()) || TRAMKOERPER.test((p.name ?? '').trim()),
    spuren: 0,
    einbahnStreng: false,
    gegenverkehr: false,
    gegenStreifen: false,
    hoehen: [],
    hoch: 0,
    runter: 0,
  })
}
const N = knotenLonLat.length / 2
console.log(`  ${kanten.length} Kanten, ${N} Knoten`)

// ------------------------------------------------------------ OSM-Wege

console.log('Abgleich mit OSM')
type OsmWeg = { id: number; tags: Record<string, string>; geometry: { lat: number; lon: number }[] }
const osmWege: OsmWeg[] = json('osm-wege.json').elements.filter((w: OsmWeg) => w.geometry?.length > 1)
const osmIndex = new LinienIndex()
const osmNach = new Map<number, OsmWeg>()
for (const w of osmWege) {
  osmNach.set(w.id, w)
  osmIndex.add(projiziere(w.geometry.map((g) => [g.lon, g.lat])), w.id)
}

function klasseAusOsm(t: Record<string, string>): number {
  switch (t.highway) {
    case 'motorway': case 'motorway_link': case 'trunk': case 'trunk_link':
    case 'primary': case 'primary_link': case 'secondary': case 'secondary_link':
      return KLASSE.haupt
    case 'tertiary': case 'tertiary_link':
      return KLASSE.sammel
    case 'residential': case 'unclassified': case 'service': case 'road':
      return KLASSE.neben
    case 'living_street': case 'pedestrian':
      return KLASSE.wohnstrasse
    case 'cycleway':
      return KLASSE.veloweg
    case 'track':
      return KLASSE.feldweg
    case 'steps':
      return KLASSE.treppe
    default:
      // Ein Fussweg, der ausdrücklich fürs Velo bestimmt ist, gilt als Veloweg.
      return t.bicycle === 'designated' ? KLASSE.veloweg : KLASSE.weg
  }
}

function belagAusOsm(t: Record<string, string>, klasse: number): number {
  const s = t.surface ?? ''
  if (/^(sett|cobblestone|unhewn_cobblestone|cobblestone:flattened)$/.test(s)) return BELAG.kopfstein
  if (/^(paving_stones|concrete:plates|concrete:lanes|grass_paver|metal|wood)$/.test(s)) return BELAG.platten
  if (/^(compacted|fine_gravel|gravel|pebblestone)$/.test(s)) return BELAG.kies
  if (/^(ground|dirt|earth|grass|mud|sand|unpaved|woodchips|rock)$/.test(s)) return BELAG.naturweg
  if (s) return BELAG.gut
  // Ohne Angabe: Strassen sind asphaltiert, Feld- und Waldwege eher nicht.
  if (klasse === KLASSE.feldweg) return t.tracktype === 'grade1' ? BELAG.gut : BELAG.kies
  if (klasse === KLASSE.weg && t.highway === 'path') return BELAG.kies
  return BELAG.gut
}

function tempoAusOsm(t: Record<string, string>): number {
  const m = parseInt(t.maxspeed ?? '', 10)
  if (!m) return TEMPO.keins
  if (m <= 20) return TEMPO.t20
  if (m <= 30) return TEMPO.t30
  if (m <= 50) return TEMPO.t50
  return TEMPO.t60plus
}

let osmTreffer = 0
const osmTempo = new Int8Array(kanten.length)
for (const [i, k] of kanten.entries()) {
  const id = abgleich(osmIndex, k.xy, 9, 35, 0.4)
  if (id === null) continue
  osmTreffer++
  const t = osmNach.get(id)!.tags
  k.klasse = klasseAusOsm(t)
  k.belag = belagAusOsm(t, k.klasse)
  k.bruecke = !!t.bridge && t.bridge !== 'no'
  k.tunnel = (!!t.tunnel && t.tunnel !== 'no') || t.covered === 'yes'
  osmTempo[i] = tempoAusOsm(t)
  if (t.embedded_rails === 'tram') k.tram = true
  if ((t.indoor && t.indoor !== 'no') || t.highway === 'corridor' || t.highway === 'elevator') k.innen = true
  // In Zürich sind viele Einbahnen für Velos in Gegenrichtung offen. Das Netz
  // der Stadt führt sie trotzdem als Einbahn, OSM hält es fest.
  const gegen = [t.cycleway, t['cycleway:left'], t['cycleway:right'], t['cycleway:both']].join(' ')
  if (t['oneway:bicycle'] === 'yes') k.einbahnStreng = true
  if (t['oneway:bicycle'] === 'no' || /opposite/.test(gegen)) {
    k.gegenverkehr = true
    k.gegenStreifen = /opposite_lane|opposite_track/.test(gegen)
  }
  k.spuren = Math.min(9, parseInt(t.lanes ?? '', 10) || 0)
  k.fussgaenger = t.highway === 'pedestrian' || t.highway === 'footway' || t.highway === 'steps'
  // Wo OSM «absteigen» sagt, wird geschoben, auch wenn die Stadt Velo erlaubt.
  if (t.bicycle === 'dismount') k.velo = false
  const spur = [t.cycleway, t['cycleway:both'], t['cycleway:right'], t['cycleway:left']]
  if (spur.includes('track') || spur.includes('separate')) k.osmVelo = 'weg'
  else if (spur.includes('lane')) k.osmVelo = 'streifen'
  if (spur.includes('shared_lane')) k.piktogramm = true
}
console.log(`  ${osmTreffer} von ${kanten.length} Kanten mit OSM-Partner`)

// ------------------------------------------------------------ Tempo

console.log('Tempo')
const tempoIndex = new LinienIndex()
const tempoRegime: number[] = []
for (const f of json('tempo.geojson').features) {
  const code: string = f.properties.temporegime_technical ?? ''
  const regime =
    code.startsWith('T0') ? TEMPO.fahrverbot
    : code.startsWith('T20') ? TEMPO.t20
    : code.startsWith('T30') ? TEMPO.t30
    : code.startsWith('T50') ? TEMPO.t50
    : /^T(60|80|100|120)/.test(code) ? TEMPO.t60plus
    : TEMPO.keins
  const id = tempoRegime.push(regime) - 1
  const g = f.geometry
  const teile: number[][][] = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]
  for (const t of teile) if (t.length > 1) tempoIndex.add(projiziere(t), id)
}
let tempoStadt = 0
for (const [i, k] of kanten.entries()) {
  const id = abgleich(tempoIndex, k.xy, 9, 35, 0.4)
  if (id !== null && tempoRegime[id] !== TEMPO.keins) {
    k.tempo = tempoRegime[id]
    tempoStadt++
  } else if (osmTempo[i]) {
    k.tempo = osmTempo[i]
  } else if (k.klasse >= KLASSE.neben && k.klasse <= KLASSE.haupt) {
    // Innerorts gilt ohne Signal Tempo 50.
    k.tempo = TEMPO.t50
  } else if (k.klasse === KLASSE.wohnstrasse) {
    k.tempo = TEMPO.t20
  }
}
console.log(`  ${tempoStadt} Kanten mit städtischem Temporegime`)

// ------------------------------------------------------------ Tramgleise

console.log('Tramgleise')
const tramIndex = new LinienIndex()
json('osm-tram.json').elements.forEach((w: OsmWeg, i: number) => {
  if (w.geometry?.length > 1 && w.tags?.tunnel !== 'yes') tramIndex.add(projiziere(w.geometry.map((g) => [g.lon, g.lat])), i)
})
let tramKanten = 0
for (const k of kanten) {
  // Nur Fahrbahnen: ein Veloweg neben dem Trassee hat kein Gleis unter dem Rad.
  if (k.klasse < KLASSE.wohnstrasse || k.klasse > KLASSE.haupt || k.veloweg) {
    k.tram = false
    continue
  }
  const punkte = stichproben(k.xy, 5)
  let nah = 0
  for (const p of punkte) if (tramIndex.naechstes(p.x, p.y, p.r, 5, 20)) nah++
  if (nah / punkte.length >= 0.5) k.tram = true
  if (k.tram) tramKanten++
}
console.log(`  ${tramKanten} Kanten mit Tramgleisen in der Fahrbahn`)

// ------------------------------------------------------------ Velonetzplanung

console.log('Velonetzplanung')
const netzIndex = new LinienIndex()
const netzKat: number[] = []
const vorzugFeatures: unknown[] = []
for (const f of json('velonetz.geojson').features) {
  const kat = f.properties.kategorie
  const code = kat === 'Vorzugsroute' ? NETZ.vorzug : kat === 'Hauptnetz' ? NETZ.haupt : kat === 'Basisnetz' ? NETZ.basis : NETZ.keins
  const id = netzKat.push(code) - 1
  if (f.geometry?.coordinates?.length > 1) netzIndex.add(projiziere(f.geometry.coordinates), id)
  if (code === NETZ.vorzug)
    vorzugFeatures.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: f.geometry.coordinates.map((c: number[]) => [+c[0].toFixed(6), +c[1].toFixed(6)]) },
    })
}
const netzZaehler = [0, 0, 0, 0]
for (const k of kanten) {
  if (!k.velo) continue
  const id = abgleich(netzIndex, k.xy, 12, 35, 0.5)
  if (id !== null) k.netz = netzKat[id]
  netzZaehler[k.netz]++
}
console.log(`  Basisnetz ${netzZaehler[1]}, Hauptnetz ${netzZaehler[2]}, Vorzugsroute ${netzZaehler[3]} Kanten`)

// Namen der Vorzugsrouten für die Karte, als eigene Linien mit Nummer.
const vorzugNamen = json('vorzugsrouten.geojson').features.map((f: any) => ({
  type: 'Feature',
  properties: { nr: f.properties.nummer, name: f.properties.bezeichnung?.trim(), abschnitt: f.properties.abschnitt?.trim() },
  geometry: f.geometry,
}))

// ------------------------------------------------------------ Höhen

console.log('Höhen')
ladeHoehen()
const knotenHoehe = new Float64Array(N)
const knotenFix = new Uint8Array(N)
for (const k of kanten) {
  if (!k.bruecke && !k.tunnel) knotenFix[k.von] = knotenFix[k.nach] = 1
}
for (let n = 0; n < N; n++) knotenHoehe[n] = hoehe(knotenLonLat[2 * n], knotenLonLat[2 * n + 1])
// Knoten mitten auf einer Brücke oder in einem Tunnel: die Höhe aus den
// Nachbarn mitteln, bis sie steht. Das ergibt eine gerade Linie zwischen den
// Widerlagern, auch wenn die Brücke aus vielen Kanten besteht.
const nachbarn: [number, number][][] = Array.from({ length: N }, () => [])
for (const k of kanten) {
  nachbarn[k.von].push([k.nach, k.laenge])
  nachbarn[k.nach].push([k.von, k.laenge])
}
for (let runde = 0; runde < 200; runde++) {
  for (let n = 0; n < N; n++) {
    if (knotenFix[n] || !nachbarn[n].length) continue
    let s = 0, w = 0
    for (const [m, l] of nachbarn[n]) {
      s += knotenHoehe[m] / Math.max(l, 1)
      w += 1 / Math.max(l, 1)
    }
    knotenHoehe[n] = s / w
  }
}

for (const k of kanten) {
  const h0 = knotenHoehe[k.von]
  const h1 = knotenHoehe[k.nach]
  const n = k.coords.length
  // Entlang der Linie: Anteil der Länge bis zu jedem Punkt.
  const anteil = [0]
  let bisher = 0
  for (let i = 1; i < n; i++) {
    bisher += Math.hypot(k.xy[2 * i] - k.xy[2 * i - 2], k.xy[2 * i + 1] - k.xy[2 * i - 1])
    anteil.push(bisher / k.laenge)
  }
  if (k.bruecke || k.tunnel) {
    k.hoehen = anteil.map((a) => h0 + (h1 - h0) * a)
    k.hoch = Math.max(0, h1 - h0)
    k.runter = Math.max(0, h0 - h1)
    continue
  }
  k.hoehen = k.coords.map(([lon, lat], i) => (i === 0 ? h0 : i === n - 1 ? h1 : hoehe(lon, lat)))
  // Auf und Ab aus dichten Stichproben alle 10 m. Das Raster hat 19 m, feiner
  // bringt nichts; die Endpunkte kommen aus den Knoten, damit aufeinander
  // folgende Kanten lückenlos anschliessen.
  const proben = [h0]
  const schritte = Math.max(1, Math.round(k.laenge / 10))
  let seg = 1
  for (let s = 1; s < schritte; s++) {
    const a = s / schritte
    while (seg < n - 1 && anteil[seg] < a) seg++
    const t = (a - anteil[seg - 1]) / Math.max(anteil[seg] - anteil[seg - 1], 1e-9)
    const lon = k.coords[seg - 1][0] + t * (k.coords[seg][0] - k.coords[seg - 1][0])
    const lat = k.coords[seg - 1][1] + t * (k.coords[seg][1] - k.coords[seg - 1][1])
    proben.push(hoehe(lon, lat))
  }
  proben.push(h1)
  for (let i = 1; i < proben.length; i++) {
    const d = proben[i] - proben[i - 1]
    if (d > 0) k.hoch += d
    else k.runter -= d
  }
}

// ------------------------------------------------------------ Unfälle

console.log('Unfälle')
const kantenIndex = new LinienIndex(25)
kanten.forEach((k, i) => {
  if (k.velo) kantenIndex.add(k.xy, i)
})
const SCHWERE: Record<string, number> = { as1: 5, as2: 3, as3: 2, as4: 1 }
let unfaelle = 0
const unfallPunkte: [number, number, number][] = []
await readCsv(Readable.from(readFileSync(RAW + 'unfaelle.csv', 'utf8')), (row, col) => {
  if (row[col('AccidentInvolvingBicycle')] !== 'true') return
  if (+row[col('AccidentYear')] < 2016) return
  const e = +row[col('AccidentLocation_CHLV95_E')]
  const n = +row[col('AccidentLocation_CHLV95_N')]
  if (!e || !n) return
  const [lon, lat] = lv95NachWgs(e, n)
  unfallPunkte.push([lon, lat, SCHWERE[row[col('AccidentSeverityCategory')]] ?? 1])
})
for (const [lon, lat, w] of unfallPunkte) {
  const [x, y] = toXY(lon, lat)
  const t = kantenIndex.naechstes(x, y, -1, 20, 90)
  if (!t) continue
  kanten[t.linie.id].unfall += w
  kanten[t.linie.id].unfallAnzahl++
  unfaelle++
}
console.log(`  ${unfallPunkte.length} Velounfälle seit 2016, ${unfaelle} einer Kante zugeordnet`)

/** Näherungsformel von swisstopo für LV95 nach WGS84, auf rund einen Meter genau. */
function lv95NachWgs(e: number, n: number): [number, number] {
  const y = (e - 2600000) / 1e6
  const x = (n - 1200000) / 1e6
  const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x * x * x
  return [(lon * 100) / 36, (lat * 100) / 36]
}

// ------------------------------------------------------------ Eigene Korrekturen

/**
 * Was wir besser wissen als die Datensätze. Die Stadt aktualisiert ihr Netz
 * in grossen Abständen, OSM hängt an Freiwilligen, und ein Umbau ist oft
 * monatelang in keiner der beiden Quellen. `pipeline/velo-korrekturen.json`
 * hält solche Fälle fest, mit Begründung.
 */
console.log('Eigene Korrekturen')
{
  type Regel = {
    strasse: string
    bbox?: [number, number, number, number]
    beideRichtungen?: boolean
    veloweg?: boolean
    velostreifen?: boolean
    gesperrt?: boolean
    stress?: number
    netz?: keyof typeof NETZ
    fussgaenger?: boolean
    grund?: string
  }
  const datei = new URL('./velo-korrekturen.json', import.meta.url).pathname
  const regeln: Regel[] = JSON.parse(readFileSync(datei, 'utf8')).regeln
  for (const r of regeln) {
    let betroffen = 0
    for (const k of kanten) {
      if (k.name !== r.strasse) continue
      if (r.bbox) {
        const [minLon, minLat, maxLon, maxLat] = r.bbox
        const drin = k.coords.some(([lon, lat]) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat)
        if (!drin) continue
      }
      if (r.beideRichtungen) (k.einbahn = null), (k.gegenverkehr = true)
      if (r.veloweg) k.veloweg = true
      if (r.velostreifen) k.streifen = 'BOTH'
      if (r.gesperrt) k.gesperrt = k.velo = false
      if (r.stress !== undefined) k.stressFest = r.stress
      if (r.netz !== undefined) k.netz = NETZ[r.netz]
      if (r.fussgaenger !== undefined) k.fussgaenger = r.fussgaenger
      betroffen++
    }
    console.log(`  ${r.strasse}: ${betroffen} Kanten`)
  }
}

/**
 * Eine Vorzugsroute ist immer befahrbar. Das Fuss- und Velowegnetz der Stadt
 * führt einzelne Stücke einer Vorzugsroute manchmal nur als Fussweg (z. B.
 * ein Kirchplatz, über den die Velonetzplanung trotzdem eine Vorzugsroute
 * legt) - das übersteuert die Sperre. Stufe 1, weil eine ausgeschilderte
 * Vorzugsroute keine Strecke ist, die man meidet, selbst dort, wo man
 * zwischen Fussgängern hindurchfährt. Ortskenntnis des Betreibers.
 */
console.log('Vorzugsrouten immer befahrbar')
{
  let n = 0
  for (const k of kanten) {
    if (k.netz !== NETZ.vorzug || k.velo || k.gesperrt) continue
    k.velo = true
    k.stressFest = 1
    n++
  }
  console.log(`  ${n} Kanten auf Vorzugsrouten fürs Velo freigegeben, die im Basisdatensatz nur Fussweg waren`)
}

// ------------------------------------------------------------ Lücken im Velonetz

/**
 * Die Stadt erfasst baulich abgetrennte Velowege als eigene Linien. An jeder
 * Querstrasse endet so eine Linie, und weiter geht es über eine kurze
 * «Überquerung», die im Datensatz nur für den Fussverkehr freigegeben ist.
 * Wer diese Stücke wörtlich nimmt, kann einen Veloweg nicht durchfahren: Die
 * Zweierstrasse war Richtung Stauffacher komplett unterbrochen.
 *
 * Darum: Ein kurzes Stück ohne Velofreigabe wird befahrbar, wenn es zwei
 * Velowege derselben Richtung verbindet und dabei ungefähr geradeaus führt.
 */
console.log('Lücken im Velonetz')
{
  const anKnoten: number[][] = Array.from({ length: N }, () => [])
  kanten.forEach((k, i) => {
    anKnoten[k.von].push(i)
    anKnoten[k.nach].push(i)
  })
  const peilungVon = (k: Kante, amAnfang: boolean) => {
    const xy = k.xy
    return amAnfang
      ? peilung(xy[0], xy[1], xy[2], xy[3])
      : peilung(xy[xy.length - 4], xy[xy.length - 3], xy[xy.length - 2], xy[xy.length - 1])
  }
  /**
   * In Tempo-30-Zonen und Quartierstrassen fährt man mit dem Velo in beide
   * Richtungen, auch wo die Einbahn im Datensatz noch für alle gilt. Nur wo
   * OSM ausdrücklich `oneway:bicycle=yes` sagt, bleibt die Sperre.
   */
  let quartier = 0
  for (const k of kanten) {
    if (!k.velo || !k.einbahn || k.einbahnStreng) continue
    const ruhig = k.tempo <= TEMPO.t30 && k.klasse <= KLASSE.neben
    if (!ruhig) continue
    k.einbahn = null
    quartier++
  }
  console.log(`  ${quartier} Einbahnen in Tempo-30-Quartierstrassen für Velos geöffnet`)

  /**
   * Ein Veloweg als Einbahn ohne Gegenstück daneben ist fast immer veraltet:
   * Entweder fehlt die zweite Linie im Datensatz, oder die Strecke wurde
   * inzwischen für beide Richtungen geöffnet. Die Zweierstrasse ist seit 2026
   * durchgehend befahrbar, im Datensatz steht sie noch als Einbahn.
   */
  const velowegIndex = new LinienIndex(25)
  kanten.forEach((k, i) => {
    if (k.velo && (k.veloweg || k.klasse === KLASSE.veloweg)) velowegIndex.add(k.xy, i)
  })
  let geoeffnet = 0
  for (const k of kanten) {
    if (!k.velo || !k.einbahn || !(k.veloweg || k.klasse === KLASSE.veloweg)) continue
    const proben = stichproben(k.xy, 10)
    const gegen = proben.filter((pr) => {
      const t = velowegIndex.naechstes(pr.x, pr.y, pr.r, 22, 35)
      if (!t) return false
      const n = kanten[t.linie.id]
      return n !== k && n.einbahn !== k.einbahn
    })
    if (gegen.length / proben.length > 0.5) continue
    k.einbahn = null
    geoeffnet++
  }
  console.log(`  ${geoeffnet} Velowege ohne Gegenstück in beide Richtungen geöffnet`)

  let geschlossen = 0
  for (const [i, k] of kanten.entries()) {
    if (k.gesperrt || k.velo || !k.fuss || k.innen || k.laenge > 30) continue
    // Velowege an beiden Enden, die ungefähr in der Verlängerung liegen?
    const passend = (knoten: number, richtung: number) =>
      anKnoten[knoten].some((j) => {
        const n = kanten[j]
        if (j === i || !n.velo || (!n.veloweg && n.klasse !== KLASSE.veloweg)) return false
        const r = n.von === knoten ? peilungVon(n, true) : peilungVon(n, false)
        return winkelDiff(r, richtung) < 40
      })
    const r = peilungVon(k, true)
    if (!passend(k.von, r) || !passend(k.nach, r)) continue
    k.velo = true
    k.veloweg = true
    geschlossen++
  }
  console.log(`  ${geschlossen} kurze Verbindungen zwischen Velowegen befahrbar gemacht`)
}

// ------------------------------------------------------------ Hürden

console.log('Hürden')
/** Alle Kanten im Raster, für Hürden und Abbiegeverbote. */
const alleKanten = new LinienIndex(25)
kanten.forEach((k, i) => alleKanten.add(k.xy, i))
type OsmKnoten = { lat: number; lon: number; tags?: Record<string, string> }
let huerdenZugeordnet = 0
for (const el of json('osm-huerden.json').elements as OsmKnoten[]) {
  const t = el.tags ?? {}
  let sek = 0
  if (t.barrier) {
    if (t.barrier === 'kerb') {
      // Abgesenkte Kanten sind keine Hürde, hohe schon.
      sek = t.kerb === 'lowered' || t.kerb === 'flush' ? 0 : HUERDE.kerb
    } else sek = HUERDE[t.barrier] ?? 3
    // Was ausdrücklich für Velos offen ist, hält niemanden auf.
    if (t.bicycle === 'yes' || t['bicycle:physical'] === 'no') sek = Math.min(sek, 2)
  } else if (t.railway === 'level_crossing') sek = HUERDE.level_crossing
  else if (t.railway === 'crossing' || t.railway === 'tram_crossing') sek = HUERDE.railway_crossing
  else if (t.highway === 'crossing') sek = HUERDE.crossing
  if (!sek) continue
  const [x, y] = toXY(el.lon, el.lat)
  const treffer = alleKanten.naechstes(x, y, -1, 8, 90)
  if (!treffer) continue
  kanten[treffer.linie.id].huerde += sek
  huerdenZugeordnet++
}
console.log(`  ${huerdenZugeordnet} Hindernisse einer Kante zugeordnet`)

// ------------------------------------------------------------ Stress

/** Infrastruktur in Fahrtrichtung, `vorwaerts` = von `von` nach `nach`. */
function infra(k: Kante, vorwaerts: boolean): number {
  if (k.veloweg || k.klasse === KLASSE.veloweg || k.osmVelo === 'weg') return INFRA.getrennt
  if (k.streifen === 'BOTH' || k.streifen === (vorwaerts ? 'FT' : 'TF')) return INFRA.streifen
  if (!k.streifen && k.osmVelo === 'streifen') return INFRA.streifen
  // Gegen die Einbahn: nur mit eigenem Streifen, sonst fährt man auf der Fahrbahn.
  if (k.gegenverkehr && k.einbahn === (vorwaerts ? 'TF' : 'FT')) return k.gegenStreifen ? INFRA.streifen : INFRA.keine
  return INFRA.keine
}

/**
 * Wie unangenehm eine Kante zu fahren ist, Stufe 1 bis 4.
 *
 * Der Kern ist das Level-of-Traffic-Stress-Schema aus Tempo, Strassenklasse
 * und Velostreifen; die Verkehrsmenge steckt nur indirekt darin. Dazu kommt,
 * was in Zürich den Unterschied macht und mit Autoverkehr nichts zu tun hat:
 * Kopfsteinpflaster, Tramgleise in der Fahrbahn und Fussgängerzonen, in denen
 * man zwischen Leuten hindurchkurvt. Die Gassen um das Grossmünster sind
 * autofrei und trotzdem keine Strecke, auf der man gerne fährt.
 */
function stress(k: Kante, vorwaerts: boolean): number {
  if (!k.velo) return 1
  if (k.stressFest !== undefined) return k.stressFest
  const i = infra(k, vorwaerts)
  // Velopiktogramme auf der Fahrbahn («shared_lane») sind in Zürich meist ein
  // markierter Sicherheitsstreifen. Für die Einstufung nach Tempo zählen sie
  // wie ein Streifen; Tramgleise und Fahrspuren bleiben davon unberührt.
  const iMark = i === INFRA.keine && k.piktogramm ? INFRA.streifen : i
  const strasse = k.klasse >= KLASSE.wohnstrasse && k.klasse <= KLASSE.haupt
  let s: number
  if (i === INFRA.getrennt || !strasse) s = 1
  else if (k.tempo === TEMPO.fahrverbot || k.tempo === TEMPO.t20 || k.klasse === KLASSE.wohnstrasse) s = 1
  else if (k.tempo === TEMPO.t30 || k.tempo === TEMPO.keins) {
    s = k.klasse === KLASSE.haupt ? 2 : 1
    if (iMark === INFRA.streifen) s = 1
  } else if (k.tempo === TEMPO.t50) {
    // Ein durchgehender Velostreifen macht auch eine Tempo-50-Achse fahrbar.
    // Nur auf der grossen Hauptachse bleibt er ein Strich neben viel Verkehr.
    if (iMark === INFRA.streifen) s = k.klasse === KLASSE.haupt ? 2 : 1
    else s = k.klasse === KLASSE.neben ? 3 : 4
  } else s = iMark === INFRA.streifen ? 3 : 4

  // Eine Strasse, die in der Velokarte der Stadt steht, ist eine ausgeschilderte
  // Route. Sie kann unangenehm sein, aber sie ist keine Achse, die man meidet.
  // Dasselbe gilt für Velopiktogramme auf der Fahrbahn.
  const gefuehrt = k.velokarte > 0 || k.piktogramm

  // Drei Spuren und mehr ohne eigenen Streifen: Hauptachsen mit Abbiegespuren,
  // oft mit Autobahnzufahrt. Abbiegespuren an einer Tempo-30-Kreuzung sind
  // dagegen harmlos, deshalb erst ab Tempo 50.
  if (k.spuren >= 3 && i === INFRA.keine && k.tempo >= TEMPO.t50) s = 4
  // Tramgleise in der Fahrbahn: das Vorderrad im Rillengleis ist ein häufiger
  // Sturzgrund. Mit eigenem Streifen fährt man neben den Rillen, nicht darin.
  // Auf Tempo 30 wiegt es weniger: Dort wählt man die Linie selbst und quert
  // die Rillen im günstigen Winkel, statt vom Verkehr hineingedrängt zu werden.
  if (k.tram && i === INFRA.keine) s = Math.min(4, s + (k.tempo >= TEMPO.t50 ? 2 : 1))
  // Auf einer Haupt- oder Sammelstrasse hilft auch der Streifen wenig: Das Tram
  // fährt neben einem, und beim Ausweichen landet das Vorderrad in der Rille.
  // Ohne die Sammelstrassen war eine Achse mit Gleisen und markiertem Streifen
  // ganz ohne Gleis-Aufschlag und landete auf Stufe 1 - die Brücke über die
  // Seebahn beim Lochergut etwa, die real der unangenehmste Ort im Quartier ist.
  else if (k.tram && i === INFRA.streifen && k.klasse >= KLASSE.sammel) s = Math.min(4, s + 1)
  // Kopfsteinpflaster rüttelt so stark, dass eine ruhige Gasse trotzdem
  // unangenehm ist. Feines Plaster und Kies zählen halb.
  if (k.belag === BELAG.kopfstein) s = Math.min(4, s + 2)
  else if (k.belag === BELAG.platten || k.belag === BELAG.kies || k.belag === BELAG.naturweg) s = Math.min(4, s + 1)
  // Fussgängerzonen und Plätze: fahren erlaubt, aber im Schritttempo.
  if (k.fussgaenger && k.klasse !== KLASSE.veloweg) s = Math.max(s, 2)
  // Eine Strasse in der Velokarte der Stadt ist eine ausgeschilderte Route:
  // höchstens Stufe 2, wenn nichts Hartes dazukommt, sonst höchstens Stufe 3.
  // Mit Tramgleisen oder drei Spuren bleibt sie, was sie ist.
  if (gefuehrt && k.belag !== BELAG.kopfstein) {
    // Eine Sammel- oder Nebenstrasse, die in der Velokarte steht und keine
    // Gleise hat, ist eine ausgeschilderte Veloachse: angenehm zu fahren,
    // auch wenn OSM dort Abbiegespuren meldet. Auf den grossen Hauptachsen
    // und bei Tramgleisen bleibt es bei höchstens Stufe 3.
    s = Math.min(s, !k.tram && k.klasse <= KLASSE.sammel ? 1 : 3)
  }
  return s
}

// ------------------------------------------------------------ Lichtsignale

console.log('Lichtsignale')
const strassenKnoten = new Uint8Array(N)
for (const k of kanten)
  if (k.klasse >= KLASSE.wohnstrasse && k.klasse <= KLASSE.haupt) strassenKnoten[k.von] = strassenKnoten[k.nach] = 1

const knotenXY = new Float64Array(N * 2)
for (let n = 0; n < N; n++) {
  const [x, y] = toXY(knotenLonLat[2 * n], knotenLonLat[2 * n + 1])
  knotenXY[2 * n] = x
  knotenXY[2 * n + 1] = y
}
// Knotenraster, 30 m Zellen.
const knotenRaster = new Map<string, number[]>()
for (let n = 0; n < N; n++) {
  const k = `${Math.floor(knotenXY[2 * n] / 30)},${Math.floor(knotenXY[2 * n + 1] / 30)}`
  let z = knotenRaster.get(k)
  if (!z) knotenRaster.set(k, (z = []))
  z.push(n)
}
function knotenImUmkreis(x: number, y: number, r: number) {
  const out: number[] = []
  const cx = Math.floor(x / 30), cy = Math.floor(y / 30)
  const z = Math.ceil(r / 30)
  for (let dx = -z; dx <= z; dx++)
    for (let dy = -z; dy <= z; dy++)
      for (const n of knotenRaster.get(`${cx + dx},${cy + dy}`) ?? [])
        if (Math.hypot(knotenXY[2 * n] - x, knotenXY[2 * n + 1] - y) <= r) out.push(n)
  return out
}

type Ampel = { x: number; y: number; art: 0 | 1; name: string; osm: [number, number][] }
const ampeln: Ampel[] = []
for (const f of json('lichtsignale.geojson').features) {
  const [x, y] = toXY(f.geometry.coordinates[0], f.geometry.coordinates[1])
  ampeln.push({ x, y, art: 0, name: f.properties.knotenbezeichnung ?? '', osm: [] })
}
// OSM-Ampeln im Umkreis von 60 m eines städtischen Knotens gehören zu ihm und
// vergrössern seinen Einzugsbereich. Die übrigen sind meist Fussgängerampeln
// auf freier Strecke; nahe beieinander liegende werden zusammengefasst.
for (const el of json('osm-ampeln.json').elements) {
  const [x, y] = toXY(el.lon, el.lat)
  let beste: Ampel | null = null
  let besteD = Infinity
  for (const a of ampeln) {
    const d = Math.hypot(a.x - x, a.y - y)
    if (d < besteD && (a.art === 0 ? d <= 60 : d <= 30)) (beste = a), (besteD = d)
  }
  if (beste) beste.osm.push([x, y])
  else ampeln.push({ x, y, art: 1, name: '', osm: [[x, y]] })
}

const knotenAmpel = new Int16Array(N).fill(-1)
const ampelAbstand = new Float64Array(N).fill(Infinity)
ampeln.forEach((a, ai) => {
  const kandidaten = new Set<number>()
  if (a.art === 0) for (const n of knotenImUmkreis(a.x, a.y, 30)) kandidaten.add(n)
  for (const [x, y] of a.osm) for (const n of knotenImUmkreis(x, y, 15)) kandidaten.add(n)
  for (const n of kandidaten) {
    if (!strassenKnoten[n]) continue
    const d = Math.hypot(knotenXY[2 * n] - a.x, knotenXY[2 * n + 1] - a.y)
    if (d < ampelAbstand[n]) {
      ampelAbstand[n] = d
      knotenAmpel[n] = ai
    }
  }
})
const genutzt = new Set(knotenAmpel.filter((a) => a >= 0))
console.log(
  `  ${ampeln.filter((a) => a.art === 0).length} städtische Signalknoten, ${ampeln.filter((a) => a.art === 1).length} weitere OSM-Ampeln, ${genutzt.size} davon an Knoten des Netzes`
)

// ------------------------------------------------------------ Abbiegeverbote

console.log('Abbiegeverbote')
const inzident: number[][] = Array.from({ length: N }, () => [])
kanten.forEach((k, i) => {
  inzident[k.von].push(i)
  inzident[k.nach].push(i)
})
function naechsteInzidente(n: number, lon: number, lat: number) {
  const [x, y] = toXY(lon, lat)
  let beste = -1, besteD = 8
  for (const i of inzident[n]) {
    const xy = kanten[i].xy
    for (let s = 0; s + 3 < xy.length; s += 2) {
      const d = abstandZuSegment(x, y, xy[s], xy[s + 1], xy[s + 2], xy[s + 3])
      if (d < besteD) (besteD = d), (beste = i)
    }
  }
  return beste
}
const verbote: [number, number, number][] = []
for (const f of json('abbiegeverbote.geojson').features) {
  const c: number[][] = f.geometry.coordinates
  let via: number | undefined
  let a = -1, b = -1
  if (c.length === 3) {
    via = knotenIndex.get(schluesselVon(c[1]))
    if (via === undefined) continue
    a = naechsteInzidente(via, c[0][0], c[0][1])
    b = naechsteInzidente(via, c[2][0], c[2][1])
  } else if (c.length === 2) {
    // Zwei Punkte: je einer auf der Kante davor und danach, der Knoten ist der gemeinsame.
    const [x0, y0] = toXY(c[0][0], c[0][1])
    const [x1, y1] = toXY(c[1][0], c[1][1])
    const ta = alleKanten.naechstes(x0, y0, -1, 6, 90)
    const tb = alleKanten.naechstes(x1, y1, -1, 6, 90)
    if (!ta || !tb || ta.linie.id === tb.linie.id) continue
    a = ta.linie.id
    b = tb.linie.id
    const ka = kanten[a], kb = kanten[b]
    via = ka.von === kb.von || ka.von === kb.nach ? ka.von : ka.nach === kb.von || ka.nach === kb.nach ? ka.nach : undefined
  }
  if (via === undefined || a < 0 || b < 0) continue
  verbote.push([a, b, via])
}
console.log(`  ${verbote.length} Abbiegeverbote zugeordnet`)

// Manche Abbiegeverbote der Stadt gelten nur fürs Auto, ohne dass die
// Geodaten das festhalten ("ausser Velo" auf dem Schild). Ohne Ausnahme
// blockiert das den Router an Kreuzungen, an denen Velofahren in Wahrheit
// erlaubt ist.
{
  const datei = new URL('./velo-korrekturen.json', import.meta.url).pathname
  const ausnahmen: { von: string; nach: string; bbox?: [number, number, number, number]; grund?: string }[] =
    JSON.parse(readFileSync(datei, 'utf8')).abbiegeverbotAusnahmen ?? []
  let entfernt = 0
  for (const x of ausnahmen) {
    const vorher = verbote.length
    for (let i = verbote.length - 1; i >= 0; i--) {
      const [a, b, via] = verbote[i]
      if (kanten[a].name !== x.von || kanten[b].name !== x.nach) continue
      if (x.bbox) {
        const [lon, lat] = [knotenLonLat[2 * via], knotenLonLat[2 * via + 1]]
        const [minLon, minLat, maxLon, maxLat] = x.bbox
        if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue
      }
      verbote.splice(i, 1)
    }
    entfernt += vorher - verbote.length
  }
  if (entfernt) console.log(`  ${entfernt} Abbiegeverbote als Ausnahme fürs Velo entfernt`)
}

// ------------------------------------------------------------ Ausgabe

console.log('Schreiben')
const namen: string[] = []
const namenIndex = new Map<string, number>()
const nameVon = (s: string) => {
  let i = namenIndex.get(s)
  if (i === undefined) {
    i = namen.push(s) - 1
    namenIndex.set(s, i)
  }
  return i
}

const E = kanten.length
const P = kanten.reduce((s, k) => s + k.coords.length, 0)

const knotenKoord = new Int32Array(N * 2)
for (let i = 0; i < N * 2; i++) knotenKoord[i] = Math.round(knotenLonLat[i] * 1e6)
const kanteVon = new Uint32Array(E)
const kanteNach = new Uint32Array(E)
const kantePunkte = new Uint32Array(E + 1)
const punkte = new Int32Array(P * 2)
const punktHoehe = new Int16Array(P) // Dezimeter
const laenge = new Float32Array(E)
const hochDm = new Uint16Array(E)
const runterDm = new Uint16Array(E)
const merkmale = new Uint32Array(E)
const spuren = new Uint8Array(E)
const unfall = new Uint8Array(E)
const unfallAnzahl = new Uint8Array(E)
const huerde = new Uint8Array(E)
const kanteName = new Uint16Array(E)

let p = 0
kanten.forEach((k, i) => {
  kanteVon[i] = k.von
  kanteNach[i] = k.nach
  kantePunkte[i] = p
  k.coords.forEach(([lon, lat], j) => {
    punkte[2 * p] = Math.round(lon * 1e6)
    punkte[2 * p + 1] = Math.round(lat * 1e6)
    punktHoehe[p] = Math.round(k.hoehen[j] * 10)
    p++
  })
  laenge[i] = k.laenge
  hochDm[i] = Math.min(65535, Math.round(k.hoch * 10))
  runterDm[i] = Math.min(65535, Math.round(k.runter * 10))
  unfall[i] = Math.min(255, k.unfall)
  unfallAnzahl[i] = Math.min(255, k.unfallAnzahl)
  huerde[i] = Math.min(255, Math.round(k.huerde))
  spuren[i] = k.spuren
  kanteName[i] = nameVon(k.name)

  const veloVor = k.velo && !k.innen && (k.gegenverkehr || k.einbahn !== 'TF')
  const veloRueck = k.velo && !k.innen && (k.gegenverkehr || k.einbahn !== 'FT')
  // Schieben geht, wo Fussgänger dürfen. Gegen die Einbahn auf dem Trottoir
  // ebenso, das ist der Normalfall für kurze Stücke.
  const schiebenVor = !veloVor && !k.innen && (k.fuss || k.velo)
  const schiebenRueck = !veloRueck && !k.innen && (k.fuss || k.velo)
  merkmale[i] =
    (veloVor ? 1 : 0) |
    (veloRueck ? 2 : 0) |
    (schiebenVor ? 4 : 0) |
    (schiebenRueck ? 8 : 0) |
    (infra(k, true) << 4) |
    (infra(k, false) << 6) |
    (k.tempo << 8) |
    (k.klasse << 11) |
    (k.belag << 14) |
    ((k.tram ? 1 : 0) << 17) |
    ((k.bruecke ? 1 : 0) << 18) |
    ((k.tunnel ? 1 : 0) << 19) |
    (k.netz << 20) |
    (stress(k, true) << 22) |
    (stress(k, false) << 25) |
    ((k.fussgaenger ? 1 : 0) << 28)
})
kantePunkte[E] = p

const ampelArt = new Uint8Array(ampeln.length)
ampeln.forEach((a, i) => (ampelArt[i] = a.art))
const verbotArr = new Uint32Array(verbote.flat())

// Abschnitte hintereinander, jeder auf 4 Byte ausgerichtet.
const abschnitte: [string, ArrayBufferView][] = [
  ['knotenKoord', knotenKoord],
  ['knotenAmpel', knotenAmpel],
  ['kanteVon', kanteVon],
  ['kanteNach', kanteNach],
  ['kantePunkte', kantePunkte],
  ['punkte', punkte],
  ['punktHoehe', punktHoehe],
  ['laenge', laenge],
  ['hoch', hochDm],
  ['runter', runterDm],
  ['merkmale', merkmale],
  ['unfall', unfall],
  ['unfallAnzahl', unfallAnzahl],
  ['huerde', huerde],
  ['spuren', spuren],
  ['kanteName', kanteName],
  ['ampelArt', ampelArt],
  ['verbote', verbotArr],
]
const aufbau: Record<string, { offset: number; laenge: number }> = {}
let offset = 0
for (const [name, arr] of abschnitte) {
  aufbau[name] = { offset, laenge: arr.byteLength / (arr as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT }
  offset += Math.ceil(arr.byteLength / 4) * 4
}
const bin = Buffer.alloc(offset)
for (const [name, arr] of abschnitte)
  Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(bin, aufbau[name].offset)
writeFileSync(OUT + 'velo.bin', bin)

const stressMeter = [0, 0, 0, 0, 0]
for (const k of kanten) if (k.velo) stressMeter[stress(k, true)] += k.laenge
writeFileSync(
  OUT + 'velo.json',
  JSON.stringify({
    version: 1,
    erstellt: new Date().toISOString(),
    knoten: N,
    kanten: E,
    punkte: P,
    aufbau,
    namen,
    ampeln: ampeln.map((a) => {
      const [lon, lat] = toLonLat(a.x, a.y)
      return [+lon.toFixed(6), +lat.toFixed(6), a.art, a.name]
    }),
    statistik: {
      veloKm: Math.round(kanten.filter((k) => k.velo).reduce((s, k) => s + k.laenge, 0) / 1000),
      stressKm: stressMeter.slice(1).map((m) => Math.round(m / 1000)),
      ampelKnoten: genutzt.size,
      gegenverkehr: kanten.filter((k) => k.gegenverkehr).length,
      velokarteKm: Math.round(kanten.filter((k) => k.velo && k.velokarte > 0).reduce((s, k) => s + k.laenge, 0) / 1000),
      mehrspurigKm: Math.round(kanten.filter((k) => k.velo && k.spuren >= 3).reduce((s, k) => s + k.laenge, 0) / 1000),
      innen: kanten.filter((k) => k.innen).length,
      tramkoerper: kanten.filter((k) => TRAMKOERPER.test(k.name)).length,
      huerden: huerdenZugeordnet,
      fussgaengerKm: Math.round(kanten.filter((k) => k.fussgaenger && k.velo).reduce((s, k) => s + k.laenge, 0) / 1000),
      verbote: verbote.length,
      unfaelle,
      tramKanten,
    },
  })
)
writeFileSync(
  OUT + 'velo-vorzug.geojson',
  JSON.stringify({ type: 'FeatureCollection', features: [...vorzugFeatures, ...vorzugNamen.map((f: any) => ({ ...f, properties: { ...f.properties, beschriftung: 1 } }))] })
)

// Adressen für die Suche: aus den Gebäuden der Erreichbarkeitskarte, ohne deren Kennzahlen.
const gebaeude = JSON.parse(readFileSync(OUT + 'buildings.geojson', 'utf8')).features
const adressen: [string, string | null, number, number][] = []
for (const g of gebaeude) {
  const q = g.properties
  if (q.s || q.n) adressen.push([q.s ?? q.n, q.s && q.n ? q.n : null, q.x, q.y])
}
writeFileSync(OUT + 'velo-adressen.json', JSON.stringify(adressen))

console.log(`  velo.bin ${(bin.length / 1e6).toFixed(1)} MB, ${adressen.length} Adressen`)
console.log(`  Stress 1–4 (km, vorwärts): ${stressMeter.slice(1).map((m) => Math.round(m / 1000)).join(' / ')}`)
