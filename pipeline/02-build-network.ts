/**
 * Baut aus dem Schweizer GTFS-Fahrplan ein kompaktes RAPTOR-Netz für den Raum
 * der aktuellen Stadt (`STADT=…`, Default Zürich).
 *
 * Schritte:
 *  1. stops.txt  -> Haltestellen im Netz-Ausschnitt, Perrons werden zur Haltestelle
 *                   zusammengefasst (Spalte `didok`, die schweizweite Haltestellennummer)
 *  2. calendar   -> welche service_id fährt am Analysetag
 *  3. trips.txt  -> welche Fahrten gehören zu diesen service_id
 *  4. stop_times -> Abfahrtszeiten, nur für relevante Fahrten und Haltestellen
 *  5. Fahrten mit identischer Haltefolge werden zu "Pattern" gruppiert (RAPTOR-Routes)
 *  6. Fusswege zwischen nahen Haltestellen als Transfers
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { readCsv, parseGtfsTime } from './lib/csv.ts'
import { toXY, dist } from './lib/geo.ts'
import { ladeHoehen, hoehe, gehSekunden } from './lib/elevation.ts'
import { CONFIG } from './config.ts'
import { aktiveStadt } from './staedte.ts'

const STADT = aktiveStadt()
const ZIP = new URL('../data/raw/gtfs_ch.zip', import.meta.url).pathname
const OUT = new URL(`../data/derived/${STADT.schluessel}/`, import.meta.url).pathname

/** Entpackt eine Datei aus dem Zip als Stream, ohne 3 GB auf die Platte zu schreiben. */
function fromZip(name: string) {
  const p = spawn('unzip', ['-p', ZIP, name], { stdio: ['ignore', 'pipe', 'inherit'] })
  return p.stdout
}

const t0 = Date.now()
const lap = (label: string) => console.log(`  ${label} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)

// ---------------------------------------------------------------- 1. Haltestellen

type Station = { key: string; name: string; lat: number; lon: number; n: number }
const stations = new Map<string, Station>()
/** stop_id (Perron) -> Haltestellen-Key */
const stopToStation = new Map<string, string>()

console.log('1/6 Haltestellen')
await readCsv(fromZip('stops.txt'), (r, col) => {
  const lat = +r[col('stop_lat')]
  const lon = +r[col('stop_lon')]
  const b = STADT.networkBbox
  if (!(lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon)) return

  const stopId = r[col('stop_id')]
  const didok = r[col('didok')]
  const parent = r[col('parent_station')]
  const key = didok || parent.replace(/^Parent/, '') || stopId

  stopToStation.set(stopId, key)
  let st = stations.get(key)
  if (!st) {
    st = { key, name: r[col('stop_name')], lat: 0, lon: 0, n: 0 }
    stations.set(key, st)
  }
  st.lat += lat
  st.lon += lon
  st.n++
})
for (const st of stations.values()) {
  st.lat /= st.n
  st.lon /= st.n
}
lap(`${stations.size} Haltestellen aus ${stopToStation.size} Perrons`)

const stationIds = [...stations.keys()]
const stationIndex = new Map(stationIds.map((k, i) => [k, i]))
/** stop_id -> Haltestellen-Index; direkte Map spart im heissen Pfad einen Lookup */
const stopIdToIdx = new Map<string, number>()
for (const [stopId, key] of stopToStation) stopIdToIdx.set(stopId, stationIndex.get(key)!)

// ---------------------------------------------------------------- 2. Kalender

console.log('2/6 Kalender')
const D = CONFIG.serviceDate
const activeServices = new Set<string>()

await readCsv(fromZip('calendar.txt'), (r, col) => {
  if (r[col('start_date')] > D || r[col('end_date')] < D) return
  if (r[col(CONFIG.serviceWeekday)] === '1') activeServices.add(r[col('service_id')])
})
const baseCount = activeServices.size
let added = 0
let removed = 0
await readCsv(fromZip('calendar_dates.txt'), (r, col) => {
  if (r[col('date')] !== D) return
  const sid = r[col('service_id')]
  if (r[col('exception_type')] === '1') {
    if (!activeServices.has(sid)) added++
    activeServices.add(sid)
  } else {
    if (activeServices.delete(sid)) removed++
  }
})
lap(`${activeServices.size} aktive Services (Basis ${baseCount}, +${added} / -${removed})`)

// ---------------------------------------------------------------- 3. Fahrten

console.log('3/6 Fahrten')
const tripToRoute = new Map<string, string>()
await readCsv(fromZip('trips.txt'), (r, col) => {
  if (!activeServices.has(r[col('service_id')])) return
  tripToRoute.set(r[col('trip_id')], r[col('route_id')])
})
lap(`${tripToRoute.size} Fahrten am ${D}`)

// ---------------------------------------------------------------- 4. Haltezeiten

console.log('4/6 Haltezeiten (2.5 GB, dauert ein paar Minuten)')
type Stop = { idx: number; arr: number; dep: number; seq: number }
const tripStops = new Map<string, Stop[]>()
let scanned = 0
await readCsv(fromZip('stop_times.txt'), (r, col) => {
  if ((++scanned & 0xfffff) === 0) process.stdout.write(`\r    ${(scanned / 1e6).toFixed(1)}M Zeilen`)
  const tripId = r[col('trip_id')]
  if (!tripToRoute.has(tripId)) return
  const idx = stopIdToIdx.get(r[col('stop_id')])
  if (idx === undefined) return
  let list = tripStops.get(tripId)
  if (!list) tripStops.set(tripId, (list = []))
  list.push({
    idx,
    arr: parseGtfsTime(r[col('arrival_time')]),
    dep: parseGtfsTime(r[col('departure_time')]),
    seq: +r[col('stop_sequence')],
  })
})
process.stdout.write('\r')
lap(`${tripStops.size} Fahrten berühren den Ausschnitt (${(scanned / 1e6).toFixed(1)}M Zeilen gelesen)`)

// ---------------------------------------------------------------- 5. Pattern

console.log('5/6 Pattern bilden')
type PatternDraft = { stops: number[]; trips: { dep0: number; times: number[] }[] }
const patterns = new Map<string, PatternDraft>()

for (const [, raw] of tripStops) {
  raw.sort((a, b) => a.seq - b.seq)

  // Aufeinanderfolgende Halte an derselben Haltestelle (verschiedene Perrons) verschmelzen
  const stops: number[] = []
  const times: number[] = [] // [arr, dep] je Halt
  for (const s of raw) {
    if (stops.length && stops[stops.length - 1] === s.idx) {
      times[times.length - 1] = s.dep // spätere Abfahrt gewinnt
      continue
    }
    stops.push(s.idx)
    times.push(s.arr < 0 ? s.dep : s.arr, s.dep < 0 ? s.arr : s.dep)
  }
  if (stops.length < 2) continue

  const key = stops.join(',')
  let p = patterns.get(key)
  if (!p) patterns.set(key, (p = { stops, trips: [] }))
  p.trips.push({ dep0: times[1], times })
}

// Fahrten je Pattern nach Abfahrt sortieren – RAPTOR verlässt sich darauf
const patternList = [...patterns.values()].filter((p) => p.trips.length > 0)
for (const p of patternList) p.trips.sort((a, b) => a.dep0 - b.dep0)
lap(`${patternList.length} Pattern, ${patternList.reduce((a, p) => a + p.trips.length, 0)} Fahrten`)

// ---------------------------------------------------------------- 6. Fusswege

console.log('6/6 Umsteige-Fusswege')
ladeHoehen()
const stationHoehe = stationIds.map((k) => {
  const st = stations.get(k)!
  return hoehe(st.lon, st.lat)
})
const xs = new Float64Array(stationIds.length)
const ys = new Float64Array(stationIds.length)
stationIds.forEach((k, i) => {
  const st = stations.get(k)!
  const [x, y] = toXY(st.lon, st.lat)
  xs[i] = x
  ys[i] = y
})

const maxD = CONFIG.maxTransferWalkM
const cell = maxD
const grid = new Map<number, number[]>()
const cellKey = (x: number, y: number) => Math.floor(x / cell) * 100000 + Math.floor(y / cell)
for (let i = 0; i < stationIds.length; i++) {
  const k = cellKey(xs[i], ys[i])
  const arr = grid.get(k)
  if (arr) arr.push(i)
  else grid.set(k, [i])
}

const transferTargets: number[][] = []
const transferTimes: number[][] = []
let transferCount = 0
for (let i = 0; i < stationIds.length; i++) {
  const tgt: number[] = []
  const tim: number[] = []
  const cx = Math.floor(xs[i] / cell)
  const cy = Math.floor(ys[i] / cell)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get((cx + dx) * 100000 + (cy + dy))
      if (!bucket) continue
      for (const j of bucket) {
        if (j === i) continue
        const d = dist(xs[i], ys[i], xs[j], ys[j])
        if (d > maxD) continue
        tgt.push(j)
        tim.push(Math.round(gehSekunden(d, stationHoehe[j] - stationHoehe[i])))
      }
    }
  }
  transferTargets.push(tgt)
  transferTimes.push(tim)
  transferCount += tgt.length
}
lap(`${transferCount} Fusswege`)

// ---------------------------------------------------------------- Serialisieren

mkdirSync(OUT, { recursive: true })

const flat = <T>(rows: T[][]) => {
  const offsets = new Int32Array(rows.length + 1)
  let n = 0
  for (let i = 0; i < rows.length; i++) offsets[i + 1] = n += rows[i].length
  return { offsets: [...offsets], values: rows.flat() as T[] }
}

const patStops = flat(patternList.map((p) => p.stops))
const patTimes = flat(patternList.map((p) => p.trips.flatMap((t) => t.times)))
const patTripCount = patternList.map((p) => p.trips.length)

/** Für jede Haltestelle: an welchen Pattern hält sie, und an welcher Position. */
const stopPatternRows: number[][] = stationIds.map(() => [])
patternList.forEach((p, pi) => {
  p.stops.forEach((s, si) => stopPatternRows[s].push(pi, si))
})
const stopPat = flat(stopPatternRows)

const network = {
  meta: {
    serviceDate: CONFIG.serviceDate,
    builtAt: new Date().toISOString(),
    stations: stationIds.length,
    patterns: patternList.length,
    trips: patternList.reduce((a, p) => a + p.trips.length, 0),
  },
  stationIds,
  stationNames: stationIds.map((k) => stations.get(k)!.name),
  lat: stationIds.map((k) => +stations.get(k)!.lat.toFixed(6)),
  lon: stationIds.map((k) => +stations.get(k)!.lon.toFixed(6)),
  patternStopOffsets: patStops.offsets,
  patternStops: patStops.values,
  patternTripCount: patTripCount,
  patternTimeOffsets: patTimes.offsets,
  patternTimes: patTimes.values,
  stopPatternOffsets: stopPat.offsets,
  stopPatterns: stopPat.values,
  transferOffsets: flat(transferTargets).offsets,
  transferTargets: transferTargets.flat(),
  transferTimes: transferTimes.flat(),
}

writeFileSync(OUT + 'network.json', JSON.stringify(network))
lap(`geschrieben: data/derived/network.json`)
console.log(network.meta)
