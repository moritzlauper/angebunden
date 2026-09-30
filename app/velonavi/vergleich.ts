/**
 * Fahrten miteinander vergleichen, ohne dass Start und Ziel genau übereinstimmen
 * müssen.
 *
 * Zwei Fragen:
 *
 * 1. `aehnliche`: Welche anderen Fahrten waren ungefähr dieselbe Strecke?
 *    Ähnlich ist eine Fahrt, wenn sie in der Nähe beginnt und endet oder wenn
 *    sie zu einem grossen Teil auf denselben Kanten des Netzes liegt.
 * 2. `teilstrecken`: Wo bist du zwischen zwei Punkten schon auf
 *    verschiedenen Wegen gefahren, und welcher war schneller? Dafür braucht es
 *    keine ähnliche Fahrt als Ganzes, ein gemeinsames Stück reicht.
 *
 * Verglichen wird bei gleichem Tempo: Ob eine Strecke besser war, soll nicht davon abhängen, wie
 * zügig man gerade gefahren ist. Dafür zählt die Modellzeit der Strecke (`Zuordnung.modell`),
 * bei Teilstrecken die Zeit geteilt durch das Tempo der jeweiligen Fahrt (`Zuordnung.tempo`).
 * Die gefahrene Zeit steht daneben.
 *
 * Beides rechnet auf den Knoten, die `zuordnen` für jede Fahrt liefert. Zwei
 * Fahrten gehen an denselben Knoten vorbei und trennen sich dazwischen: Dort
 * liegt eine Teilstrecke mit Alternativen.
 *
 * Keine Laufzeit-Importe ausser den Typen, damit sich die Rechnung in Node
 * prüfen lässt.
 */

import type { Fahrt, Zuordnung } from './fahrten.ts'
import type { Graph } from './router.ts'

export type Lauf = { fahrt: Fahrt; zuordnung: Zuordnung }

const LON0 = 8.54
const MY = 111133
const mx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)
const meterZwischen = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) =>
  Math.hypot((b.lon - a.lon) * mx(a.lat), (b.lat - a.lat) * MY)

// ------------------------------------------------------------ Ähnliche Fahrten

/** So weit dürfen Start und Ziel zweier ähnlicher Fahrten auseinanderliegen. */
const NAHE = 400
/** Anteil der Strecke auf denselben Kanten, ab dem zwei Fahrten ähnlich sind. */
const UEBERLAPP = 0.5

export type Aehnliche = {
  fahrt: Fahrt
  zuordnung: Zuordnung
  /** Anteil der gefahrenen Meter der Bezugsfahrt, die auch hier befahren wurden. */
  gemeinsam: number
  /** Fahrzeit ohne Pausen minus die der Bezugsfahrt, in Sekunden; negativ heisst schneller. */
  unterschied: number
  /** Dasselbe bei gleichem Tempo gerechnet: Modellzeit der Strecke minus die der Bezugsfahrt. */
  unterschiedModell: number
}

function kantenMengeVon(z: Zuordnung, g: Graph) {
  const menge = new Map<number, number>()
  for (const s of z.stuecke) menge.set(s.a >> 1, (menge.get(s.a >> 1) ?? 0) + g.laenge[s.a >> 1] * (s.bis - s.von))
  return menge
}

/** Fahrten, die ungefähr dieselbe Strecke wie `bezug` waren, die ähnlichsten zuerst. */
export function aehnliche(g: Graph, bezug: Lauf, andere: Lauf[]): Aehnliche[] {
  const mBezug = kantenMengeVon(bezug.zuordnung, g)
  const ganz = [...mBezug.values()].reduce((a, b) => a + b, 0)
  const anfang = (l: Lauf) => ({ lon: l.fahrt.spur[0][0], lat: l.fahrt.spur[0][1] })
  const ende = (l: Lauf) => ({ lon: l.fahrt.spur[l.fahrt.spur.length - 1][0], lat: l.fahrt.spur[l.fahrt.spur.length - 1][1] })
  const out: Aehnliche[] = []
  for (const l of andere) {
    if (l.fahrt.id === bezug.fahrt.id || !l.fahrt.spur.length) continue
    const mL = kantenMengeVon(l.zuordnung, g)
    let gemeinsam = 0
    for (const [e, m] of mBezug) if (mL.has(e)) gemeinsam += Math.min(m, mL.get(e)!)
    const anteil = ganz > 0 ? gemeinsam / ganz : 0
    const anteilL = l.zuordnung.distanz > 0 ? gemeinsam / l.zuordnung.distanz : 0
    const nah = meterZwischen(anfang(bezug), anfang(l)) < NAHE && meterZwischen(ende(bezug), ende(l)) < NAHE
    // Die Strecke muss auch ungefähr gleich lang sein, sonst wäre ein Abstecher zum Bahnhof «ähnlich» wie die Fahrt bis ans andere Stadtende.
    const laenge = l.zuordnung.distanz / Math.max(bezug.zuordnung.distanz, 1)
    if (laenge < 0.5 || laenge > 2) continue
    if (!nah && Math.max(anteil, anteilL) < UEBERLAPP) continue
    out.push({
      fahrt: l.fahrt,
      zuordnung: l.zuordnung,
      gemeinsam: anteil,
      unterschied: l.zuordnung.netto - bezug.zuordnung.netto,
      unterschiedModell: l.zuordnung.modell - bezug.zuordnung.modell,
    })
  }
  return out.sort((a, b) => b.gemeinsam - a.gemeinsam)
}

// ------------------------------------------------------------ Teilstrecken

/** Kürzere Abschnitte lohnen keinen Vergleich: Der Zeitunterschied ginge im Rauschen unter. */
const MEHR_ALS_METER = 120
/** Kleinerer Unterschied in Sekunden ist keine Meldung wert. */
const UNTERSCHIED_MIN = 8

export type Weg = {
  /** Gerichtete Kanten in Fahrtrichtung. */
  kanten: number[]
  meter: number
  /** Die Strasse, auf der der grösste Teil des Wegs liegt. */
  strasse: string
  /** Fahrzeit je Fahrt, die diesen Weg genommen hat, auf das Modelltempo umgerechnet (bei gleichem Tempo). */
  zeiten: { id: string; t: number }[]
  median: number
  koordinaten: [number, number][]
}

export type Teilstrecke = {
  von: number
  nach: number
  /** Kürzeste der Varianten in Metern, für die Anzeige. */
  meter: number
  /** Nach Fahrzeit sortiert, der schnellste zuerst. */
  wege: Weg[]
  /** Wie viele Sekunden der schnellste Weg gegenüber dem langsamsten im Mittel gewinnt. */
  vorsprung: number
  /** Auf wie vielen Fahrten das beruht. */
  fahrten: number
}

const median = (w: number[]) => {
  const s = [...w].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function wegKoordinaten(g: Graph, kanten: number[]) {
  const out: [number, number][] = []
  for (const a of kanten) {
    const e = a >> 1
    const idx: number[] = []
    for (let i = g.kantePunkte[e]; i < g.kantePunkte[e + 1]; i++) idx.push(i)
    if (a & 1) idx.reverse()
    idx.forEach((i, j) => {
      if (j === 0 && out.length) return
      out.push([g.punkte[2 * i] / 1e6, g.punkte[2 * i + 1] / 1e6])
    })
  }
  return out
}

/**
 * Abschnitte, die verschiedene Fahrten zwischen denselben zwei Knoten auf
 * verschiedenen Wegen zurückgelegt haben. Der Weg mit der kleinsten mittleren
 * Fahrzeit steht zuerst.
 *
 * Gesucht wird paarweise: Zwei Fahrten haben gemeinsame Knoten, zwischen zwei
 * aufeinanderfolgenden gemeinsamen Knoten verlaufen sie gleich oder nicht. Wo
 * nicht, ist es ein Kandidat. Danach wird jede Fahrt gefragt, ob sie ebenfalls
 * an beiden Knoten vorbeikam, und ihr Weg dazwischen den Varianten zugeordnet.
 * So zählen alle Fahrten mit, nicht nur die beiden, an denen der Kandidat
 * entdeckt wurde.
 */
export function teilstrecken(g: Graph, laeufe: Lauf[], max = 6): Teilstrecke[] {
  const ks = laeufe.map((l) => l.zuordnung.knoten)
  const pos = ks.map((k) => {
    const m = new Map<number, number>()
    k.forEach((x, j) => m.has(x.v) || m.set(x.v, j))
    return m
  })
  const weg = (f: number, ia: number, ib: number) => {
    const k = ks[f]
    const kanten: number[] = []
    for (let j = k[ia].i; j < k[ib].i; j++) kanten.push(laeufe[f].zuordnung.stuecke[j].a)
    return kanten
  }

  // 1. Kandidaten: Knotenpaare, zwischen denen zwei Fahrten verschieden fuhren.
  const kandidaten = new Map<string, [number, number]>()
  for (let a = 0; a < laeufe.length; a++)
    for (let b = a + 1; b < laeufe.length; b++) {
      let letztB = -1
      let vorher: [number, number] | null = null
      ks[a].forEach((k, ia) => {
        const jb = pos[b].get(k.v)
        if (jb === undefined || jb <= letztB) return
        if (vorher) {
          const [ia0, jb0] = vorher
          const wa = weg(a, ia0, ia)
          const wb = weg(b, jb0, jb)
          const gleich = wa.length === wb.length && wa.every((x, i) => x === wb[i])
          if (!gleich && wa.length && wb.length) kandidaten.set(`${ks[a][ia0].v}>${k.v}`, [ks[a][ia0].v, k.v])
        }
        vorher = [ia, jb]
        letztB = jb
      })
    }

  // 2. Jeden Kandidaten mit allen Fahrten auswerten.
  const gefunden: (Teilstrecke & { knoten: Set<number> })[] = []
  for (const [von, nach] of kandidaten.values()) {
    const varianten = new Map<string, { kanten: number[]; meter: number; zeiten: { id: string; t: number }[] }>()
    laeufe.forEach((l, f) => {
      const ia = pos[f].get(von)
      const ib = pos[f].get(nach)
      if (ia === undefined || ib === undefined || ib <= ia) return
      // Durch das Tempo dieser Fahrt geteilt: Wer müde war, soll die Strecke nicht schlechter aussehen lassen.
      const t = (ks[f][ib].t - ks[f][ia].t) / laeufe[f].zuordnung.tempo
      const meter = ks[f][ib].s - ks[f][ia].s
      if (!(t > 0) || meter < MEHR_ALS_METER) return
      const kanten = weg(f, ia, ib)
      const sig = kanten.join(',')
      const v = varianten.get(sig) ?? { kanten, meter, zeiten: [] }
      v.zeiten.push({ id: l.fahrt.id, t })
      varianten.set(sig, v)
    })
    if (varianten.size < 2) continue
    const wege: Weg[] = [...varianten.values()]
      .map((v) => {
        const meterJeStrasse = new Map<string, number>()
        for (const a of v.kanten) {
          const name = g.meta.namen[g.kanteName[a >> 1]] || ''
          if (name) meterJeStrasse.set(name, (meterJeStrasse.get(name) ?? 0) + g.laenge[a >> 1])
        }
        const strasse = [...meterJeStrasse.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? ''
        return { ...v, strasse, median: median(v.zeiten.map((z) => z.t)), koordinaten: wegKoordinaten(g, v.kanten) }
      })
      .sort((a, b) => a.median - b.median)
    const vorsprung = wege[wege.length - 1].median - wege[0].median
    if (vorsprung < UNTERSCHIED_MIN) continue
    const alle = new Set<string>()
    for (const w of wege) for (const z of w.zeiten) alle.add(z.id)
    const knoten = new Set<number>()
    for (const w of wege) for (const a of w.kanten) knoten.add(g.kopf(a)), knoten.add(g.fuss(a))
    gefunden.push({ von, nach, meter: Math.min(...wege.map((w) => w.meter)), wege, vorsprung, fahrten: alle.size, knoten })
  }

  // 3. Die aussagekräftigsten zuerst, ohne dass sich zwei Abschnitte überdecken.
  gefunden.sort((a, b) => b.vorsprung * Math.sqrt(b.fahrten) - a.vorsprung * Math.sqrt(a.fahrten))
  const belegt = new Set<number>()
  const out: Teilstrecke[] = []
  for (const t of gefunden) {
    const ueberdeckt = [...t.knoten].filter((v) => belegt.has(v)).length
    if (ueberdeckt > 2) continue
    for (const v of t.knoten) belegt.add(v)
    const { knoten: _knoten, ...rest } = t
    out.push(rest)
    if (out.length >= max) break
  }
  return out
}
