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
