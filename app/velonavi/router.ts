/**
 * Routing für den Velonavi, vollständig im Browser.
 *
 * Der Graph kommt aus `pipeline/11-velo-netz.ts` als eine Binärdatei. Gesucht
 * wird kantenbasiert (A* über gerichtete Kanten statt über Knoten). Das kostet
 * etwas mehr Speicher, erlaubt aber, was ein Knotenrouter nicht kann:
 * Abbiegeverbote, Kosten fürs Abbiegen und vor allem Lichtsignale, deren
 * Wartezeit davon abhängt, ob man geradeaus über die Kreuzung will oder nur
 * rechts abbiegt.
 *
 * Die Datei hat keine Laufzeit-Importe, damit sie sich auch in Node testen lässt.
 */

// ------------------------------------------------------------ Kodierung
// Muss zu `pipeline/11-velo-netz.ts` passen.

export const KLASSE = { weg: 0, veloweg: 1, wohnstrasse: 2, neben: 3, sammel: 4, haupt: 5, feldweg: 6, treppe: 7 } as const
export const BELAG = { gut: 0, platten: 1, kopfstein: 2, kies: 3, naturweg: 4 } as const
export const TEMPO = { keins: 0, fahrverbot: 1, t20: 2, t30: 3, t50: 4, t60plus: 5 } as const
export const NETZ = { keins: 0, basis: 1, haupt: 2, vorzug: 3 } as const
export const INFRA = { keine: 0, streifen: 1, getrennt: 2 } as const

export type VeloMeta = {
  version: number
  erstellt: string
  knoten: number
  kanten: number
  punkte: number
  aufbau: Record<string, { offset: number; laenge: number }>
  namen: string[]
  ampeln: [number, number, 0 | 1, string][]
  statistik: {
    veloKm: number
    stressKm: number[]
    ampelKnoten: number
    verbote: number
    unfaelle: number
    tramKanten: number
  }
}

export type Graph = ReturnType<typeof ladeGraph>

/** Liest die Binärdatei und legt die abgeleiteten Hilfsfelder an. */
export function ladeGraph(meta: VeloMeta, puffer: ArrayBuffer) {
  const feld = <T>(name: string, Typ: new (b: ArrayBuffer, o: number, l: number) => T): T => {
    const a = meta.aufbau[name]
    return new Typ(puffer, a.offset, a.laenge)
  }
  const N = meta.knoten
  const E = meta.kanten
  const knotenKoord = feld('knotenKoord', Int32Array)
  const knotenAmpel = feld('knotenAmpel', Int16Array)
  const kanteVon = feld('kanteVon', Uint32Array)
  const kanteNach = feld('kanteNach', Uint32Array)
  const kantePunkte = feld('kantePunkte', Uint32Array)
  const punkte = feld('punkte', Int32Array)
  const punktHoehe = feld('punktHoehe', Int16Array)
  const laenge = feld('laenge', Float32Array)
  const hoch = feld('hoch', Uint16Array)
  const runter = feld('runter', Uint16Array)
  const merkmale = feld('merkmale', Uint32Array)
  const unfall = feld('unfall', Uint8Array)
  const unfallAnzahl = feld('unfallAnzahl', Uint8Array)
  const huerde = feld('huerde', Uint8Array)
  const spuren = feld('spuren', Uint8Array)
  const kanteName = feld('kanteName', Uint16Array)
  const ampelArt = feld('ampelArt', Uint8Array)
  const verboteRoh = feld('verbote', Uint32Array)

  // Lokale Meter um Zürich, für Distanzen und Peilungen.
  const LAT0 = 47.38
  const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180)
  const MY = 111133
  const px = (i: number) => (punkte[2 * i] / 1e6 - 8.54) * MX
  const py = (i: number) => (punkte[2 * i + 1] / 1e6 - LAT0) * MY

  // Gerichtete Kante a: 2e läuft von `von` nach `nach`, 2e+1 zurück.
  const kopf = (a: number) => (a & 1 ? kanteVon[a >> 1] : kanteNach[a >> 1])
  const fuss = (a: number) => (a & 1 ? kanteNach[a >> 1] : kanteVon[a >> 1])

  // Ausgehende gerichtete Kanten je Knoten, als CSR.
  const grad = new Uint32Array(N + 1)
  for (let e = 0; e < E; e++) {
    grad[kanteVon[e] + 1]++
    grad[kanteNach[e] + 1]++
  }
  for (let n = 0; n < N; n++) grad[n + 1] += grad[n]
  const ausgehend = new Uint32Array(2 * E)
  const fuellung = grad.slice(0, N)
  for (let e = 0; e < E; e++) {
    ausgehend[fuellung[kanteVon[e]]++] = 2 * e
    ausgehend[fuellung[kanteNach[e]]++] = 2 * e + 1
  }

  // Peilung am Anfang und am Ende jeder gerichteten Kante, in Grad ab Nord.
  // Gemessen über die ersten bzw. letzten 10 m, damit ein Knick im letzten
  // Meter vor der Kreuzung nicht die Richtung bestimmt.
  const peilStart = new Float32Array(2 * E)
  const peilEnde = new Float32Array(2 * E)
  const peil = (i: number, j: number) => (Math.atan2(px(j) - px(i), py(j) - py(i)) * 180) / Math.PI
  for (let e = 0; e < E; e++) {
    const p0 = kantePunkte[e]
    const p1 = kantePunkte[e + 1] - 1
    let a = p0 + 1
    while (a < p1 && Math.hypot(px(a) - px(p0), py(a) - py(p0)) < 10) a++
    let b = p1 - 1
    while (b > p0 && Math.hypot(px(b) - px(p1), py(b) - py(p1)) < 10) b--
    peilStart[2 * e] = peil(p0, a)
    peilEnde[2 * e] = peil(b, p1)
    peilStart[2 * e + 1] = peil(p1, b)
    peilEnde[2 * e + 1] = peil(a, p0)
  }

  // Knoten an einer Haupt- oder Sammelstrasse: dort kostet das Queren ohne Ampel.
  const hauptKnoten = new Uint8Array(N)
  for (let e = 0; e < E; e++) {
    const k = (merkmale[e] >> 11) & 7
    if ((merkmale[e] & 3) && (k === KLASSE.haupt || k === KLASSE.sammel)) hauptKnoten[kanteVon[e]] = hauptKnoten[kanteNach[e]] = 1
  }

  const verbote = new Set<number>()
  for (let i = 0; i < verboteRoh.length; i += 3) verbote.add(verboteRoh[i] * E + verboteRoh[i + 1])

  // Raster über alle Segmente für das Einrasten von Start und Ziel, 60 m Zellen.
  const ZELLE = 60
  const raster = new Map<number, number[]>()
  for (let e = 0; e < E; e++) {
    for (let i = kantePunkte[e]; i < kantePunkte[e + 1] - 1; i++) {
      const x0 = Math.floor(Math.min(px(i), px(i + 1)) / ZELLE)
      const x1 = Math.floor(Math.max(px(i), px(i + 1)) / ZELLE)
      const y0 = Math.floor(Math.min(py(i), py(i + 1)) / ZELLE)
      const y1 = Math.floor(Math.max(py(i), py(i + 1)) / ZELLE)
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const k = (cx + 1000) * 4000 + cy + 1000
          let z = raster.get(k)
          if (!z) raster.set(k, (z = []))
          z.push(i)
        }
    }
  }
  // Zu jedem Punkt die Kante, zu der er gehört.
  const punktKante = new Uint32Array(meta.punkte)
  for (let e = 0; e < E; e++) for (let i = kantePunkte[e]; i < kantePunkte[e + 1]; i++) punktKante[i] = e

  return {
    meta, N, E, knotenKoord, knotenAmpel, kanteVon, kanteNach, kantePunkte, punkte, punktHoehe,
    laenge, hoch, runter, merkmale, unfall, unfallAnzahl, huerde, spuren, kanteName, ampelArt, verbote,
    ausgehend, grad, peilStart, peilEnde, hauptKnoten, raster, ZELLE, punktKante,
    kopf, fuss, px, py, MX, MY, LAT0,
  }
}

// ------------------------------------------------------------ Merkmale lesen

const m = (g: Graph, e: number) => g.merkmale[e]
export const veloErlaubt = (g: Graph, a: number) => ((m(g, a >> 1) >> (a & 1)) & 1) === 1
export const schiebenErlaubt = (g: Graph, a: number) => ((m(g, a >> 1) >> (2 + (a & 1))) & 1) === 1
export const infraVon = (g: Graph, a: number) => (m(g, a >> 1) >> (a & 1 ? 6 : 4)) & 3
export const tempoVon = (g: Graph, e: number) => (m(g, e) >> 8) & 7
export const klasseVon = (g: Graph, e: number) => (m(g, e) >> 11) & 7
export const belagVon = (g: Graph, e: number) => (m(g, e) >> 14) & 7
export const tramVon = (g: Graph, e: number) => ((m(g, e) >> 17) & 1) === 1
export const netzVon = (g: Graph, e: number) => (m(g, e) >> 20) & 3
export const stressVon = (g: Graph, a: number) => (m(g, a >> 1) >> (a & 1 ? 25 : 22)) & 7
export const fussgaengerVon = (g: Graph, e: number) => ((m(g, e) >> 28) & 1) === 1
const istStrasse = (g: Graph, e: number) => {
  const k = klasseVon(g, e)
  return k >= KLASSE.wohnstrasse && k <= KLASSE.haupt
}

// ------------------------------------------------------------ Profil

export type Profil = {
  /** 0–1: wie stark Verkehr, Tramgleise und Unfallstellen gemieden werden. */
  sicherheit: number
  /** 0–1: wie stark Steigungen über die reine Mehrzeit hinaus gemieden werden. */
  steigung: number
  /** 0–1: wie stark Warten an Lichtsignalen zählt. */
  ampeln: number
  /** 0–1: wie stark Kopfsteinpflaster, Kies und Naturwege gemieden werden. */
  belag: number
  /** Ob kurze Stücke zu Fuss mit dem Velo an der Hand erlaubt sind. */
  schieben: boolean
}

export const VOREINSTELLUNGEN = {
  schnell: { sicherheit: 0.1, steigung: 0.1, ampeln: 0.4, belag: 0.3 },
  ausgewogen: { sicherheit: 0.5, steigung: 0.3, ampeln: 0.5, belag: 0.6 },
  entspannt: { sicherheit: 0.95, steigung: 0.8, ampeln: 0.6, belag: 1 },
} as const

/** Tempo in der Ebene, 23 km/h. */
const V0 = 6.4
/**
 * Zeit je Höhenmeter bergauf, zusätzlich zur Zeit in der Ebene. Weil man
 * bergauf langsamer fährt und dabei weniger Luftwiderstand hat, ist sie
 * kleiner als die reine Hubarbeit (90 kg, 150 W wären 5.9 s/m).
 */
const S_PRO_M = 3.2
/** Deckel für Abfahrten in der Stadt, 34 km/h. */
const VMAX = 9.4
/** Tempo zu Fuss mit dem Velo an der Hand. */
const V_SCHIEBEN = 1.25
/** Tempofaktor je Belag. */
const BELAG_TEMPO = [1, 0.9, 0.62, 0.8, 0.62]
/**
 * Zusätzliche gefühlte Zeit je Belag, bei voller Gewichtung. Das grobe
 * Pflaster der Altstadtgassen ist der unangenehmste Belag der Stadt: es
 * rüttelt, bei Nässe rutscht es, und bergauf verliert man den Tritt.
 */
const BELAG_KOSTEN = [0, 0.15, 1.3, 0.4, 0.8]
/**
 * Zusätzliche gefühlte Zeit je Stufe (Index 1–4), bei voller Gewichtung.
 * Stufe 2 ist ein Velostreifen an Tempo 30 oder etwas ruppiger Belag: spürbar,
 * aber kein Grund für einen Umweg.
 */
const STRESS_KOSTEN = [0, 0, 0.15, 1.5, 3.2]
/** Rabatt für einen abgetrennten Veloweg: den nimmt man gerne, auch mit Umweg. */
const GETRENNT_RABATT = 0.85
/**
 * Rabatt auf Hauptnetz und Vorzugsrouten der städtischen Velonetzplanung.
 * Der Rabatt ist bewusst kräftig: Diese Achsen sind die offiziell empfohlenen
 * Korridore, sie sind durchgehend, direkt und meist besser ausgebaut. Ohne ihn
 * zieht die Bewertung auf ruhige Quartierstrassen, auch wenn sie Umwege sind.
 */
const NETZ_RABATT = [1, 1, 0.75, 0.65]
/** Kleinster Kostenfaktor, den es gibt: begrenzt die A*-Schätzung nach unten. */
const MIN_FAKTOR = 0.55

/**
 * Erwartete Wartezeit an einem Lichtsignal in Sekunden, je Manöver.
 * Geradeaus über die Kreuzung wartet man im Mittel eine halbe Rotphase.
 * Rechts abbiegen geht fast immer ohne Halt, links meist indirekt über den
 * Velosack oder den Fussgängerstreifen, was selten lange dauert.
 */
const WARTEN = {
  knoten: { geradeaus: 24, links: 7, rechts: 2 },
  // Einzelne Fussgängerampeln: entlang der Strasse meist grün, beim Queren rot.
  einzeln: { entlang: 5, queren: 18, abbiegen: 2 },
}

type Kosten = { zeit: Float32Array; kosten: Float32Array }

/** Zeit und gewichtete Kosten je gerichteter Kante für ein Profil. */
export function kantenKosten(g: Graph, p: Profil): Kosten {
  const zeit = new Float32Array(2 * g.E).fill(Infinity)
  const kosten = new Float32Array(2 * g.E).fill(Infinity)
  const v0 = V0
  const sProM = S_PRO_M
  for (let a = 0; a < 2 * g.E; a++) {
    const e = a >> 1
    const L = g.laenge[e]
    const auf = (a & 1 ? g.runter[e] : g.hoch[e]) / 10
    const ab = (a & 1 ? g.hoch[e] : g.runter[e]) / 10
    const klasse = klasseVon(g, e)
    if (veloErlaubt(g, a)) {
      const belag = belagVon(g, e)
      const fuss = fussgaengerVon(g, e)
      let v = v0 * BELAG_TEMPO[belag]
      // Wo man Fussgängern ausweichen muss, fährt man langsamer.
      if (klasse === KLASSE.weg || klasse === KLASSE.wohnstrasse) v = Math.min(v, 4.2)
      if (fuss) v = Math.min(v, 3.3)
      const eben = L / v
      const gewinn = Math.max(0, Math.min(ab * 3, eben - L / VMAX))
      const t = eben + auf * sProM - gewinn
      const steil = auf / Math.max(L, 1)
      const stress = stressVon(g, a)
      // Jede zusätzliche Fahrspur über zwei hinaus: mehr Verkehr, schnellere
      // Spurwechsel neben einem, Abbiegespuren, die man queren muss.
      const spurig = Math.max(0, g.spuren[e] - 2)
      let faktor =
        1 +
        STRESS_KOSTEN[stress] * p.sicherheit +
        (infraVon(g, a) === INFRA.getrennt ? 0 : spurig * 0.35 * p.sicherheit) +
        BELAG_KOSTEN[belag] * p.belag +
        // Auf Plätzen und in Fussgängerzonen kommt man weder zügig noch
        // entspannt durch, unabhängig davon, wie man die Regler stellt.
        (fuss ? 0.4 : 0)
      // Der Rabatt fürs städtische Velonetz gilt nur, wo die Achse auch
      // angenehm ist. Die Badenerstrasse beim Lochergut steht im Hauptnetz und
      // bleibt trotzdem eine Strecke, die man meidet.
      if (stress <= 2) faktor *= NETZ_RABATT[netzVon(g, e)]
      if (infraVon(g, a) === INFRA.getrennt) faktor *= GETRENNT_RABATT
      // Poller, Tore, Bahnübergänge und ungesicherte Querungen: feste
      // Sekunden, unabhängig von der Länge der Kante.
      const huerde = g.huerde[e]
      zeit[a] = t + huerde
      kosten[a] =
        t * faktor +
        huerde * 1.6 +
        auf * sProM * p.steigung * (1.2 + 12 * Math.max(0, steil - 0.05)) +
        g.unfall[e] * 3 * p.sicherheit
    } else if (p.schieben && schiebenErlaubt(g, a)) {
      const treppe = klasse === KLASSE.treppe
      const t = L / (treppe ? 0.5 : V_SCHIEBEN) + auf * (treppe ? 4 : 1.5)
      zeit[a] = t
      kosten[a] = t * (treppe ? 3.5 : 2.5)
    }
  }
  return { zeit, kosten }
}

// ------------------------------------------------------------ Abbiegen

/** Winkel von Peilung a nach b, -180 bis 180, positiv heisst rechts. */
function drehung(a: number, b: number) {
  let d = b - a
  while (d > 180) d -= 360
  while (d <= -180) d += 360
  return d
}

type Manoever = 'geradeaus' | 'links' | 'rechts' | 'wende'
function manoever(d: number): Manoever {
  const b = Math.abs(d)
  if (b <= 40) return 'geradeaus'
  if (b >= 155) return 'wende'
  return d > 0 ? 'rechts' : 'links'
}

type Uebergang = { kosten: number; zeit: number; ampel: number; manoever: Manoever | null; eintritt: number }

/**
 * Kosten beim Übergang von gerichteter Kante a auf b am Knoten v.
 * `eintritt` ist die Peilung, mit der man die Kreuzung betreten hat, falls a
 * schon innerhalb einer Ampelkreuzung liegt; sonst NaN. Eine Kreuzung besteht
 * oft aus mehreren Knoten, das Manöver ergibt sich erst beim Verlassen.
 */
function uebergang(g: Graph, p: Profil, a: number, b: number, v: number, eintritt: number, out: Uebergang) {
  out.kosten = 0
  out.zeit = 0
  out.ampel = -1
  out.manoever = null
  out.eintritt = NaN
  // Jedes Abbiegen kostet: Abbremsen, Schulterblick, Handzeichen. Ohne
  // diesen Zuschlag nimmt der Router in Rasterquartieren eine Treppe durch die
  // Blöcke, weil viele Wege dort fast gleich lang sind.
  const d = drehung(g.peilEnde[a], g.peilStart[b])
  const b_ = Math.abs(d)
  if (b_ > 35) {
    out.kosten += b_ > 120 ? 14 : 8
    out.zeit += b_ > 120 ? 5 : 3
  }

  // Absteigen und wieder aufsteigen.
  if (veloErlaubt(g, a) !== veloErlaubt(g, b)) {
    out.zeit += 8
    out.kosten += 25
  }

  const J = g.knotenAmpel[v]
  if (J >= 0) {
    const inJ = g.knotenAmpel[g.fuss(a)] === J && !Number.isNaN(eintritt)
    const rein = inJ ? eintritt : g.peilEnde[a]
    if (g.knotenAmpel[g.kopf(b)] === J && g.laenge[b >> 1] < 40) {
      // Noch in der Kreuzung: das Manöver steht erst beim Verlassen fest.
      out.eintritt = rein
      return
    }
    const mv = manoever(drehung(rein, g.peilStart[b]))
    let warten: number
    if (g.ampelArt[J] === 0) {
      warten = mv === 'geradeaus' ? WARTEN.knoten.geradeaus : mv === 'links' ? WARTEN.knoten.links : WARTEN.knoten.rechts
    } else {
      const quer = !istStrasse(g, a >> 1) || !istStrasse(g, b >> 1)
      warten = mv === 'geradeaus' ? (quer ? WARTEN.einzeln.queren : WARTEN.einzeln.entlang) : WARTEN.einzeln.abbiegen
    }
    out.zeit += warten
    out.kosten += warten * (0.3 + 1.6 * p.ampeln)
    out.ampel = J
    out.manoever = mv
    return
  }

  // Hauptstrasse ohne Ampel queren oder links von ihr abbiegen: man wartet
  // auf eine Lücke, und es ist die Stelle, an der es am häufigsten kracht.
  if (g.hauptKnoten[v]) {
    const ea = a >> 1
    const eb = b >> 1
    const haupt = (e: number) => {
      const k = klasseVon(g, e)
      return k === KLASSE.haupt || k === KLASSE.sammel
    }
    const mv = manoever(d)
    if (!haupt(ea) && !haupt(eb) && mv !== 'rechts') {
      out.zeit += 5
      out.kosten += 5 + 12 * p.sicherheit
    } else if (haupt(ea) && !haupt(eb) && mv === 'links') {
      out.zeit += 3
      out.kosten += 3 + 6 * p.sicherheit
    } else if (!haupt(ea) && haupt(eb) && mv === 'links') {
      out.zeit += 5
      out.kosten += 5 + 10 * p.sicherheit
    }
  }
}

// ------------------------------------------------------------ Einrasten

export type Einrastung = { kante: number; t: number; lon: number; lat: number; d: number }

/**
 * Nächster Punkt auf einer befahrbaren (oder, wenn erlaubt, schiebbaren)
 * Kante. `t` ist der Längenanteil ab `von`.
 *
 * `strasse` ist der Strassenname der Adresse. Er entscheidet bei Eckhäusern:
 * Die Werdstrasse 21 liegt 20 m vom Stauffacherquai und 25 m von der
 * Werdstrasse entfernt, gemeint ist aber die Werdstrasse. Ohne diesen Hinweis
 * führt die Route einmal um den Block.
 */
export function einrasten(g: Graph, lon: number, lat: number, schieben: boolean, strasse?: string): Einrastung | null {
  const x = (lon - 8.54) * g.MX
  const y = (lat - g.LAT0) * g.MY
  const cx = Math.floor(x / g.ZELLE)
  const cy = Math.floor(y / g.ZELLE)
  let beste = null as Einrastung | null
  let passend = null as Einrastung | null
  const gesucht = strasse?.toLowerCase()
  for (let r = 0; r <= 8; r++) {
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        for (const i of g.raster.get((cx + dx + 1000) * 4000 + cy + dy + 1000) ?? []) {
          const e = g.punktKante[i]
          const nutzbar =
            veloErlaubt(g, 2 * e) || veloErlaubt(g, 2 * e + 1) ||
            (schieben && (schiebenErlaubt(g, 2 * e) || schiebenErlaubt(g, 2 * e + 1)))
          if (!nutzbar) continue
          const ax = g.px(i), ay = g.py(i), bx = g.px(i + 1), by = g.py(i + 1)
          const ddx = bx - ax, ddy = by - ay
          const l2 = ddx * ddx + ddy * ddy
          const s = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ddx + (y - ay) * ddy) / l2)) : 0
          const qx = ax + s * ddx, qy = ay + s * ddy
          // Velokanten leicht bevorzugt: wer neben einer Strasse klickt, meint
          // selten den Fussweg dahinter.
          const d = Math.hypot(qx - x, qy - y) + (veloErlaubt(g, 2 * e) || veloErlaubt(g, 2 * e + 1) ? 0 : 15)
          const gleicheStrasse =
            gesucht !== undefined && (g.meta.namen[g.kanteName[e]] ?? '').toLowerCase() === gesucht
          if ((!beste || d < beste.d) || (gleicheStrasse && (!passend || d < passend.d))) {
            // Anteil der Kantenlänge bis zum Fusspunkt.
            let bis = 0
            for (let j = g.kantePunkte[e]; j < i; j++) bis += Math.hypot(g.px(j + 1) - g.px(j), g.py(j + 1) - g.py(j))
            bis += Math.sqrt(l2) * s
            const treffer = { kante: e, t: Math.min(1, bis / Math.max(g.laenge[e], 1e-6)), lon: qx / g.MX + 8.54, lat: qy / g.MY + g.LAT0, d }
            if (!beste || d < beste.d) beste = treffer
            if (gleicheStrasse && (!passend || d < passend.d)) passend = treffer
          }
        }
      }
    // Der Ring r deckt garantiert alles bis (r·ZELLE) ab.
    if (beste && beste.d <= r * g.ZELLE) break
  }
  // Die Kante mit dem Strassennamen der Adresse gewinnt, solange sie nicht
  // unverhältnismässig weiter weg liegt.
  if (passend && (!beste || passend.d < beste.d + 60)) return passend
  return beste
}

// ------------------------------------------------------------ Suche

/** Binärer Min-Heap über (Schlüssel, Wert), ohne Decrease-Key. */
class Heap {
  k = new Float64Array(1024)
  v = new Int32Array(1024)
  n = 0
  push(key: number, val: number) {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2)
      k.set(this.k)
      this.k = k
      const v = new Int32Array(this.n * 2)
      v.set(this.v)
      this.v = v
    }
    let i = this.n++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.k[p] <= key) break
      this.k[i] = this.k[p]
      this.v[i] = this.v[p]
      i = p
    }
    this.k[i] = key
    this.v[i] = val
  }
  pop(): number {
    const top = this.v[0]
    const key = this.k[--this.n]
    const val = this.v[this.n]
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= this.n) break
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++
      if (this.k[c] >= key) break
      this.k[i] = this.k[c]
      this.v[i] = this.v[c]
      i = c
    }
    this.k[i] = key
    this.v[i] = val
    return top
  }
  get minKey() {
    return this.k[0]
  }
}

/** Ein Stück der Route: eine gerichtete Kante, ganz oder anteilig. */
export type Stueck = { a: number; von: number; bis: number; ampel: number; manoever: Manoever | null }

export type Route = {
  stuecke: Stueck[]
  koordinaten: [number, number][]
  /** Je Koordinate: Stressstufe 1–4, 0 für Schieben. */
  stufen: number[]
  distanz: number
  zeit: number
  kosten: number
  hoch: number
  runter: number
  /** Meter je Stressstufe 1–4 (Index 1–4), Index 0 geschoben. */
  meterNachStufe: number[]
  vorzugM: number
  tramM: number
  kopfsteinM: number
  kiesM: number
  treppen: number
  unfaelle: number
  /** Sekunden für Poller, Tore, Bahnübergänge und Querungen. */
  huerden: number
  ampeln: { geradeaus: number; abbiegen: number; wartezeit: number; orte: [number, number, Manoever][] }
  /** Höhenprofil: [Distanz ab Start in m, Höhe in m]. */
  profil: [number, number][]
  strassen: { name: string; meter: number }[]
}

/**
 * Route von `start` nach `ziel`. Liefert null, wenn es keine Verbindung gibt
 * (zum Beispiel, wenn Schieben aus ist und das Ziel nur zu Fuss erreichbar).
 */
export function route(g: Graph, p: Profil, start: Einrastung, ziel: Einrastung, k?: Kosten): Route | null {
  const { kosten } = k ?? kantenKosten(g, p)
  const A = 2 * g.E
  const best = new Float64Array(A).fill(Infinity)
  const vorher = new Int32Array(A).fill(-2) // -1: Startkante
  const eintritt = new Float32Array(A).fill(NaN)
  const erledigt = new Uint8Array(A)
  const heap = new Heap()
  const zx = (ziel.lon - 8.54) * g.MX
  const zy = (ziel.lat - g.LAT0) * g.MY
  const hK = (n: number) =>
    (Math.hypot((g.knotenKoord[2 * n] / 1e6 - 8.54) * g.MX - zx, (g.knotenKoord[2 * n + 1] / 1e6 - g.LAT0) * g.MY - zy) / VMAX) *
    MIN_FAKTOR

  const se = start.kante
  const ze = ziel.kante
  const saat = (a: number, c: number) => {
    if (!Number.isFinite(c) || c >= best[a]) return
    best[a] = c
    vorher[a] = -1
    heap.push(c + hK(g.kopf(a)), a)
  }
  saat(2 * se, (1 - start.t) * kosten[2 * se])
  saat(2 * se + 1, start.t * kosten[2 * se + 1])

  // Start und Ziel auf derselben Kante: direkt, falls die Richtung erlaubt ist.
  let bestesZiel = Infinity
  let zielVon = -1 // gerichtete Kante, über die das Ziel erreicht wird
  let zielDirekt = false
  if (se === ze) {
    const c = ziel.t >= start.t ? (ziel.t - start.t) * kosten[2 * se] : (start.t - ziel.t) * kosten[2 * se + 1]
    if (Number.isFinite(c)) {
      bestesZiel = c
      zielDirekt = true
    }
  }

  const ue: Uebergang = { kosten: 0, zeit: 0, ampel: -1, manoever: null, eintritt: NaN }
  while (heap.n > 0) {
    if (heap.minKey >= bestesZiel) break
    const a = heap.pop()
    if (erledigt[a]) continue
    erledigt[a] = 1
    const ga = best[a]
    const v = g.kopf(a)
    const ea = a >> 1

    // Ziel erreicht: von hier noch das Stück auf der Zielkante.
    if (ea !== ze) {
      if (v === g.kanteVon[ze]) {
        const c = ga + ziel.t * kosten[2 * ze]
        if (c < bestesZiel) (bestesZiel = c), (zielVon = a), (zielDirekt = false)
      }
      if (v === g.kanteNach[ze]) {
        const c = ga + (1 - ziel.t) * kosten[2 * ze + 1]
        if (c < bestesZiel) (bestesZiel = c), (zielVon = a), (zielDirekt = false)
      }
    }

    const grad = g.grad[v + 1] - g.grad[v]
    for (let i = g.grad[v]; i < g.grad[v + 1]; i++) {
      const b = g.ausgehend[i]
      if (erledigt[b]) continue
      const cb = kosten[b]
      if (!Number.isFinite(cb)) continue
      const eb = b >> 1
      if (eb === ea && grad > 1) continue // wenden nur in der Sackgasse
      if (g.verbote.has(ea * g.E + eb) && veloErlaubt(g, a) && veloErlaubt(g, b)) continue
      uebergang(g, p, a, b, v, eintritt[a], ue)
      const c = ga + ue.kosten + cb
      if (c < best[b]) {
        best[b] = c
        vorher[b] = a
        eintritt[b] = ue.eintritt
        heap.push(c + hK(g.kopf(b)), b)
      }
    }
  }
  if (!Number.isFinite(bestesZiel)) return null

  // Kette zurückverfolgen.
  const stuecke: Stueck[] = []
  if (zielDirekt) {
    if (ziel.t >= start.t) stuecke.push({ a: 2 * se, von: start.t, bis: ziel.t, ampel: -1, manoever: null })
    else stuecke.push({ a: 2 * se + 1, von: 1 - start.t, bis: 1 - ziel.t, ampel: -1, manoever: null })
  } else {
    const kette: number[] = []
    for (let a = zielVon; a >= 0; a = vorher[a]) kette.push(a)
    kette.reverse()
    kette.forEach((a, i) => {
      const e = a >> 1
      const vonAnteil = i === 0 ? (a & 1 ? 1 - start.t : start.t) : 0
      stuecke.push({ a, von: vonAnteil, bis: 1, ampel: -1, manoever: null })
    })
    const letzte = kette[kette.length - 1]
    const zv = g.kopf(letzte) === g.kanteVon[ze]
    stuecke.push({ a: zv ? 2 * ze : 2 * ze + 1, von: 0, bis: zv ? ziel.t : 1 - ziel.t, ampel: -1, manoever: null })
  }
  return auswerten(g, p, stuecke, bestesZiel)
}

// ------------------------------------------------------------ Auswertung

/** Koordinaten und Höhen einer gerichteten Kante zwischen zwei Längenanteilen. */
function ausschnitt(g: Graph, a: number, von: number, bis: number) {
  const e = a >> 1
  const p0 = g.kantePunkte[e]
  const p1 = g.kantePunkte[e + 1]
  const idx: number[] = []
  for (let i = p0; i < p1; i++) idx.push(i)
  if (a & 1) idx.reverse()
  // Kumulierte Länge entlang der Richtung.
  const cum = [0]
  for (let j = 1; j < idx.length; j++)
    cum.push(cum[j - 1] + Math.hypot(g.px(idx[j]) - g.px(idx[j - 1]), g.py(idx[j]) - g.py(idx[j - 1])))
  const L = cum[cum.length - 1] || 1
  const s0 = von * L
  const s1 = bis * L
  const pts: [number, number, number, number][] = [] // lon, lat, höhe, s
  const bei = (s: number) => {
    let j = 1
    while (j < cum.length - 1 && cum[j] < s) j++
    const t = (s - cum[j - 1]) / Math.max(cum[j] - cum[j - 1], 1e-9)
    const i0 = idx[j - 1], i1 = idx[j]
    return [
      (g.punkte[2 * i0] + t * (g.punkte[2 * i1] - g.punkte[2 * i0])) / 1e6,
      (g.punkte[2 * i0 + 1] + t * (g.punkte[2 * i1 + 1] - g.punkte[2 * i0 + 1])) / 1e6,
      (g.punktHoehe[i0] + t * (g.punktHoehe[i1] - g.punktHoehe[i0])) / 10,
    ] as const
  }
  const [x0, y0, h0] = bei(s0)
  pts.push([x0, y0, h0, 0])
  for (let j = 0; j < idx.length; j++) {
    if (cum[j] <= s0 || cum[j] >= s1) continue
    pts.push([g.punkte[2 * idx[j]] / 1e6, g.punkte[2 * idx[j] + 1] / 1e6, g.punktHoehe[idx[j]] / 10, cum[j] - s0])
  }
  const [x1, y1, h1] = bei(s1)
  pts.push([x1, y1, h1, s1 - s0])
  return pts
}

function auswerten(g: Graph, p: Profil, stuecke: Stueck[], kostenSumme: number): Route {
  const { zeit } = kantenKosten(g, p)
  const r: Route = {
    stuecke, koordinaten: [], stufen: [], distanz: 0, zeit: 0, kosten: kostenSumme, hoch: 0, runter: 0,
    meterNachStufe: [0, 0, 0, 0, 0], vorzugM: 0, tramM: 0, kopfsteinM: 0, kiesM: 0, treppen: 0, unfaelle: 0, huerden: 0,
    ampeln: { geradeaus: 0, abbiegen: 0, wartezeit: 0, orte: [] }, profil: [], strassen: [],
  }
  const ue: Uebergang = { kosten: 0, zeit: 0, ampel: -1, manoever: null, eintritt: NaN }
  let eintritt = NaN
  const gesehen = new Set<number>()
  stuecke.forEach((s, i) => {
    const e = s.a >> 1
    const anteil = s.bis - s.von
    if (anteil <= 0) return
    const L = g.laenge[e] * anteil
    const velo = veloErlaubt(g, s.a)
    const stufe = velo ? stressVon(g, s.a) : 0
    r.distanz += L
    r.zeit += zeit[s.a] * anteil
    r.meterNachStufe[stufe] += L
    if (netzVon(g, e) === NETZ.vorzug && velo) r.vorzugM += L
    if (tramVon(g, e) && velo && infraVon(g, s.a) === INFRA.keine) r.tramM += L
    const belag = belagVon(g, e)
    if (belag === BELAG.kopfstein) r.kopfsteinM += L
    if (belag === BELAG.kies || belag === BELAG.naturweg) r.kiesM += L
    if (klasseVon(g, e) === KLASSE.treppe) r.treppen++
    if (!gesehen.has(e)) {
      gesehen.add(e)
      r.unfaelle += g.unfallAnzahl[e] * Math.min(1, anteil * 1.5)
      r.huerden += g.huerde[e]
    }

    const pts = ausschnitt(g, s.a, s.von, s.bis)
    const basis = r.profil.length ? r.profil[r.profil.length - 1][0] : 0
    pts.forEach(([lon, lat, h, d], j) => {
      if (j === 0 && r.koordinaten.length) return
      r.koordinaten.push([lon, lat])
      r.stufen.push(stufe)
      r.profil.push([basis + d, h])
    })

    const name = g.meta.namen[g.kanteName[e]] || ''
    const letzte = r.strassen[r.strassen.length - 1]
    if (letzte && letzte.name === name) letzte.meter += L
    else r.strassen.push({ name, meter: L })

    // Übergang zum nächsten Stück: Abbiegen und Ampeln wie im Router.
    const n = stuecke[i + 1]
    if (n) {
      const v = g.kopf(s.a)
      uebergang(g, p, s.a, n.a, v, eintritt, ue)
      eintritt = ue.eintritt
      r.zeit += ue.zeit
      if (ue.ampel >= 0) {
        s.ampel = ue.ampel
        s.manoever = ue.manoever
        const [lon, lat] = g.meta.ampeln[ue.ampel]
        if (ue.manoever === 'geradeaus') r.ampeln.geradeaus++
        else r.ampeln.abbiegen++
        r.ampeln.wartezeit += ue.zeit
        r.ampeln.orte.push([lon, lat, ue.manoever ?? 'geradeaus'])
      }
    }
  })
  // Höhenmeter aus dem Profil, geglättet über 3 Punkte gegen Rasterrauschen.
  const h = r.profil.map((_, i) => {
    const a = r.profil[Math.max(0, i - 1)][1]
    const c = r.profil[Math.min(r.profil.length - 1, i + 1)][1]
    return (a + r.profil[i][1] + c) / 3
  })
  for (let i = 1; i < h.length; i++) {
    const d = h[i] - h[i - 1]
    if (d > 0) r.hoch += d
    else r.runter -= d
  }
  r.unfaelle = Math.round(r.unfaelle)
  return r
}

/**
 * Mehrere Teilrouten zu einer zusammenfassen, für Fahrten über Zwischenziele.
 * Geometrie und Höhenprofil laufen durch, die Kennzahlen werden addiert.
 */
export function verbinde(teile: Route[]): Route {
  const g = teile[0]
  const out: Route = {
    ...g,
    stuecke: [], koordinaten: [], stufen: [], profil: [], strassen: [],
    distanz: 0, zeit: 0, kosten: 0, hoch: 0, runter: 0,
    meterNachStufe: [0, 0, 0, 0, 0], vorzugM: 0, tramM: 0, kopfsteinM: 0, kiesM: 0,
    treppen: 0, unfaelle: 0, huerden: 0,
    ampeln: { geradeaus: 0, abbiegen: 0, wartezeit: 0, orte: [] },
  }
  for (const t of teile) {
    const versatz = out.distanz
    out.stuecke.push(...t.stuecke)
    t.koordinaten.forEach((c, i) => {
      // Der erste Punkt einer Teilroute ist der letzte der vorherigen.
      if (versatz > 0 && i === 0) return
      out.koordinaten.push(c)
      out.stufen.push(t.stufen[i])
      out.profil.push([versatz + t.profil[i][0], t.profil[i][1]])
    })
    for (const st of t.strassen) {
      const letzte = out.strassen[out.strassen.length - 1]
      if (letzte && letzte.name === st.name) letzte.meter += st.meter
      else out.strassen.push({ ...st })
    }
    out.distanz += t.distanz
    out.zeit += t.zeit
    out.kosten += t.kosten
    out.hoch += t.hoch
    out.runter += t.runter
    out.vorzugM += t.vorzugM
    out.tramM += t.tramM
    out.kopfsteinM += t.kopfsteinM
    out.kiesM += t.kiesM
    out.treppen += t.treppen
    out.unfaelle += t.unfaelle
    out.huerden += t.huerden
    t.meterNachStufe.forEach((m, i) => (out.meterNachStufe[i] += m))
    out.ampeln.geradeaus += t.ampeln.geradeaus
    out.ampeln.abbiegen += t.ampeln.abbiegen
    out.ampeln.wartezeit += t.ampeln.wartezeit
    out.ampeln.orte.push(...t.ampeln.orte)
  }
  return out
}

/** GPX-Track für Navigationsgeräte und Apps. */
export function alsGpx(r: Route, name: string) {
  const pts = r.koordinaten
    .map(([lon, lat], i) => `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${r.profil[i][1].toFixed(1)}</ele></trkpt>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="angebunden Velonavi" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name.replace(/[<&>]/g, '')}</name><trkseg>${pts}</trkseg></trk></gpx>`
}
