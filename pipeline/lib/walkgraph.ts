/**
 * Ein Fussweggraph aus OSM-Wegen für echte Gehdistanzen.
 *
 * `baueWalkGraph` macht aus den `way`-Elementen (`highway=…`, mit `nodes[]` und
 * `geometry[]` aus `out geom`) einen flachen, serialisierbaren Graphen: Knoten =
 * OSM-Knoten (nach ID und Koordinate zusammengeführt), Kanten = aufeinander
 * folgende Knotenpaare einer Way.
 *
 * `augmentiere` hängt Ankerpunkte (Gebäude, Zielzellen, Haltestellen, Kulturorte)
 * als echte Knoten in den Graphen: jede Kante wird an den Fusspunkten der auf ihr
 * liegenden Anker aufgeteilt. So stimmt auch der Weg zwischen zwei Punkten auf
 * derselben Kante – ein blosses „raus zum Endknoten und zurück" würde ihn stark
 * überschätzen. Der Lotabstand zum Fusspunkt kommt separat als `ankerLot` zurück
 * und wird beim Starten bzw. Ankommen addiert.
 *
 * `WalkDijkstra` rechnet ab einem oder mehreren Startknoten die Gehzeit zu allen
 * Knoten im Zeitbudget. Die Kantenkosten kommen von aussen (Sekunden je Kante),
 * damit derselbe Graph für Fuss und Velo dient – Velo setzt `treppe`-Kanten auf
 * unendlich.
 */
import { toXY, dist } from './geo.ts'

export const INF = Infinity

type OsmWay = {
  nodes?: number[]
  geometry?: ({ lat: number; lon: number } | null)[]
  tags?: Record<string, string>
}

/** Flache Arrays, direkt nach JSON serialisierbar. */
export type WalkGraphRoh = {
  nodeLon: number[]
  nodeLat: number[]
  edgeA: number[]
  edgeB: number[]
  edgeLen: number[]
  edgeTreppe: number[]
}

export type WalkGraph = {
  n: number
  m: number
  nodeX: Float64Array
  nodeY: Float64Array
  nodeLon: Float64Array
  nodeLat: Float64Array
  edgeA: Int32Array
  edgeB: Int32Array
  edgeLen: Float64Array
  edgeTreppe: Uint8Array
  /** CSR: Nachbarschaft je Knoten. */
  adjOff: Int32Array
  adjTo: Int32Array
  adjEdge: Int32Array
}

/** Knoten in einem groben Raster verschmelzen, damit Kachelränder zusammenwachsen. */
const WELD = 1e6 // ~0.1 m in Grad
const gkey = (gx: number, gy: number) => gx * 100003 + gy

export function baueWalkGraph(wege: OsmWay[]): WalkGraphRoh {
  const idIdx = new Map<number, number>()
  const koordIdx = new Map<number, number>()
  const nodeX: number[] = []
  const nodeY: number[] = []
  const nodeLon: number[] = []
  const nodeLat: number[] = []

  const knoten = (id: number, lon: number, lat: number): number => {
    const vorhanden = idIdx.get(id)
    if (vorhanden !== undefined) return vorhanden
    const kk = Math.round(lon * WELD) * 2147483647 + Math.round(lat * WELD)
    const geweldet = koordIdx.get(kk)
    if (geweldet !== undefined) {
      idIdx.set(id, geweldet)
      return geweldet
    }
    const i = nodeLon.length
    const [x, y] = toXY(lon, lat)
    nodeX.push(x)
    nodeY.push(y)
    nodeLon.push(lon)
    nodeLat.push(lat)
    idIdx.set(id, i)
    koordIdx.set(kk, i)
    return i
  }

  // Kanten sammeln, parallele Kanten auf die kürzeste eindampfen.
  const kante = new Map<number, { a: number; b: number; len: number; treppe: number }>()
  const kkey = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a)

  for (const w of wege) {
    const ns = w.nodes
    const geo = w.geometry
    if (!ns || !geo || ns.length < 2) continue
    const treppe = w.tags?.highway === 'steps' ? 1 : 0
    let prev = -1
    for (let j = 0; j < ns.length; j++) {
      const g = geo[j]
      if (!g || g.lat == null || g.lon == null) {
        prev = -1
        continue
      }
      const cur = knoten(ns[j], g.lon, g.lat)
      if (prev >= 0 && prev !== cur) {
        const len = dist(nodeX[prev], nodeY[prev], nodeX[cur], nodeY[cur])
        const k = kkey(prev, cur)
        const alt = kante.get(k)
        if (!alt || len < alt.len) kante.set(k, { a: prev, b: cur, len, treppe })
      }
      prev = cur
    }
  }

  const edgeA: number[] = []
  const edgeB: number[] = []
  const edgeLen: number[] = []
  const edgeTreppe: number[] = []
  for (const e of kante.values()) {
    edgeA.push(e.a)
    edgeB.push(e.b)
    edgeLen.push(e.len)
    edgeTreppe.push(e.treppe)
  }

  return { nodeLon, nodeLat, edgeA, edgeB, edgeLen, edgeTreppe }
}

export type Augmentiert = WalkGraphRoh & {
  /** Graphknoten je Ankerpunkt, `-1` wenn nichts in `maxM` lag. */
  ankerKnoten: Int32Array
  /** Lotabstand (Meter) vom Ankerpunkt zu seinem Fusspunkt auf der Kante. */
  ankerLot: Float64Array
}

/**
 * Ankerpunkte als echte Knoten in den Graphen einfügen (Kanten an den
 * Fusspunkten aufteilen). `punkte` in projizierten Metern.
 *
 * `hauptKnoten` (optional): Maske über die Rohknoten, `1` = im zusammenhängenden
 * Hauptnetz. Ist sie gesetzt, snappt ein Anker nur an Kanten des Hauptnetzes –
 * nie an eine geometrisch näher liegende, aber abgetrennte Weginsel (OSM-Lücke,
 * privater Stichweg). Findet sich in `maxM` keine Hauptnetz-Kante, bleibt der
 * Anker bei `-1` und der Aufrufer schickt ihn über die Luftlinie ans Ziel.
 */
export function augmentiere(
  roh: WalkGraphRoh,
  punkte: { x: number; y: number }[],
  maxM: number,
  hauptKnoten?: Uint8Array
): Augmentiert {
  const nodeLon = roh.nodeLon.slice()
  const nodeLat = roh.nodeLat.slice()
  const nodeX: number[] = []
  const nodeY: number[] = []
  for (let i = 0; i < nodeLon.length; i++) {
    const [x, y] = toXY(nodeLon[i], nodeLat[i])
    nodeX.push(x)
    nodeY.push(y)
  }

  // Rasterindex über Rohkanten (nach Bounding-Box-Zellen).
  const cell = Math.max(maxM, 60)
  const grid = new Map<number, number[]>()
  const M = roh.edgeA.length
  for (let e = 0; e < M; e++) {
    const ax = nodeX[roh.edgeA[e]]
    const ay = nodeY[roh.edgeA[e]]
    const bx = nodeX[roh.edgeB[e]]
    const by = nodeY[roh.edgeB[e]]
    const x0 = Math.floor(Math.min(ax, bx) / cell)
    const x1 = Math.floor(Math.max(ax, bx) / cell)
    const y0 = Math.floor(Math.min(ay, by) / cell)
    const y1 = Math.floor(Math.max(ay, by) / cell)
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = gkey(cx, cy)
        const arr = grid.get(k)
        if (arr) arr.push(e)
        else grid.set(k, [e])
      }
  }

  const ankerKnoten = new Int32Array(punkte.length).fill(-1)
  const ankerLot = new Float64Array(punkte.length)
  // je Rohkante: Liste { anker, t } der Fusspunkte darauf
  const proKante = new Map<number, { anker: number; t: number }[]>()

  const r = 1
  for (let p = 0; p < punkte.length; p++) {
    const px = punkte[p].x
    const py = punkte[p].y
    const gx = Math.floor(px / cell)
    const gy = Math.floor(py / cell)
    let bestD2 = maxM * maxM
    let bestE = -1
    let bestT = 0
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        const bucket = grid.get(gkey(gx + dx, gy + dy))
        if (!bucket) continue
        for (const e of bucket) {
          if (hauptKnoten && !hauptKnoten[roh.edgeA[e]]) continue
          const ax = nodeX[roh.edgeA[e]]
          const ay = nodeY[roh.edgeA[e]]
          const bx = nodeX[roh.edgeB[e]]
          const by = nodeY[roh.edgeB[e]]
          const vx = bx - ax
          const vy = by - ay
          const ll = vx * vx + vy * vy
          let t = ll > 0 ? ((px - ax) * vx + (py - ay) * vy) / ll : 0
          if (t < 0) t = 0
          else if (t > 1) t = 1
          const fx = ax + t * vx
          const fy = ay + t * vy
          const d2 = (px - fx) * (px - fx) + (py - fy) * (py - fy)
          if (d2 < bestD2) {
            bestD2 = d2
            bestE = e
            bestT = t
          }
        }
      }
    if (bestE < 0) continue
    ankerLot[p] = Math.sqrt(bestD2)
    if (bestT <= 1e-6) {
      ankerKnoten[p] = roh.edgeA[bestE]
    } else if (bestT >= 1 - 1e-6) {
      ankerKnoten[p] = roh.edgeB[bestE]
    } else {
      const liste = proKante.get(bestE)
      if (liste) liste.push({ anker: p, t: bestT })
      else proKante.set(bestE, [{ anker: p, t: bestT }])
    }
  }

  const edgeA: number[] = []
  const edgeB: number[] = []
  const edgeLen: number[] = []
  const edgeTreppe: number[] = []
  const neuerKnoten = (lon: number, lat: number): number => {
    const i = nodeLon.length
    nodeLon.push(lon)
    nodeLat.push(lat)
    return i
  }

  for (let e = 0; e < M; e++) {
    const a = roh.edgeA[e]
    const b = roh.edgeB[e]
    const L = roh.edgeLen[e]
    const tr = roh.edgeTreppe[e]
    const liste = proKante.get(e)
    if (!liste || liste.length === 0) {
      edgeA.push(a)
      edgeB.push(b)
      edgeLen.push(L)
      edgeTreppe.push(tr)
      continue
    }
    liste.sort((x, y) => x.t - y.t)
    const lonA = roh.nodeLon[a]
    const latA = roh.nodeLat[a]
    const lonB = roh.nodeLon[b]
    const latB = roh.nodeLat[b]
    let vorKnoten = a
    let vorT = 0
    for (const { anker, t } of liste) {
      const kn = neuerKnoten(lonA + (lonB - lonA) * t, latA + (latB - latA) * t)
      ankerKnoten[anker] = kn
      edgeA.push(vorKnoten)
      edgeB.push(kn)
      edgeLen.push((t - vorT) * L)
      edgeTreppe.push(tr)
      vorKnoten = kn
      vorT = t
    }
    edgeA.push(vorKnoten)
    edgeB.push(b)
    edgeLen.push((1 - vorT) * L)
    edgeTreppe.push(tr)
  }

  return { nodeLon, nodeLat, edgeA, edgeB, edgeLen, edgeTreppe, ankerKnoten, ankerLot }
}

export function ladeWalkGraph(roh: WalkGraphRoh): WalkGraph {
  const n = roh.nodeLon.length
  const m = roh.edgeA.length
  const nodeLon = Float64Array.from(roh.nodeLon)
  const nodeLat = Float64Array.from(roh.nodeLat)
  const nodeX = new Float64Array(n)
  const nodeY = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const [x, y] = toXY(nodeLon[i], nodeLat[i])
    nodeX[i] = x
    nodeY[i] = y
  }
  const edgeA = Int32Array.from(roh.edgeA)
  const edgeB = Int32Array.from(roh.edgeB)
  const edgeLen = Float64Array.from(roh.edgeLen)
  const edgeTreppe = Uint8Array.from(roh.edgeTreppe)

  const grad = new Int32Array(n + 1)
  for (let e = 0; e < m; e++) {
    grad[edgeA[e] + 1]++
    grad[edgeB[e] + 1]++
  }
  for (let i = 0; i < n; i++) grad[i + 1] += grad[i]
  const adjOff = grad
  const adjTo = new Int32Array(m * 2)
  const adjEdge = new Int32Array(m * 2)
  const fuell = Int32Array.from(adjOff.subarray(0, n))
  for (let e = 0; e < m; e++) {
    const a = edgeA[e]
    const b = edgeB[e]
    adjTo[fuell[a]] = b
    adjEdge[fuell[a]] = e
    fuell[a]++
    adjTo[fuell[b]] = a
    adjEdge[fuell[b]] = e
    fuell[b]++
  }

  return { n, m, nodeX, nodeY, nodeLon, nodeLat, edgeA, edgeB, edgeLen, edgeTreppe, adjOff, adjTo, adjEdge }
}

/**
 * Marker je Knoten: `1`, wenn er zur grössten zusammenhängenden Komponente
 * gehört. Kleine abgetrennte Weginseln (OSM-Lücken, private Zufahrten als
 * einziger Anschluss) fallen so raus – Anker darauf gelten besser als nicht
 * angeschlossen und kommen über die Luftlinie ans Ziel.
 */
export function groessteKomponente(g: WalkGraph): Uint8Array {
  const comp = new Int32Array(g.n).fill(-1)
  const stack = new Int32Array(g.n)
  let besteId = -1
  let besteGroesse = 0
  let naechste = 0
  for (let start = 0; start < g.n; start++) {
    if (comp[start] !== -1) continue
    const id = naechste++
    let sp = 0
    let groesse = 0
    stack[sp++] = start
    comp[start] = id
    while (sp > 0) {
      const u = stack[--sp]
      groesse++
      for (let k = g.adjOff[u]; k < g.adjOff[u + 1]; k++) {
        const v = g.adjTo[k]
        if (comp[v] === -1) {
          comp[v] = id
          stack[sp++] = v
        }
      }
    }
    if (groesse > besteGroesse) {
      besteGroesse = groesse
      besteId = id
    }
  }
  const im = new Uint8Array(g.n)
  for (let i = 0; i < g.n; i++) im[i] = comp[i] === besteId ? 1 : 0
  return im
}

/**
 * Gekappter Dijkstra ab einem oder mehreren Startknoten, mit wiederverwendbarem
 * Arbeitsspeicher. `kantenSek` gibt die Kosten je Kante (Sekunden); `INF` sperrt
 * eine Kante (Velo über Treppen).
 */
export class WalkDijkstra {
  private g: WalkGraph
  readonly dist: Float64Array
  private besucht: Uint8Array
  private reihe: Int32Array
  private reiheN = 0
  private hNode: Int32Array
  private hDist: Float64Array
  private hLen = 0

  constructor(g: WalkGraph) {
    this.g = g
    this.dist = new Float64Array(g.n).fill(INF)
    this.besucht = new Uint8Array(g.n)
    this.reihe = new Int32Array(g.n)
    this.hNode = new Int32Array(1024)
    this.hDist = new Float64Array(1024)
  }

  /** Knoten, die der letzte Lauf angefasst hat (Ausschnitt – nicht behalten). */
  angefasst(): Int32Array {
    return this.reihe.subarray(0, this.reiheN)
  }

  private push(node: number, d: number): void {
    if (this.hLen === this.hNode.length) {
      const nn = new Int32Array(this.hLen * 2)
      const nd = new Float64Array(this.hLen * 2)
      nn.set(this.hNode)
      nd.set(this.hDist)
      this.hNode = nn
      this.hDist = nd
    }
    let i = this.hLen++
    this.hNode[i] = node
    this.hDist[i] = d
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.hDist[p] <= this.hDist[i]) break
      this.swap(i, p)
      i = p
    }
  }

  private pop(): number {
    const top = this.hNode[0]
    this.hLen--
    if (this.hLen > 0) {
      this.hNode[0] = this.hNode[this.hLen]
      this.hDist[0] = this.hDist[this.hLen]
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const rr = l + 1
        let s = i
        if (l < this.hLen && this.hDist[l] < this.hDist[s]) s = l
        if (rr < this.hLen && this.hDist[rr] < this.hDist[s]) s = rr
        if (s === i) break
        this.swap(i, s)
        i = s
      }
    }
    return top
  }

  private swap(i: number, j: number): void {
    const n = this.hNode[i]
    this.hNode[i] = this.hNode[j]
    this.hNode[j] = n
    const d = this.hDist[i]
    this.hDist[i] = this.hDist[j]
    this.hDist[j] = d
  }

  /**
   * @param starts  Startknoten mit Anfangskosten (Sekunden bis dorthin).
   * @param cap     Zeitbudget in Sekunden; Knoten darüber bleiben `INF`.
   * @param kantenSek  Kosten je Kante (Länge `g.m`), `INF` = gesperrt.
   */
  run(starts: { node: number; sek: number }[], cap: number, kantenSek: Float64Array): Float64Array {
    const g = this.g
    const { dist, besucht, reihe } = this
    for (let i = 0; i < this.reiheN; i++) {
      dist[reihe[i]] = INF
      besucht[reihe[i]] = 0
    }
    this.reiheN = 0
    this.hLen = 0
    for (const s of starts) {
      if (s.sek < dist[s.node]) {
        if (dist[s.node] === INF) reihe[this.reiheN++] = s.node
        dist[s.node] = s.sek
        this.push(s.node, s.sek)
      }
    }
    while (this.hLen > 0) {
      const u = this.pop()
      const du = dist[u]
      if (besucht[u]) continue
      besucht[u] = 1
      if (du > cap) break
      for (let k = g.adjOff[u]; k < g.adjOff[u + 1]; k++) {
        const w = kantenSek[g.adjEdge[k]]
        if (w === INF) continue
        const nd = du + w
        const v = g.adjTo[k]
        if (nd < dist[v] && nd <= cap) {
          if (dist[v] === INF) reihe[this.reiheN++] = v
          dist[v] = nd
          this.push(v, nd)
        }
      }
    }
    return dist
  }
}
