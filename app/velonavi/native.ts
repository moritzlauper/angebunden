/**
 * Die Brücke zur Android-App. Im Browser gibt es sie nicht, dort liefert
 * `tracker()` null und alles läuft über den Standortdienst der Seite.
 *
 * Die App ist ein Capacitor-Rahmen um dieselbe Seite (`android/`). Sie bringt
 * ein eigenes Plugin mit, das im Hintergrund aufzeichnet: Ein Dienst im
 * Vordergrund mit sichtbarer Benachrichtigung sammelt die Standortpunkte, und
 * wenn die Erkennung von Android eine Velofahrt meldet, startet er von selbst.
 * Die fertigen Fahrten holt die Seite ab, sobald sie offen ist.
 *
 * `window.Capacitor` legt die App beim Laden der Seite an. Das JavaScript-Paket
 * von Capacitor braucht die Seite deshalb nicht.
 */

import type { Spurpunkt } from './fahrten.ts'

export type NativeFahrt = {
  id: string
  /** Beginn in Millisekunden seit 1970. */
  beginn: number
  spur: Spurpunkt[]
  quelle: 'aufzeichnung' | 'auto'
  /** Was `start` mitgegeben wurde, als JSON. */
  vorschlag?: string
}

export type NativStatus = {
  laeuft: boolean
  /** Ob die automatische Erkennung eingeschaltet ist. */
  auto: boolean
  beginn: number
  distanz: number
  lon: number | null
  lat: number | null
  /** Was der Nutzer noch freigeben muss: `standort`, `hintergrund`, `bewegung`, `mitteilung`. */
  fehlt: string[]
}

export type Tracker = {
  status(): Promise<NativStatus>
  /** Fragt die Freigaben an. `auto` verlangt zusätzlich Standort im Hintergrund und Bewegungserkennung. */
  berechtigen(o: { auto: boolean }): Promise<{ fehlt: string[] }>
  start(o: { vorschlag?: string }): Promise<void>
  stop(): Promise<void>
  auto(o: { aktiv: boolean }): Promise<NativStatus>
  abholen(): Promise<{ fahrten: NativeFahrt[] }>
  quittieren(o: { ids: string[] }): Promise<void>
}

type CapacitorAussen = { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> }

export function tracker(): Tracker | null {
  if (typeof window === 'undefined') return null
  const c = (window as unknown as { Capacitor?: CapacitorAussen }).Capacitor
  if (!c?.isNativePlatform?.()) return null
  return (c.Plugins?.Velotracker as Tracker | undefined) ?? null
}
