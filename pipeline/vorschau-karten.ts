/**
 * Zeichnet die Kartenhintergründe der Vorschaubilder (`app/og/karte-*.svg`).
 *
 * Die Stadtbilder zeigen jedes Haus als Rasterpunkt, eingefärbt nach seinem
 * Rang: gelb heisst gut angebunden, violett weit weg. Das Bild des Velonavi
 * zeigt eine echt gerechnete Route quer durch Zürich in den Stufenfarben.
 *
 * Die Dateien sind fertig gerechnet eingecheckt, damit `next build` die
 * 30 MB Gebäudedaten nicht lesen muss. Neu zeichnen nach neuen Daten:
 *
 *   pnpm daten:vorschau
 */

import { readFileSync, writeFileSync } from 'node:fs'
import {
  ladeGraph, einrastenAlle, route, kantenKosten, reinZeitlich, VOREINSTELLUNGEN,
  type VeloMeta,
} from '../app/velonavi/router.ts'
import { OG } from '../app/og/farben.ts'

const W = 1200
const H = 630
const wurzel = new URL('..', import.meta.url).pathname
const lies = (p: string) => JSON.parse(readFileSync(wurzel + p, 'utf8'))

type Pos = [number, number]
type Geo = { type: string; coordinates: unknown }

/** Lineare Projektion um einen Mittelpunkt, Norden oben. */
function projektion(lon0: number, lat0: number, meterJePixel: number, cx: number, cy: number) {
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const my = 111133
  return ([lon, lat]: Pos): Pos => [cx + ((lon - lon0) * mx) / meterJePixel, cy - ((lat - lat0) * my) / meterJePixel]
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** Linienzug als SVG-Pfad, Punkte näher als `min` Pixel fallen weg. */
function linie(pts: Pos[], min = 1.2) {
  let d = ''
  let lx = NaN, ly = NaN
  pts.forEach(([x, y], i) => {
    if (i > 0 && i < pts.length - 1 && Math.hypot(x - lx, y - ly) < min) return
    d += `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`
    lx = x
    ly = y
  })
  return d
}

function sichtbar(pts: Pos[], rand = 40) {
  return pts.some(([x, y]) => x > -rand && x < W + rand && y > -rand && y < H + rand)
}

/** Alle Linien und Flächenringe einer Geometrie. */
function ringe(g: Geo): Pos[][] {
  const c = g.coordinates as never
  if (g.type === 'LineString') return [c]
  if (g.type === 'MultiLineString' || g.type === 'Polygon') return c
  if (g.type === 'MultiPolygon') return (c as Pos[][][]).flat()
  return []
}

function pfade(features: { geometry: Geo; properties?: Record<string, unknown> }[], p: (x: Pos) => Pos, filter = (_f: unknown) => true) {
  let d = ''
  for (const f of features) {
    if (!filter(f)) continue
    for (const r of ringe(f.geometry)) {
      const pts = r.map(p)
      if (pts.length > 1 && sichtbar(pts)) d += linie(pts)
    }
  }
  return d
}

function svg(inhalt: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inhalt}</svg>`
}

// ------------------------------------------------------------ Stadtbilder

/**
 * Die Häuser als Punktraster: je Zelle der mittlere Rang, die Grösse nach
 * der Zahl der Häuser. Das Raster liest sich wie Druckraster und hält die
 * Datei klein.
 */
function stadt(ordner: string, datei: string, mitte: Pos, meterJePixel: number) {
  const inhalt = stadtInhalt(ordner, projektion(mitte[0], mitte[1], meterJePixel, 900, 315))
  writeFileSync(wurzel + `app/og/${datei}`, svg(inhalt))
  console.log(`${datei}: ${(svg(inhalt).length / 1024).toFixed(0)} kB`)
}

function stadtInhalt(ordner: string, P: (x: Pos) => Pos) {
  const RASTER = 9
  const zellen = new Map<number, { n: number; p: number }>()
  const haeuser = lies(`public/data/${ordner}/buildings.geojson`).features as { properties: { x: number; y: number; p: number } }[]
  for (const h of haeuser) {
    const [x, y] = P([h.properties.x, h.properties.y])
    if (x < -RASTER || x > W + RASTER || y < -RASTER || y > H + RASTER) continue
    const k = Math.round(x / RASTER) * 10000 + Math.round(y / RASTER)
    const z = zellen.get(k) ?? { n: 0, p: 0 }
    z.n++
    z.p += h.properties.p
    zellen.set(k, z)
  }
  // Je Farbe und Grösse ein Pfad aus Nullstrichen mit runden Enden.
  const gruppen = new Map<string, string>()
  for (const [k, z] of zellen) {
    const x = Math.floor(k / 10000) * RASTER
    const y = (k % 10000) * RASTER
    const farbe = Math.min(OG.rampe.length - 1, Math.floor((z.p / z.n) * OG.rampe.length))
    const groesse = z.n >= 6 ? 2 : z.n >= 2 ? 1 : 0
    const key = `${farbe}-${groesse}`
    gruppen.set(key, (gruppen.get(key) ?? '') + `M${x} ${y}h0`)
  }
  const wasser = lies(`public/data/${ordner}/water.geojson`).features
  const strassen = lies(`public/data/${ordner}/streets.geojson`).features
  const breite = [3.4, 5.2, 7]
  let punkte = ''
  for (const [key, d] of gruppen) {
    const [f, s] = key.split('-').map(Number)
    punkte += `<path d="${d}" stroke="${OG.rampe[f]}" stroke-width="${breite[s]}" stroke-linecap="round"/>`
  }
  return (
    `<rect width="${W}" height="${H}" fill="${OG.grund}"/>` +
    `<path d="${pfade(wasser, P, (f) => (f as { properties: { kind: string } }).properties.kind === 'area')}" fill="${OG.wasser}"/>` +
    `<path d="${pfade(wasser, P, (f) => (f as { properties: { kind: string } }).properties.kind === 'line')}" stroke="${OG.wasser}" stroke-width="3" fill="none"/>` +
    `<path d="${pfade(strassen, P)}" stroke="${OG.strasse}" stroke-width="1" fill="none"/>` +
    punkte
  )
}

stadt('zuerich', 'karte-zuerich.svg', [8.528, 47.378], 19)
stadt('bern', 'karte-bern.svg', [7.44, 46.948], 15)
stadt('basel', 'karte-basel.svg', [7.598, 47.557], 13)

// ------------------------------------------------------------ Velonavi

let velonaviInhalt: (cx: number, cy: number, breite: number, hoehe: number) => string

{
  const meta = lies('public/data/zuerich/velo.json') as VeloMeta
  const bin = readFileSync(wurzel + 'public/data/zuerich/velo.graph')
  const g = ladeGraph(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength))
  // Von Wiedikon an den See, mitten durch die Stadt.
  const von: Pos = [8.5176, 47.3712]
  const nach: Pos = [8.5487, 47.3620]
  const profil = reinZeitlich({ ...VOREINSTELLUNGEN.schnell, schieben: true }, true)
  const r = route(g, profil, einrastenAlle(g, ...von, true), einrastenAlle(g, ...nach, true), kantenKosten(g, profil))
  if (!r) throw new Error('keine Route')
  console.log(`Velonavi: ${Math.round(r.distanz)} m, ${Math.round(r.zeit / 60)} min, ${r.strassen.map((s) => s.name).join(' > ')}`)

  const strassen = lies('public/data/zuerich/streets.geojson').features
  const wasser = lies('public/data/zuerich/water.geojson').features
  const gruen = lies('public/data/zuerich/gruen.geojson').features
  const vorzug = lies('public/data/zuerich/velo-vorzug.geojson').features
  const art = (k: string) => (f: unknown) => (f as { properties: { k?: string; kind?: string } }).properties.k === k || (f as { properties: { kind?: string } }).properties.kind === k

  /** Die Route, eingepasst in einen Kasten mit Mitte (cx, cy). */
  velonaviInhalt = (cx: number, cy: number, breite: number, hoehe: number) => {
    const xs = r.koordinaten.map((c) => c[0])
    const ys = r.koordinaten.map((c) => c[1])
    const mitte: Pos = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    const breiteM = (Math.max(...xs) - Math.min(...xs)) * 111320 * Math.cos((mitte[1] * Math.PI) / 180)
    const hoeheM = (Math.max(...ys) - Math.min(...ys)) * 111133
    const mpp = Math.max(breiteM / breite, hoeheM / hoehe)
    const P = projektion(mitte[0], mitte[1], mpp, cx, cy)

    // Route in Stücke gleicher Stufe.
    let stuecke = ''
    let lauf: Pos[] = []
    let stufe = r.stufen[1] ?? r.stufen[0]
    const zeichne = () => {
      if (lauf.length < 2) return
      const d = linie(lauf.map(P), 0.8)
      stuecke += `<path d="${d}" stroke="${OG.stufen[stufe]}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
    }
    r.koordinaten.forEach((c, i) => {
      const s = r.stufen[i]
      if (i > 0 && s !== stufe) {
        lauf.push(c)
        zeichne()
        lauf = [c]
      } else lauf.push(c)
      stufe = s
    })
    zeichne()
    const ganz = linie(r.koordinaten.map(P), 0.8)
    const [sx, sy] = P(r.koordinaten[0])
    const [zx, zy] = P(r.koordinaten[r.koordinaten.length - 1])

    return (
      `<rect width="${W}" height="${H}" fill="${OG.nacht}"/>` +
      `<path d="${pfade(gruen, P)}" fill="${OG.nachtGruen}"/>` +
      `<path d="${pfade(wasser, P, art('area'))}" fill="${OG.nachtWasser}"/>` +
      `<path d="${pfade(wasser, P, art('line'))}" stroke="${OG.nachtWasser}" stroke-width="5" fill="none"/>` +
      `<path d="${pfade(strassen, P, art('neben'))}" stroke="${OG.nachtStrasse}" stroke-width="1.4" fill="none" stroke-linecap="round"/>` +
      `<path d="${pfade(strassen, P, art('haupt'))}" stroke="${OG.nachtHaupt}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` +
      `<path d="${pfade(vorzug, P)}" stroke="${OG.vorzug}" stroke-width="2.2" stroke-dasharray="1 5" stroke-linecap="round" fill="none"/>` +
      // Leuchten unter der Route, dann ein dunkler Rand, dann die Farben.
      `<path d="${ganz}" stroke="${OG.stufen[1]}" stroke-opacity="0.22" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
      `<path d="${ganz}" stroke="${OG.nacht}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
      stuecke +
      `<circle cx="${r1(sx)}" cy="${r1(sy)}" r="11" fill="${OG.nacht}" stroke="#ffffff" stroke-width="5"/>` +
      `<circle cx="${r1(zx)}" cy="${r1(zy)}" r="22" fill="${OG.ziel}" fill-opacity="0.3"/>` +
      `<circle cx="${r1(zx)}" cy="${r1(zy)}" r="12" fill="${OG.ziel}" stroke="#ffffff" stroke-width="4"/>`
    )
  }

  // Die Route bleibt rechts, der Text links liegt über leerer Karte.
  const inhalt = velonaviInhalt(950, 315, 430, 460)
  writeFileSync(wurzel + 'app/og/karte-velonavi.svg', svg(inhalt))
  console.log(`karte-velonavi.svg: ${(svg(inhalt).length / 1024).toFixed(0)} kB`)
}

// ------------------------------------------------------------ Beides

/**
 * Startseite: links die Erreichbarkeit, rechts der Velonavi, je eine Hälfte.
 * Beide Karten liegen in den oberen zwei Dritteln, darunter stehen die Titel
 * über einem Verlauf.
 */
{
  const halb = W / 2
  const links = stadtInhalt('zuerich', projektion(8.528, 47.378, 30, halb / 2, 228))
  const rechts = velonaviInhalt(halb + halb / 2, 222, 470, 290)
  const inhalt =
    `<defs><clipPath id="l"><rect width="${halb}" height="${H}"/></clipPath>` +
    `<clipPath id="r"><rect x="${halb}" width="${halb}" height="${H}"/></clipPath></defs>` +
    `<g clip-path="url(#l)">${links}</g>` +
    `<g clip-path="url(#r)">${rechts}</g>` +
    `<rect x="${halb - 1}" width="2" height="${H}" fill="rgba(255,255,255,0.22)"/>`
  writeFileSync(wurzel + 'app/og/karte-beides.svg', svg(inhalt))
  console.log(`karte-beides.svg: ${(svg(inhalt).length / 1024).toFixed(0)} kB`)
}
