/**
 * Erkennt aus einer Spur, womit jemand unterwegs war: zu Fuss, joggend, mit
 * dem Velo, im Tram oder Bus, im Auto.
 *
 * Die Bewegungserkennung von Android liefert einen Hinweis, aber keinen
 * verlässlichen: Ein E-Bike hält sie gern für ein Auto, ein Tram auch. Deshalb
 * rechnet die Seite selbst, aus dem Tempo und aus den Halten. Ein Tram hält
 * an Haltestellen, ein Auto an Ampeln und Kreuzungen, und das lässt sich
 * unterscheiden, weil die Haltestellen der Stadt bekannt sind.
 *
 * Gelernt wird nur aus Velofahrten. Alles andere bleibt auf dem Gerät und
 * trägt nichts zum Lernen bei; so verfälscht ein Tramweg nicht das Tempo.
 *
 * Keine Laufzeit-Importe ausser dem Typ, damit sich die Rechnung in Node
 * prüfen lässt.
 */

import type { Spurpunkt } from './fahrten.ts'

export type Modus = 'velo' | 'laufen' | 'gehen' | 'oev' | 'auto'

export const MODI: { id: Modus; name: string }[] = [
  { id: 'velo', name: 'Velo' },
  { id: 'laufen', name: 'Joggen' },
  { id: 'gehen', name: 'Gehen' },
  { id: 'oev', name: 'Tram oder Bus' },
  { id: 'auto', name: 'Auto' },
]

export const modusName = (m: Modus | undefined) => MODI.find((x) => x.id === (m ?? 'velo'))!.name

/** Was Android meldet, als Hinweis für die Auswahl. */
export type Hinweis = 'velo' | 'gehen' | 'laufen' | 'fahrzeug'

const MY = 111133
const mx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)
const meter = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * mx(a[1]), (b[1] - a[1]) * MY)

/**
 * Ein Halt: so viele Sekunden unter dieser Geschwindigkeit. Im Stand springt der
 * Empfänger um einige Meter, über ein Fenster von acht Sekunden gerechnet ergibt
 * das gut 0.5 m/s.
 */
const HALT_V = 1.1
const HALT_MIN_S = 8
/** Ein Halt gilt als Haltestelle, wenn eine so nah liegt. */
const HALTESTELLE_M = 45
/** Die ersten und letzten Sekunden zählen bei den Halten nicht: Dort startet und endet man. */
const RAND_S = 45

export type Merkmale = {
  /** Mittleres Tempo in Bewegung, in m/s. */
  mittel: number
  /** Das Tempo, das 90% der Zeit nicht überschritten wird. */
  p90: number
  halte: number
  /** Anteil der Halte an einer Haltestelle, null wenn keine bekannt sind oder es keine Halte gab. */
  anHaltestelle: number | null
}

/** Tempo in m/s über ein Fenster von acht Sekunden, Punkt für Punkt. */
function tempos(spur: Spurpunkt[]) {
  const v: { t: number; v: number }[] = []
  let j = 0
  for (let i = 0; i < spur.length; i++) {
    const t = spur[i][2]
    while (j < spur.length - 1 && spur[j + 1][2] < t - 4) j++
    let k = i
    while (k < spur.length - 1 && spur[k][2] < t + 4) k++
    const dt = spur[k][2] - spur[j][2]
    if (dt < 4) continue
    v.push({ t, v: meter([spur[j][0], spur[j][1]], [spur[k][0], spur[k][1]]) / dt })
  }
  return v
}

export function merkmale(spur: Spurpunkt[], haltestellen: [number, number][] | null): Merkmale | null {
  if (spur.length < 10) return null
  const v = tempos(spur)
  const bewegt = v.filter((x) => x.v > HALT_V).map((x) => x.v).sort((a, b) => a - b)
  if (bewegt.length < 10) return null
  const mittel = bewegt.reduce((a, b) => a + b, 0) / bewegt.length
  const p90 = bewegt[Math.floor(bewegt.length * 0.9)]

  // Halte: zusammenhängende Stücke langsamer als HALT_V, mindestens HALT_MIN_S lang.
  const ende = spur[spur.length - 1][2]
  const halte: [number, number][] = []
  let von = -1
  for (let i = 0; i <= v.length; i++) {
    const langsam = i < v.length && v[i].v < HALT_V
    if (langsam && von < 0) von = i
    if (!langsam && von >= 0) {
      const dauer = v[i - 1].t - v[von].t
      const mitte = v[(von + i - 1) >> 1]
      const p = spur.find((q) => q[2] >= mitte.t) ?? spur[spur.length - 1]
      if (dauer >= HALT_MIN_S && mitte.t > spur[0][2] + RAND_S && mitte.t < ende - RAND_S) halte.push([p[0], p[1]])
      von = -1
    }
  }
  let anHaltestelle: number | null = null
  if (halte.length && haltestellen?.length) {
    const an = halte.filter((h) => haltestellen.some((s) => meter(h, s) < HALTESTELLE_M)).length
    anHaltestelle = an / halte.length
  }
  return { mittel, p90, halte: halte.length, anHaltestelle }
}

/**
 * Die Art der Fortbewegung. `hinweis` ist die Meldung von Android, falls es
 * eine gab; sie entscheidet nur, wo die Zahlen keine klare Antwort geben.
 */
export function erkenne(spur: Spurpunkt[], haltestellen: [number, number][] | null, hinweis?: Hinweis): Modus {
  const m = merkmale(spur, haltestellen)
  const vorrang: Modus | undefined = hinweis === 'velo' ? 'velo' : hinweis === 'gehen' ? 'gehen' : hinweis === 'laufen' ? 'laufen' : undefined
  if (!m) return vorrang ?? 'velo'

  // Zu Fuss und joggend: langsam und gleichmässig. Gehen und Joggen überlappen bei etwa
  // 2.2 m/s, dort gibt der Hinweis den Ausschlag. Ein sehr gemütliches Velo fährt 3.5 m/s,
  // ein flotter Jogger ab 3.4 m/s gibt es selten.
  if (m.p90 < 2.3) return 'gehen'
  if (m.mittel < 2.2) return hinweis === 'laufen' ? 'laufen' : 'gehen'
  if (m.mittel < 3.4 && m.p90 < 4.6) return hinweis === 'velo' && m.mittel > 3.0 ? 'velo' : 'laufen'

  // Ein Tram hält an Haltestellen, ein Auto nicht. Zwei Halte genügen, damit der Anteil etwas sagt.
  const oev = m.anHaltestelle !== null && m.halte >= 2 && m.anHaltestelle >= 0.6
  // Sehr schnell ist kein Velo: über 41 km/h als Spitze oder im Mittel über 32 km/h.
  const zuSchnell = m.p90 > 11.5 || m.mittel > 9
  if (oev) return 'oev'
  if (zuSchnell) return 'auto'
  // Meldet Android ein Fahrzeug und es spricht nichts für ein Velo, ist es kein Velo: Lieber aus dem Lernen
  // heraushalten als ein Auto unter die Velofahrten mischen. Die Korrektur steht im Menü.
  if (hinweis === 'fahrzeug') return m.mittel >= 6 && m.halte >= 2 && (m.anHaltestelle ?? 0) >= 0.4 ? 'oev' : 'auto'
  return 'velo'
}
