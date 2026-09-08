/**
 * Macht aus den OSM-Rohdaten zwei Dinge:
 *  - `buildings.json`: jedes Gebäude innerhalb der Stadtgrenze mit Grundriss und Schwerpunkt
 *  - `cells.json`:     das Zielraster. Jede Zelle steht für die Adressen, die in ihr
 *                      liegen, und trägt deren Anzahl als Gewicht.
 *
 * Das Gewicht ist der Kern der Kennzahl: gemittelt wird nicht über Fläche, sondern
 * über Adressen. Eine Fahrt in ein dicht bebautes Quartier zählt so viel wie die
 * Adressen, die dort liegen – der Wald am Uetliberg zieht den Schnitt nicht runter.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { toXY, toLonLat, pointInRings, dist } from './lib/geo.ts'
import { baueWalkGraph } from './lib/walkgraph.ts'
import { CONFIG } from './config.ts'
import { aktiveStadt } from './staedte.ts'

const STADT = aktiveStadt()
const RAW = new URL(`../data/raw/osm/${STADT.schluessel}/`, import.meta.url).pathname
const OUT = new URL(`../data/derived/${STADT.schluessel}/`, import.meta.url).pathname
const PUBLIC = new URL(`../public/data/${STADT.schluessel}/`, import.meta.url).pathname
const read = (f: string) => JSON.parse(readFileSync(RAW + f, 'utf8'))

// ---------------------------------------------------------------- Stadtgrenze

type Pt = { lat: number; lon: number }

/**
 * Overpass liefert in `geometry` null-Einträge für Knoten ausserhalb der
 * Abfrage-Box. Die müssen raus, bevor irgendetwas gerechnet wird.
 */
function clean(geom: (Pt | null)[] | undefined): Pt[] {
  if (!geom) return []
  const out: Pt[] = []
  for (const p of geom) if (p && p.lat != null && p.lon != null) out.push(p)
  return out
}

/** Fügt die Wegstücke einer Grenzrelation zu geschlossenen Ringen zusammen. */
function stitchRings(segments: Pt[][]): number[][][] {
  const open = segments.filter((s) => s.length > 1).map((s) => s.slice())
  const rings: number[][][] = []
  const key = (p: Pt) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`

  while (open.length) {
    let cur = open.pop()!
    let progress = true
    while (progress && key(cur[0]) !== key(cur[cur.length - 1])) {
      progress = false
      for (let i = 0; i < open.length; i++) {
        const seg = open[i]
        if (key(seg[0]) === key(cur[cur.length - 1])) cur = cur.concat(seg.slice(1))
        else if (key(seg[seg.length - 1]) === key(cur[cur.length - 1]))
          cur = cur.concat(seg.slice(0, -1).reverse())
        else if (key(seg[seg.length - 1]) === key(cur[0])) cur = seg.slice(0, -1).concat(cur)
        else if (key(seg[0]) === key(cur[0])) cur = seg.slice(1).reverse().concat(cur)
        else continue
        open.splice(i, 1)
        progress = true
        break
      }
    }
    if (cur.length > 3) rings.push(cur.map((p) => [p.lon, p.lat]))
  }
  return rings
}

// Meist genau eine Relation; falls die Box mehrere Namensgleiche fasst (etwa ein
// Quartier gleichen Namens), gewinnt die mit den meisten Wegstücken.
const boundaryRel = read('boundary.json')
  .elements.filter((e: any) => e.type === 'relation')
  .sort((a: any, b: any) => (b.members?.length ?? 0) - (a.members?.length ?? 0))[0]
if (!boundaryRel) throw new Error('Stadtgrenze nicht gefunden')
const outerSegments = boundaryRel.members
  .filter((m: any) => m.role !== 'inner' && m.geometry)
  .map((m: any) => clean(m.geometry))
const cityRings = stitchRings(outerSegments)
// Der grösste Ring ist das Stadtgebiet, kleinere Ringe sind Exklaven.
cityRings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))
console.log(`Stadtgrenze: ${cityRings.length} Ring(e), grösster ${cityRings[0].length} Punkte`)

function ringArea(ring: number[][]): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = toXY(ring[i][0], ring[i][1])
    const [xj, yj] = toXY(ring[j][0], ring[j][1])
    a += xj * yi - xi * yj
  }
  return a / 2
}
const inCity = (lon: number, lat: number) => pointInRings(cityRings, lon, lat)

// ---------------------------------------------------------------- Gebäude

/** Koordinaten sind projizierte Meter; die Rückrechnung nach WGS84 macht Schritt 04. */
type Building = {
  id: number
  x: number
  y: number
  area: number
  ring: number[]
  name?: string
  addr?: string
}
const buildings = new Map<number, Building>()
const P = CONFIG.coordPrecision
const round = (v: number) => +v.toFixed(P)

/** Douglas-Peucker in Metern - nimmt der Datei viel Volumen, ohne dass man es sieht. */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 4) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let best = -1
    let bestD = tol
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

function addBuilding(id: number, rawGeom: (Pt | null)[] | undefined, tags: Record<string, string> | undefined) {
  if (buildings.has(id)) return
  const geom = clean(rawGeom)
  if (geom.length < 4) return
  if (tags?.building === 'roof' || tags?.building === 'bridge') return
  if (!inCity(geom[0].lon, geom[0].lat)) return

  const xy = geom.map((p) => toXY(p.lon, p.lat) as [number, number])

  // Fläche und Flächenschwerpunkt über die Gauss'sche Trapezformel
  let a2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const cross = xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1]
    a2 += cross
    cx += (xy[j][0] + xy[i][0]) * cross
    cy += (xy[j][1] + xy[i][1]) * cross
  }
  const area = Math.abs(a2 / 2)
  if (area < 12) return // Velounterstände, Trafohäuschen
  const px = a2 ? cx / (3 * a2) : xy[0][0]
  const py = a2 ? cy / (3 * a2) : xy[0][1]

  // Ring als flaches [x0,y0,x1,y1,...] in Dezimeter-Auflösung
  const ring: number[] = []
  for (const [x, y] of simplify(xy, 1.2)) ring.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10)

  const haus = tags?.['addr:housenumber']
  const strasse = tags?.['addr:street']
  buildings.set(id, {
    id,
    x: px,
    y: py,
    area: Math.round(area),
    ring,
    name: tags?.name,
    addr: strasse && haus ? `${strasse} ${haus}` : undefined,
  })
}

for (const f of readdirSync(RAW).filter((f) => f.startsWith('buildings_'))) {
  const json = read(f)
  for (const el of json.elements) {
    if (el.type === 'way') addBuilding(el.id, el.geometry, el.tags)
    else if (el.type === 'relation') {
      const outer = el.members?.find((m: any) => m.role === 'outer' && clean(m.geometry).length > 3)
      if (outer) addBuilding(-el.id, outer.geometry, el.tags)
    }
  }
}

/**
 * Gebäude, deren Schwerpunkt in einem viel grösseren Gebäude liegt, sind meist
 * Kioske, Anbauten oder doppelt erfasste Teile im selben Haus – etwa die kleinen
 * Bauten im Hauptbahnhof. Sie bekommen keinen eigenen Rang.
 */
{
  function imRing(ring: number[], px: number, py: number): boolean {
    let inside = false
    const n = ring.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2]
      const yi = ring[i * 2 + 1]
      const xj = ring[j * 2]
      const yj = ring[j * 2 + 1]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  const GZ = 300
  const raster = new Map<number, { x: number; y: number; area: number; ring: number[] }[]>()
  for (const b of buildings.values()) {
    if (b.area < 2000) continue // nur grosse Gebäude als mögliche Hülle
    const k = Math.floor(b.x / GZ) * 100003 + Math.floor(b.y / GZ)
    const arr = raster.get(k)
    if (arr) arr.push(b)
    else raster.set(k, [b])
  }
  let raus = 0
  for (const [id, b] of buildings) {
    if (b.area >= 400) continue
    const gx = Math.floor(b.x / GZ)
    const gy = Math.floor(b.y / GZ)
    let drin = false
    for (let dx = -1; dx <= 1 && !drin; dx++)
      for (let dy = -1; dy <= 1 && !drin; dy++)
        for (const g of raster.get((gx + dx) * 100003 + (gy + dy)) ?? [])
          if (g.area > b.area * 3 && imRing(g.ring, b.x, b.y)) {
            drin = true
            break
          }
    if (drin) {
      buildings.delete(id)
      raus++
    }
  }
  if (raus) console.log(`Gebäude in grösseren entfernt: ${raus}`)
}

console.log(`Gebäude in der Stadt: ${buildings.size}`)

// ---------------------------------------------------------------- Adressen -> Zielraster

type Adresse = { x: number; y: number; text: string }
const adressen: Adresse[] = []
const seenAddr = new Set<string>()
for (const f of readdirSync(RAW).filter((f) => f.startsWith('addresses_'))) {
  for (const el of read(f).elements) {
    const k = `${el.type}${el.id}`
    if (seenAddr.has(k)) continue
    seenAddr.add(k)
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (lat === undefined || !inCity(lon, lat)) continue
    const [x, y] = toXY(lon, lat)
    const t = el.tags ?? {}
    const text = t['addr:street'] && t['addr:housenumber']
      ? `${t['addr:street']} ${t['addr:housenumber']}`
      : ''
    adressen.push({ x, y, text })
  }
}
const addr: [number, number][] = adressen.map((a) => [a.x, a.y])
console.log(`Adressen in der Stadt: ${addr.length}`)

// --- Gebäude ohne eigene Adresstags bekommen die Adresse des Punktes, der in
//     ihrem Grundriss liegt. In Zürich tragen rund drei Viertel der Gebäude die
//     Adresse selbst, der Rest hängt an einem separaten Adressknoten.
{
  const Z = 60
  const raster = new Map<number, Adresse[]>()
  const rk = (x: number, y: number) => Math.floor(x / Z) * 100003 + Math.floor(y / Z)
  for (const a of adressen) {
    if (!a.text) continue
    const k = rk(a.x, a.y)
    const b = raster.get(k)
    if (b) b.push(a)
    else raster.set(k, [a])
  }

  const imRing = (ring: number[], px: number, py: number) => {
    let drin = false
    const n = ring.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2]
      const yi = ring[i * 2 + 1]
      const xj = ring[j * 2]
      const yj = ring[j * 2 + 1]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) drin = !drin
    }
    return drin
  }

  let ergaenzt = 0
  for (const b of buildings.values()) {
    if (b.addr) continue
    const gx = Math.floor(b.x / Z)
    const gy = Math.floor(b.y / Z)
    let treffer: Adresse | undefined
    let naechste: Adresse | undefined
    let bestD = 15
    for (let dx = -1; dx <= 1 && !treffer; dx++) {
      for (let dy = -1; dy <= 1 && !treffer; dy++) {
        for (const a of raster.get((gx + dx) * 100003 + (gy + dy)) ?? []) {
          if (imRing(b.ring, a.x, a.y)) {
            treffer = a
            break
          }
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d < bestD) {
            bestD = d
            naechste = a
          }
        }
      }
    }
    const gefunden = treffer ?? naechste
    if (gefunden) {
      b.addr = gefunden.text
      ergaenzt++
    }
  }
  const mit = [...buildings.values()].filter((b) => b.addr).length
  console.log(
    `Adressen an Gebäuden: ${mit} von ${buildings.size} (${((100 * mit) / buildings.size).toFixed(1)} %), davon ${ergaenzt} nachgetragen`
  )
}

const G = CONFIG.gridSizeM
type Cell = { gx: number; gy: number; sx: number; sy: number; w: number }
const cellMap = new Map<string, Cell>()
for (const [x, y] of addr) {
  const gx = Math.floor(x / G)
  const gy = Math.floor(y / G)
  const k = `${gx},${gy}`
  let c = cellMap.get(k)
  if (!c) cellMap.set(k, (c = { gx, gy, sx: 0, sy: 0, w: 0 }))
  c.sx += x
  c.sy += y
  c.w++
}
const cells = [...cellMap.values()].map((c) => ({
  x: c.sx / c.w, // Schwerpunkt der Adressen, nicht Zellmitte
  y: c.sy / c.w,
  w: c.w,
}))
console.log(`Zielzellen: ${cells.length} (Ø ${(addr.length / cells.length).toFixed(1)} Adressen)`)

// ---------------------------------------------------------------- Gewässer

/**
 * See, Limmat und Sihl. Ohne sie ist eine Karte, die nur aus Hausgrundrissen
 * besteht, kaum als Zürich zu erkennen.
 */
const waterPolys: number[][][] = []
const waterLines: number[][][] = []
const seenWater = new Set<string>()

/** Vereinfacht einen Ring in Grad-Koordinaten über die projizierte Fassung. */
function simplifyRing(ring: number[][], tolM: number): number[][] {
  const xy = ring.map((c) => toXY(c[0], c[1]) as [number, number])
  return simplify(xy, tolM).map((c) => {
    const [lo, la] = toLonLat(c[0], c[1])
    return [round(lo), round(la)]
  })
}

function pushRing(ring: number[][], minArea: number) {
  if (ring.length < 4) return
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
  if (!closed) return
  if (Math.abs(ringArea(ring)) < minArea) return
  waterPolys.push(simplifyRing(ring, 6))
}

for (const el of read('water.json').elements) {
  const k = `${el.type}${el.id}`
  if (seenWater.has(k)) continue
  seenWater.add(k)
  const tags = el.tags ?? {}

  if (el.type === 'way') {
    const geom = clean(el.geometry)
    if (geom.length < 2) continue
    const ring = geom.map((p) => [p.lon, p.lat])
    const closed =
      ring.length > 3 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
    if (closed) pushRing(ring, 2000)
    else if (tags.waterway === 'river' || tags.waterway === 'canal')
      waterLines.push(simplifyRing(ring, 4))
  } else if (el.type === 'relation') {
    // Der Zürichsee ist eine Multipolygon-Relation: die äusseren Mitglieder sind
    // offene Wegstücke und ergeben erst zusammengesetzt einen Ring.
    const segmente = (el.members ?? [])
      .filter((m: any) => m.role !== 'inner')
      .map((m: any) => clean(m.geometry))
      .filter((g: Pt[]) => g.length > 1)
    for (const ring of stitchRings(segmente)) pushRing(ring, 5000)
  }
}
console.log(`Gewässer: ${waterPolys.length} Flächen, ${waterLines.length} Linien`)

// ---------------------------------------------------------------- Strassen

/**
 * Strassen dienen hier nur der Orientierung. Deshalb nur zwei Klassen und
 * keine Fahrbahnbreiten: "haupt" für das Gerüst der Stadt, "neben" für alles
 * andere. Der Name bleibt dran, damit die Karte ihn beim Hineinzoomen setzen kann.
 */
const HAUPT = new Set(['motorway', 'trunk', 'primary', 'secondary'])
type Strasse = { klasse: 'haupt' | 'neben'; name?: string; punkte: number[][] }
const strassen: Strasse[] = []
const seenStreet = new Set<number>()

for (const f of readdirSync(RAW).filter((f) => f.startsWith('streets_'))) {
  for (const el of read(f).elements) {
    if (el.type !== 'way' || seenStreet.has(el.id)) continue
    seenStreet.add(el.id)
    const geom = clean(el.geometry)
    if (geom.length < 2) continue
    // Wege ganz ausserhalb der Stadt weglassen; angeschnittene bleiben drin,
    // sonst brechen die Ausfallachsen an der Stadtgrenze mitten im Bild ab.
    if (!geom.some((pt) => inCity(pt.lon, pt.lat))) continue
    strassen.push({
      klasse: HAUPT.has(el.tags?.highway) ? 'haupt' : 'neben',
      name: el.tags?.name,
      punkte: simplifyRing(geom.map((pt) => [pt.lon, pt.lat]), 5),
    })
  }
}
console.log(`Strassen: ${strassen.length} (${strassen.filter((s) => s.klasse === 'haupt').length} Hauptachsen)`)

// ---------------------------------------------------------------- Fussweggraph

/**
 * Aus den begehbaren Wegen (`wege_*.json`) einen Graphen für echte Gehdistanzen.
 * Kanten mit planarer Länge und `treppe`-Flag; die Höhe kommt erst in `04` dazu.
 */
{
  const wege: any[] = []
  const seenWeg = new Set<number>()
  for (const f of readdirSync(RAW).filter((f) => f.startsWith('wege_'))) {
    for (const el of read(f).elements) {
      if (el.type !== 'way' || seenWeg.has(el.id)) continue
      seenWeg.add(el.id)
      wege.push(el)
    }
  }
  const graph = baueWalkGraph(wege)
  writeFileSync(OUT + 'walk.json', JSON.stringify(graph))
  console.log(
    `Fussweggraph: ${graph.nodeLon.length} Knoten, ${graph.edgeA.length} Kanten ` +
      `(${graph.edgeTreppe.reduce((n, t) => n + t, 0)} Treppen)`
  )
}

// ---------------------------------------------------------------- Kulturorte

/**
 * Die Sorten, nach denen die Kulturkarte zählt. Die Reihenfolge bestimmt auch
 * die Reihenfolge in der Aufschlüsselung beim Darüberfahren; `restaurant` steht
 * am Ende, damit bestehende `?arten=`-Links (Indizes 0–8) stabil bleiben.
 * Achtung: dieselbe Liste steht in `04-compute-scores.ts` und muss deckungsgleich sein.
 */
export const KULTUR_ARTEN = ['cafe', 'bar', 'buehne', 'kino', 'museum', 'kunst', 'bibliothek', 'badi', 'treff', 'restaurant'] as const
type KulturArt = (typeof KULTUR_ARTEN)[number]

/**
 * Hammam, Therme, Sauna und Spa sind Wellness, kein Bad zum Schwimmen – sie
 * hängen oft am selben `amenity=public_bath` wie die Badis und müssen raus.
 */
function istWellness(t: Record<string, string>): boolean {
  const typ = t['bath:type'] ?? ''
  if (typ === 'hammam' || typ === 'thermal' || typ === 'sauna') return true
  return /\b(spa|wellness|therme|hammam)\b/i.test(t.name ?? '')
}

function kulturArt(t: Record<string, string>): KulturArt | null {
  switch (t.amenity) {
    case 'cafe':
      return 'cafe'
    case 'restaurant':
      return 'restaurant'
    case 'bar':
    case 'pub':
    case 'biergarten':
    case 'nightclub':
      return 'bar'
    case 'theatre':
    case 'arts_centre':
    case 'events_venue':
    case 'music_venue':
      return 'buehne'
    case 'cinema':
      return 'kino'
    case 'library':
      return 'bibliothek'
    case 'public_bath':
      return istWellness(t) ? null : 'badi'
    case 'community_centre':
      return 'treff'
  }
  if (t.tourism === 'museum' || t.tourism === 'gallery') return 'museum'
  if (t.tourism === 'artwork') return 'kunst'
  if (t.leisure === 'swimming_area' || t.leisure === 'water_park')
    return istWellness(t) ? null : 'badi'
  if (t.leisure === 'dance') return 'buehne'
  // Frei- und Hallenbäder sind in der Schweiz meist leisure=sports_centre mit
  // sport=swimming (Freibad Letzigraben, Freibad Heuried, Hallenbad City …).
  // Schulschwimmanlagen tragen dieselben Tags, sind aber nicht öffentlich –
  // die filtern Name und building=school weg.
  if (
    t.leisure === 'sports_centre' &&
    /swimming/.test(t.sport ?? '') &&
    t.name &&
    t.building !== 'school' &&
    !/schul/i.test(t.name) &&
    !istWellness(t)
  )
    return 'badi'
  return null
}

type Kulturort = { art: KulturArt; name: string; lon: number; lat: number; wikidata: string }
const kulturorte: Kulturort[] = []
const seenKultur = new Set<string>()
for (const el of read('kultur.json').elements) {
  const k = `${el.type}${el.id}`
  if (seenKultur.has(k)) continue
  seenKultur.add(k)
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (lat === undefined) continue
  const art = kulturArt(el.tags ?? {})
  if (!art) continue
  kulturorte.push({ art, name: el.tags?.name ?? '', lon: round(lon), lat: round(lat), wikidata: el.tags?.wikidata ?? '' })
}

/**
 * Grössere Häuser trägt OSM oft mehrfach: Mehrsaal-Kinos als einen Punkt je
 * Saalgruppe (das Riffraff als «Riffraff 1 + 2» und «Riffraff 3 + 4», ~30 m
 * auseinander), Galerien doppelt erfasst, ein Ort einmal als Knoten und einmal
 * als Gebäudeumriss. Solche Punkte teilen die `wikidata`-Id – dasselbe reale
 * Haus – und werden je Sorte zu einem zusammengezogen, dem ersten benannten.
 * Der Abstands-Deckel lässt Fälle zu, in denen eine Id für zwei echte Häuser
 * steht: das Museum für Gestaltung und sein Schaudepot im Toni-Areal liegen
 * ~2 km auseinander und bleiben zwei Punkte.
 */
const WIKIDATA_MERGE_M = 300
{
  const nachId = new Map<string, number[]>()
  for (let i = 0; i < kulturorte.length; i++) {
    const w = kulturorte[i].wikidata
    if (!w) continue
    const g = nachId.get(w)
    if (g) g.push(i)
    else nachId.set(w, [i])
  }
  const weg = new Set<number>()
  for (const ids of nachId.values()) {
    if (ids.length < 2) continue
    const xy = ids.map((i) => toXY(kulturorte[i].lon, kulturorte[i].lat))
    const uf = ids.map((_, k) => k)
    const find = (k: number): number => (uf[k] === k ? k : (uf[k] = find(uf[k])))
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++)
        if (
          kulturorte[ids[a]].art === kulturorte[ids[b]].art &&
          dist(xy[a][0], xy[a][1], xy[b][0], xy[b][1]) < WIKIDATA_MERGE_M
        )
          uf[find(a)] = find(b)

    const gruppen = new Map<number, number[]>()
    for (let k = 0; k < ids.length; k++) {
      const r = find(k)
      const g = gruppen.get(r)
      if (g) g.push(k)
      else gruppen.set(r, [k])
    }
    for (const ks of gruppen.values()) {
      if (ks.length < 2) continue
      const gewinner = ks.find((k) => kulturorte[ids[k]].name) ?? ks[0]
      for (const k of ks) if (k !== gewinner) weg.add(ids[k])
    }
  }
  if (weg.size) {
    const gefiltert = kulturorte.filter((_, i) => !weg.has(i))
    kulturorte.length = 0
    kulturorte.push(...gefiltert)
    console.log(`Kulturorte mit gleicher wikidata-Id zusammengezogen: ${weg.size} entfernt`)
  }
}

/**
 * Badis mappt OSM meist mehrteilig: eine `amenity=public_bath`-Fläche und darin
 * je ein `leisure=swimming_area`-Becken, dazu Frei- und Hallenbad desselben Bades
 * als zwei Einträge und bisweilen doppelte Namensflächen. So wird ein Bad zu
 * mehreren Punkten (Utoquai drei, Mythenquai zwei) und die Sorte `badi` in der
 * Vielfalt überzählt. Geometrie fehlt (`out center`), also entscheidet die Nähe:
 * Badis näher als `BADI_MERGE_M` gehören zusammen, sofern die Namen aufs selbe
 * Bad deuten. `gleichesBad` streicht dafür die Gattungswörter (Frei-, Hallenbad,
 * Strandbad …) und vergleicht den Rest – so fällt «Hallen- und Freibad Juch»
 * mit «Hallenbad Juch» zusammen, «Hallenbad City» aber nicht mit dem 95 m
 * entfernten «Männerbad Schanzengraben». Namensloses zieht immer ans nächste
 * Bad. Der kürzeste Abstand zwischen zwei echten Bädern liegt bei ~400 m.
 */
const BADI_MERGE_M = 150
const BADI_GATTUNG = new Set([
  'hallenbad', 'freibad', 'hallenfreibad', 'strandbad', 'seebad', 'flussbad', 'gartenbad',
  'schwimmbad', 'thermalbad', 'warmebad', 'badeland', 'hallen', 'frei', 'bad', 'baeder',
  'und', 'im', 'in', 'am', 'an', 'der', 'die', 'das',
])
const badiKern = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && !BADI_GATTUNG.has(w))
const gleichesBad = (a: string, b: string) => {
  if (!a || !b) return true // Namensloses zieht immer mit
  const ka = badiKern(a)
  const kb = badiKern(b)
  if (!ka.length || !kb.length) return a.toLowerCase() === b.toLowerCase()
  if (ka.join(' ') === kb.join(' ')) return true
  if (ka.every((w) => kb.includes(w)) || kb.every((w) => ka.includes(w))) return true
  return ka.some((w) => w.length >= 5 && kb.includes(w))
}
{
  const idx = kulturorte.map((o, i) => (o.art === 'badi' ? i : -1)).filter((i) => i >= 0)
  const xy = idx.map((i) => toXY(kulturorte[i].lon, kulturorte[i].lat))
  const name = idx.map((i) => kulturorte[i].name)
  const uf = idx.map((_, k) => k)
  const find = (k: number): number => (uf[k] === k ? k : (uf[k] = find(uf[k])))
  for (let a = 0; a < idx.length; a++)
    for (let b = a + 1; b < idx.length; b++) {
      if (!gleichesBad(name[a], name[b])) continue
      if (dist(xy[a][0], xy[a][1], xy[b][0], xy[b][1]) < BADI_MERGE_M) uf[find(a)] = find(b)
    }

  const gruppen = new Map<number, number[]>()
  for (let k = 0; k < idx.length; k++) {
    const r = find(k)
    const g = gruppen.get(r)
    if (g) g.push(k)
    else gruppen.set(r, [k])
  }
  const behalten = new Set<number>()
  for (const ks of gruppen.values()) {
    // je eigenständigem Bad ein Punkt; bei mehreren Namen gewinnt der längste
    const benannt = ks.filter((k) => name[k]).sort((x, y) => name[y].length - name[x].length)
    if (!benannt.length) {
      behalten.add(idx[ks[0]])
      continue
    }
    const vertreter: number[] = []
    for (const k of benannt) if (!vertreter.some((r) => gleichesBad(name[k], name[r]))) vertreter.push(k)
    for (const r of vertreter) behalten.add(idx[r])
  }
  const weg = new Set(idx.filter((i) => !behalten.has(i)))
  if (weg.size) {
    const gefiltert = kulturorte.filter((_, i) => !weg.has(i))
    kulturorte.length = 0
    kulturorte.push(...gefiltert)
    console.log(`Badis zusammengezogen: ${weg.size} Doppelpunkte entfernt, ${behalten.size} Bäder`)
  }
}

const nachArt = new Map<string, number>()
for (const o of kulturorte) nachArt.set(o.art, (nachArt.get(o.art) ?? 0) + 1)
console.log(
  `Kulturorte: ${kulturorte.length} (${[...nachArt].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(', ')})`
)

// ---------------------------------------------------------------- Beschriftung

/**
 * Drei Sorten Beschriftung mit eigener Zoomstufe, damit die Karte nicht zuwächst:
 * Stadtteile früh, Bahnhöfe mittel, Plätze und Quartiere zuletzt.
 */
type Marke = { name: string; art: 'stadtteil' | 'bahnhof' | 'platz'; abZoom: number; lon: number; lat: number }
const marken: Marke[] = []
for (const el of read('places.json').elements) {
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  const name = el.tags?.name
  if (!name || lat === undefined || !inCity(lon, lat)) continue

  const place = el.tags.place
  let art: Marke['art']
  let abZoom: number
  if (el.tags.railway === 'station') {
    art = 'bahnhof'
    abZoom = 12.5
  } else if (place === 'square') {
    art = 'platz'
    abZoom = 14
  } else if (place === 'city' || place === 'town' || place === 'suburb') {
    art = 'stadtteil'
    abZoom = 11
  } else {
    art = 'stadtteil'
    abZoom = 13.5
  }
  marken.push({ name, art, abZoom, lon: round(lon), lat: round(lat) })
}
console.log(`Beschriftung: ${marken.length} Marken`)

// ---------------------------------------------------------------- Schreiben

mkdirSync(PUBLIC, { recursive: true })
const fc = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features })

writeFileSync(
  PUBLIC + 'city.geojson',
  JSON.stringify({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: cityRings.map((r) => r.map(([lo, la]) => [round(lo), round(la)])),
    },
  })
)

writeFileSync(
  PUBLIC + 'water.geojson',
  fc([
    ...waterPolys.map((ring) => ({
      type: 'Feature',
      properties: { kind: 'area' },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })),
    ...waterLines.map((line) => ({
      type: 'Feature',
      properties: { kind: 'line' },
      geometry: { type: 'LineString', coordinates: line },
    })),
  ])
)

writeFileSync(
  PUBLIC + 'streets.geojson',
  fc(
    strassen.map((st) => ({
      type: 'Feature',
      properties: st.name ? { k: st.klasse, name: st.name } : { k: st.klasse },
      geometry: { type: 'LineString', coordinates: st.punkte },
    }))
  )
)

writeFileSync(
  PUBLIC + 'labels.geojson',
  fc(
    marken.map((m) => ({
      type: 'Feature',
      properties: { name: m.name, art: m.art, z: m.abZoom },
      geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
    }))
  )
)

writeFileSync(
  PUBLIC + 'kultur.geojson',
  fc(
    kulturorte.map((o) => ({
      type: 'Feature',
      properties: o.name ? { art: o.art, name: o.name } : { art: o.art },
      geometry: { type: 'Point', coordinates: [o.lon, o.lat] },
    }))
  )
)

writeFileSync(
  OUT + 'targets.json',
  JSON.stringify({
    cells,
    buildings: [...buildings.values()],
    kultur: kulturorte.map((o) => {
      const [x, y] = toXY(o.lon, o.lat)
      return { art: o.art, x, y }
    }),
  })
)
console.log('geschrieben: public/data/{city,water,streets,labels,kultur}.geojson + data/derived/targets.json')
