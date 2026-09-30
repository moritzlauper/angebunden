/**
 * Was von einer Fahrt ins Konto geht, wenn man angemeldet ist und die Sicherung an ist.
 *
 * Auf dem Gerät liegt die Fahrt vollständig. Ins Konto geht eine Fassung, die
 * sich nicht mehr auf eine Wohnung oder einen Arbeitsplatz zurückführen lässt:
 *
 * - Die ersten und letzten 150 Meter der Spur fehlen (Schutzzone).
 * - Start und Ziel tragen nur die Gegend (auf etwa 100 Meter gerundet) und
 *   keinen Namen. Den Namen setzt das Gerät beim Zurückholen selbst ein.
 * - Der Beginn ist auf die volle Stunde gerundet.
 *
 * Für das Lernen reicht das: Die Fahrzeit je Abschnitt und die Wartezeit an
 * Ampeln ändern sich durch 150 Meter weniger an den Enden kaum.
 *
 * Keine Laufzeit-Importe ausser den Typen und `spurDistanz`.
 */

import { spurDistanz, type Fahrt, type Ort, type Spurpunkt, type Vorschlag } from './fahrten.ts'

export const SCHUTZZONE = 150

/** Die Zeile in der Tabelle `velonavi_fahrten`. */
export type Zeile = {
  id: string
  begonnen: string
  dauer_s: number
  distanz_m: number
  start: Ort
  ziel: Ort
  spur: Spurpunkt[]
  vorschlag: Vorschlag | null
  quelle: Fahrt['quelle']
}

const MY = 111133
const mx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)
const luftlinie = (a: Spurpunkt, b: Spurpunkt) => Math.hypot((b[0] - a[0]) * mx(a[1]), (b[1] - a[1]) * MY)

/** Streicht die Punkte innerhalb von `zone` Metern (Luftlinie) um Anfang und Ende. */
export function kuerzen(spur: Spurpunkt[], zone: number): Spurpunkt[] {
  if (!spur.length) return []
  const anfang = spur[0]
  const ende = spur[spur.length - 1]
  const von = spur.findIndex((p) => luftlinie(anfang, p) >= zone)
  let bis = -1
  for (let i = spur.length - 1; i >= 0; i--)
    if (luftlinie(ende, spur[i]) >= zone) {
      bis = i
      break
    }
  return von < 0 || bis < von ? [] : spur.slice(von, bis + 1)
}

const grob = (x: number) => Math.round(x * 1000) / 1000

/** Die Fassung für das Konto, oder null, wenn nach dem Kürzen nichts Brauchbares bleibt. */
export function fuerKonto(f: Fahrt): Zeile | null {
  const gekuerzt = kuerzen(f.spur, SCHUTZZONE)
  if (gekuerzt.length < 10) return null
  const beginn = Date.parse(f.begonnen)
  const stunde = Math.floor(beginn / 3_600_000) * 3_600_000
  // Die Zeiten der Spur zählen ab `begonnen`. Wird der Beginn abgerundet, rücken sie mit.
  const versatz = (beginn - stunde) / 1000
  const spur = gekuerzt.map(
    ([lon, lat, t]): Spurpunkt => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5, Math.round((t + versatz) * 10) / 10]
  )
  return {
    id: f.id,
    begonnen: new Date(stunde).toISOString(),
    dauer_s: spur[spur.length - 1][2] - spur[0][2],
    distanz_m: spurDistanz(spur),
    start: { lon: grob(f.start.lon), lat: grob(f.start.lat), titel: '' },
    ziel: { lon: grob(f.ziel.lon), lat: grob(f.ziel.lat), titel: '' },
    spur,
    vorschlag: f.vorschlag,
    quelle: f.quelle,
  }
}

/** Eine Fahrt aus dem Konto, die Namen von Start und Ziel setzt das Gerät ein. */
export function ausKonto(z: Zeile, benenne: (lon: number, lat: number) => Ort): Fahrt {
  return {
    id: z.id,
    begonnen: z.begonnen,
    dauer: z.dauer_s,
    distanz: z.distanz_m,
    start: benenne(z.spur[0][0], z.spur[0][1]),
    ziel: benenne(z.spur[z.spur.length - 1][0], z.spur[z.spur.length - 1][1]),
    spur: z.spur,
    vorschlag: z.vorschlag,
    quelle: z.quelle,
  }
}
