/**
 * Geführtes Fahren: Abbiegehinweise aus einer Route und das Verfolgen der eigenen Position auf ihr.
 *
 * Das Handy sagt per Vibration, wo man abbiegen soll, damit man nicht aufs Display schauen muss:
 * einmal lang für rechts, zweimal kurz für links, dreimal kurz für wenden, ein langes Signal am Ziel.
 *
 * Keine Laufzeit-Importe ausser `drehung` (Winkel zwischen zwei Peilungen) und den Typen, damit sich
 * die Rechnung in Node prüfen lässt.
 */

import { drehung, type Graph, type Route } from './router.ts'

export type Richtung = 'links' | 'rechts' | 'wende'

export type Anweisung = {
  /** Meter ab Start der Route bis zur Kreuzung. */
  s: number
  richtung: Richtung
  /** Die Strasse, in die man einbiegt. */
  strasse: string
  lon: number
  lat: number
  /** Winkel in Grad, positiv heisst rechts. */
  winkel: number
}

/** Vibrationsmuster in Millisekunden: Vibration, Pause, Vibration, … */
export const MUSTER: Record<Richtung | 'ziel' | 'abseits', number[]> = {
  rechts: [450],
  links: [200, 150, 200],
  wende: [160, 110, 160, 110, 160],
  ziel: [900],
  abseits: [90, 70, 90, 70, 90, 70, 90],
}

/** Ab diesem Winkel ist es ein Abbiegen. */
const ABBIEGEN = 35
const WENDE = 155
/** Mehrere Knoten einer grossen Kreuzung zählen als ein Abbiegen, wenn sie so nah beieinander liegen. */
const VERSCHMELZEN_M = 25

const normal = (w: number) => {
  while (w > 180) w -= 360
  while (w <= -180) w += 360
  return w
}

/**
 * Die Stellen, an denen die Route abbiegt. Eine Kurve entlang derselben Strasse ohne Kreuzung ist
 * keine Anweisung wert, eine Kreuzung ab 35 Grad schon.
 */
export function anweisungen(g: Graph, r: Route): Anweisung[] {
  const roh: Anweisung[] = []
  let s = 0
  const st = r.stuecke
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i].a
    const b = st[i + 1].a
    s += g.laenge[a >> 1] * (st[i].bis - st[i].von)
    // Zwischen zwei Teilrouten (Zwischenziel) gibt es keinen Übergang am Knoten.
    if (g.kopf(a) !== g.fuss(b)) continue
    const v = g.kopf(a)
    const winkel = drehung(g.peilEnde[a], g.peilStart[b])
    if (Math.abs(winkel) < ABBIEGEN) continue
    const kreuzung = g.grad[v + 1] - g.grad[v] >= 3
    // Ohne Kreuzung nur eine scharfe Kehre, sonst ist es eine Kurve der Strasse.
    if (!kreuzung && Math.abs(winkel) < 100) continue
    roh.push({
      s,
      richtung: Math.abs(winkel) >= WENDE ? 'wende' : winkel > 0 ? 'rechts' : 'links',
      strasse: g.meta.namen[g.kanteName[b >> 1]] || '',
      lon: g.knotenKoord[2 * v] / 1e6,
      lat: g.knotenKoord[2 * v + 1] / 1e6,
      winkel,
    })
  }
  // Verschmelzen: Die Knoten einer breiten Kreuzung ergeben zusammen eine Drehung.
  const out: Anweisung[] = []
  for (const x of roh) {
    const l = out[out.length - 1]
    if (l && x.s - l.s < VERSCHMELZEN_M) {
      const summe = normal(l.winkel + x.winkel)
      out.pop()
      if (Math.abs(summe) >= ABBIEGEN)
        out.push({ ...x, winkel: summe, richtung: Math.abs(summe) >= WENDE ? 'wende' : summe > 0 ? 'rechts' : 'links' })
      continue
    }
    out.push(x)
  }
  return out
}

// ------------------------------------------------------------ Position auf der Route

const MY = 111133
const mx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)

export type Linie = { koord: [number, number][]; kum: number[] }

/** Die Route als Linienzug mit Meter ab Start an jedem Punkt. */
export function linieVon(r: Route): Linie {
  return { koord: r.koordinaten, kum: r.profil.map((p) => p[0]) }
}

/**
 * Wo auf der Route man gerade ist: der nächste Punkt auf dem Linienzug, gesucht nur ein Stück vor und
 * hinter dem bisherigen Fortschritt. Das hält die Position auf der richtigen Durchfahrt, wenn die
 * Route sich selbst kreuzt, und hindert sie daran, bei einer Schleife zurückzuspringen.
 */
export function fortschritt(l: Linie, pos: [number, number], vorher: number, vor = 300, zurueck = 40) {
  let beste = Infinity
  let besteS = vorher
  for (let i = 0; i + 1 < l.koord.length; i++) {
    if (l.kum[i + 1] < vorher - zurueck) continue
    if (l.kum[i] > vorher + vor) break
    const m = mx(pos[1])
    const ax = (l.koord[i][0] - pos[0]) * m
    const ay = (l.koord[i][1] - pos[1]) * MY
    const bx = (l.koord[i + 1][0] - pos[0]) * m
    const by = (l.koord[i + 1][1] - pos[1]) * MY
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    const u = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0
    const d = Math.hypot(ax + u * dx, ay + u * dy)
    if (d < beste) {
      beste = d
      besteS = l.kum[i] + u * (l.kum[i + 1] - l.kum[i])
    }
  }
  return { s: besteS, abstand: beste }
}

/** Wie früh vor der Kreuzung der Hinweis kommt: sechs Sekunden Fahrt, mindestens 25, höchstens 90 Meter. */
export const vorlauf = (tempo: number) => Math.max(25, Math.min(90, tempo * 6))

export const richtungText = (x: Richtung) => (x === 'links' ? 'Links abbiegen' : x === 'rechts' ? 'Rechts abbiegen' : 'Wenden')
