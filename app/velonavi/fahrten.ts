/**
 * Aufgezeichnete Fahrten: der Spur die befahrenen Kanten zuordnen, messen, wie
 * lange jede gedauert hat, und daraus lernen.
 *
 * Gespeichert wird nur die rohe Spur. Die Zuordnung zum Netz und alles
 * Gelernte entstehen bei jedem Laden neu im Browser. Das kostet etwas
 * Rechenzeit, dafür überlebt das Gelernte jede neue Fassung des Velonetzes:
 * Die Nummern der Kanten ändern sich mit jedem Lauf der Pipeline, die Spur
 * nicht.
 *
 * Ausser dem Router gibt es keine Laufzeit-Importe, damit sich die Rechnung
 * wie dieser in Node prüfen lässt.
 */

import {
  ausschnitt, einrastenAlle, kantenKosten, leererUebergang, reinZeitlich, schiebenErlaubt, sucheStuecke, uebergang,
  veloErlaubt, zeitVon,
  type Einrastung, type Gelernt, type Graph, type Profil, type Route, type Stueck,
} from './router.ts'
import { ampelNummer, kantenIndex, type Gemeinschaft } from './gemeinschaft.ts'
import type { Modus } from './modus.ts'

/** Ein Punkt der Spur: Länge, Breite, Sekunden seit dem Start, Genauigkeit in Metern. */
export type Spurpunkt = [lon: number, lat: number, t: number, genau?: number]

export type Ort = { lon: number; lat: number; titel: string }

/** Was der Velonavi beim Losfahren vorschlug, in Sekunden und Metern. */
export type Vorschlag = {
  wahl: string
  schnell?: { zeit: number; distanz: number }
  komfort?: { zeit: number; distanz: number }
}

export type Fahrt = {
  id: string
  /** Zeitpunkt des ersten Punkts, ISO 8601. */
  begonnen: string
  dauer: number
  distanz: number
  start: Ort
  ziel: Ort
  spur: Spurpunkt[]
  vorschlag: Vorschlag | null
  /** `auto`: von der Android-App von selbst erkannt und aufgezeichnet. */
  quelle: 'aufzeichnung' | 'gpx' | 'auto'
  /** Womit man unterwegs war. Fehlt es, war es ein Velo. Gelernt wird nur aus Velofahrten. */
  modus?: Modus
}

// ------------------------------------------------------------ Spur aufbereiten

/** Mittelmeridian der lokalen Meter, wie in `router.ts`. */
const LON0 = 8.54
const MY = 111133
const mx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)

/** Ungenauere Punkte (Häuserschlucht, Unterführung) helfen der Zuordnung nicht. */
const GENAU_MAX = 40
/** Mehr Punkte speichert eine Fahrt nicht, das sind gut fünf Stunden. */
const PUNKTE_MAX = 20000

/**
 * Die Spur zum Speichern ausdünnen: höchstens ein Punkt je Sekunde, im Stand
 * einer alle fünf. Die Standzeit bleibt so messbar, ohne dass eine Minute an
 * der Ampel sechzig fast gleiche Punkte ablegt.
 */
export function verdichten(spur: Spurpunkt[]): Spurpunkt[] {
  const out: Spurpunkt[] = []
  for (const [lon, lat, t, genau] of spur) {
    const l = out[out.length - 1]
    if (l) {
      const dt = t - l[2]
      if (dt < 1) continue
      const d = Math.hypot((lon - l[0]) * mx(lat), (lat - l[1]) * MY)
      if (d < 2 && dt < 5) continue
    }
    const p: Spurpunkt = [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6, Math.round(t * 10) / 10]
    if (genau !== undefined) p.push(Math.round(genau))
    out.push(p)
    if (out.length >= PUNKTE_MAX) break
  }
  return out
}

/** So lange ist das Fenster, in dem `kern` misst, wie weit man vom Fleck kommt. */
const KERN_FENSTER = 30
/** Ab so viel Luftlinie je Sekunde über das Fenster gilt es als Velofahren: 8 km/h. Gehen bleibt darunter. */
const KERN_TEMPO = 2.2

/**
 * Der Teil der Spur, auf dem man Velo fuhr: Vorne und hinten fällt weg, was nicht vom Fleck kommt.
 * Am Ziel lief eine automatische Aufzeichnung neun Minuten weiter, weil der Standort im Haus um
 * 30 bis 60 Meter hin und her sprang. Das ergab Kritzeleien über die Häuser, «Pausen», die keine
 * waren, und einen Vergleich mit einer Strecke, die niemand gefahren ist. Ebenso fällt das Stück zu
 * Fuss zum Velo und vom Velo weg.
 *
 * Gemessen wird die Luftlinie über 30 Sekunden, nicht der zurückgelegte Weg: Zittern legt viel Weg
 * zurück, kommt aber nicht vom Fleck. Halte mitten in der Fahrt bleiben, nur die Ränder werden
 * gekürzt. Kommt die Spur nie auf Velotempo, bleibt sie, wie sie ist.
 */
export function kern(spur: Spurpunkt[]): Spurpunkt[] {
  const n = spur.length
  if (n < 3) return spur
  // Geglättet über je fünf Punkte davor und danach: Ein einzelner Sprung verschiebt das Mittel kaum.
  const glatt = spur.map((_, i) => {
    let x = 0
    let y = 0
    let k = 0
    for (let d = Math.max(0, i - 5); d <= Math.min(n - 1, i + 5); d++) (x += spur[d][0]), (y += spur[d][1]), k++
    return [x / k, y / k]
  })
  const luft = (a: number, b: number) => Math.hypot((glatt[b][0] - glatt[a][0]) * mx(glatt[a][1]), (glatt[b][1] - glatt[a][1]) * MY)
  let anfang = -1
  let ende = -1
  let j = 0
  for (let i = 0; i < n; i++) {
    if (j < i) j = i
    while (j < n && spur[j][2] - spur[i][2] < KERN_FENSTER) j++
    if (j >= n) break
    const d = luft(i, j)
    // Weniger weit, als die beiden Punkte ungenau sind, ist kein Vorankommen.
    if (d / (spur[j][2] - spur[i][2]) < KERN_TEMPO || d < (spur[i][3] ?? 0) + (spur[j][3] ?? 0)) continue
    if (anfang < 0) anfang = i
    ende = j
  }
  return anfang < 0 ? spur : spur.slice(anfang, ende + 1)
}

/**
 * Gezählt wird erst, wenn man sich so weit vom letzten gezählten Punkt
 * entfernt hat. Im Stand springt der Empfänger um ein paar Meter hin und her,
 * und auch in der Fahrt schlingert die Spur: Von Punkt zu Punkt addiert, kam
 * eine Strecke von 4.6 km auf 5.9 km.
 */
export const DISTANZ_SCHRITT = 25

/** Gefahrene Meter, siehe `DISTANZ_SCHRITT`. */
export function spurDistanz(spur: Spurpunkt[]) {
  if (!spur.length) return 0
  const meter = (a: Spurpunkt, b: Spurpunkt) => Math.hypot((b[0] - a[0]) * mx(b[1]), (b[1] - a[1]) * MY)
  let summe = 0
  let l = spur[0]
  for (const p of spur) {
    const d = meter(l, p)
    if (d < DISTANZ_SCHRITT) continue
    summe += d
    l = p
  }
  return summe + meter(l, spur[spur.length - 1])
}

/**
 * Liest die Spur aus einer GPX-Datei, wie sie Velocomputer, Strava oder Komoot
 * ausgeben. Ohne Zeitstempel gibt es nichts zu lernen, dann kommt null zurück.
 */
export function spurAusGpx(gpx: string): { spur: Spurpunkt[]; beginn: number } | null {
  const spur: Spurpunkt[] = []
  let beginn = NaN
  for (const m of gpx.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const lat = Number(m[1].match(/\blat="([^"]+)"/)?.[1])
    const lon = Number(m[1].match(/\blon="([^"]+)"/)?.[1])
    const ms = Date.parse(m[2].match(/<time>([^<]+)<\/time>/)?.[1] ?? '')
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(ms)) continue
    if (Number.isNaN(beginn)) beginn = ms
    spur.push([lon, lat, (ms - beginn) / 1000])
  }
  return spur.length > 1 ? { spur, beginn } : null
}

// ------------------------------------------------------------ Zuordnung

/**
 * Bis zu diesem Abstand gilt eine Kante als befahren. Breiter als der übliche
 * Fehler des Empfängers, schmaler als der Abstand zur Parallelstrasse.
 */
const NAH = 25
/** Zuschlag auf die gedeckte Länge: Die Spur hat Lücken von einigen Metern. */
const RAND = 8
/** So viel teurer ist ein Meter abseits der Spur. */
const FERN = 15
/**
 * Bei diesem mittleren Abstand zur Spur kostet eine Kante das Doppelte. Der
 * Veloweg und die Fahrbahn daneben liegen beide nahe genug, um als befahren
 * zu gelten; welche es war, entscheidet der Abstand.
 */
const ABSTAND_DOPPELT = 12
/** Über einen Fussweg gefahren: möglich, aber nicht die erste Wahl. */
const GEGEN = 1.6
/** Gegen die Einbahn, wo man nicht einmal schieben dürfte: meist die Gegenfahrbahn, selten wahr. */
const VERBOTEN = 4
/** Alle so viele Meter ein Ankerpunkt, zwischen denen einzeln gesucht wird. */
const ANKER = 400
/** Bis zu dieser Länge gilt ein Abstecher hin und zurück als Fehler der Zuordnung. */
const STUMMEL = 30
/** Tempo, mit dem die Zuordnung Meter in Kosten umrechnet. */
const V_SPUR = 6.4
/** Schneller ist auf dem Velo in der Stadt niemand, 43 km/h. */
const V_MAX_SPUR = 12
/** Spurpunkte weiter weg liegen nicht auf der zugeordneten Strecke. */
const ABSEITS = 45
/** So weit darf ein Punkt hinter den letzten zurückfallen, bevor er nicht mehr zählt. */
const ZURUECK = 25
/** Unter diesem Tempo steht man, in m/s. */
const STAND_V = 0.8
/**
 * Das Tempo wird über so viele Sekunden vor und nach einem Zeitpunkt gemessen.
 * Von Punkt zu Punkt springt der Empfänger im Stand mehr, als man in einer
 * Sekunde fährt.
 */
const FENSTER = 3
/** Kürzere Halte sind Rauschen. */
const HALT_MIN = 4
/** Ohne Punkt über so viele Sekunden hat der Empfänger ausgesetzt. */
const LUECKE = 20
/** Ein Halt abseits einer Ampel, der länger dauert, ist eine Pause. */
const PAUSE_AB = 20
/** Länger wartet man an keiner Ampel der Stadt. */
const AMPEL_MAX = 150
/** Anhalten und Anfahren, wie `WARTEN.halt` im Router. */
const HALT_ZUSCHLAG = 5

/** Die Zuordnung sucht nach Länge; Ampeln und Komfort spielen keine Rolle. */
const PROFIL_SPUR: Profil = reinZeitlich({ sicherheit: 0, steigung: 0, ampeln: 0, belag: 0, schieben: true }, false, 0)
/** Das Modell ohne Gelerntes, an dem die Messung verglichen wird. */
const PROFIL_MODELL: Profil = reinZeitlich({ sicherheit: 0, steigung: 0, ampeln: 0, belag: 0, schieben: true })

type Hilfen = { weg: Float32Array; zeit: Float32Array }
const hilfenJe = new WeakMap<Graph, Hilfen>()

/** Je Graph einmal: die Bogenlänge jedes Punkts ab Kantenanfang und die Modellzeiten. */
function hilfen(g: Graph): Hilfen {
  let h = hilfenJe.get(g)
  if (h) return h
  const weg = new Float32Array(g.meta.punkte)
  for (let e = 0; e < g.E; e++)
    for (let i = g.kantePunkte[e] + 1; i < g.kantePunkte[e + 1]; i++)
      weg[i] = weg[i - 1] + Math.hypot(g.px(i) - g.px(i - 1), g.py(i) - g.py(i - 1))
  h = { weg, zeit: kantenKosten(g, PROFIL_MODELL).zeit }
  hilfenJe.set(g, h)
  return h
}

export type Zuordnung = {
  stuecke: Stueck[]
  /** Länge der zugeordneten Strecke in Metern. */
  distanz: number
  /** Dauer ohne Pausen, in Sekunden. */
  netto: number
  pausen: number
  /** Sekunden im Stand vor Lichtsignalen. */
  gewartet: number
  /** Was das Modell ohne Gelerntes für dieselbe Strecke rechnet. */
  modell: number
  /**
   * Das Tempo dieser Fahrt im Verhältnis zum Modell: gemessene durch erwartete Fahrzeit der
   * Kanten. Unter 1 heisst schneller als das Modell. Damit lassen sich Strecken vergleichen,
   * ohne dass zählt, wie zügig man gerade gefahren ist.
   */
  tempo: number
  /** Anteil der Spurpunkte, die auf der zugeordneten Strecke liegen. */
  treffer: number
  /** Je ganz befahrener Kante: gemessene Fahrzeit und die des Modells. */
  /** `s0` und `s1`: Bogenlänge am Anfang und am Ende der Kante, ab Beginn der Fahrt. */
  kanten: { a: number; fahr: number; modell: number; s0: number; s1: number }[]
  /** Je Ampel: gemessene Wartezeit und die des Modells. */
  /** `s`: wo in der Fahrt die Ampel lag, in Metern ab Beginn. */
  ampeln: { schluessel: number; gewartet: number; modell: number; s: number }[]
  /**
   * Die Knoten des Netzes, die die Fahrt passiert hat, mit Bogenlänge und
   * Fahrzeit ohne Pausen ab Beginn. `i` ist das erste Stück nach dem Knoten.
   * Damit lassen sich Fahrten Stück für Stück vergleichen (`vergleich.ts`).
   */
  knoten: { v: number; s: number; t: number; i: number }[]
}

/** Hängt ein Stück an und legt es mit dem vorigen zusammen, wenn es dieselbe Kante fortsetzt. */
function anhaengen(liste: Stueck[], s: Stueck) {
  if (s.bis - s.von <= 1e-6) return
  const l = liste[liste.length - 1]
  if (l && l.a === s.a && Math.abs(l.bis - s.von) < 1e-3) l.bis = s.bis
  else liste.push({ ...s })
}

/**
 * Ordnet eine Spur dem Velonetz zu und misst, wie lange jede Kante und jede
 * Ampel gedauert hat.
 *
 * Die Zuordnung ist selbst eine Routensuche. Kanten, an denen die Spur
 * entlangläuft, sind billig, alle anderen fünfzehnmal so teuer; der kürzeste
 * Weg unter diesen Kosten folgt der Spur. Gesucht wird in Etappen von rund
 * 400 Metern, jede beginnt, wo die vorige aufgehört hat. Eine einzige Suche
 * vom ersten zum letzten Punkt würde jede Schleife abkürzen, und bei einer
 * Rundfahrt bliebe nichts übrig.
 *
 * Danach wandert jeder Spurpunkt auf die gefundene Strecke. Daraus ergibt
 * sich, wann welcher Knoten passiert wurde und wo man gestanden ist.
 */
export function zuordnen(g: Graph, spur: Spurpunkt[]): Zuordnung | null {
  const { weg, zeit: zeit0 } = hilfen(g)

  const P: { x: number; y: number; t: number }[] = []
  for (const [lon, lat, t, genau] of spur) {
    if (genau !== undefined && genau > GENAU_MAX) continue
    if (P.length && t <= P[P.length - 1].t) continue
    P.push({ x: (lon - LON0) * g.MX, y: (lat - g.LAT0) * g.MY, t })
  }
  if (P.length < 10) return null

  // Wie weit die Spur jede Kante deckt: kleinste und grösste Bogenlänge, an
  // der ein Punkt nahe vorbeikommt. Eine Kante, die die Spur bloss kreuzt,
  // ist so nur auf wenigen Metern gedeckt.
  const lo = new Float32Array(g.E).fill(Infinity)
  const hi = new Float32Array(g.E).fill(-Infinity)
  const quadrate = new Float32Array(g.E)
  const anzahl = new Uint32Array(g.E)
  for (const p of P) {
    const cx = Math.floor(p.x / g.ZELLE)
    const cy = Math.floor(p.y / g.ZELLE)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of g.raster.get((cx + dx + 1000) * 4000 + cy + dy + 1000) ?? []) {
          const ax = g.px(i), ay = g.py(i)
          const ddx = g.px(i + 1) - ax, ddy = g.py(i + 1) - ay
          const l2 = ddx * ddx + ddy * ddy
          const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * ddx + (p.y - ay) * ddy) / l2)) : 0
          const d = Math.hypot(ax + u * ddx - p.x, ay + u * ddy - p.y)
          if (d > NAH) continue
          const e = g.punktKante[i]
          // Der Abstand zählt nur, wo der Punkt neben dem Segment liegt. Davor
          // und dahinter misst er bloss, wie weit das Segmentende weg ist.
          if (u > 0 && u < 1) {
            quadrate[e] += d * d
            anzahl[e]++
          }
          const s = weg[i] + u * Math.sqrt(l2)
          if (s < lo[e]) lo[e] = s
          if (s > hi[e]) hi[e] = s
        }
  }
  const kosten = new Float32Array(2 * g.E)
  const preis = (e: number, gedeckt: number) => {
    const L = g.laenge[e]
    const abstand = anzahl[e] ? quadrate[e] / anzahl[e] / ABSTAND_DOPPELT ** 2 : 0
    const c = (gedeckt * (1 + abstand) + (L - gedeckt) * FERN) / V_SPUR
    for (const a of [2 * e, 2 * e + 1])
      kosten[a] = c * (veloErlaubt(g, a) ? 1 : schiebenErlaubt(g, a) ? GEGEN : VERBOTEN)
  }
  for (let e = 0; e < g.E; e++) preis(e, hi[e] >= lo[e] ? Math.min(g.laenge[e], hi[e] - lo[e] + 2 * RAND) : 0)
  // Die erste und die letzte Kante sind nur zum Teil befahren. Der Router
  // rechnet einen Teil als Anteil der ganzen Kante, der unbefahrene Rest
  // würde das befahrene Stück mitverteuern. Dort zählt deshalb nur der Abstand.
  const kandidaten = (p: { x: number; y: number }) => einrastenAlle(g, p.x / g.MX + LON0, p.y / g.MY + g.LAT0, true)
  let von: Einrastung[] = kandidaten(P[0])
  for (const c of [...von, ...kandidaten(P[P.length - 1])]) preis(c.kante, g.laenge[c.kante])
  const k = { zeit: kosten, kosten }

  // Ankerpunkte entlang der Spur. Das Hin und Her im Stand zählt nicht mit,
  // sonst lägen an jeder Ampel mehrere Anker auf demselben Fleck.
  const anker: number[] = []
  let seit = 0
  let gezaehlt = 0
  for (let i = 1; i < P.length - 1; i++) {
    const d = Math.hypot(P[i].x - P[gezaehlt].x, P[i].y - P[gezaehlt].y)
    if (d < 5) continue
    seit += d
    gezaehlt = i
    if (seit >= ANKER) {
      anker.push(i)
      seit = 0
    }
  }
  anker.push(P.length - 1)

  const stuecke: Stueck[] = []
  for (const i of anker) {
    const nach = kandidaten(P[i])
    // Findet sich keine Verbindung, versucht es der nächste Anker vom selben Ort aus.
    const teil = von.length && nach.length ? sucheStuecke(g, PROFIL_SPUR, von, nach, k) : null
    if (!teil) {
      if (!von.length) von = nach
      continue
    }
    for (const s of teil.stuecke) anhaengen(stuecke, s)
    const l = teil.stuecke[teil.stuecke.length - 1]
    von = [{ kante: l.a >> 1, t: l.a & 1 ? 1 - l.bis : l.bis, lon: 0, lat: 0, d: 0 }]
  }
  // Liegt ein Anker an einer Kreuzung, rastet er manchmal auf der Querstrasse
  // ein: Die Etappe endet ein paar Meter in ihr, die nächste fährt dieselben
  // Meter zurück. Solche Stummel fallen weg, die Nachbarn schliessen am Knoten
  // wieder aneinander an.
  for (let i = 0; i + 1 < stuecke.length; i++) {
    const hin = stuecke[i]
    const her = stuecke[i + 1]
    if (her.a !== (hin.a ^ 1) || hin.von > 1e-3 || her.bis < 1 - 1e-3) continue
    if (Math.abs(hin.bis + her.von - 1) > 1e-3 || g.laenge[hin.a >> 1] * hin.bis > STUMMEL) continue
    stuecke.splice(i, 2)
    i = Math.max(-1, i - 2)
  }
  if (!stuecke.length) return null
  const n = stuecke.length

  // Die Strecke als Linienzug in lokalen Metern, dazu die Bogenlänge am Anfang
  // jedes Stücks (`grenze[n]` ist die Gesamtlänge).
  const X: number[] = []
  const Y: number[] = []
  const S: number[] = []
  const grenze: number[] = []
  let laenge = 0
  for (const st of stuecke) {
    grenze.push(laenge)
    const pts = ausschnitt(g, st.a, st.von, st.bis)
    for (const [lon, lat, , d] of pts) {
      X.push((lon - LON0) * g.MX)
      Y.push((lat - g.LAT0) * g.MY)
      S.push(laenge + d)
    }
    laenge += pts[pts.length - 1][3]
  }
  grenze.push(laenge)

  // Jeden Spurpunkt auf die Strecke setzen. Gesucht wird nur ein Stück voraus:
  // so weit, wie man seit dem letzten Punkt gekommen sein kann. Das hält den
  // Punkt auf der richtigen Durchfahrt, wenn die Strecke sich selbst kreuzt.
  // Zurück geht es nie, sonst liefe die Zeit an einem Knoten zweimal ab.
  const zeit: number[] = []
  const roh: number[] = []
  let pos = 0
  let seg = 0
  let tLetzt = P[0].t
  for (const p of P) {
    const bis = pos + Math.max(60, ZURUECK + V_MAX_SPUR * (p.t - tLetzt))
    while (seg + 2 < S.length && S[seg + 1] < pos - ZURUECK) seg++
    let beste = Infinity
    let besteS = pos
    for (let i = seg; i + 1 < S.length && S[i] <= bis; i++) {
      const ddx = X[i + 1] - X[i], ddy = Y[i + 1] - Y[i]
      const l2 = ddx * ddx + ddy * ddy
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - X[i]) * ddx + (p.y - Y[i]) * ddy) / l2)) : 0
      const d = Math.hypot(X[i] + u * ddx - p.x, Y[i] + u * ddy - p.y)
      if (d < beste) {
        beste = d
        besteS = S[i] + u * (S[i + 1] - S[i])
      }
    }
    if (beste > ABSEITS) continue
    pos = Math.max(pos, besteS)
    zeit.push(p.t)
    roh.push(besteS)
    tLetzt = p.t
  }
  if (zeit.length < 5) return null
  // Der Median über fünf Punkte nimmt einzelne Ausreisser heraus, ohne die
  // Fahrt zu verzögern: Bei gleichmässigem Tempo ist er der mittlere Punkt.
  const ort: number[] = []
  for (let i = 0; i < roh.length; i++) {
    const fuenf = roh.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b)
    ort.push(Math.max(ort[i - 1] ?? 0, fuenf[fuenf.length >> 1]))
  }

  /** Wo man zur Zeit `t` war, zwischen den Punkten gerade verbunden. */
  const ortBei = (t: number) => {
    if (t <= zeit[0]) return ort[0]
    if (t >= zeit[zeit.length - 1]) return ort[ort.length - 1]
    let a = 0
    let b = zeit.length - 1
    while (b - a > 1) {
      const m = (a + b) >> 1
      if (zeit[m] <= t) a = m
      else b = m
    }
    return ort[a] + ((t - zeit[a]) / (zeit[b] - zeit[a])) * (ort[b] - ort[a])
  }

  // Halte und Lücken. Das Tempo wird im Sekundentakt geprüft, auch wo die Spur
  // dünner ist: Im Stand legt `verdichten` nur alle fünf Sekunden einen Punkt
  // ab, und manche Geräte gar keinen. Eine lange Spanne ohne Fortschritt ist
  // deshalb ein Halt und keine Lücke.
  const halte: { s: number; dauer: number; vergeben: boolean }[] = []
  const luecken: [number, number][] = []
  let haltS = NaN
  let haltT = 0
  const schliessen = () => {
    // Das Fenster sieht den Halt erst, wenn es fast ganz in ihm liegt, und
    // verliert so an beiden Enden ein paar Sekunden. Die Hälfte kommt zurück;
    // der Rest ist Ausrollen und Anfahren und steckt in `HALT_ZUSCHLAG`.
    if (!Number.isNaN(haltS) && haltT >= HALT_MIN) halte.push({ s: haltS, dauer: haltT + FENSTER, vergeben: false })
    haltS = NaN
    haltT = 0
  }
  for (let i = 1; i < zeit.length; i++) {
    const dt = zeit[i] - zeit[i - 1]
    if (dt > LUECKE && ort[i] - ort[i - 1] >= 15) {
      schliessen()
      luecken.push([ort[i - 1], ort[i]])
      continue
    }
    const schritte = Math.ceil(dt)
    for (let j = 0; j < schritte; j++) {
      const mitte = zeit[i - 1] + ((j + 0.5) * dt) / schritte
      if (ortBei(mitte + FENSTER) - ortBei(mitte - FENSTER) < STAND_V * 2 * FENSTER) {
        if (Number.isNaN(haltS)) haltS = ortBei(mitte)
        haltT += dt / schritte
      } else schliessen()
    }
  }
  schliessen()
  const inLuecke = (s0: number, s1: number) => luecken.some(([a, b]) => a < s1 && b > s0)

  /** Wann die Bogenlänge `s` zum ersten Mal erreicht war; NaN ausserhalb der Messung. */
  const zeitBei = (s: number) => {
    if (s < ort[0] - 1e-6 || s > ort[ort.length - 1] + 1e-6) return NaN
    let a = 0
    let b = ort.length - 1
    while (a < b) {
      const m = (a + b) >> 1
      if (ort[m] < s) a = m + 1
      else b = m
    }
    if (a === 0) return zeit[0]
    const ds = ort[a] - ort[a - 1]
    return ds > 0 ? zeit[a - 1] + ((s - ort[a - 1]) / ds) * (zeit[a] - zeit[a - 1]) : zeit[a]
  }

  // Die Übergänge, wie das Modell sie rechnet. Wendet jemand mitten auf einer
  // Kante, liegt dazwischen kein Knoten und damit auch kein Übergang.
  const ue = leererUebergang()
  const ueFahren = new Float32Array(n)
  const ueWarten = new Float32Array(n)
  const ueSchluessel = new Int32Array(n).fill(-1)
  const ueAmpel = new Int32Array(n).fill(-1)
  let eintritt = NaN
  let modell = 0
  for (let i = 0; i < n; i++) {
    const st = stuecke[i]
    // Gegen die Einbahn kennt das Modell keine Zeit, gerechnet wird wie in der Ebene.
    const t0 = Number.isFinite(zeit0[st.a]) ? zeit0[st.a] : g.laenge[st.a >> 1] / V_SPUR
    modell += t0 * (st.bis - st.von)
    const naechstes = stuecke[i + 1]
    if (!naechstes || st.bis < 0.999 || naechstes.von > 0.001) {
      eintritt = NaN
      continue
    }
    uebergang(g, PROFIL_MODELL, st.a, naechstes.a, g.kopf(st.a), eintritt, ue)
    eintritt = ue.eintritt
    modell += ue.zeit
    ueFahren[i] = ue.zeit - ue.warten
    ueWarten[i] = ue.warten
    ueSchluessel[i] = ue.schluessel
    ueAmpel[i] = ue.ampel
  }

  // Halte vor Ampeln. Die Wartezeit rechnet das Modell beim Verlassen der
  // Kreuzung an, gestanden wird aber davor: auf der Kante, die zur Kreuzung
  // hinführt, oder auf einer innerhalb. Dem Empfänger nach steht man manchmal
  // auch schon ein paar Meter dahinter.
  const gesperrt = new Uint8Array(n)
  /** Sekunden je Stück, die nicht Fahrzeit sind: Stand vor der Ampel samt Anhalten und Anfahren. */
  const abzug = new Float32Array(n)
  const stueckBei = (s: number) => {
    let m = 0
    while (m + 1 < n && grenze[m + 1] <= s) m++
    return m
  }
  const ampeln: Zuordnung['ampeln'] = []
  let gewartet = 0
  let pausen = 0
  /** Wo und wie lange pausiert wurde, für die Fahrzeit ohne Pausen bei den Knoten. */
  const pauseListe: { s: number; dauer: number }[] = []
  for (let i = 0; i < n; i++) {
    if (ueAmpel[i] < 0) continue
    let j = i
    while (j > 0 && g.knotenAmpel[g.fuss(stuecke[j].a)] === ueAmpel[i]) j--
    const s0 = grenze[j]
    const s1 = grenze[i + 1] + 15
    let summe = 0
    const hier: typeof halte = []
    for (const h of halte) {
      if (h.vergeben || h.s < s0 || h.s > s1) continue
      h.vergeben = true
      summe += h.dauer
      hier.push(h)
    }
    if (summe > AMPEL_MAX) {
      pausen += summe
      for (const h of hier) (gesperrt[stueckBei(h.s)] = 1), pauseListe.push({ s: h.s, dauer: h.dauer })
      continue
    }
    // Die Standzeit gehört zur Ampel. Der Kante, auf der gestanden wurde,
    // bleibt ihre Fahrzeit, sie lässt sich weiter messen.
    hier.forEach((h, nr) => (abzug[stueckBei(h.s)] += h.dauer + (nr === 0 ? HALT_ZUSCHLAG : 0)))
    if (inLuecke(s0, s1) || Number.isNaN(zeitBei(s0)) || Number.isNaN(zeitBei(Math.min(s1, laenge)))) continue
    gewartet += summe
    ampeln.push({ schluessel: ueSchluessel[i], gewartet: summe > 0 ? summe + HALT_ZUSCHLAG : 0, modell: ueWarten[i], s: grenze[i + 1] })
  }
  // Was übrig bleibt: Ein kurzer Halt (Vortritt gewähren) gehört zur Fahrzeit
  // der Kante, ein langer ist eine Pause und sagt nichts über die Strecke.
  for (const h of halte) {
    if (h.vergeben || h.dauer <= PAUSE_AB) continue
    pausen += h.dauer
    pauseListe.push({ s: h.s, dauer: h.dauer })
    gesperrt[stueckBei(h.s)] = 1
  }

  // Fahrzeit je ganz befahrener Kante.
  const kanten: Zuordnung['kanten'] = []
  for (let i = 0; i < n; i++) {
    const st = stuecke[i]
    if (gesperrt[i] || st.von > 0.001 || st.bis < 0.999 || !veloErlaubt(g, st.a)) continue
    if (inLuecke(grenze[i], grenze[i + 1])) continue
    const fahr = zeitBei(grenze[i + 1]) - zeitBei(grenze[i]) - abzug[i]
    const L = grenze[i + 1] - grenze[i]
    // Schneller als 54 km/h fährt niemand: Dann stimmt die Zeitmessung nicht.
    if (!(fahr > 0) || L / fahr > 15) continue
    // Abbremsen und Schulterblick beim Abbiegen rechnet der Router als festen
    // Zuschlag am Knoten, gemessen stecken sie in der Kante davor. Sie kommen
    // hier weg, sonst zählten sie nach dem Lernen doppelt.
    kanten.push({ a: st.a, fahr: Math.max(fahr - ueFahren[i], L / 15), modell: zeit0[st.a], s0: grenze[i], s1: grenze[i + 1] })
  }

  // Die passierten Knoten. Stehen am Beginn oder am Ende eines Stücks nur ein
  // Teil der Kante, gehört der Knoten dazu, nicht aber der Teil.
  const knoten: Zuordnung['knoten'] = []
  const knotenAn = (v: number, s: number, i: number) => {
    const t = zeitBei(s) - pauseListe.reduce((a, p) => (p.s < s ? a + p.dauer : a), 0)
    if (Number.isNaN(t) || inLuecke(s, s)) return
    const l = knoten[knoten.length - 1]
    if (!l || l.v !== v) knoten.push({ v, s, t, i })
  }
  for (let i = 0; i < n; i++) {
    const st = stuecke[i]
    if (st.von < 0.001) knotenAn(g.fuss(st.a), grenze[i], i)
    if (st.bis > 0.999) knotenAn(g.kopf(st.a), grenze[i + 1], i + 1)
  }

  return {
    stuecke, distanz: laenge, netto: Math.max(0, P[P.length - 1].t - P[0].t - pausen), pausen, gewartet, modell,
    treffer: zeit.length / P.length, kanten, ampeln, knoten, tempo: fahrtTempo(kanten),
  }
}

/** Gemessene durch erwartete Fahrzeit über alle Kanten, nie extremer als 0.4 bis 2.5. */
function fahrtTempo(kanten: Zuordnung['kanten']) {
  let fahr = 0
  let modell = 0
  for (const k of kanten) {
    fahr += k.fahr
    modell += k.modell
  }
  return modell > 30 ? Math.max(0.4, Math.min(2.5, fahr / modell)) : 1
}

/** Die Modellzeit einer Strecke, ohne alles Gelernte: Grundlage für den Vergleich bei gleichem Tempo. */
export const modellZeit = (g: Graph, stuecke: Stueck[]) => zeitVon(g, PROFIL_MODELL, stuecke)

// ------------------------------------------------------------ Lernen

/** Schlechter zugeordnete Fahrten (Spur grossteils abseits des Netzes) lehren nichts. */
const TREFFER_MIN = 0.7
/**
 * Vorwissen zum eigenen Tempo, in Sekunden Fahrzeit bei Modelltempo.
 *
 * Aus einer einzelnen Fahrt lässt sich nicht trennen, ob jemand schnell fährt
 * oder ob die Strecke schnell ist. Wer nach zehn Minuten auf eigener Strecke
 * eine Minute vor dem Vorschlag ankommt, erwartet, dass der Velonavi sich die
 * Strecke merkt, und nicht, dass er dem Vorschlag einfach dieselbe Minute
 * abzieht. Deshalb gilt zu Beginn: Das Modelltempo stimmt, die Abweichung
 * gehört der Strecke. Mit jeder weiteren Fahrt verschiebt sich das, nach zwei
 * Stunden im Sattel bestimmt die Messung das Tempo zu vier Fünfteln.
 */
const TEMPO_VORWISSEN = 1800
/**
 * Vorwissen je Kante, in Sekunden: So viel Fahrzeit nach Modell wiegt gleich
 * viel wie die Messung. Es bremst nur die ganz kurzen Kanten, die sich auf
 * eine Sekunde genau nicht messen lassen.
 *
 * Mehr braucht es nicht. Der Messfehler an einem Knoten fehlt der einen Kante
 * und landet bei der nächsten, über eine ganze Strecke hebt er sich auf. Mit
 * zwölf Sekunden Vorwissen blieb die gefahrene Strecke nach der ersten Fahrt
 * dagegen ein Fünftel hinter ihrer gemessenen Zeit zurück, und der Router
 * schlug sie nicht vor, obwohl sie den Vorschlag klar geschlagen hatte.
 */
const VORWISSEN = 1
/**
 * Vorwissen je Ampel, in Durchfahrten: So viele Durchfahrten wiegt die Wartezeit, die das Modell
 * erwartet, gegen die eigenen Messungen. Ob es grün ist, entscheidet der Zufall. Mit einer einzigen
 * Durchfahrt als Gewicht halbierte schon ein Mal Grün die erwartete Wartezeit, und drei Ampeln
 * mit Glück an einem Tag machten eine Route um eine halbe Minute billiger. Mit vier Durchfahrten
 * bewegt ein einzelnes Grün die Erwartung um einen Fünftel, erst viele Fahrten verschieben sie.
 */
const VORWISSEN_AMPEL = 4

export type Lernstand = Gelernt & {
  /** Wie viele Fahrten, Kanten und Ampeln in das Gelernte eingeflossen sind. */
  fahrten: number
  abschnitte: number
  ampeln: number
  /** Wie viele Abschnitte und Ampeln zusätzlich aus den Fahrten anderer stammen. */
  vonAnderen: { abschnitte: number; ampeln: number }
}

/**
 * Gewicht der Fahrten anderer je Abschnitt, in Sekunden Modellzeit. Es
 * wächst mit der Zahl der Messungen: Fünf Messungen zählen halb so viel wie
 * unendlich viele, und gegenüber den eigenen Messungen wie ein Abschnitt
 * von acht Sekunden.
 */
const GEM_VORWISSEN = 8
const GEM_HALB = 5
/** Gewicht der Wartezeit anderer je Ampel, in Durchfahrten. */
const GEM_AMPEL = 3

/**
 * Macht aus den Messungen aller Fahrten die Korrekturen für den Router.
 *
 * Zuerst das eigene Tempo: gemessene Fahrzeit durch Modellzeit, über alles.
 * Ohne diesen Schritt wäre jede befahrene Kante bei jemandem, der langsamer
 * fährt als das Modell, «langsam» und jede unbefahrene «schnell», und der
 * Router wiche genau den Strassen aus, die man kennt. Erst was vom eigenen
 * Tempo abweicht, sagt etwas über die Kante.
 *
 * `gemeinschaft` sind die Messungen anderer, siehe `gemeinschaft.ts`. Sie
 * gelten als Vorwissen: Wo man selbst nichts gefahren ist, bestimmen sie den
 * Abschnitt und die Ampel, wo man selbst gefahren ist, ziehen sie die eigene
 * Messung ein Stück Richtung Durchschnitt. Ihre Werte sind auf das jeweils
 * eigene Tempo der Beitragenden bezogen, das eigene Tempo kommt obendrauf.
 */
export function lerne(g: Graph, zuordnungen: Zuordnung[], gemeinschaft?: Gemeinschaft | null): Lernstand | null {
  const brauchbar = zuordnungen.filter((z) => z.treffer >= TREFFER_MIN)
  let fahr = 0
  let modell = 0
  for (const z of brauchbar)
    for (const k of z.kanten) {
      fahr += k.fahr
      modell += k.modell
    }
  if (modell <= 0 && !gemeinschaft) return null
  const tempo = Math.max(0.6, Math.min(1.7, (fahr + TEMPO_VORWISSEN) / (modell + TEMPO_VORWISSEN)))

  const jeKante = new Map<number, { fahr: number; modell: number }>()
  const jeAmpel = new Map<number, { n: number; gewartet: number; modell: number }>()
  for (const z of brauchbar) {
    for (const k of z.kanten) {
      const s = jeKante.get(k.a)
      if (s) (s.fahr += k.fahr), (s.modell += k.modell)
      else jeKante.set(k.a, { fahr: k.fahr, modell: k.modell })
    }
    for (const a of z.ampeln) {
      const s = jeAmpel.get(a.schluessel)
      if (s) s.n++, (s.gewartet += a.gewartet)
      else jeAmpel.set(a.schluessel, { n: 1, gewartet: a.gewartet, modell: a.modell })
    }
  }

  const faktor = new Float32Array(2 * g.E).fill(1)
  // Die anderen: je Abschnitt ein Faktor und sein Gewicht.
  const gemKante = new Map<number, { f: number; w: number }>()
  const gemWarten = new Map<number, number>()
  if (gemeinschaft) {
    const index = kantenIndex(g)
    for (const [k, [r, n]] of Object.entries(gemeinschaft.kanten ?? {})) {
      const a = index.get(k)
      if (a === undefined) continue
      gemKante.set(a, { f: Math.max(0.6, Math.min(2, r)), w: n / (n + GEM_HALB) })
    }
    for (const [k, [mittel, n]] of Object.entries(gemeinschaft.ampeln ?? {})) {
      const sk = ampelNummer(g, k)
      if (sk !== undefined && n > 0) gemWarten.set(sk, mittel)
    }
    for (const [a, x] of gemKante) faktor[a] = 1 + (x.f - 1) * x.w
  }
  for (const [a, s] of jeKante) {
    const x = gemKante.get(a)
    // Ohne andere ist das Vorwissen eine Sekunde bei Faktor 1, mit ihnen mehr, bei ihrem Faktor.
    const w = x ? VORWISSEN + GEM_VORWISSEN * x.w : VORWISSEN
    const vor = x ? x.f : 1
    const f = (s.fahr / tempo + w * vor) / (s.modell + w)
    // Zusammen mit dem Tempo nie unter die Hälfte der Modellzeit.
    faktor[a] = Math.max(0.6, 0.5 / tempo, Math.min(2, f))
  }
  const warten = new Map<number, number>()
  for (const [schluessel, s] of jeAmpel) {
    const andere = gemWarten.get(schluessel)
    warten.set(schluessel, andere === undefined ? (VORWISSEN_AMPEL * s.modell + s.gewartet) / (VORWISSEN_AMPEL + s.n) : (GEM_AMPEL * andere + s.gewartet) / (GEM_AMPEL + s.n))
  }
  for (const [schluessel, mittel] of gemWarten) if (!warten.has(schluessel)) warten.set(schluessel, mittel)

  return {
    tempo, faktor, warten,
    fahrten: brauchbar.length, abschnitte: jeKante.size, ampeln: jeAmpel.size,
    vonAnderen: { abschnitte: [...gemKante.keys()].filter((a) => !jeKante.has(a)).length, ampeln: [...gemWarten.keys()].filter((k) => !jeAmpel.has(k)).length },
  }
}

/** So nah an der Route gilt ein Stück als gefolgt: eine Strassenbreite mit Trottoir. */
const DECKUNG_M = 20

/**
 * Anteil der gefahrenen Meter, die nah an `r` liegen. Gemessen wird der Abstand und nicht, ob es
 * dieselbe Kante des Netzes ist: Viele Strassen haben Fahrbahn, Velostreifen und Trottoir als eigene
 * Kanten, oft je Seite. Wer auf dem Streifen neben der vorgeschlagenen Fahrbahn fuhr, folgte der
 * Route, zählte aber nicht dazu. Eine Fahrt, die bis auf das letzte Stück der Route folgte, kam so
 * auf 59 statt gut 85 Prozent.
 */
export function deckung(g: Graph, stuecke: Stueck[], r: Route) {
  const pts = r.koordinaten
  if (pts.length < 2) return 0
  const kx = mx(pts[0][1])
  const xy = (lon: number, lat: number) => [lon * kx, lat * MY] as const
  // Die Abschnitte der Route in einem Gitter aus Feldern von 50 m, damit jede Probe nur die nahen prüft.
  const FELD = 50
  const gitter = new Map<string, number[]>()
  const routeXY = pts.map(([lon, lat]) => xy(lon, lat))
  for (let i = 0; i + 1 < routeXY.length; i++) {
    const [ax, ay] = routeXY[i]
    const [bx, by] = routeXY[i + 1]
    for (let fx = Math.floor((Math.min(ax, bx) - DECKUNG_M) / FELD); fx <= Math.floor((Math.max(ax, bx) + DECKUNG_M) / FELD); fx++)
      for (let fy = Math.floor((Math.min(ay, by) - DECKUNG_M) / FELD); fy <= Math.floor((Math.max(ay, by) + DECKUNG_M) / FELD); fy++) {
        const k = `${fx},${fy}`
        const l = gitter.get(k)
        if (l) l.push(i)
        else gitter.set(k, [i])
      }
  }
  const nah = (x: number, y: number) => {
    for (const i of gitter.get(`${Math.floor(x / FELD)},${Math.floor(y / FELD)}`) ?? []) {
      const [ax, ay] = routeXY[i]
      const [bx, by] = routeXY[i + 1]
      const dx = bx - ax
      const dy = by - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= DECKUNG_M) return true
    }
    return false
  }
  let alle = 0
  let gemeinsam = 0
  for (const s of stuecke) {
    const linie = ausschnitt(g, s.a, s.von, s.bis)
    for (let i = 0; i + 1 < linie.length; i++) {
      const [ax, ay] = xy(linie[i][0], linie[i][1])
      const [bx, by] = xy(linie[i + 1][0], linie[i + 1][1])
      const L = Math.hypot(bx - ax, by - ay)
      // In Schritten von höchstens 10 m, jeder Schritt zählt nach seiner Mitte.
      const n = Math.max(1, Math.ceil(L / 10))
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        alle += L / n
        if (nah(ax + t * (bx - ax), ay + t * (by - ay))) gemeinsam += L / n
      }
    }
  }
  return alle > 0 ? gemeinsam / alle : 0
}
