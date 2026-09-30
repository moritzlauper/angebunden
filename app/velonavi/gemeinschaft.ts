/**
 * Lernen aus den Fahrten anderer, ohne dass eine Fahrt erkennbar wird.
 *
 * Wer mitmacht, schickt keine Fahrt, sondern einzelne Messwerte:
 *
 * - Je Abschnitt des Netzes ein Verhältnis: gemessene Fahrzeit durch die Zeit,
 *   die das Modell beim eigenen Tempo erwartet. 1.2 heisst: 20% langsamer, als
 *   der Abschnitt für diese Person zu erwarten war.
 * - Je Ampel, Anfahrtsrichtung und Manöver die gewartete Zeit in Sekunden,
 *   auch null bei Grün.
 *
 * Jeder Wert steht für sich, ohne Zeitpunkt, ohne Kennung, ohne Reihenfolge
 * und ohne die Zugehörigkeit zu einer Fahrt. Die ersten und letzten 150 Meter
 * einer Fahrt fehlen. Der Server gibt einen Wert erst weiter, wenn mindestens
 * fünf Messungen dazu vorliegen (`supabase/migrations`).
 *
 * Der Schlüssel eines Abschnitts sind die Koordinaten seiner beiden Knoten, auf
 * einen Meter gerundet. Die Nummern der Kanten ändern sich mit jedem Lauf der
 * Pipeline, die Koordinaten der Kreuzungen nicht.
 *
 * Keine Laufzeit-Importe ausser den Typen, damit sich die Rechnung in Node
 * prüfen lässt.
 */

import type { Zuordnung } from './fahrten.ts'
import type { Graph } from './router.ts'

/** Was der Server zurückgibt: je Schlüssel [Wert, Anzahl der Messungen]. */
export type Gemeinschaft = {
  /** Verhältnis der Fahrzeit zur erwarteten, im Median. */
  kanten: Record<string, [number, number]>
  /** Mittlere Wartezeit in Sekunden je Durchfahrt. */
  ampeln: Record<string, [number, number]>
}

export type Beitrag = {
  kanten: { k: string; v: number }[]
  ampeln: { k: string; w: number }[]
}

/** So viel vom Anfang und Ende einer Fahrt bleibt zu Hause. */
export const SCHUTZ = 150
/** Kürzere Abschnitte lassen sich nicht auf die Sekunde messen. */
const MIN_FAHRZEIT = 4
const V_MIN = 0.3
const V_MAX = 4

const rund = (x: number) => Math.round(x / 10)

export function kantenSchluessel(g: Graph, a: number) {
  const von = g.fuss(a)
  const nach = g.kopf(a)
  return `${rund(g.knotenKoord[2 * von])}_${rund(g.knotenKoord[2 * von + 1])}>${rund(g.knotenKoord[2 * nach])}_${rund(g.knotenKoord[2 * nach + 1])}`
}

const ampelPunkt = (g: Graph, J: number) => `${Math.round(g.meta.ampeln[J][0] * 1e5)}_${Math.round(g.meta.ampeln[J][1] * 1e5)}`

/** Der Schlüssel aus `ampelSchluessel` (Router): (Kreuzung · 8 + Achtel) · 4 + Manöver. */
export function ampelSchluesselText(g: Graph, sk: number) {
  return `${ampelPunkt(g, sk >> 5)}_${(sk >> 2) & 7}_${sk & 3}`
}

const kantenIndexJe = new WeakMap<Graph, Map<string, number>>()
/** Schlüssel → gerichtete Kante, einmal je Graph. */
export function kantenIndex(g: Graph) {
  let m = kantenIndexJe.get(g)
  if (m) return m
  m = new Map()
  for (let a = 0; a < 2 * g.E; a++) m.set(kantenSchluessel(g, a), a)
  kantenIndexJe.set(g, m)
  return m
}

const ampelIndexJe = new WeakMap<Graph, Map<string, number>>()
/** Schlüssel einer Ampel in der Form des Routers, sonst undefined. */
export function ampelNummer(g: Graph, text: string) {
  let m = ampelIndexJe.get(g)
  if (!m) {
    m = new Map()
    for (let J = 0; J < g.meta.ampeln.length; J++) m.set(ampelPunkt(g, J), J)
    ampelIndexJe.set(g, m)
  }
  const teile = text.split('_')
  if (teile.length !== 4) return undefined
  const J = m.get(`${teile[0]}_${teile[1]}`)
  return J === undefined ? undefined : (J * 8 + Number(teile[2])) * 4 + Number(teile[3])
}

/** Mischt in Place, damit die Reihenfolge nichts über den Weg verrät. */
function mischen<T>(liste: T[]) {
  for (let i = liste.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[liste[i], liste[j]] = [liste[j], liste[i]]
  }
  return liste
}

/**
 * Die Messwerte einer Fahrt für die Gemeinschaft. `tempo` ist das eigene Tempo
 * im Verhältnis zum Modell (`Lernstand.tempo`).
 */
export function beitrag(g: Graph, z: Zuordnung, tempo: number): Beitrag {
  const innen = (s0: number, s1: number) => s0 >= SCHUTZ && s1 <= z.distanz - SCHUTZ
  const kanten: Beitrag['kanten'] = []
  for (const k of z.kanten) {
    if (!innen(k.s0, k.s1) || k.fahr < MIN_FAHRZEIT) continue
    const v = k.fahr / (k.modell * tempo)
    if (v < V_MIN || v > V_MAX || !Number.isFinite(v)) continue
    kanten.push({ k: kantenSchluessel(g, k.a), v: Math.round(v * 100) / 100 })
  }
  const ampeln: Beitrag['ampeln'] = []
  for (const a of z.ampeln) {
    if (!innen(a.s, a.s) || a.schluessel < 0) continue
    ampeln.push({ k: ampelSchluesselText(g, a.schluessel), w: Math.round(a.gewartet) })
  }
  return { kanten: mischen(kanten), ampeln: mischen(ampeln) }
}
