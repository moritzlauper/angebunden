/**
 * Rechnet die Erreichbarkeitskennzahl für jedes Gebäude.
 *
 * Kennzahl: die mittlere Reisezeit von diesem Haus zu einer zufällig gezogenen
 * Adresse der Stadt, Türe zu Türe, gemittelt über ein Abfahrtsfenster am Morgen.
 *
 *   score(h) = Σ_z  gewicht(z) · reisezeit(h, z)  /  Σ_z gewicht(z)
 *
 * Nicht die Summe, sondern der Durchschnitt: die Zahl bleibt so eine Zeitangabe,
 * die man direkt lesen kann ("von hier aus im Schnitt 24 Minuten"). Das Gewicht
 * ist die Zahl der Adressen in der Zielzelle, damit dicht bebaute Ziele stärker
 * zählen als leere Flächen.
 *
 *   reisezeit(h, z) = min(
 *       Fussweg direkt,
 *       min über die nahen Haltestellen a von  Fussweg(h,a) + ÖV-Zeit(a, z)
 *   )
 *
 * ÖV-Zeit(a, z) enthält Wartezeit, Fahrzeit, Umsteigen und den Ausstiegs-Fussweg
 * und ist über alle Abfahrtszeitpunkte des Fensters gemittelt. Dadurch schlägt
 * sich die Taktdichte direkt in der Zahl nieder.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { toXY, toLonLat, dist } from './lib/geo.ts'
import {
  ladeHoehen,
  hoehe,
  gehSekunden,
  veloSekunden,
  gehSekundenWeg,
  veloSekundenWeg,
} from './lib/elevation.ts'
import { Raptor, toRaptorNetwork, INF } from './lib/raptor.ts'
import { augmentiere, ladeWalkGraph, groessteKomponente, WalkDijkstra } from './lib/walkgraph.ts'
import { CONFIG } from './config.ts'
import { aktiveStadt } from './staedte.ts'

const STADT = aktiveStadt()
const DERIVED = new URL(`../data/derived/${STADT.schluessel}/`, import.meta.url).pathname
const PUBLIC = new URL(`../public/data/${STADT.schluessel}/`, import.meta.url).pathname
mkdirSync(PUBLIC, { recursive: true })

const t0 = Date.now()
const lap = (s: string) => console.log(`  ${s} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)

console.log('Lade Netz und Ziele')
const rawNet = JSON.parse(readFileSync(DERIVED + 'network.json', 'utf8'))
const targets = JSON.parse(readFileSync(DERIVED + 'targets.json', 'utf8'))
const net = toRaptorNetwork(rawNet)

ladeHoehen()

const nStations = net.nStations
const stX = new Float64Array(nStations)
const stY = new Float64Array(nStations)
const stH = new Float64Array(nStations)
for (let i = 0; i < nStations; i++) {
  const [x, y] = toXY(rawNet.lon[i], rawNet.lat[i])
  stX[i] = x
  stY[i] = y
  stH[i] = hoehe(rawNet.lon[i], rawNet.lat[i])
}

type Cell = { x: number; y: number; w: number }
const cells: Cell[] = targets.cells
const nCells = cells.length
const cellX = new Float64Array(cells.map((c) => c.x))
const cellY = new Float64Array(cells.map((c) => c.y))
const cellW = new Float64Array(cells.map((c) => c.w))
const cellH = new Float64Array(
  cells.map((c) => {
    const [lon, lat] = toLonLat(c.x, c.y)
    return hoehe(lon, lat)
  })
)
const cellWSum = cellW.reduce((a, b) => a + b, 0)

type Building = {
  id: number
  x: number
  y: number
  area: number
  ring: number[]
  name?: string
  addr?: string
}
const buildings: Building[] = targets.buildings
const bldH = new Float64Array(
  buildings.map((b) => {
    const [lon, lat] = toLonLat(b.x, b.y)
    return hoehe(lon, lat)
  })
)
lap(`${nStations} Haltestellen, ${nCells} Zielzellen, ${buildings.length} Gebäude`)

// ---------------------------------------------------------------- Fussweggraph

/**
 * Echte Gehdistanzen: alle kurzen Wege (Kultur-Score, ÖV-Zu- und -Ausstieg)
 * laufen über den OSM-Fussweggraphen statt über Luftlinie × Umwegfaktor. Brücken,
 * Treppen und Unterführungen zählen; ein Haus hinter dem Fluss braucht den Umweg
 * über die Brücke. Der lange "alles zu Fuss"-Vergleichswert bleibt Luftlinie.
 */
const rohGraph = JSON.parse(readFileSync(DERIVED + 'walk.json', 'utf8'))

// Kulturorte schon hier laden – sie sind Ankerpunkte des Graphen.
// KULTUR_ARTEN deckungsgleich mit `03-build-targets.ts` halten (dort exportiert,
// aber nicht importierbar, weil dieses Skript beim Import sofort losrechnet).
const KULTUR_ARTEN = ['cafe', 'bar', 'buehne', 'kino', 'museum', 'kunst', 'bibliothek', 'badi', 'treff', 'restaurant'] as const
const AZ = KULTUR_ARTEN.length
type Kulturort = { art: (typeof KULTUR_ARTEN)[number]; x: number; y: number }
const kultur: Kulturort[] = targets.kultur ?? []

// Alle Ankerpunkte in einer Reihe: Gebäude | Zielzellen | Haltestellen | Kulturorte.
const OFF_ZELLE = buildings.length
const OFF_STOP = OFF_ZELLE + nCells
const OFF_KULTUR = OFF_STOP + nStations
const anker: { x: number; y: number }[] = new Array(OFF_KULTUR + kultur.length)
for (let b = 0; b < buildings.length; b++) anker[b] = { x: buildings[b].x, y: buildings[b].y }
for (let c = 0; c < nCells; c++) anker[OFF_ZELLE + c] = { x: cellX[c], y: cellY[c] }
for (let s = 0; s < nStations; s++) anker[OFF_STOP + s] = { x: stX[s], y: stY[s] }
for (let i = 0; i < kultur.length; i++) anker[OFF_KULTUR + i] = { x: kultur[i].x, y: kultur[i].y }

// Anker snappen nur ans zusammenhängende Hauptnetz, nicht an eine geometrisch
// näher liegende, aber abgetrennte Weginsel (OSM-Digitalisierlücke, privater
// Stichweg). Ein Haus im Innenhof kommt so über die Strasse ans Netz, statt auf
// der Insel hängenzubleiben und die Haltestelle nur über die Luftlinie zu sehen.
// Dazu erst die Komponenten des rohen Graphen bestimmen.
const hauptRoh = groessteKomponente(ladeWalkGraph(rohGraph))
const aug = augmentiere(rohGraph, anker, CONFIG.walk.maxSnapM, hauptRoh)
const wg = ladeWalkGraph(aug)

// Sicherheitsnetz: Anker, die auch so keinen Hauptnetz-Knoten in `maxSnapM`
// fanden (weit abgelegen), gelten als nicht angeschlossen und kommen über die
// Luftlinie ans Ziel – nicht auf den langsamen „alles zu Fuss"-Wert.
const hauptnetz = groessteKomponente(wg)
let inselAnker = 0
for (let i = 0; i < aug.ankerKnoten.length; i++)
  if (aug.ankerKnoten[i] >= 0 && !hauptnetz[aug.ankerKnoten[i]]) {
    aug.ankerKnoten[i] = -1
    inselAnker++
  }

const nodeHoehe = new Float64Array(wg.n)
for (let i = 0; i < wg.n; i++) nodeHoehe[i] = hoehe(wg.nodeLon[i], wg.nodeLat[i])

// Kantensekunden mit Steigung. Velo sperrt Treppen (∞).
const edgeFussSek = new Float64Array(wg.m)
const edgeVeloSek = new Float64Array(wg.m)
for (let e = 0; e < wg.m; e++) {
  const dz = nodeHoehe[wg.edgeB[e]] - nodeHoehe[wg.edgeA[e]]
  edgeFussSek[e] = gehSekundenWeg(wg.edgeLen[e], dz)
  edgeVeloSek[e] = wg.edgeTreppe[e] ? Infinity : veloSekundenWeg(wg.edgeLen[e], dz)
}

/** Lotweg eines Ankers auf sein Kantenknoten – flach, kurz. `null` = kein Weg nah. */
type Lot = { node: number; fuss: number; velo: number } | null
function lot(ankerIdx: number): Lot {
  const node = aug.ankerKnoten[ankerIdx]
  if (node < 0) return null
  const m = aug.ankerLot[ankerIdx]
  return { node, fuss: gehSekundenWeg(m, 0), velo: veloSekundenWeg(m, 0) }
}
const bldLot = buildings.map((_, b) => lot(b))
const cellLot = Array.from({ length: nCells }, (_, c) => lot(OFF_ZELLE + c))
const stopLot = Array.from({ length: nStations }, (_, s) => lot(OFF_STOP + s))
const kulturLot = kultur.map((_, i) => lot(OFF_KULTUR + i))

// Graphknoten -> Gebäude / Zellen, die dort hängen (jeder Anker an genau einem Knoten).
const knotenGeb = new Map<number, number[]>()
const knotenZelle = new Map<number, number[]>()
const haenge = (map: Map<number, number[]>, node: number, ziel: number) => {
  const b = map.get(node)
  if (b) b.push(ziel)
  else map.set(node, [ziel])
}
for (let b = 0; b < buildings.length; b++) if (bldLot[b]) haenge(knotenGeb, bldLot[b]!.node, b)
for (let c = 0; c < nCells; c++) if (cellLot[c]) haenge(knotenZelle, cellLot[c]!.node, c)

const walker = new WalkDijkstra(wg)
lap(
  `Fussweggraph: ${wg.n} Knoten, ${wg.m} Kanten, ${inselAnker} Anker ohne Hauptnetz in ${CONFIG.walk.maxSnapM} m, ` +
    `${bldLot.filter((a) => !a).length} Gebäude / ${stopLot.filter((a) => !a).length} Haltestellen / ` +
    `${kulturLot.filter((a) => !a).length} Kulturorte ohne Weg`
)

// ---------------------------------------------------------------- ÖV-Zu- und -Ausstieg

/**
 * Je Haltestelle ein gekappter Dijkstra über das Fussnetz; daraus je Gebäude bzw.
 * Zielzelle die nahen Haltestellen mit echter Gehzeit sammeln. Ersetzt die
 * frühere Luftlinien-Suche `stopsNear`.
 */
// Budget der Zuweg-Dijkstras: das Meterlimit als Fussweg, grosszügig für den
// realen Umweg im Netz. Barrieregetrennte Haltestellen fallen so raus, nahe
// bleiben auch mit Umweg drin.
const capAccess = gehSekundenWeg(CONFIG.maxAccessWalkM * 2, 0)
const capEgress = gehSekundenWeg(CONFIG.maxEgressWalkM * 2, 0)

const gebZuStop: { stop: number; sec: number }[][] = Array.from({ length: buildings.length }, () => [])
const zelleZuStop: { stop: number; sec: number }[][] = Array.from({ length: nCells }, () => [])

for (let s = 0; s < nStations; s++) {
  const anker = stopLot[s]
  if (!anker) continue
  const d = walker.run([{ node: anker.node, sek: anker.fuss }], Math.max(capAccess, capEgress), edgeFussSek)
  for (const u of walker.angefasst()) {
    const geb = knotenGeb.get(u)
    if (geb) {
      for (const b of geb) {
        const t = d[bldLot[b]!.node] + bldLot[b]!.fuss
        if (t <= capAccess) gebZuStop[b].push({ stop: s, sec: t })
      }
    }
    const zel = knotenZelle.get(u)
    if (zel) {
      for (const c of zel) {
        const t = d[cellLot[c]!.node] + cellLot[c]!.fuss
        if (t <= capEgress) zelleZuStop[c].push({ stop: s, sec: t })
      }
    }
  }
}

// Fallback per Luftlinie: Ziele ohne Weg-Anschluss, und Haltestellen ausserhalb
// des Weg-Ausschnitts (Umland) – dort ist das Netz einfach, die Näherung reicht.
const CELLST = 500
const stKey = (gx: number, gy: number) => gx * 100003 + gy
const rastere = (n: number, pos: (i: number) => [number, number]) => {
  const m = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const [x, y] = pos(i)
    const k = stKey(Math.floor(x / CELLST), Math.floor(y / CELLST))
    const a = m.get(k)
    if (a) a.push(i)
    else m.set(k, [i])
  }
  return m
}
const zellGrid = rastere(nCells, (c) => [cellX[c], cellY[c]])
const gebGrid = rastere(buildings.length, (b) => [buildings[b].x, buildings[b].y])
const stGrid = rastere(nStations, (s) => [stX[s], stY[s]])
function nahe(grid: Map<number, number[]>, x: number, y: number, maxM: number) {
  const r = Math.ceil(maxM / CELLST)
  const gx = Math.floor(x / CELLST)
  const gy = Math.floor(y / CELLST)
  const out: number[] = []
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++) out.push(...(grid.get(stKey(gx + dx, gy + dy)) ?? []))
  return out
}
for (let s = 0; s < nStations; s++) {
  if (stopLot[s]) continue
  for (const b of nahe(gebGrid, stX[s], stY[s], CONFIG.maxAccessWalkM)) {
    const dd = dist(buildings[b].x, buildings[b].y, stX[s], stY[s])
    if (dd <= CONFIG.maxAccessWalkM) gebZuStop[b].push({ stop: s, sec: gehSekunden(dd, stH[s] - bldH[b]) })
  }
  for (const c of nahe(zellGrid, stX[s], stY[s], CONFIG.maxEgressWalkM)) {
    const dd = dist(cellX[c], cellY[c], stX[s], stY[s])
    if (dd <= CONFIG.maxEgressWalkM) zelleZuStop[c].push({ stop: s, sec: gehSekunden(dd, stH[s] - cellH[c]) })
  }
}
// Ziele, die über das Wegnetz keine Haltestelle gefunden haben (nicht gesnappt,
// auf einer Weginsel, oder keine Haltestelle im Budget erreichbar): rundum
// Luftlinie zu allen Haltestellen.
for (let b = 0; b < buildings.length; b++) {
  if (gebZuStop[b].length > 0) continue
  for (const s of nahe(stGrid, buildings[b].x, buildings[b].y, CONFIG.maxAccessWalkM)) {
    const dd = dist(buildings[b].x, buildings[b].y, stX[s], stY[s])
    if (dd <= CONFIG.maxAccessWalkM) gebZuStop[b].push({ stop: s, sec: gehSekunden(dd, stH[s] - bldH[b]) })
  }
}
for (let c = 0; c < nCells; c++) {
  if (zelleZuStop[c].length > 0) continue
  for (const s of nahe(stGrid, cellX[c], cellY[c], CONFIG.maxEgressWalkM)) {
    const dd = dist(cellX[c], cellY[c], stX[s], stY[s])
    if (dd <= CONFIG.maxEgressWalkM) zelleZuStop[c].push({ stop: s, sec: gehSekunden(dd, stH[s] - cellH[c]) })
  }
}

const egressOffsets = new Int32Array(nCells + 1)
const egressStopArr: number[] = []
const egressWalkArr: number[] = []
for (let c = 0; c < nCells; c++) {
  const near = zelleZuStop[c].sort((a, b) => a.sec - b.sec)
  for (const { stop, sec } of near) {
    egressStopArr.push(stop)
    egressWalkArr.push(Math.round(sec))
  }
  egressOffsets[c + 1] = egressStopArr.length
}
const egressStop = Int32Array.from(egressStopArr)
const egressWalk = Int32Array.from(egressWalkArr)
lap(`${egressStop.length} Ausstiegswege`)

const accessStopArr: number[] = []
const accessWalkArr: number[] = []
const accessOffsets = new Int32Array(buildings.length + 1)
const usedStations = new Set<number>()
let withoutStop = 0
for (let b = 0; b < buildings.length; b++) {
  let near = gebZuStop[b].sort((a, b) => a.sec - b.sec)
  if (near.length > CONFIG.maxAccessStops) near = near.slice(0, CONFIG.maxAccessStops)
  if (near.length === 0) withoutStop++
  for (const { stop, sec } of near) {
    accessStopArr.push(stop)
    accessWalkArr.push(Math.round(sec))
    usedStations.add(stop)
  }
  accessOffsets[b + 1] = accessStopArr.length
}
const accessStop = Int32Array.from(accessStopArr)
const accessWalk = Int32Array.from(accessWalkArr)
lap(`${accessStop.length} Zustiegswege, ${withoutStop} Gebäude ohne Haltestelle in ${CONFIG.maxAccessWalkM} m`)

// ---------------------------------------------------------------- Reisezeitmatrix

const origins = [...usedStations].sort((a, b) => a - b)
const originRow = new Int32Array(nStations).fill(-1)
origins.forEach((s, i) => (originRow[s] = i))

const departures: number[] = []
for (let t = CONFIG.window.startSec; t < CONFIG.window.endSec; t += CONFIG.window.stepSec)
  departures.push(t)

console.log(
  `Matrix: ${origins.length} Starthaltestellen × ${departures.length} Abfahrtszeiten × ${nCells} Zielzellen`
)

const raptor = new Raptor(net, CONFIG.maxRounds, CONFIG.transferPenaltySec)
const CAP = CONFIG.maxTravelTimeSec
const T = new Float32Array(origins.length * nCells)
const acc = new Float64Array(nCells)

const bench = Date.now()
raptor.run(origins[0], departures[0])
const perRun = Date.now() - bench
console.log(`  ein RAPTOR-Lauf: ${perRun} ms -> geschätzt ${((perRun * origins.length * departures.length) / 60000).toFixed(1)} min`)

for (let oi = 0; oi < origins.length; oi++) {
  acc.fill(0)
  for (const dep of departures) {
    const best = raptor.run(origins[oi], dep)
    for (let c = 0; c < nCells; c++) {
      let m = CAP
      for (let e = egressOffsets[c]; e < egressOffsets[c + 1]; e++) {
        const a = best[egressStop[e]]
        if (a === INF) continue
        const v = a - dep + egressWalk[e]
        if (v < m) m = v
      }
      acc[c] += m
    }
  }
  const row = oi * nCells
  const inv = 1 / departures.length
  for (let c = 0; c < nCells; c++) T[row + c] = acc[c] * inv
  if ((oi & 63) === 0) process.stdout.write(`\r    ${oi}/${origins.length}`)
}
process.stdout.write('\r')
lap('Matrix fertig')

// ---------------------------------------------------------------- Gebäudewerte

const scores = new Float32Array(buildings.length)
const tmp = new Float32Array(nCells)

for (let b = 0; b < buildings.length; b++) {
  const bx = buildings[b].x
  const by = buildings[b].y
  const bh = bldH[b]

  // Ausgangslage: alles zu Fuss, mit Steigung
  for (let c = 0; c < nCells; c++) {
    const dx = bx - cellX[c]
    const dy = by - cellY[c]
    const w = gehSekunden(Math.sqrt(dx * dx + dy * dy), cellH[c] - bh)
    tmp[c] = w < CAP ? w : CAP
  }

  // und dann für jede erreichbare Haltestelle prüfen, ob der ÖV schneller ist
  for (let a = accessOffsets[b]; a < accessOffsets[b + 1]; a++) {
    const row = originRow[accessStop[a]] * nCells
    const walk = accessWalk[a]
    for (let c = 0; c < nCells; c++) {
      const v = walk + T[row + c]
      if (v < tmp[c]) tmp[c] = v
    }
  }

  let sum = 0
  for (let c = 0; c < nCells; c++) sum += tmp[c] * cellW[c]
  scores[b] = sum / cellWSum
  if ((b & 8191) === 0) process.stdout.write(`\r    ${b}/${buildings.length}`)
}
process.stdout.write('\r')
lap('Gebäudewerte fertig')

// ---------------------------------------------------------------- Kulturvielfalt

/**
 * Zweite Kennzahl: wie vielfältig das Kulturangebot in der Nähe ist.
 *
 *  - `k`, `kb`, `kbf`   Anzahl Orte je Sorte in Velo- bzw. Fussdistanz. Aus der
 *                       Summe der gewählten Sorten kommt die angezeigte Zahl,
 *                       weil man sie unmittelbar versteht.
 *  - `i0…i9` / `f0…f9`  derselbe Bestand je Sorte, aber mit der Reisezeit
 *                       abklingend gewichtet (`exp(-t/zerfall)`). Rang und
 *                       Farbskala kommen daraus – nicht als blosse Summe,
 *                       sondern als Summe der Wurzeln über die Sorten:
 *
 *                           vielfalt(Haus) = Σ_Sorte √( index_Sorte )
 *
 *                       Die Wurzel bremst jede einzelne Sorte: die zwölfte Bar
 *                       zählt kaum noch, die erste Bühne viel. So misst die
 *                       Karte Vielfalt statt Dichte, und Quartierzentren heben
 *                       sich vom Zentrum ab, statt darin unterzugehen.
 *
 * Die Gehzeit `t` läuft über das Fussnetz: je Kulturort ein gekappter Dijkstra,
 * der seinen Beitrag auf alle Häuser im Zeitbudget verteilt. Zu Fuss (Vorgabe)
 * und Velo getrennt; der Index bleibt je Sorte getrennt, damit die Karte
 * abgewählte Sorten ohne eigenen Datensatz herausrechnen kann.
 */
const kVelo = CONFIG.kultur.velo
const kFuss = CONFIG.kultur.fuss
// Luftlinien-Radius für den Fallback (weiterer der beiden Wege, Velo, in der Ebene).
const kRadius = Math.ceil((kVelo.sucheSek * CONFIG.veloSpeedMs) / CONFIG.veloDetourFactor)

const kH = new Float64Array(
  kultur.map((o) => {
    const [lon, lat] = toLonLat(o.x, o.y)
    return hoehe(lon, lat)
  })
)
const kArtIdx = kultur.map((o) => KULTUR_ARTEN.indexOf(o.art))

const KZ = 500
const kRaster = new Map<number, number[]>()
for (let i = 0; i < kultur.length; i++) {
  const key = Math.floor(kultur[i].x / KZ) * 100003 + Math.floor(kultur[i].y / KZ)
  const b = kRaster.get(key)
  if (b) b.push(i)
  else kRaster.set(key, [i])
}
const kReichweite = Math.ceil(kRadius / KZ)

// je Wegart: Anzahl und abklingender Index, jeweils je Sorte
const cntVelo = new Int32Array(buildings.length * AZ)
const cntFuss = new Int32Array(buildings.length * AZ)
const idxVelo = new Float64Array(buildings.length * AZ)
const idxFuss = new Float64Array(buildings.length * AZ)

console.log(
  `Kulturvielfalt: ${kultur.length} Orte über das Fussnetz, ` +
    `bis ${kVelo.minuten} Velo- bzw. ${kFuss.minuten} Gehminuten`
)

/** Ein Dijkstra-Lauf ab einem Kulturort verteilt seinen Beitrag auf alle Häuser im Budget. */
function verteile(
  ankerNode: number,
  ankerLotSek: number,
  bldLotFeld: 'fuss' | 'velo',
  art: number,
  cap: number,
  kantenSek: Float64Array,
  zerfall: number,
  zaehlbis: number,
  idx: Float64Array,
  cnt: Int32Array
) {
  const d = walker.run([{ node: ankerNode, sek: ankerLotSek }], cap, kantenSek)
  for (const u of walker.angefasst()) {
    const geb = knotenGeb.get(u)
    if (!geb) continue
    for (const b of geb) {
      const t = d[u] + bldLot[b]![bldLotFeld]
      if (t <= cap) {
        const off = b * AZ + art
        idx[off] += Math.exp(-t / zerfall)
        if (t <= zaehlbis) cnt[off]++
      }
    }
  }
}

let ortOhneWeg = 0
for (let i = 0; i < kultur.length; i++) {
  const anker = kulturLot[i]
  if (!anker) {
    ortOhneWeg++
    continue
  }
  const art = kArtIdx[i]
  verteile(anker.node, anker.fuss, 'fuss', art, kFuss.sucheSek, edgeFussSek, kFuss.zerfallSek, kFuss.minuten * 60, idxFuss, cntFuss)
  verteile(anker.node, anker.velo, 'velo', art, kVelo.sucheSek, edgeVeloSek, kVelo.zerfallSek, kVelo.minuten * 60, idxVelo, cntVelo)
  if ((i & 255) === 0) process.stdout.write(`\r    ${i}/${kultur.length}`)
}
process.stdout.write('\r')
lap(`Kulturvielfalt Graphlauf (${ortOhneWeg} Orte ohne Weg-Anschluss)`)

// Fallback für Orte ohne Weg-Anschluss und Gebäude ohne Weg-Anschluss: Luftlinie.
let gebOhneWeg = 0
if (ortOhneWeg > 0 || bldLot.some((a) => !a)) {
  const bldRaster = new Map<number, number[]>()
  for (let b = 0; b < buildings.length; b++) {
    const key = Math.floor(buildings[b].x / KZ) * 100003 + Math.floor(buildings[b].y / KZ)
    const bb = bldRaster.get(key)
    if (bb) bb.push(b)
    else bldRaster.set(key, [b])
  }
  const paar = (b: number, i: number) => {
    const d = dist(buildings[b].x, buildings[b].y, kultur[i].x, kultur[i].y)
    if (d > kRadius) return
    const dz = kH[i] - bldH[b]
    const off = b * AZ + kArtIdx[i]
    const tv = veloSekunden(d, dz)
    if (tv <= kVelo.sucheSek) {
      idxVelo[off] += Math.exp(-tv / kVelo.zerfallSek)
      if (tv <= kVelo.minuten * 60) cntVelo[off]++
    }
    const tf = gehSekunden(d, dz)
    if (tf <= kFuss.sucheSek) {
      idxFuss[off] += Math.exp(-tf / kFuss.zerfallSek)
      if (tf <= kFuss.minuten * 60) cntFuss[off]++
    }
  }
  // Gebäude ohne Anschluss: gegen alle Orte im Radius.
  for (let b = 0; b < buildings.length; b++) {
    if (bldLot[b]) continue
    gebOhneWeg++
    const gx = Math.floor(buildings[b].x / KZ)
    const gy = Math.floor(buildings[b].y / KZ)
    for (let dx = -kReichweite; dx <= kReichweite; dx++)
      for (let dy = -kReichweite; dy <= kReichweite; dy++)
        for (const i of kRaster.get((gx + dx) * 100003 + (gy + dy)) ?? []) paar(b, i)
  }
  // Orte ohne Anschluss: gegen alle Gebäude MIT Anschluss im Radius (die ohne sind schon durch).
  for (let i = 0; i < kultur.length; i++) {
    if (kulturLot[i]) continue
    const gx = Math.floor(kultur[i].x / KZ)
    const gy = Math.floor(kultur[i].y / KZ)
    for (let dx = -kReichweite; dx <= kReichweite; dx++)
      for (let dy = -kReichweite; dy <= kReichweite; dy++)
        for (const b of bldRaster.get((gx + dx) * 100003 + (gy + dy)) ?? [])
          if (bldLot[b]) paar(b, i)
  }
  lap(`Kulturvielfalt Fallback (${gebOhneWeg} Gebäude ohne Weg-Anschluss)`)
}

/** Vielfalts-Index eines Hauses: Summe der Wurzeln über die Sorten. */
function vielfalt(arr: Float64Array, b: number): number {
  let s = 0
  for (let a = 0; a < AZ; a++) s += Math.sqrt(arr[b * AZ + a])
  return s
}
/**
 * Vorschauwerte für die Standard-Wegart (zu Fuss) – sie stehen in der Kachel und
 * gelten, bis die Karte Rang und Farbe für die gewählten Sorten selbst rechnet.
 */
const kAnzahlStd = new Int32Array(buildings.length)
for (let b = 0; b < buildings.length; b++) {
  let s = 0
  for (let a = 0; a < AZ; a++) s += cntFuss[b * AZ + a]
  kAnzahlStd[b] = s
}

/** Rang nach Kulturvielfalt (zu Fuss, alle Sorten), 1 = vielfältigstes Angebot. */
const kRang = new Int32Array(buildings.length)
const kReihenfolge = (() => {
  const wert = Array.from({ length: buildings.length }, (_, b) => vielfalt(idxFuss, b))
  const r = wert.map((_, b) => b).sort((a, b) => wert[b] - wert[a])
  r.forEach((idx, platz) => (kRang[idx] = platz + 1))
  return r
})()
lap(
  `Kulturvielfalt fertig (bestes Haus ${Math.max(...kAnzahlStd)} Orte, Median ${
    Int32Array.from(kAnzahlStd).sort()[Math.floor(buildings.length / 2)]
  })`
)

// ---------------------------------------------------------------- Ausgabe

const sorted = Float32Array.from(scores).sort()
const pct = (v: number) => {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo / (sorted.length - 1)
}
const quantile = (q: number) => sorted[Math.round(q * (sorted.length - 1))]

/** Platz in der Rangliste, 1 = bestangeschlossenes Haus der Stadt. */
const rang = new Int32Array(buildings.length)
{
  const reihenfolge = Array.from(scores.keys()).sort((a, b) => scores[a] - scores[b])
  reihenfolge.forEach((idx, platz) => (rang[idx] = platz + 1))
}

/**
 * Der abklingende Index je Sorte und Wegart, als eigene Eigenschaften `i0…i8`
 * (Velo) und `f0…f8` (zu Fuss). Anders als bei `kb` geht hier kein Text: die
 * Karte summiert die gewählten Sorten in einem Ausdruck, und der kann nur
 * einzelne Zahlen lesen. Zwei Nachkommastellen trennen die Rangfolge
 * zuverlässig und halten die Datei klein.
 */
function indexProSorte(prefix: string, arr: Float64Array, i: number) {
  const out: Record<string, number> = {}
  for (let a = 0; a < AZ; a++)
    out[`${prefix}${a}`] = Math.round(arr[i * AZ + a] * 100) / 100
  return out
}
/** Die Zählung je Sorte als "3,5,7,0,…" – Vektorkacheln kennen nur Skalare. */
const zahlProSorte = (arr: Int32Array, i: number) =>
  Array.from(arr.subarray(i * AZ, (i + 1) * AZ)).join(',')

const features = buildings.map((b, i) => {
  const ring: number[][] = []
  for (let k = 0; k < b.ring.length; k += 2) {
    const [lon, lat] = toLonLat(b.ring[k], b.ring[k + 1])
    ring.push([+lon.toFixed(CONFIG.coordPrecision), +lat.toFixed(CONFIG.coordPrecision)])
  }
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]))
    ring.push(ring[0])
  const [lon, lat] = toLonLat(b.x, b.y)
  return {
    type: 'Feature' as const,
    properties: {
      m: Math.round((scores[i] / 60) * 10) / 10, // Minuten
      p: Math.round(pct(scores[i]) * 1000) / 1000, // Rang 0..1
      r: rang[i], // Platz in der Rangliste, 1 = bestes Haus
      a: b.area,
      x: +lon.toFixed(5),
      y: +lat.toFixed(5),
      k: kAnzahlStd[i], // Orte zu Fuss, alle Sorten (Vorschau vor dem Laden)
      kr: kRang[i], // Rang zu Fuss, alle Sorten (Vorschau)
      kb: zahlProSorte(cntVelo, i), // Zählung je Sorte, Velo
      kbf: zahlProSorte(cntFuss, i), // Zählung je Sorte, zu Fuss
      ...indexProSorte('i', idxVelo, i),
      ...indexProSorte('f', idxFuss, i),
      ...(b.addr ? { s: b.addr } : {}),
      ...(b.name ? { n: b.name } : {}),
    },
    geometry: { type: 'Polygon' as const, coordinates: [ring] },
  }
})

writeFileSync(
  PUBLIC + 'buildings.geojson',
  JSON.stringify({ type: 'FeatureCollection', features })
)

/**
 * Die vordersten Ränge als Punktebene. Auf Stadtansicht ist ein einzelnes Haus
 * kleiner als ein Pixel – für "zeig mir die Top 10" braucht es einen Marker,
 * der unabhängig von der Gebäudegrösse sichtbar bleibt. 10'000 Ränge, damit der
 * Regler in der Karte über gut ein Fünftel aller Häuser laufen kann.
 */
const TOP = 10000

function schreibeBestenliste(datei: string, raenge: Int32Array) {
  const beste = Array.from(raenge.keys())
    .filter((i) => raenge[i] <= TOP)
    .sort((a, b) => raenge[a] - raenge[b])
  writeFileSync(
    PUBLIC + datei,
    JSON.stringify({
      type: 'FeatureCollection',
      features: beste.map((i) => {
        const [lon, lat] = toLonLat(buildings[i].x, buildings[i].y)
        return {
          type: 'Feature',
          properties: { r: raenge[i] },
          geometry: { type: 'Point', coordinates: [+lon.toFixed(5), +lat.toFixed(5)] },
        }
      }),
    })
  )
}
schreibeBestenliste('top.geojson', rang)
schreibeBestenliste('top-kultur.geojson', kRang)

const stopFeatures = origins.map((s) => ({
  type: 'Feature' as const,
  properties: { name: rawNet.stationNames[s] },
  geometry: { type: 'Point' as const, coordinates: [rawNet.lon[s], rawNet.lat[s]] },
}))
writeFileSync(
  PUBLIC + 'stops.geojson',
  JSON.stringify({ type: 'FeatureCollection', features: stopFeatures })
)
/** Die beiden Enden einer Rangliste, damit die Karte sie einzeichnen kann. */
function extrem(raenge: Int32Array, platz: number) {
  const idx = raenge.indexOf(platz)
  const b = buildings[idx]
  const [lon, lat] = toLonLat(b.x, b.y)
  return {
    rang: platz,
    minuten: +(scores[idx] / 60).toFixed(1),
    orte: kAnzahlStd[idx],
    lon: +lon.toFixed(5),
    lat: +lat.toFixed(5),
    adresse: b.addr ?? null,
    name: b.name ?? null,
  }
}

const tausender = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2019')
const komma = (n: number) => String(n).replace('.', ',')

const extremPunkte = (
  [
    ['oev', rang, 1, (e: ReturnType<typeof extrem>) => `${komma(e.minuten)} min`],
    ['oev', rang, buildings.length, (e: ReturnType<typeof extrem>) => `${komma(e.minuten)} min`],
    ['kultur', kRang, 1, (e: ReturnType<typeof extrem>) => `${e.orte} Orte`],
    ['kultur', kRang, buildings.length, (e: ReturnType<typeof extrem>) => `${e.orte} Orte`],
  ] as const
).map(([modus, raenge, platz, text]) => {
  const e = extrem(raenge, platz)
  return {
    type: 'Feature',
    properties: {
      modus,
      art: platz === 1 ? 'best' : 'worst',
      beschriftung: `Rang ${tausender(e.rang)} · ${text(e)}`,
      ...e,
    },
    geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
  }
})

writeFileSync(
  PUBLIC + 'extreme.geojson',
  JSON.stringify({ type: 'FeatureCollection', features: extremPunkte })
)

const meta = {
  serviceDate: CONFIG.serviceDate,
  window: `${(CONFIG.window.startSec / 3600).toFixed(0)}:00–${(CONFIG.window.endSec / 3600).toFixed(0)}:00`,
  departures: departures.length,
  buildings: buildings.length,
  cells: nCells,
  addresses: cellWSum,
  stations: nStations,
  originStations: origins.length,
  trips: rawNet.meta.trips,
  minutes: {
    best: +(sorted[0] / 60).toFixed(1),
    p05: +(quantile(0.05) / 60).toFixed(1),
    p25: +(quantile(0.25) / 60).toFixed(1),
    median: +(quantile(0.5) / 60).toFixed(1),
    p75: +(quantile(0.75) / 60).toFixed(1),
    p95: +(quantile(0.95) / 60).toFixed(1),
    worst: +(sorted[sorted.length - 1] / 60).toFixed(1),
  },
  extreme: { bestes: extrem(rang, 1), schlechtestes: extrem(rang, buildings.length) },
  kultur: {
    orte: kultur.length,
    budgets: { velo: CONFIG.kultur.velo.minuten, fuss: CONFIG.kultur.fuss.minuten },
    arten: KULTUR_ARTEN,
    /** Wie viele Orte je Sorte – die Karte schreibt die Zahl an den Schalter. */
    proArt: KULTUR_ARTEN.map((_, a) => kArtIdx.reduce((n, x) => n + (x === a ? 1 : 0), 0)),
    // `max` ist das Haus auf Rang 1 (nicht das mit den meisten Orten), damit die
    // Anzeige zur Karten-Beschriftung „Rang 1 · N Orte" passt; der Rest der Grösse nach.
    verteilung: (() => {
      const v = Int32Array.from(kAnzahlStd).sort()
      const q = (f: number) => v[Math.round(f * (v.length - 1))]
      return { min: q(0), p25: q(0.25), median: q(0.5), p75: q(0.75), max: kAnzahlStd[kReihenfolge[0]] }
    })(),
    extreme: {
      bestes: extrem(kRang, 1),
      schlechtestes: extrem(kRang, buildings.length),
    },
  },
  builtAt: new Date().toISOString(),
}
writeFileSync(PUBLIC + 'meta.json', JSON.stringify(meta, null, 2))
lap('geschrieben nach public/data/')
console.log(meta)
