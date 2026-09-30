import { aktiveStadt } from '../staedte.ts'

/**
 * Lokale, äquidistante Projektion um den Mittelpunkt der aktuellen Stadt.
 * Für Distanzen bis ~50 km genau genug. Ein Pipeline-Lauf betrifft genau eine
 * Stadt, deshalb reicht eine Modulkonstante.
 */
export const { lat0: LAT0, lon0: LON0 } = aktiveStadt().projektion
const M_PER_DEG_LAT = 111132.95
const M_PER_DEG_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180)

export function toXY(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT]
}

export function toLonLat(x: number, y: number): [number, number] {
  return [x / M_PER_DEG_LON + LON0, y / M_PER_DEG_LAT + LAT0]
}

/**
 * Schweizer Landeskoordinaten LV95 nach WGS84, Näherungsformel von swisstopo.
 * Auf rund einen Meter genau, für das Zuordnen von Messstellen mehr als genug.
 */
export function lv95ZuLonLat(e: number, n: number): [number, number] {
  const y = (e - 2_600_000) / 1e6
  const x = (n - 1_200_000) / 1e6
  const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y
  const lat =
    16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x * x * x
  return [(lon * 100) / 36, (lat * 100) / 36]
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return Math.sqrt(dx * dx + dy * dy)
}

/** Punkt-in-Polygon (ray casting) für ein GeoJSON-Ring-Array [outer, ...holes]. */
export function pointInRings(rings: number[][][], lon: number, lat: number): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}
