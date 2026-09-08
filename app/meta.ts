import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { StadtSchluessel } from './staedte'

export type Extrem = {
  rang: number
  minuten: number
  orte: number
  lon: number
  lat: number
  adresse: string | null
  name: string | null
}

export type Meta = {
  serviceDate: string
  window: string
  departures: number
  buildings: number
  cells: number
  addresses: number
  stations: number
  originStations: number
  trips: number
  minutes: {
    best: number
    p05: number
    p25: number
    median: number
    p75: number
    p95: number
    worst: number
  }
  extreme: { bestes: Extrem; schlechtestes: Extrem }
  kultur: {
    orte: number
    /** Zeitbudget je Wegart in Minuten, in dem Orte gezählt werden. */
    budgets: { velo: number; fuss: number }
    arten: string[]
    proArt: number[]
    verteilung: { min: number; p25: number; median: number; p75: number; max: number }
    extreme: { bestes: Extrem; schlechtestes: Extrem }
  }
  builtAt: string
}

/** Liest die vorgerechneten Kennzahlen einer Stadt aus `public/data/<stadt>/`. */
export async function ladeMeta(stadt: StadtSchluessel): Promise<Meta> {
  return JSON.parse(
    await readFile(path.join(process.cwd(), 'public', 'data', stadt, 'meta.json'), 'utf8')
  )
}
