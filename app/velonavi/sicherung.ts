/**
 * Was von einer Fahrt ins Konto geht, wenn man angemeldet ist und die Sicherung an ist: die ganze
 * Fahrt, wie sie auf dem Gerät liegt, mit der vollständigen Spur, Start und Ziel samt Namen und dem
 * genauen Beginn. So ist sie auf einem neuen Gerät wieder genau dieselbe.
 *
 * Früher fehlten die ersten und letzten 150 Meter, Start und Ziel waren auf etwa 100 Meter gerundet
 * und der Beginn auf die Stunde. Solche Zeilen liegen noch im Konto; ohne Namen setzt das Gerät
 * beim Zurückholen die nächste Adresse ein. Gekürzt bleibt nur, was anonym an alle geht
 * (`gemeinschaft.ts`).
 *
 * Keine Laufzeit-Importe ausser den Typen.
 */

import type { Fahrt, Ort, Spurpunkt, Vorschlag } from './fahrten.ts'

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

/** Die Fassung für das Konto, oder null ohne brauchbare Spur. */
export function fuerKonto(f: Fahrt): Zeile | null {
  if (f.spur.length < 2) return null
  return {
    id: f.id,
    begonnen: f.begonnen,
    dauer_s: f.dauer,
    distanz_m: f.distanz,
    start: f.start,
    ziel: f.ziel,
    spur: f.spur,
    vorschlag: f.vorschlag,
    quelle: f.quelle,
  }
}

/** Eine Fahrt aus dem Konto. Fehlt ein Name (ältere, gekürzte Zeilen), setzt das Gerät die nächste Adresse ein. */
export function ausKonto(z: Zeile, benenne: (lon: number, lat: number) => Ort): Fahrt {
  const erster = z.spur[0]
  const letzter = z.spur[z.spur.length - 1]
  return {
    id: z.id,
    begonnen: z.begonnen,
    dauer: z.dauer_s,
    distanz: z.distanz_m,
    start: z.start?.titel ? z.start : benenne(erster[0], erster[1]),
    ziel: z.ziel?.titel ? z.ziel : benenne(letzter[0], letzter[1]),
    spur: z.spur,
    vorschlag: z.vorschlag,
    quelle: z.quelle,
  }
}
