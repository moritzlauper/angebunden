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
import type { Hinweis } from './modus.ts'

export type NativeFahrt = {
  id: string
  /** Beginn in Millisekunden seit 1970. */
  beginn: number
  spur: Spurpunkt[]
  quelle: 'aufzeichnung' | 'auto'
  /** Was `start` mitgegeben wurde, als JSON. */
  vorschlag?: string
  /** Womit die automatische Erkennung die Fahrt begann, nach Android. Fehlt bei einem Start per Knopf. */
  hinweis?: Hinweis
}

export type NativStatus = {
  laeuft: boolean
  /** Ob die automatische Erkennung eingeschaltet ist. */
  auto: boolean
  /** Ob sie auch Gehen, Joggen und Fahrzeuge aufzeichnet, nicht nur Velofahrten. */
  alle: boolean
  beginn: number
  distanz: number
  /** Seit wann die Bewegungserkennung von Android angemeldet ist, Millisekunden seit 1970, sonst 0. */
  bereitSeit: number
  /** Warum sie es nicht ist. */
  bereitFehler: string
  /** Die letzte Meldung von Android, auch wenn daraus keine Aufzeichnung wurde: velo, gehen, laufen oder fahrzeug. */
  letzteArt: Hinweis | ''
  letzteBeginn: boolean
  letzteZeit: number
  /** Womit die laufende Aufzeichnung begann. */
  hinweis: Hinweis | ''
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
  auto(o: { aktiv: boolean; alle?: boolean }): Promise<NativStatus>
  abholen(): Promise<{ fahrten: NativeFahrt[] }>
  quittieren(o: { ids: string[] }): Promise<void>
  /** Vibriert nach einem Muster wie `navigator.vibrate`, als Alarm. Älteren Fassungen der App fehlt die Funktion. */
  vibrieren?(o: { muster: number[] }): Promise<{ ok: boolean; fehler?: string }>
  /** Was zuletzt schiefging (Absturz, abgelehnter Dienst), einmal, danach leer. Älteren Fassungen der App fehlt die Funktion. */
  panne?(): Promise<{ text: string; zeit: number }>
  /** Öffnet das Teilen-Menü von Android mit einer GPX-Datei. Älteren Fassungen der App fehlt die Funktion. */
  gpxTeilen?(o: { name: string; inhalt: string }): Promise<void>
}

type CapacitorAussen = { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> }

export function tracker(): Tracker | null {
  if (typeof window === 'undefined') return null
  const c = (window as unknown as { Capacitor?: CapacitorAussen }).Capacitor
  if (!c?.isNativePlatform?.()) return null
  return (c.Plugins?.Velotracker as Tracker | undefined) ?? null
}
