'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Map as MapLibreMap,
  NavigationControl,
  AttributionControl,
  Popup,
  setWorkerUrl,
  type MapMouseEvent,
} from 'maplibre-gl'
import type { Meta, Extrem } from './meta'
import { STADT_LISTE, type Stadt } from './staedte'
import { Blatt, useMedienabfrage } from './blatt'
import { Suchleiste, bauIndex, suchen, type Eintrag } from './suche'
import { Wortmarke } from './marke'
import { SITE_URL } from './site'

/** Die Grundkarte bleibt schwarzweiss: dunkel = gut, hell = schlecht. */
const RAMPE_HELL = ['#000000', '#242424', '#4d4d4d', '#7a7a7a', '#a5a5a5', '#c8c8c8']
const RAMPE_DUNKEL = ['#ffffff', '#dcdcdc', '#b0b0b0', '#828282', '#565656', '#333333']

/**
 * Farbe kommt nur bei der Hervorhebung ins Spiel: kräftiges Dunkelrot für die
 * vordersten Ränge, ausbleichend bis Hellrot am eingestellten Ende.
 */
const RANG_RAMPE = ['#7f1d1d', '#b91c1c', '#dc2626', '#f87171', '#fecaca']

/**
 * Blau für Zeiger, Marken und Bedienelemente. Es liegt weder auf der
 * Graustufen-Skala der Karte noch auf dem roten Verlauf der Hervorhebung
 * und ist deshalb nie mit einem Datenwert zu verwechseln.
 */
const AKZENT = '#2563eb'

/** So viele Ränge liegen als Punktebene vor. Darüber zeigt nur noch die Fläche. */
const TOP_PUNKTE = 10000

/**
 * Bis hierher legt die Hervorhebung zusätzlich Punkte über die Fläche: sind nur
 * eine Handvoll Häuser hervorgehoben, gehen die roten Flecken sonst in der ganzen
 * Stadt unter. Darüber färbt die Fläche allein – gleichmässig statt als
 * Punktteppich, wie schon immer bei den höheren Rängen.
 */
const TOP_PUNKTE_ANZEIGE = 20

type Modus = 'oev' | 'kultur'

/** Womit die Kultur erreichbar gerechnet wird – in der Karte umschaltbar. */
type WegModus = 'velo' | 'fuss'
const WEG = {
  velo: { kurz: 'Velo', minutenWort: 'Velominuten' },
  fuss: { kurz: 'Fuss', minutenWort: 'Gehminuten' },
} as const

/** Was die beiden Kennzahlen unterscheidet, an einer Stelle gesammelt. */
const MODI = {
  oev: {
    titel: 'Erreichbarkeit',
    kurz: 'ÖV',
    punktQuelle: 'top-oev',
    schalter: 'Haltestellen',
    schalterEbene: 'halte',
  },
  kultur: {
    titel: 'Kulturvielfalt',
    kurz: 'Kultur',
    punktQuelle: 'top-kultur',
    schalter: 'Kulturorte',
    schalterEbene: 'kulturorte',
  },
} as const

const ARTEN_NAMEN: Record<string, string> = {
  cafe: 'Cafés',
  bar: 'Bars und Clubs',
  buehne: 'Bühnen',
  kino: 'Kinos',
  museum: 'Museen und Galerien',
  kunst: 'Öffentliche Kunst',
  bibliothek: 'Bibliotheken',
  badi: 'Badis',
  treff: 'Quartiertreffs',
  restaurant: 'Restaurants',
}

/** Für die Schalterreihe, wo neben dem Namen noch die Anzahl Platz braucht. */
const ARTEN_KURZ: Record<string, string> = {
  cafe: 'Cafés',
  bar: 'Bars',
  buehne: 'Bühnen',
  kino: 'Kinos',
  museum: 'Museen',
  kunst: 'Kunst',
  bibliothek: 'Bibliotheken',
  badi: 'Badis',
  treff: 'Treffs',
  restaurant: 'Restaurants',
}

/** Kurzer Hinweis für die Labels, die man nicht sofort einordnet. */
const ARTEN_HILFE: Record<string, string> = {
  bar: 'auch Pubs, Clubs und Biergärten',
  buehne: 'Theater, Konzert- und Veranstaltungslokale',
  museum: 'auch Galerien',
  kunst: 'Kunstwerke im öffentlichen Raum (z. B. Skulpturen, Wandbilder)',
  badi: 'Frei-, Hallen-, Fluss- und Strandbäder',
  treff: 'Quartier- und Gemeinschaftszentren',
}

/** Was die Karte je Haus über eine Wegart weiss. */
type SortenReihen = {
  /** Orte je Sorte im Zeitbudget, in der Reihenfolge von `meta.kultur.arten`. */
  kb: number[]
  /** Der abklingende Index je Sorte, aus dem die Rangfolge gebildet wird. */
  ki: number[]
}

type Treffer = {
  r: number
  m: number
  /** Sortenreihen je Wegart – beim Umschalten greift die Karte auf die andere zu. */
  weg: Record<WegModus, SortenReihen>
  x: number
  y: number
  adresse?: string
  name?: string
} | null

/** Die Aufschlüsselung kommt als "12,8,2,0,..." aus der Kachel. */
function kbLesen(wert: unknown): number[] {
  if (Array.isArray(wert)) return wert as number[]
  if (typeof wert === 'string' && wert !== '') return wert.split(',').map(Number)
  return []
}

/**
 * Ein Haus aus seinen Kachel-Eigenschaften lesen – ob es aus einem Klick auf
 * die Karte stammt, aus der Suche oder aus einem geteilten Link, am Ende
 * steht überall dasselbe `Treffer`-Objekt.
 */
function ausMerkmalen(p: Record<string, unknown>, artenZahl: number): NonNullable<Treffer> {
  return {
    r: p.r as number,
    m: p.m as number,
    // MapLibre reicht Array-Eigenschaften je nach Quelle als Array oder als
    // JSON-Text durch; beides muss hier ankommen.
    weg: {
      velo: {
        kb: kbLesen(p.kb),
        ki: Array.from({ length: artenZahl }, (_, i) => (p[`i${i}`] as number) ?? 0),
      },
      fuss: {
        kb: kbLesen(p.kbf),
        ki: Array.from({ length: artenZahl }, (_, i) => (p[`f${i}`] as number) ?? 0),
      },
    },
    x: p.x as number,
    y: p.y as number,
    adresse: (p.s as string) || undefined,
    name: (p.n as string) || undefined,
  }
}

// ---------------------------------------------------------------- Sortenwahl

/**
 * Was die Karte je Haus über die Kulturorte weiss, aus der GeoJSON-Datei in
 * flache Reihen umgelegt: je Sorte die Anzahl in Gehweite und der abklingende
 * Index. Bei 47'000 Häusern mal zehn Sorten ist das der Unterschied zwischen
 * einem Rechengang von Millisekunden und einem von Sekunden pro Schalterklick.
 */
type Kulturdaten = {
  n: number
  arten: number
  /** Anzahl je Sorte, je Wegart – n·arten lange Reihen. */
  anzahl: Record<WegModus, Int32Array>
  /** Abklingender Index je Sorte, je Wegart. */
  index: Record<WegModus, Float64Array>
  lon: Float64Array
  lat: Float64Array
  minuten: Float64Array
  name: (string | null)[]
  adresse: (string | null)[]
}

type RohFeature = { properties: Record<string, unknown> }

function leseKulturdaten(fc: { features: RohFeature[] }, arten: number): Kulturdaten {
  const f = fc.features
  const n = f.length
  const d: Kulturdaten = {
    n,
    arten,
    anzahl: { velo: new Int32Array(n * arten), fuss: new Int32Array(n * arten) },
    index: { velo: new Float64Array(n * arten), fuss: new Float64Array(n * arten) },
    lon: new Float64Array(n),
    lat: new Float64Array(n),
    minuten: new Float64Array(n),
    name: new Array(n).fill(null),
    adresse: new Array(n).fill(null),
  }
  for (let b = 0; b < n; b++) {
    const p = f[b].properties
    const kbVelo = kbLesen(p.kb)
    const kbFuss = kbLesen(p.kbf)
    for (let a = 0; a < arten; a++) {
      d.anzahl.velo[b * arten + a] = kbVelo[a] ?? 0
      d.anzahl.fuss[b * arten + a] = kbFuss[a] ?? 0
      d.index.velo[b * arten + a] = (p[`i${a}`] as number) ?? 0
      d.index.fuss[b * arten + a] = (p[`f${a}`] as number) ?? 0
    }
    d.lon[b] = p.x as number
    d.lat[b] = p.y as number
    d.minuten[b] = p.m as number
    d.name[b] = (p.n as string) ?? null
    d.adresse[b] = (p.s as string) ?? null
  }
  return d
}

/**
 * Rangfolge, Farbstufen und Extreme für die gerade gewählten Sorten. Vorrechnen
 * lässt sich das nicht: zehn Sorten ergeben 1023 mögliche Auswahlen.
 *
 * Gerechnet wird auf der Hauptseite, angewendet wird es als Ausdruck – die
 * Summe der gewählten Spalten steht in der Kachel, die Karte muss also nicht
 * neu zerlegt werden, wenn ein Schalter kippt. Neu gesetzt werden nur Farben.
 */
type Sicht = {
  wegModus: WegModus
  /** Indizes der gewählten Sorten in `meta.kultur.arten`. */
  gewaehlt: number[]
  /** Zahl der Kulturorte der gewählten Sorten in der ganzen Stadt. */
  orte: number
  /** Summe der gewählten Indexspalten, als Ausdruck für die Karte. */
  ausdruck: unknown
  /** Dieselbe Summe je Haus, absteigend – daraus kommen Rang und Farbstufen. */
  absteigend: Float64Array
  anzahl: Int32Array
  verteilung: { min: number; median: number; max: number }
  bestes: Extrem
  schlechtestes: Extrem
  /** Rang eines Indexwerts, 1 = am meisten Kultur in Gehweite. */
  rangVon: (wert: number) => number
  /** Der Indexwert, ab dem ein Haus zu den besten `n` gehört. */
  schwelle: (n: number) => number
  /** Die besten `n` Häuser als Punktebene, für die Hervorhebung. */
  besteAls: (n: number) => PunkteFC
}

/** Nur so viel GeoJSON, wie die beiden nachgereichten Ebenen brauchen. */
type PunkteFC = {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    properties: Record<string, unknown>
    geometry: { type: 'Point'; coordinates: number[] }
  }[]
}

function berechneSicht(
  d: Kulturdaten | null,
  an: boolean[],
  proArt: number[],
  wegModus: WegModus
): Sicht | null {
  if (!d) return null
  const gewaehlt: number[] = []
  an.forEach((x, i) => x && gewaehlt.push(i))

  const summe = new Float64Array(d.n)
  const anzahl = new Int32Array(d.n)
  for (let b = 0; b < d.n; b++) {
    const off = b * d.arten
    let si = 0
    let sa = 0
    for (const a of gewaehlt) {
      si += Math.sqrt(d.index[wegModus][off + a])
      sa += d.anzahl[wegModus][off + a]
    }
    summe[b] = si
    anzahl[b] = sa
  }

  const absteigend = Float64Array.from(summe).sort().reverse()
  const reihenfolge = Array.from(summe.keys()).sort((x, y) => summe[y] - summe[x])

  const rangVon = (wert: number) => {
    let lo = 0
    let hi = absteigend.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (absteigend[mid] > wert) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }

  const sortiertAnzahl = Int32Array.from(anzahl).sort()
  const q = (f: number) => sortiertAnzahl[Math.round(f * (d.n - 1))]

  const extrem = (b: number, rang: number): Extrem => ({
    rang,
    minuten: d.minuten[b],
    orte: anzahl[b],
    lon: d.lon[b],
    lat: d.lat[b],
    adresse: d.adresse[b],
    name: d.name[b],
  })

  return {
    wegModus,
    gewaehlt,
    orte: gewaehlt.reduce((n, a) => n + (proArt[a] ?? 0), 0),
    ausdruck:
      gewaehlt.length === 0
        ? 0
        : gewaehlt.length === 1
          ? ['sqrt', ['get', `${wegModus === 'velo' ? 'i' : 'f'}${gewaehlt[0]}`]]
          : ['+', ...gewaehlt.map((a) => ['sqrt', ['get', `${wegModus === 'velo' ? 'i' : 'f'}${a}`]])],
    absteigend,
    anzahl,
    // `max` ist das Haus auf Rang 1 (nicht das mit den meisten Orten), passend
    // zur Karten-Beschriftung «Rang 1 · N Orte»; Median und Min sind der Grösse nach.
    verteilung: { min: q(0), median: q(0.5), max: anzahl[reihenfolge[0]] },
    bestes: extrem(reihenfolge[0], 1),
    schlechtestes: extrem(reihenfolge[d.n - 1], d.n),
    rangVon,
    schwelle: (n) => absteigend[Math.min(Math.max(n, 1), d.n) - 1],
    besteAls: (n) => ({
      type: 'FeatureCollection' as const,
      features: reihenfolge.slice(0, Math.min(n, d.n)).map((b, i) => ({
        type: 'Feature' as const,
        properties: { r: i + 1 },
        geometry: { type: 'Point' as const, coordinates: [d.lon[b], d.lat[b]] },
      })),
    }),
  }
}

/**
 * Stützstellen für `interpolate`, aus Paaren in Rangfolge (bester Rang zuerst).
 * Der Ausdruck verlangt streng steigende Werte: wählt jemand nur eine seltene
 * Sorte, hat die halbe Stadt den Wert 0, die unteren Stufen fallen zusammen und
 * werden hier um ein Haar auseinandergeschoben.
 */
function aufsteigendeStufen(paare: (readonly [number, string])[]) {
  let vorher = -Infinity
  return [...paare].reverse().flatMap(([wert, farbe]) => {
    const w = wert > vorher ? wert : vorher + 1e-4
    vorher = w
    return [w, farbe]
  })
}

/**
 * Die Graustufen über die ganze Stadt: die Stützstellen liegen auf den
 * Quantilen der Rangfolge, nicht auf gleichen Werteabständen. Damit bleibt die
 * Karte gleichmässig eingefärbt, egal wie schief eine Auswahl liegt – genau
 * das, was beim Färben nach Rang von selbst herauskam.
 */
function quantilStufen(absteigend: Float64Array, rampe: string[]) {
  const n = absteigend.length
  return aufsteigendeStufen(
    rampe.map((c, i) => [absteigend[Math.round((i / (rampe.length - 1)) * (n - 1))], c] as const)
  )
}

/** Dasselbe, aber nur über die vordersten `n` Ränge – für die Hervorhebung. */
function rangStufen(absteigend: Float64Array, rampe: string[], n: number) {
  const bis = Math.min(Math.max(n, 1), absteigend.length)
  return aufsteigendeStufen(
    rampe.map((c, i) => [absteigend[Math.round(((bis - 1) * i) / (rampe.length - 1))], c] as const)
  )
}

/** Rohdaten eines Hauses, wie sie einmal geladen im Speicher liegen. */
type HausFeature = { properties: Record<string, unknown> }

export default function Karte({ meta, stadt }: { meta: Meta; stadt: Stadt }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const hoverIdRef = useRef<number | null>(null)

  const [bereit, setBereit] = useState(false)
  // Dunkelmodus vorerst ausgeblendet – die Grundkarte sieht dunkel noch nicht gut aus.
  const [dunkel] = useState(false)
  const [modus, setModus] = useState<Modus>('oev')
  const [nebenebene, setNebenebene] = useState(false)
  // Die Karte startet mit hervorgehobenen Top 1000 – ohne Farbe sieht man beim
  // Öffnen nur Graustufen und übersieht, dass der Regler überhaupt etwas tut.
  const [topN, setTopN] = useState(1000)
  const [rangHighlight, setRangHighlight] = useState(true)
  const [treffer, setTreffer] = useState<Treffer>(null)
  const [fixiert, setFixiert] = useState(false)
  // Ob die Hervorhebung dem gewählten Haus auf seinen Rang nachzieht. Nur bei
  // Suche und geteiltem Link – ein Klick auf die Karte lässt den Regler stehen.
  const [rangFolgt, setRangFolgt] = useState(false)
  const [artenAn, setArtenAn] = useState<boolean[]>(() => meta.kultur.arten.map(() => true))
  const [wegModus, setWegModus] = useState<WegModus>('fuss')

  // Welches Blatt auf dem Handy gerade den unteren Bildrand belegt – Bedienfeld
  // oder ausgewähltes Haus. Auf breiteren Schirmen stehen beide immer da, wie
  // bisher, das Feld bleibt dort ungenutzt.
  const [blatt, setBlatt] = useState<'ort' | 'einstellungen' | null>(null)
  const [suchWert, setSuchWert] = useState('')
  const [sucheOffen, setSucheOffen] = useState(false)
  const [suchTreffer, setSuchTreffer] = useState<Eintrag[]>([])
  const [geteilt, setGeteilt] = useState(false)
  // Wie viele Pixel das mobile Blatt am unteren Kartenrand verdeckt – Zoom-
  // Kontrolle und `flyTo`-Ziel weichen entsprechend nach oben aus.
  const [deckung, setDeckung] = useState(0)

  // Ab dieser Breite steht genug Platz für zwei feste Karten statt eines Blatts.
  const mobil = !useMedienabfrage('(min-width: 768px)')

  // Die Rohdaten liegen in Refs: sie ändern sich nie, und als State würden
  // 47'000 Häuser bei jedem Bildaufbau durch den Vergleich geschleift.
  const kulturdatenRef = useRef<Kulturdaten | null>(null)
  const oevExtremeRef = useRef<PunkteFC['features']>([])
  const haeuserRef = useRef<HausFeature[] | null>(null)
  const suchIndexRef = useRef<Eintrag[] | null>(null)
  const [datenBereit, setDatenBereit] = useState(false)

  const sicht = useMemo(
    () =>
      datenBereit ? berechneSicht(kulturdatenRef.current, artenAn, meta.kultur.proArt, wegModus) : null,
    [datenBereit, artenAn, meta.kultur.proArt, wegModus]
  )

  // --- Ein Haus aktiv markieren
  const setzeAktiv = useCallback((id: number | null) => {
    const map = mapRef.current
    if (!map) return
    if (hoverIdRef.current !== null)
      map.setFeatureState({ source: 'gebaeude', id: hoverIdRef.current }, { aktiv: false })
    hoverIdRef.current = id
    if (id !== null) map.setFeatureState({ source: 'gebaeude', id }, { aktiv: true })
  }, [])

  const fliegeZu = useCallback(
    (lngLat: [number, number], zoom = 16.5) => {
      // Auf dem Handy schiebt das Blatt den unteren Teil der Karte zu – das
      // Ziel wird deshalb nach oben verschoben, statt darunter zu verschwinden.
      const offset: [number, number] = mobil && deckung > 0 ? [0, -deckung / 2] : [0, 0]
      mapRef.current?.flyTo({ center: lngLat, zoom, offset, duration: 1100 })
    },
    [mobil, deckung]
  )

  /** Wählt Haus `id` aus (Umriss, Karteikarte, `fixiert`) und fliegt optional hin. */
  const waehleId = useCallback(
    (id: number, opts: { fliegen?: boolean; rangFolgt?: boolean } = {}) => {
      const props = haeuserRef.current?.[id]?.properties
      if (!props) return
      const haus = ausMerkmalen(props, meta.kultur.arten.length)
      setzeAktiv(id)
      setTreffer(haus)
      setFixiert(true)
      setRangFolgt(opts.rangFolgt ?? false)
      if (opts.fliegen !== false) fliegeZu([haus.x, haus.y])
    },
    [meta.kultur.arten.length, setzeAktiv, fliegeZu]
  )

  /** Nächstes Haus zu einem Punkt – für Extrempunkte und Deep-Links, die nur Koordinaten kennen. */
  const waehleXY = useCallback(
    (lon: number, lat: number, opts: { fliegen?: boolean; rangFolgt?: boolean } = {}) => {
      const haeuser = haeuserRef.current
      if (!haeuser) return
      let beste = -1
      let bester = Infinity
      // Lineare Suche über 47'000 Häuser kostet unter einer Millisekunde und
      // erspart einen zweiten räumlichen Index nur für diesen seltenen Fall.
      haeuser.forEach((f, i) => {
        const dx = (f.properties.x as number) - lon
        const dy = (f.properties.y as number) - lat
        const d = dx * dx + dy * dy
        if (d < bester) {
          bester = d
          beste = i
        }
      })
      if (beste >= 0 && bester < 0.0003 ** 2) waehleId(beste, opts)
    },
    [waehleId]
  )

  /** Rang eines Hauses in der gerade aktiven Kennzahl und Sortenwahl. */
  const rangDesHauses = useCallback(
    (h: NonNullable<Treffer>) => {
      if (modus !== 'kultur') return h.r
      const gewaehlt = sicht?.gewaehlt ?? meta.kultur.arten.map((_, i) => i)
      const summe = gewaehlt.reduce((w, a) => w + Math.sqrt(h.weg[wegModus].ki[a] ?? 0), 0)
      return sicht?.rangVon(summe) ?? 0
    },
    [modus, sicht, meta.kultur.arten, wegModus]
  )

  /**
   * Richtet die Hervorhebung auf das festgehaltene Haus aus, so wie es Suche und
   * geteilter Link tun. Gedacht für den Fall, dass jemand seine Adresse selbst
   * auf der Karte anklickt: danach zeigt Rot die besser, Schwarz die schlechter
   * angebundenen Häuser. Den Regler zieht der `fixiert`-Effekt auf den Rang nach.
   */
  const richteAus = useCallback(() => {
    if (!treffer) return
    setRangFolgt(true)
    fliegeZu([treffer.x, treffer.y], mapRef.current?.getZoom())
  }, [treffer, fliegeZu])

  // --- Karte einmalig aufbauen
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // Siehe scripts/copy-maplibre-worker.mjs: ohne das bleibt die Karte leer.
    setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        // Eigene Glyphen, siehe scripts/fetch-glyphs.mjs – die Karte lädt nichts von aussen.
        glyphs: '/fonts/{fontstack}/{range}.pbf',
        sources: {},
        layers: [{ id: 'grund', type: 'background', paint: { 'background-color': '#f7f7f5' } }],
      },
      center: stadt.center,
      zoom: stadt.zoom,
      minZoom: 10,
      maxZoom: 18,
      maxBounds: stadt.maxBounds,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map

    // MapLibre schluckt Fehler aus dem GeoJSON-Worker sonst stillschweigend.
    map.on('error', (e) => console.error('[karte]', e.error?.message ?? e))

    // Zoomknöpfe: auf dem Handy blendet sie die CSS aus (Pinch reicht, und der
    // Platz unten gehört dem Regler-Balken).
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(
      new AttributionControl({
        // Immer als blosses «i», das sich auf Tippen öffnet: die ausgeschriebene
        // Quellenzeile deckt sonst je nach Breite die Karteikarte zu.
        compact: true,
        customAttribution:
          'Gebäude, Adressen, Kulturorte © OpenStreetMap-Mitwirkende · Fahrplan: opentransportdata.swiss · Höhen: AWS Terrain Tiles',
      }),
      'bottom-left'
    )
    // MapLibre klappt die kompakte Quellenzeile beim Aufbau auf und erst beim
    // ersten Ziehen wieder zu – hier gleich zugeklappt lassen.
    const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
    attrib?.classList.add('maplibregl-compact')
    attrib?.classList.remove('maplibregl-compact-show')
    attrib?.removeAttribute('open')

    map.on('load', async () => {
      const namen = [
        'city', 'water', 'streets', 'labels', 'buildings',
        'stops', 'kultur', 'top', 'top-kultur', 'extreme',
      ]
      const [stadtGeo, wasser, strassen, marken, gebaeude, halte, kulturorte, topOev, topKultur, extreme] =
        await Promise.all(namen.map((n) => fetch(`${stadt.daten}/${n}.geojson`).then((r) => r.json())))

      map.addSource('stadt', { type: 'geojson', data: stadtGeo })
      map.addSource('wasser', { type: 'geojson', data: wasser })
      map.addSource('strassen', { type: 'geojson', data: strassen })
      map.addSource('marken', { type: 'geojson', data: marken })
      map.addSource('halte', { type: 'geojson', data: halte })
      map.addSource('kulturorte', { type: 'geojson', data: kulturorte })
      map.addSource('top-oev', { type: 'geojson', data: topOev })
      map.addSource('top-kultur', { type: 'geojson', data: topKultur })
      map.addSource('extreme', { type: 'geojson', data: extreme })
      map.addSource('gebaeude', { type: 'geojson', data: gebaeude, generateId: true })

      // Die Sortenwahl rechnet danach auf flachen Reihen weiter; das GeoJSON
      // selbst darf eingesammelt werden, MapLibre hält seine eigene Kopie.
      kulturdatenRef.current = leseKulturdaten(gebaeude, meta.kultur.arten.length)
      oevExtremeRef.current = extreme.features.filter(
        (f: PunkteFC['features'][number]) => f.properties.modus === 'oev'
      )
      // Für Suche und Deep-Links: der Index eines Hauses in dieser Liste ist
      // zugleich seine MapLibre-Feature-Id, `generateId` zählt in derselben
      // Reihenfolge hoch.
      haeuserRef.current = gebaeude.features
      suchIndexRef.current = bauIndex(
        gebaeude.features,
        kulturorte.features,
        halte.features,
        ARTEN_NAMEN,
        stadt.name
      )
      setDatenBereit(true)

      map.addLayer({
        id: 'stadt-flaeche',
        type: 'fill',
        source: 'stadt',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 1 },
      })
      map.addLayer({
        id: 'wasser-flaeche',
        type: 'fill',
        source: 'wasser',
        filter: ['==', ['get', 'kind'], 'area'],
        paint: { 'fill-color': '#dcdcd6' },
      })
      map.addLayer({
        id: 'wasser-linie',
        type: 'line',
        source: 'wasser',
        filter: ['==', ['get', 'kind'], 'line'],
        paint: {
          'line-color': '#dcdcd6',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 14],
        },
      })

      // Strassen bleiben bewusst abstrakt: zwei Strichstärken, kein Farbcode,
      // keine Fahrbahnbreiten. Sie liegen unter den Gebäuden, damit die Daten
      // im Vordergrund bleiben.
      map.addLayer({
        id: 'strassen-neben',
        type: 'line',
        source: 'strassen',
        filter: ['==', ['get', 'k'], 'neben'],
        paint: {
          'line-color': '#e3e3de',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 14, 0.8, 17, 3],
        },
      })
      map.addLayer({
        id: 'strassen-haupt',
        type: 'line',
        source: 'strassen',
        filter: ['==', ['get', 'k'], 'haupt'],
        paint: {
          'line-color': '#d5d5ce',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 14, 2, 17, 7],
        },
      })
      map.addLayer({
        id: 'stadt-rand',
        type: 'line',
        source: 'stadt',
        paint: { 'line-color': '#c9c9c4', 'line-width': 1 },
      })

      map.addLayer({
        id: 'gebaeude',
        type: 'fill',
        source: 'gebaeude',
        paint: { 'fill-color': farbAusdruck('oev', false, meta.buildings, null) as never },
      })
      // Bei starkem Zoom eine Hauchlinie, damit einzelne Häuser ablesbar bleiben
      map.addLayer({
        id: 'gebaeude-kante',
        type: 'line',
        source: 'gebaeude',
        paint: {
          'line-color': farbAusdruck('oev', false, meta.buildings, null) as never,
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0, 17, 0.6],
        },
      })

      // Beim Ziehen des Reglers wird bewusst weder `setFilter` noch
      // `visibility` angefasst: beides lässt MapLibre die Kacheln neu
      // zerlegen und ruckelt über 47'000 Gebäude. Die Ebene bleibt immer
      // sichtbar, ausgeblendet wird nur über das Alpha der Farbe selbst.
      map.addLayer({
        id: 'top-flaeche',
        type: 'fill',
        source: 'gebaeude',
        paint: { 'fill-color': 'rgba(0,0,0,0)' },
      })

      map.addLayer({
        id: 'gebaeude-aktiv',
        type: 'line',
        source: 'gebaeude',
        paint: {
          'line-color': AKZENT,
          'line-width': 2,
          'line-opacity': ['case', ['boolean', ['feature-state', 'aktiv'], false], 1, 0],
        },
      })

      map.addLayer({
        id: 'halte',
        type: 'circle',
        source: 'halte',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.4, 16, 4],
          'circle-color': AKZENT,
          'circle-opacity': 0.85,
        },
      })
      map.addLayer({
        id: 'kulturorte',
        type: 'circle',
        source: 'kulturorte',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 16, 4.5],
          'circle-color': AKZENT,
          'circle-opacity': 0.85,
        },
      })

      for (const m of ['oev', 'kultur'] as const) {
        map.addLayer({
          id: `top-punkt-${m}`,
          type: 'circle',
          source: MODI[m].punktQuelle,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5, 17, 8],
            'circle-color': AKZENT,
            'circle-opacity': 0,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.2,
            'circle-stroke-opacity': 0,
          },
        })
      }

      // Die beiden Enden der Rangliste sind immer eingezeichnet.
      map.addLayer({
        id: 'extreme-punkt',
        type: 'circle',
        source: 'extreme',
        filter: ['==', ['get', 'modus'], 'oev'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#18181b',
          'circle-stroke-color': '#18181b',
          'circle-stroke-width': 2,
        },
      })

      // Beschriftung zuletzt, damit sie über allem liegt. Drei Ebenen mit
      // eigener Mindestzoomstufe, sonst wächst die Karte im Zentrum zu.
      map.addLayer({
        id: 'strassennamen',
        type: 'symbol',
        source: 'strassen',
        minzoom: 15,
        filter: ['has', 'name'],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9, 18, 12],
          'text-max-angle': 30,
          'text-padding': 4,
        },
        paint: { 'text-color': '#6a6a66', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      })
      map.addLayer({
        id: 'marke-platz',
        type: 'symbol',
        source: 'marken',
        minzoom: 14,
        filter: ['==', ['get', 'art'], 'platz'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-padding': 6,
        },
        paint: { 'text-color': '#4a4a46', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      })
      map.addLayer({
        id: 'marke-bahnhof',
        type: 'symbol',
        source: 'marken',
        minzoom: 12.5,
        filter: ['==', ['get', 'art'], 'bahnhof'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-padding': 6,
        },
        paint: { 'text-color': '#4a4a46', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      })
      map.addLayer({
        id: 'marke-stadtteil',
        type: 'symbol',
        source: 'marken',
        minzoom: 11,
        filter: ['==', ['get', 'art'], 'stadtteil'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 14],
          'text-letter-spacing': 0.06,
          'text-padding': 10,
        },
        paint: { 'text-color': '#1c1c1a', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      })
      map.addLayer({
        id: 'extreme-text',
        type: 'symbol',
        source: 'extreme',
        filter: ['==', ['get', 'modus'], 'oev'],
        layout: {
          'text-field': ['get', 'beschriftung'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-offset': [0, -1.3],
          'text-anchor': 'bottom',
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#18181b', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      })

      setBereit(true)
      // Für die Browserkonsole: window.__karte.queryRenderedFeatures() etc.
      ;(window as unknown as { __karte?: MapLibreMap }).__karte = map
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [meta.buildings])

  // --- Hover und Klick
  useEffect(() => {
    const map = mapRef.current
    if (!map || !bereit) return

    // Schwebendes Label für den Kulturort unter dem Zeiger. Die Ebene ist nur in
    // der Kultur-Sicht mit Schalter «Kulturorte» sichtbar; sonst greift die
    // Abfrage ins Leere und das Label bleibt weg.
    const ortLabel = new Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'ort-label',
      offset: 10,
      focusAfterOpen: false,
    })

    const onMove = (e: MapMouseEvent) => {
      const ort = map.queryRenderedFeatures(e.point, { layers: ['kulturorte'] })[0]
      const name = ort?.properties?.name as string | undefined
      if (name) {
        ortLabel
          .setLngLat((ort.geometry as { coordinates: [number, number] }).coordinates)
          .setText(name)
          .addTo(map)
      } else {
        ortLabel.remove()
      }

      if (fixiert) return
      const f = map.queryRenderedFeatures(e.point, { layers: ['gebaeude'] })[0]
      map.getCanvas().style.cursor = f ? 'crosshair' : ''
      if (!f) {
        setzeAktiv(null)
        setTreffer(null)
        return
      }
      setzeAktiv(f.id as number)
      setTreffer(ausMerkmalen(f.properties, meta.kultur.arten.length))
    }

    const onClick = (e: MapMouseEvent) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ['gebaeude'] })[0]
      if (!f) {
        setFixiert(false)
        setzeAktiv(null)
        setTreffer(null)
        setBlatt(null)
        setzeUrl(null)
        return
      }
      waehleId(f.id as number, { fliegen: false })
    }

    const onLeave = () => ortLabel.remove()

    map.on('mousemove', onMove)
    map.on('click', onClick)
    map.on('mouseout', onLeave)
    return () => {
      map.off('mousemove', onMove)
      map.off('click', onClick)
      map.off('mouseout', onLeave)
      ortLabel.remove()
    }
  }, [bereit, fixiert, modus, nebenebene, meta.kultur.arten, setzeAktiv, waehleId])

  // --- Wird ein Haus festgehalten, ziehen Blatt und Adresszeile mit. Die
  // Hervorhebung springt nur dann auf den Rang des Hauses, wenn es aus der
  // Suche oder einem geteilten Link kommt – dann aber auch, wenn bloss die
  // Sortenwahl wechselt und der Rang sich dadurch verschiebt. Ein Klick auf
  // die Karte lässt den Regler stehen, reine Vorschau beim Überfahren auch.
  useEffect(() => {
    if (!fixiert || !treffer) return
    if (rangFolgt) setTopN(rangDesHauses(treffer))
    setBlatt('ort')
    const gewaehlt = sicht?.gewaehlt ?? meta.kultur.arten.map((_, i) => i)
    setzeUrl({
      haus: `${treffer.x},${treffer.y}`,
      modus,
      weg: modus === 'kultur' ? wegModus : undefined,
      arten:
        modus === 'kultur' && gewaehlt.length !== meta.kultur.arten.length
          ? gewaehlt.join(',')
          : undefined,
    })
  }, [fixiert, treffer, rangFolgt, modus, wegModus, sicht, rangDesHauses, meta.kultur.arten])

  // --- Enter richtet die Hervorhebung auf ein selbst angeklicktes Haus aus –
  // Tastenkürzel für den Knopf auf der Karteikarte. Nicht, während ein Feld
  // oder ein Bedienelement den Fokus hat (die Suche fängt Enter selbst ab).
  useEffect(() => {
    if (!fixiert || !treffer || rangFolgt) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      const z = document.activeElement as HTMLElement | null
      if (z?.matches('input, textarea, button, a, select, [contenteditable]')) return
      e.preventDefault()
      richteAus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fixiert, treffer, rangFolgt, richteAus])

  // --- Deep-Link beim Start: #haus=lon,lat&modus=oev|kultur&arten=0,2,5
  useEffect(() => {
    if (!bereit) return
    const p = paramsAusUrl()
    const modusParam = p.get('modus')
    const startModus: Modus = modusParam === 'kultur' ? 'kultur' : 'oev'
    if (modusParam) setModus(startModus)

    if (p.get('weg') === 'fuss') setWegModus('fuss')

    const artenParam = p.get('arten')
    if (artenParam) {
      const gewaehlt = new Set(artenParam.split(',').map(Number))
      const wahl = meta.kultur.arten.map((_, i) => gewaehlt.has(i))
      // Ein kaputter Link (?arten=99) darf die Karte nicht leer räumen.
      if (wahl.some(Boolean)) setArtenAn(wahl)
    }

    const hausParam = p.get('haus')
    if (!hausParam) return
    const [xs, ys] = hausParam.split(',')
    const x = Number(xs)
    const y = Number(ys)
    if (Number.isFinite(x) && Number.isFinite(y)) waehleXY(x, y, { rangFolgt: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bereit])

  // --- Suche
  const wennGesucht = (wert: string) => {
    setSuchWert(wert)
    setSuchTreffer(suchIndexRef.current ? suchen(suchIndexRef.current, wert) : [])
  }

  const onWaehlen = (e: Eintrag) => {
    if (e.art === 'adresse' && typeof e.haus === 'number') {
      waehleId(e.haus, { rangFolgt: true })
    } else {
      setFixiert(false)
      setzeAktiv(null)
      setTreffer(null)
      setBlatt(null)
      setzeUrl(null)
      fliegeZu([e.x, e.y], 17)
    }
  }

  // --- Teilen: Text plus Link auf angebunden.ch für das gewählte Haus.
  const teilNachricht = () => {
    if (!treffer) return null
    const gewaehlt = sicht?.gewaehlt ?? meta.kultur.arten.map((_, i) => i)
    const rang = rangDesHauses(treffer)
    // Dieselbe Lesart wie auf der Karteikarte: Anteil der Häuser mit schlechterem
    // Rang. Nach oben auf 99 gedeckelt, damit ein geteilter Satz nie "100 %" behauptet.
    const besserAls = Math.min(99, Math.round((1 - rang / meta.buildings) * 100))
    const orte = gewaehlt.reduce((n, a) => n + (treffer.weg[wegModus].kb[a] ?? 0), 0)

    // Der Link zeigt auf die Produktionsadresse, nicht auf localhost – eine
    // Vorschau von localhost bekommt beim Teilen ohnehin niemand. Der Zustand
    // steht im Fragment, damit die Koordinate keinen Server erreicht.
    const url = new URL(stadt.pfad, SITE_URL)
    const p = new URLSearchParams()
    p.set('haus', `${treffer.x},${treffer.y}`)
    p.set('modus', modus)
    if (modus === 'kultur') p.set('weg', wegModus)
    if (modus === 'kultur' && gewaehlt.length !== meta.kultur.arten.length)
      p.set('arten', gewaehlt.join(','))
    url.hash = p.toString()

    const ort = treffer.name ?? treffer.adresse ?? 'Mein Haus'
    const text =
      modus === 'kultur'
        ? `Von ${ort} ist mehr Kultur erreichbar als von ${besserAls}% der Häuser in ${stadt.name}. ${orte} Orte in ${meta.kultur.budgets[wegModus]} ${WEG[wegModus].minutenWort}. Wo liegt deins?`
        : `${ort} ist besser angebunden als ${besserAls}% der Häuser in ${stadt.name}. Im Schnitt ${fmt(treffer.m)} Minuten zu jeder Adresse der Stadt. Wo liegt deins?`

    return { text, url: url.toString() }
  }

  // Natives Teilen-Fenster, wo der Browser es kann (Handy, Safari, Edge). Sonst
  // öffnet die Karteikarte ihr eigenes kleines Menü (WhatsApp, Telegram, Mail).
  const teilenNativ = async () => {
    const n = teilNachricht()
    if (!n || typeof navigator.share !== 'function') return
    try {
      await navigator.share({ title: `angebunden · ${stadt.name}`, text: n.text, url: n.url })
    } catch {
      // Abgebrochene Teilen-Dialoge sind kein Fehler.
    }
  }

  const kopiereLink = async () => {
    const n = teilNachricht()
    if (!n) return
    try {
      await navigator.clipboard.writeText(`${n.text} ${n.url}`)
      setGeteilt(true)
      setTimeout(() => setGeteilt(false), 2000)
    } catch {
      // Kein Clipboard-Zugriff (z. B. kein https).
    }
  }

  // --- Kennzahl und Helligkeit
  useEffect(() => {
    const map = mapRef.current
    if (!map || !bereit) return
    const ausdruck = farbAusdruck(modus, dunkel, meta.buildings, sicht)
    map.setPaintProperty('gebaeude', 'fill-color', ausdruck as never)
    map.setPaintProperty('gebaeude-kante', 'line-color', ausdruck as never)
    // Die Farbe des aktiven Umrisses hängt davon ab, ob das Haus in der
    // Hervorhebung liegt – das weiss nur der gedrosselte Regler-Effekt.

    map.setPaintProperty('grund', 'background-color', dunkel ? '#0b0b0c' : '#f7f7f5')
    map.setPaintProperty('stadt-flaeche', 'fill-color', dunkel ? '#141416' : '#ffffff')
    map.setPaintProperty('wasser-flaeche', 'fill-color', dunkel ? '#08080a' : '#dcdcd6')
    map.setPaintProperty('wasser-linie', 'line-color', dunkel ? '#08080a' : '#dcdcd6')
    map.setPaintProperty('stadt-rand', 'line-color', dunkel ? '#2a2a2e' : '#c9c9c4')
    map.setPaintProperty('strassen-neben', 'line-color', dunkel ? '#232327' : '#e3e3de')
    map.setPaintProperty('strassen-haupt', 'line-color', dunkel ? '#303036' : '#d5d5ce')

    const kontur = dunkel ? '#0e0e10' : '#ffffff'
    for (const ebene of ['strassennamen', 'marke-platz', 'marke-bahnhof']) {
      map.setPaintProperty(ebene, 'text-color', dunkel ? '#a6a6a4' : '#6a6a66')
      map.setPaintProperty(ebene, 'text-halo-color', kontur)
    }
    map.setPaintProperty('marke-platz', 'text-color', dunkel ? '#e8e8e6' : '#4a4a46')
    map.setPaintProperty('marke-bahnhof', 'text-color', dunkel ? '#e8e8e6' : '#4a4a46')
    map.setPaintProperty('marke-stadtteil', 'text-color', dunkel ? '#ffffff' : '#1c1c1a')
    map.setPaintProperty('marke-stadtteil', 'text-halo-color', kontur)
    map.setPaintProperty('extreme-text', 'text-halo-color', kontur)

    // Beide Extrempunkte und ihre Beschriftungen bleiben schwarz.
    const zeigerFarbe = '#18181b'
    map.setPaintProperty('extreme-text', 'text-color', zeigerFarbe)
    map.setPaintProperty('extreme-punkt', 'circle-stroke-color', zeigerFarbe)
    map.setPaintProperty('extreme-punkt', 'circle-color', zeigerFarbe)

    // Die Extreme gehören zur aktiven Kennzahl.
    const extremFilter =
      ['==', ['get', 'modus'], modus]
    map.setFilter('extreme-punkt', extremFilter as never)
    map.setFilter('extreme-text', extremFilter as never)
  }, [modus, dunkel, bereit, meta.buildings, sicht, rangHighlight])

  // --- Nebenebene (Haltestellen bzw. Kulturorte)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !bereit) return
    for (const m of ['oev', 'kultur'] as const) {
      map.setLayoutProperty(
        MODI[m].schalterEbene,
        'visibility',
        nebenebene && modus === m ? 'visible' : 'none'
      )
    }
  }, [nebenebene, modus, bereit])

  // --- Was an der Sortenwahl hängt: Punktebene, Extreme, Kulturorte
  useEffect(() => {
    const map = mapRef.current
    if (!map || !bereit || !sicht) return

    // Die Bestenliste steht nicht mehr fest, sobald Sorten wegfallen – sie wird
    // hier neu gezogen. 10'000 Punkte umzuhängen kostet weniger als eine
    // Zehntelsekunde, die 47'000 Gebäudeflächen bleiben unangetastet.
    const punkte = map.getSource('top-kultur')
    if (punkte && 'setData' in punkte)
      (punkte as { setData: (d: unknown) => void }).setData(sicht.besteAls(TOP_PUNKTE))

    const extremPunkte = ([sicht.bestes, sicht.schlechtestes] as const).map((e, i) => ({
      type: 'Feature' as const,
      properties: {
        modus: 'kultur',
        art: i === 0 ? 'best' : 'worst',
        beschriftung: `Rang ${nf(e.rang)} · ${e.orte} ${e.orte === 1 ? 'Ort' : 'Orte'}`,
        ...e,
      },
      geometry: { type: 'Point' as const, coordinates: [e.lon, e.lat] },
    }))
    const extreme = map.getSource('extreme')
    if (extreme && 'setData' in extreme)
      (extreme as { setData: (d: unknown) => void }).setData({
        type: 'FeatureCollection',
        features: [...oevExtremeRef.current, ...extremPunkte],
      })

    // Die Punktebene zeigt nur, was auch gezählt wird.
    map.setFilter('kulturorte', [
      'in',
      ['get', 'art'],
      ['literal', sicht.gewaehlt.map((a) => meta.kultur.arten[a])],
    ])
  }, [sicht, bereit, meta.kultur.arten])

  /**
   * Die Hervorhebung wird auf einen Bildaufbau pro Frame gedrosselt. Ohne das
   * staut sich beim Ziehen des Reglers eine Aktualisierung pro Zwischenwert –
   * die Beschriftung läuft dann voraus und die Karte hinterher.
   */
  const zielRef = useRef({ n: 0, modus: 'oev' as Modus, highlight: false })
  const geplantRef = useRef(false)
  const [stossAn, setStossAn] = useState(0)

  useEffect(() => {
    const map = mapRef.current
    if (!map || !bereit) return
    zielRef.current = { n: topN, modus, highlight: rangHighlight }
    if (geplantRef.current) return
    geplantRef.current = true

    requestAnimationFrame(() => {
      geplantRef.current = false
      const { n, modus: m, highlight } = zielRef.current
      // Ohne gewählte Sorte gibt es keine Rangfolge, die man hervorheben könnte.
      const sichtbar = highlight && n > 0 && (m === 'oev' || (sicht !== null && sicht.gewaehlt.length > 0))
      // Punkte nur für die vordersten paar Ränge, wo einzelne Häuser über die
      // ganze Stadt verstreut untergehen. Darüber trägt die Fläche allein.
      const punkteSichtbar = sichtbar && n <= TOP_PUNKTE_ANZEIGE

      // Ausblenden heisst hier nur: Deckkraft auf 0. `visibility` toggeln
      // liesse MapLibre die Kacheln neu zerlegen, was über 47'000 Gebäuden
      // beim Ziehen ruckelt. Mit betroffen ist die gerade inaktive Kennzahl –
      // ihre Punkte standen vielleicht noch offen, als der Modus wechselte.
      for (const kandidat of ['oev', 'kultur'] as const) {
        if (kandidat === m && punkteSichtbar) continue
        map.setPaintProperty(`top-punkt-${kandidat}`, 'circle-opacity', 0)
        map.setPaintProperty(`top-punkt-${kandidat}`, 'circle-stroke-opacity', 0)
      }

      if (!sichtbar) {
        map.setPaintProperty('top-flaeche', 'fill-color', 'rgba(0,0,0,0)' as never)
        // Ohne Hervorhebung liegt jedes Haus auf der Graustufen-Karte – blau.
        map.setPaintProperty('gebaeude-aktiv', 'line-color', AKZENT)
      } else {
        // Die Fläche kennt bei der Kultur keinen Rang – dort steht der Indexwert
        // in der Kachel, und die Grenze des Regler ist der Wert des n-ten Hauses.
        const kulturSicht = m === 'kultur' ? sicht : null
        const innerhalb = kulturSicht
          ? ['>=', kulturSicht.ausdruck, kulturSicht.schwelle(n)]
          : ['<=', ['get', 'r'], n]
        const farbeFlaeche =
          n <= 1
            ? RANG_RAMPE[0]
            : kulturSicht
              ? [
                  'interpolate',
                  ['linear'],
                  kulturSicht.ausdruck,
                  ...rangStufen(kulturSicht.absteigend, RANG_RAMPE, n),
                ]
              : [
                  'interpolate',
                  ['linear'],
                  ['get', 'r'],
                  ...RANG_RAMPE.flatMap((c, i) => [1 + ((n - 1) * i) / (RANG_RAMPE.length - 1), c]),
                ]

        // Farbe und Grenze in einem Ausdruck statt in zwei getrennten
        // Eigenschaften: erspart einen ganzen Neuaufbau des Attributpuffers
        // über 47'000 Gebäude bei jedem Bildaufbau.
        map.setPaintProperty('top-flaeche', 'fill-color', [
          'case', innerhalb, farbeFlaeche, 'rgba(0,0,0,0)',
        ] as never)

        // Der Umriss des gewählten Hauses ist über der roten Hervorhebung schwarz.
        map.setPaintProperty('gebaeude-aktiv', 'line-color', [
          'case', innerhalb, '#18181b', AKZENT,
        ] as never)

        if (punkteSichtbar) {
          const farbe =
            n <= 1
              ? RANG_RAMPE[0]
              : [
                  'interpolate',
                  ['linear'],
                  ['get', 'r'],
                  ...RANG_RAMPE.flatMap((c, i) => [1 + ((n - 1) * i) / (RANG_RAMPE.length - 1), c]),
                ]
          map.setPaintProperty(`top-punkt-${m}`, 'circle-color', farbe as never)

          // Je weiter der Regler offen ist, desto kleiner und blasser die Punkte,
          // sonst wird die Innenstadt zu einem einzigen Fleck.
          const gedraengt = Math.min(1, Math.log10(Math.max(n, 1)) / 4)
          map.setPaintProperty(`top-punkt-${m}`, 'circle-opacity', [
            'case', ['<=', ['get', 'r'], n], 0.9 - 0.25 * gedraengt, 0,
          ] as never)
          map.setPaintProperty(`top-punkt-${m}`, 'circle-stroke-opacity', [
            'case', ['<=', ['get', 'r'], n], 1, 0,
          ] as never)

          // `zoom` muss bei MapLibre der Eingang des äussersten `interpolate` sein;
          // die Rang-Abhängigkeit gehört deshalb in die Ausgabewerte, nicht darum herum.
          const nachRang = [
            '*',
            ['interpolate', ['linear'], ['get', 'r'], 1, 1, Math.max(n, 2), 0.45],
            1 - 0.45 * gedraengt,
          ]
          map.setPaintProperty(`top-punkt-${m}`, 'circle-radius', [
            'interpolate',
            ['linear'],
            ['zoom'],
            11, ['*', 3.2, nachRang],
            14, ['*', 5, nachRang],
            17, ['*', 8, nachRang],
          ] as never)
          map.setPaintProperty(`top-punkt-${m}`, 'circle-stroke-width', 1.2)
        }
      }

      // Kam während des Bildaufbaus ein neuer Wert, gleich noch einmal
      if (
        zielRef.current.n !== n ||
        zielRef.current.modus !== m ||
        zielRef.current.highlight !== highlight
      )
        setStossAn((v) => v + 1)
    })
  }, [topN, rangHighlight, modus, bereit, stossAn, sicht, dunkel])

  // Wird die Hervorhebung ausgeschaltet, muss der rote Belag sofort weg – ohne
  // auf den gedrosselten Effekt oben zu warten, der beim schnellen Umschalten
  // schon einen Frame geplant haben kann und dann nichts mehr nachzieht.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !bereit || rangHighlight) return
    map.setPaintProperty('top-flaeche', 'fill-color', 'rgba(0,0,0,0)' as never)
    for (const m of ['oev', 'kultur'] as const) {
      map.setPaintProperty(`top-punkt-${m}`, 'circle-opacity', 0)
      map.setPaintProperty(`top-punkt-${m}`, 'circle-stroke-opacity', 0)
    }
    map.setPaintProperty('gebaeude-aktiv', 'line-color', AKZENT)
  }, [rangHighlight, bereit])

  // --- MapLibre-Kontrollen weichen auf Mobile der Rang-Leiste aus. Auf dem
  // Desktop stehen die Zoomtasten direkt über dem Feedback-Button.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const ausblenden = mobil && blatt === 'ort'
    const rangLeiste = mobil && blatt === null ? 88 : 0
    const zoom = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-bottom-right')
    if (zoom) {
      zoom.style.top = ''
      zoom.style.bottom = mobil ? '' : '4.25rem'
      zoom.style.transform = mobil && (deckung || rangLeiste) ? `translateY(-${deckung || rangLeiste}px)` : ''
      zoom.style.visibility = ausblenden ? 'hidden' : ''
      zoom.style.pointerEvents = ausblenden ? 'none' : ''
    }
    const attribution = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-bottom-left')
    if (attribution) {
      attribution.style.transform = mobil && (deckung || rangLeiste) ? `translateY(-${deckung || rangLeiste}px)` : ''
      attribution.style.visibility = ausblenden ? 'hidden' : ''
      attribution.style.pointerEvents = ausblenden ? 'none' : ''
    }
  }, [deckung, mobil, blatt])

  const ui = dunkel ? uiDunkel : uiHell

  const schliesseBlatt = () => {
    setBlatt(null)
    if (fixiert) {
      setFixiert(false)
      setzeAktiv(null)
      setTreffer(null)
      setzeUrl(null)
    }
  }

  return (
    <div
      className={`relative h-full w-full overflow-hidden ${dunkel ? 'dunkel' : ''}`}
      style={{ background: ui.bg }}
    >
      <div ref={containerRef} className="h-full w-full" />

      {!mobil && (
        <a
          href={`mailto:moritz.lauper@hispeed.ch?subject=${encodeURIComponent('Wunsch für angebunden')}&body=${encodeURIComponent('Mein Wunsch:\n\n')}`}
          aria-label="Wunsch senden"
          title="Wunsch senden"
          className="absolute bottom-3 right-3 z-10 grid h-10 w-10 place-items-center rounded-full border backdrop-blur-md transition-opacity hover:opacity-70"
          style={{ background: ui.panel, borderColor: ui.border, color: ui.fg, boxShadow: ui.schatten }}
        >
          <WunschSymbol />
        </a>
      )}

      {!bereit && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-[5] flex justify-center">
          <div
            className="rounded-full border px-4 py-2 text-[12px] backdrop-blur-md"
            style={{ background: ui.panel, borderColor: ui.border, color: ui.muted, boxShadow: ui.schatten }}
          >
            {nf(meta.buildings)} Häuser werden gezeichnet …
          </div>
        </div>
      )}

      {/* Kopfzeile: Suche und Modus-Chips, fest verankert wie bei Google Maps. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 px-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="mx-auto w-full max-w-[26rem]">
          <Suchleiste
            ui={ui}
            wert={suchWert}
            setWert={wennGesucht}
            treffer={suchTreffer}
            offen={sucheOffen}
            setOffen={setSucheOffen}
            onWaehlen={onWaehlen}
            rechts={
              mobil ? (
                <button
                  onClick={() => setBlatt(blatt === 'einstellungen' ? null : 'einstellungen')}
                  aria-label="Anzeige einstellen"
                  aria-pressed={blatt === 'einstellungen'}
                  className="pointer-events-auto grid h-12 w-12 shrink-0 place-items-center rounded-full border backdrop-blur-md"
                  style={
                    blatt === 'einstellungen'
                      ? { background: AKZENT, borderColor: AKZENT, color: '#fff' }
                      : { background: ui.panel, borderColor: ui.border, color: ui.fg, boxShadow: ui.schatten }
                  }
                >
                  <ReglerSymbol />
                </button>
              ) : undefined
            }
          />
        </div>

        <div className="pointer-events-auto mx-auto flex w-full max-w-[26rem] justify-center">
          <div
            className="flex gap-1 rounded-full border p-1 backdrop-blur-md"
            style={{ background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten }}
          >
            {(['oev', 'kultur'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModus(m)}
                className="rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors"
                style={modus === m ? { background: ui.aktiv, color: ui.fg } : { color: ui.muted }}
              >
                {MODI[m].kurz}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mobil && blatt === null && (
        <MobileRangLeiste
          ui={ui}
          modus={modus}
          topN={topN}
          setTopN={setTopN}
          aktiv={rangHighlight}
          setAktiv={setRangHighlight}
          gesamt={meta.buildings}
        />
      )}

      {mobil ? (
        <Blatt ui={ui} offen={blatt !== null} onSchliessen={schliesseBlatt} onHoehe={setDeckung}>
          {blatt === 'einstellungen' ? (
            <Panel
              meta={meta}
              stadt={stadt}
              ui={ui}
              modus={modus}
              nebenebene={nebenebene}
              setNebenebene={setNebenebene}
              topN={topN}
              setTopN={setTopN}
              rangHighlight={rangHighlight}
              setRangHighlight={setRangHighlight}
              wegModus={wegModus}
              setWegModus={setWegModus}
              mobil={mobil}
              waehleXY={waehleXY}
              sicht={sicht}
              artenAn={artenAn}
              setArtenAn={setArtenAn}
            />
          ) : blatt === 'ort' && treffer ? (
            <Karteikarte
              treffer={treffer}
              meta={meta}
              ui={ui}
              modus={modus}
              wegModus={wegModus}
              sicht={sicht}
              fixiert={fixiert}
              geteilt={geteilt}
              rangFolgt={rangFolgt}
              onAusrichten={richteAus}
              mobil={mobil}
              nachricht={teilNachricht()}
              onTeilenNativ={teilenNativ}
              onKopieren={kopiereLink}
              onClose={schliesseBlatt}
            />
          ) : (
            <div className="py-8" />
          )}
        </Blatt>
      ) : (
        <>
          <Tafel ui={ui} className="left-4 top-[5.75rem] w-[19.5rem] max-w-[calc(100vw-2rem)]">
            <Panel
              meta={meta}
              stadt={stadt}
              ui={ui}
              modus={modus}
              nebenebene={nebenebene}
              setNebenebene={setNebenebene}
              topN={topN}
              setTopN={setTopN}
              rangHighlight={rangHighlight}
              setRangHighlight={setRangHighlight}
              wegModus={wegModus}
              setWegModus={setWegModus}
              mobil={mobil}
              waehleXY={waehleXY}
              sicht={sicht}
              artenAn={artenAn}
              setArtenAn={setArtenAn}
            />
          </Tafel>

          {treffer && (
            <Tafel ui={ui} className="right-4 top-[5.75rem] w-64">
              <Karteikarte
                treffer={treffer}
                meta={meta}
                ui={ui}
                modus={modus}
                wegModus={wegModus}
                sicht={sicht}
                fixiert={fixiert}
                geteilt={geteilt}
                rangFolgt={rangFolgt}
                onAusrichten={richteAus}
                mobil={mobil}
                nachricht={teilNachricht()}
                onTeilenNativ={teilenNativ}
                onKopieren={kopiereLink}
                onClose={() => {
                  setFixiert(false)
                  setTreffer(null)
                }}
              />
            </Tafel>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Farbe

/**
 * Eingefärbt wird nach Rang, nicht nach Wert: der Rang ist gleichverteilt und
 * spreizt die Unterschiede über die ganze Stadt. Bei den Minuten liegen zwei
 * Drittel aller Häuser zwischen 26 und 34 – die Karte wäre fast einfarbig.
 */
function farbAusdruck(modus: Modus, dunkel: boolean, gesamt: number, sicht: Sicht | null) {
  const rampe = dunkel ? RAMPE_DUNKEL : RAMPE_HELL
  if (modus === 'oev')
    return [
      'interpolate',
      ['linear'],
      ['/', ['get', 'r'], gesamt],
      ...rampe.flatMap((c, i) => [i / (rampe.length - 1), c]),
    ]
  // Bei der Kultur hängt der Rang an der Sortenwahl und steht deshalb nicht in
  // der Kachel. Gefärbt wird nach dem Indexwert, die Stufen kommen aber aus
  // den Quantilen – das Bild bleibt dasselbe wie beim Färben nach Rang.
  if (!sicht) return rampe[rampe.length - 1]
  if (sicht.gewaehlt.length === 0) return rampe[rampe.length - 1]
  return ['interpolate', ['linear'], sicht.ausdruck, ...quantilStufen(sicht.absteigend, rampe)]
}

const uiHell = {
  bg: '#f7f7f5',
  fg: '#18181b',
  panel: 'rgba(255,255,255,0.82)',
  border: 'rgba(24,24,27,0.07)',
  muted: '#71717a',
  weich: 'rgba(24,24,27,0.045)',
  aktiv: '#ffffff',
  ring: 'rgba(37,99,235,0.35)',
  schatten:
    '0 1px 1px rgba(24,24,27,0.03), 0 10px 30px -12px rgba(24,24,27,0.22)',
  rampe: RAMPE_HELL,
}
const uiDunkel = {
  bg: '#0b0b0c',
  fg: '#f4f4f5',
  panel: 'rgba(24,24,27,0.82)',
  border: 'rgba(255,255,255,0.08)',
  muted: '#a1a1aa',
  weich: 'rgba(255,255,255,0.06)',
  aktiv: 'rgba(255,255,255,0.14)',
  ring: 'rgba(96,165,250,0.4)',
  schatten: '0 1px 1px rgba(0,0,0,0.3), 0 10px 30px -12px rgba(0,0,0,0.7)',
  rampe: RAMPE_DUNKEL,
}
type Ui = typeof uiHell

/**
 * Der Zustand steht im URL-Fragment (`#haus=…`), nicht in der Query. Fragmente
 * schickt der Browser nie an einen Server, so taucht die angeschaute Adresse in
 * keinem Zugriffslog auf. Ältere Links mit `?haus=…` werden beim Lesen noch
 * akzeptiert und beim ersten Schreiben auf das Fragment umgestellt.
 */
function paramsAusUrl(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, '')
  return new URLSearchParams(hash || window.location.search)
}

/** Schreibt die Auswahl ins Fragment, ohne Verlaufseintrag – ein Klick, kein Zurück-Spam. */
function setzeUrl(teile: { haus: string; modus: Modus; weg?: WegModus; arten?: string } | null) {
  const basis = window.location.pathname // Query und Fragment fallen dabei weg
  if (!teile) {
    window.history.replaceState(null, '', basis)
    return
  }
  const p = new URLSearchParams()
  p.set('haus', teile.haus)
  p.set('modus', teile.modus)
  if (teile.weg) p.set('weg', teile.weg)
  if (teile.arten) p.set('arten', teile.arten)
  window.history.replaceState(null, '', `${basis}#${p}`)
}

/** Das Glas-Gehäuse, das Bedienfeld und Karteikarte auf breiten Schirmen umgibt. */
function Tafel({ ui, className, children }: { ui: Ui; className: string; children: React.ReactNode }) {
  return (
    <div className={`pointer-events-none absolute z-10 ${className}`}>
      <div
        className="pointer-events-auto max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain rounded-2xl border p-4 text-[13px] backdrop-blur-md"
        style={{ background: ui.panel, borderColor: ui.border, color: ui.fg, boxShadow: ui.schatten }}
      >
        {children}
      </div>
    </div>
  )
}

function ReglerSymbol() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" strokeLinecap="round" />
      <circle cx="13" cy="7" r="2.3" />
      <circle cx="7" cy="17" r="2.3" />
    </svg>
  )
}

function WunschSymbol() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M20 14a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1-1-2.7V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10h8M8 14h5" strokeLinecap="round" />
    </svg>
  )
}

function TeilenSymbol() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="18" cy="5" r="2.8" />
      <circle cx="6" cy="12" r="2.8" />
      <circle cx="18" cy="19" r="2.8" />
      <path d="M8.5 10.5 15.5 6.5M8.5 13.5l7 4" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------- Bedienfeld

function Panel({
  meta, stadt, ui, modus, nebenebene, setNebenebene, topN, setTopN, waehleXY,
  rangHighlight, setRangHighlight, wegModus, setWegModus, mobil, sicht, artenAn, setArtenAn,
}: {
  meta: Meta
  stadt: Stadt
  ui: Ui
  modus: Modus
  nebenebene: boolean
  setNebenebene: (h: boolean) => void
  topN: number
  setTopN: (n: number) => void
  rangHighlight: boolean
  setRangHighlight: (sichtbar: boolean) => void
  wegModus: WegModus
  setWegModus: (weg: WegModus) => void
  mobil: boolean
  waehleXY: (lon: number, lat: number) => void
  sicht: Sicht | null
  artenAn: boolean[]
  setArtenAn: (a: boolean[]) => void
}) {
  const [offen, setOffen] = useState(false)
  const kultur = modus === 'kultur'
  // Solange die Gebäude noch laden, stehen die Werte aus der Datei da; danach
  // rechnet die Sicht sie für die gewählten Sorten neu.
  const extreme = kultur ? (sicht ?? meta.kultur.extreme) : meta.extreme
  const verteilung = kultur ? (sicht?.verteilung ?? meta.kultur.verteilung) : null
  const orte = sicht?.orte ?? meta.kultur.orte
  const leer = kultur && sicht !== null && sicht.gewaehlt.length === 0

  return (
    <div style={{ color: ui.fg }}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight leading-tight">
          {MODI[modus].titel} {stadt.name}
        </h2>
        <p className="mt-1.5 leading-snug" style={{ color: ui.muted }}>
          {kultur ? (
            leer ? (
              <>Keine Sorte gewählt – es gibt nichts zu zählen.</>
            ) : (
              <>
                Für jedes der {nf(meta.buildings)} Häuser: Wie viele der {nf(orte)} Orte der
                gewählten Sorten in {meta.kultur.budgets[wegModus]} {WEG[wegModus].minutenWort} liegen.
              </>
            )
          ) : (
            <>
              Für jedes der {nf(meta.buildings)} Häuser: Wie lange man mit Tram, Bus und S-Bahn im
              Schnitt zu einer beliebigen Adresse der Stadt braucht, Türe zu Türe.
            </>
          )}
        </p>
      </div>

      <div className="mt-3">
        <div
          className="h-2.5 w-full rounded-sm"
          style={{ background: `linear-gradient(to right, ${ui.rampe.join(',')})` }}
        />
        <div className="mt-1 flex justify-between text-[11px]" style={{ color: ui.muted }}>
          <span>
            {kultur ? `${verteilung!.max} Orte` : `${fmt(meta.minutes.best)} min`}
          </span>
          <span>
            Median {kultur ? `${verteilung!.median} Orte` : `${fmt(meta.minutes.median)} min`}
          </span>
          <span>
            {kultur ? `${verteilung!.min} Orte` : `${fmt(meta.minutes.worst)} min`}
          </span>
        </div>
      </div>

      {kultur && (
        <SortenWahl
          ui={ui}
          arten={meta.kultur.arten}
          proArt={meta.kultur.proArt}
          an={artenAn}
          setAn={setArtenAn}
        />
      )}

      <RangRegler
        ui={ui}
        topN={topN}
        setTopN={setTopN}
        aktiv={rangHighlight}
        setAktiv={setRangHighlight}
        gesamt={meta.buildings}
      />

      <div className="flex items-center gap-4 border-t py-2.5" style={{ borderColor: ui.border }}>
        <Schalter ui={ui} checked={nebenebene} onChange={setNebenebene} label={MODI[modus].schalter} />
        {kultur && (
          <div className="flex rounded-full border p-0.5 text-[11px]" style={{ borderColor: ui.border }}>
            {(['velo', 'fuss'] as const).map((weg) => (
              <button
                key={weg}
                onClick={() => setWegModus(weg)}
                aria-pressed={wegModus === weg}
                className="rounded-full px-2 py-1"
                style={wegModus === weg ? { background: ui.aktiv, color: ui.fg } : { color: ui.muted }}
              >
                {WEG[weg].kurz}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t py-2.5" style={{ borderColor: ui.border }}>
        <Extrempunkt
          ui={ui}
          k="Rang 1"
          e={extreme.bestes}
          wert={kultur ? `${extreme.bestes.orte} Orte` : `${fmt(extreme.bestes.minuten)} min`}
          onWaehlen={() => waehleXY(extreme.bestes.lon, extreme.bestes.lat)}
        />
        <Extrempunkt
          ui={ui}
          k={`Rang ${nf(extreme.schlechtestes.rang)}`}
          e={extreme.schlechtestes}
          wert={kultur ? `${extreme.schlechtestes.orte} Orte` : `${fmt(extreme.schlechtestes.minuten)} min`}
          onWaehlen={() => waehleXY(extreme.schlechtestes.lon, extreme.schlechtestes.lat)}
        />
      </div>

      <button
        onClick={() => setOffen(!offen)}
        className="zeile w-full border-t py-2 text-left text-[12px] rounded-b-2xl"
        style={{ borderColor: ui.border, color: ui.muted, '--weich': ui.weich } as React.CSSProperties}
      >
        {offen ? '– ' : '+ '}Wie das gerechnet ist
      </button>

      {offen && (
        <div
          className="border-t pb-1 pt-3 text-[12px] leading-relaxed"
          style={{ borderColor: ui.border, color: ui.muted }}
        >
          {kultur ? (
            <>
              <p>
                Gezählt wird, was von einem Haus aus in {meta.kultur.budgets[wegModus]}{' '}
                {WEG[wegModus].minutenWort} liegt. Die Orte stammen aus OpenStreetMap. Für Rang und
                Farbe zählt jede Sorte mit der Wurzel ihres abklingenden Index: Das erste Museum
                zählt stärker als das zwölfte.
              </p>
              <p className="mt-2">
                Welche Sorten zählen, entscheidest du oben. Restaurants und öffentliche Kunst stellen
                mit {meta.kultur.proArt[meta.kultur.arten.indexOf('restaurant')]} und{' '}
                {meta.kultur.proArt[meta.kultur.arten.indexOf('kunst')]} Einträgen die grössten
                Gruppen und ziehen die Karte in Richtung Innenstadt. Wähl sie ab, und die
                Quartierzentren treten hervor.
              </p>
              <p className="mt-2">
                Die Reihenfolge richtet sich nicht nach der blossen Anzahl, sondern nach einem mit
                der Gehzeit abklingenden Index. Sonst hätten tausende Häuser denselben Wert.
              </p>
            </>
          ) : (
            <>
              <p>
                Die Stadt ist in {meta.cells} Zielzellen zerlegt, jede gewichtet mit der Zahl der
                Adressen darin. Von jedem Haus aus wird die Reisezeit in jede Zelle gerechnet und
                über alle Zellen gemittelt. Nicht summiert. Der Wert bleibt eine lesbare
                Zeitangabe.
              </p>
              <p className="mt-2">
                Eine Reise umfasst Fussweg zur Haltestelle, Wartezeit, Fahrt, Umsteigen und Fussweg
                zum Ziel. Gesucht wird zu {meta.departures} Abfahrtszeiten zwischen {meta.window}{' '}
                Uhr am {formatDatum(meta.serviceDate)} und über alle gemittelt, damit die Taktdichte
                einfliesst. Fusswege rechnen die Steigung mit.
              </p>
            </>
          )}
          <p className="mt-2">
            Kein Konto, keine Cookies. Welches Haus du dir ansiehst, bleibt im Browser. Gezählt
            wird nur, wie viele Leute pro Tag da sind, cookielos über GoatCounter.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
            <Kennzahl ui={ui} k="Häuser" v={nf(meta.buildings)} />
            <Kennzahl ui={ui} k={kultur ? 'Kulturorte' : 'Adressen'} v={nf(kultur ? orte : meta.addresses)} />
            <Kennzahl ui={ui} k={kultur ? 'Median' : 'Zielzellen'} v={kultur ? `${verteilung!.median} Orte` : nf(meta.cells)} />
            <Kennzahl ui={ui} k="Fahrten/Tag" v={nf(meta.trips)} />
          </dl>
          <Link
            href="/methode"
            className="mt-3 block underline underline-offset-2"
            style={{ color: ui.muted }}
          >
            Ausführlich: Formeln, Parameter, Datenquellen
          </Link>
        </div>
      )}

      <StadtWechsel ui={ui} stadt={stadt} modus={modus} />

      {mobil && (
        <a
          href={`mailto:moritz.lauper@hispeed.ch?subject=${encodeURIComponent('Wunsch für angebunden')}&body=${encodeURIComponent('Mein Wunsch:\n\n')}`}
          className="mt-3 block text-[11px] underline underline-offset-2 transition-opacity hover:opacity-70"
          style={{ color: ui.muted }}
        >
          Wunsch senden
        </a>
      )}
    </div>
  )
}

/**
 * Der Sprung zwischen den Städten, unten links. Bewusst unscheinbar: auf dem
 * Handy liegt das ganze Bedienfeld hinter dem Einstellungen-Blatt, hier taucht
 * der Wechsel also erst auf, wenn man ihn ohnehin sucht. Rechts daneben die
 * Wortmarke, die auf die Methodenseite führt. Dort steht auch, wer das gemacht hat.
 *
 * Der gewählte Tab reist mit: wer von der Kultur aus die Stadt wechselt, landet
 * drüben wieder in der Kultur und nicht beim ÖV. `?modus=kultur` liest der
 * Deep-Link-Effekt der neuen Seite beim Start aus.
 */
function StadtWechsel({ ui, stadt, modus }: { ui: Ui; stadt: Stadt; modus: Modus }) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-t pt-2.5 text-[11px]"
      style={{ borderColor: ui.border, color: ui.muted }}
    >
      <div className="flex items-center gap-2">
        <span>Stadt</span>
        <div className="flex items-center gap-1.5">
          {STADT_LISTE.map((s, i) => (
            <span key={s.schluessel} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden style={{ opacity: 0.4 }}>
                  ·
                </span>
              )}
              {s.schluessel === stadt.schluessel ? (
                <span className="font-semibold" style={{ color: ui.fg }}>
                  {s.name}
                </span>
              ) : (
                <Link
                  href={modus === 'kultur' ? { pathname: s.pfad, query: { modus: 'kultur' } } : s.pfad}
                  className="underline underline-offset-2"
                >
                  {s.name}
                </Link>
              )}
            </span>
          ))}
        </div>
      </div>
      <Link
        href="/methode"
        aria-label="angebunden · Wie das gerechnet ist"
        className="inline-flex shrink-0 transition-opacity hover:opacity-70"
      >
        <Wortmarke size={13} style={{ color: '#18181b' }} />
      </Link>
    </div>
  )
}

/**
 * Regler für die Hervorhebung. Linear wären auf einem 270 Pixel breiten Regler
 * schon 174 Ränge pro Pixel, die vorderen Ränge also unerreichbar. Logarithmisch
 * lag dafür die Hälfte des Wegs bereits bei Top 500 – der Füllstand versprach
 * viel mehr eingefärbte Karte, als tatsächlich zu sehen war. Die Kubikwurzel
 * liegt dazwischen: Rang 1 bleibt ein paar Pixel breit, halb offen sind gut
 * 12 Prozent aller Häuser, ganz offen alle.
 */
function RangRegler({
  ui, topN, setTopN, aktiv, setAktiv, gesamt,
}: {
  ui: Ui
  topN: number
  setTopN: (n: number) => void
  aktiv: boolean
  setAktiv: (aktiv: boolean) => void
  gesamt: number
}) {
  const SCHRITTE = 4000
  const KURVE = 3
  const zuRang = (v: number) =>
    v <= 0 ? 0 : Math.min(gesamt, Math.max(1, Math.round(gesamt * (v / SCHRITTE) ** KURVE)))
  const zuRegler = (n: number) =>
    n <= 0 ? 0 : Math.round(SCHRITTE * (Math.min(n, gesamt) / gesamt) ** (1 / KURVE))

  const position = zuRegler(topN)
  const prozent = (position / SCHRITTE) * 100

  return (
    <div className="mt-3 border-t pb-3 pt-2.5" style={{ borderColor: ui.border }}>
      <div className="mb-2 flex items-baseline justify-between text-[11px]">
        <span style={{ color: ui.muted }}>Bestplatzierte hervorheben</span>
        <Schalter ui={ui} checked={aktiv} onChange={setAktiv} label="Rang-Highlight" />
      </div>

      <input
        type="range"
        min={0}
        max={SCHRITTE}
        step={1}
        value={position}
        onChange={(e) => setTopN(zuRang(Number(e.target.value)))}
        disabled={!aktiv}
        aria-label="Anzahl hervorgehobener Ränge"
        className={`regler ${aktiv ? '' : 'cursor-not-allowed opacity-40'}`}
        style={
          {
            '--fuellung': `linear-gradient(to right, ${RANG_RAMPE[0]} ${prozent}%, ${ui.weich} ${prozent}%)`,
            '--knopf': ui.aktiv,
            '--ring': ui.ring,
          } as React.CSSProperties
        }
      />

      {aktiv && topN > 0 && (
        <div className="mt-2.5 flex items-center gap-2">
          <div
            className="h-1 flex-1 rounded-full"
            style={{ background: `linear-gradient(to right, ${RANG_RAMPE.join(',')})` }}
          />
        </div>
      )}
      {aktiv && topN > 0 && (
        <div className="mt-1 flex justify-between text-[11px]" style={{ color: ui.muted }}>
          <span>Rang 1</span>
          <span>Rang {nf(topN)}</span>
        </div>
      )}
    </div>
  )
}

function MobileRangLeiste({
  ui, modus, topN, setTopN, aktiv, setAktiv, gesamt,
}: {
  ui: Ui
  modus: Modus
  topN: number
  setTopN: (n: number) => void
  aktiv: boolean
  setAktiv: (aktiv: boolean) => void
  gesamt: number
}) {
  const schritte = 4000
  const kurve = 3
  const zuRang = (wert: number) =>
    wert <= 0 ? 0 : Math.min(gesamt, Math.max(1, Math.round(gesamt * (wert / schritte) ** kurve)))
  const position = topN <= 0 ? 0 : Math.round(schritte * (Math.min(topN, gesamt) / gesamt) ** (1 / kurve))
  const prozent = (position / schritte) * 100
  const erklaerung =
    modus === 'oev'
      ? 'Je dunkler das Rot, desto besser per ÖV an die Stadt angebunden.'
      : 'Je dunkler das Rot, desto mehr Kulturvielfalt in der Nähe.'
  const titel =
    modus === 'oev'
      ? 'Best angebundene Adressen hervorheben'
      : 'Adressen mit Kulturvielfalt hervorheben'

  return (
    <div
      className="absolute inset-x-3 bottom-3 z-20 rounded-lg border px-3 pb-2 pt-2 backdrop-blur-md"
      style={{ background: ui.panel, borderColor: ui.border, color: ui.fg, boxShadow: ui.schatten }}
    >
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium">
          {titel}
          {aktiv && (
            <span className="ml-1.5 font-normal tabular-nums" style={{ color: ui.muted }}>
              {topN === 1 ? 'Rang 1' : `Top ${nf(topN)}`}
            </span>
          )}
        </span>
        <Schalter ui={ui} checked={aktiv} onChange={setAktiv} label="" />
      </div>
      <input
        type="range"
        min={0}
        max={schritte}
        step={1}
        value={position}
        onChange={(e) => setTopN(zuRang(Number(e.target.value)))}
        disabled={!aktiv}
        aria-label="Anzahl hervorgehobener Ränge"
        className={`regler mt-1 ${aktiv ? '' : 'cursor-not-allowed opacity-40'}`}
        style={{ '--fuellung': `linear-gradient(to right, ${RANG_RAMPE[0]} ${prozent}%, ${ui.weich} ${prozent}%)`, '--knopf': ui.aktiv, '--ring': ui.ring } as React.CSSProperties}
      />
      {aktiv && (
        <p className="mt-1 text-[11px]" style={{ color: ui.muted }}>
          {erklaerung}
        </p>
      )}
    </div>
  )
}

/**
 * Die Sorten zum An- und Abwählen. Zwei Spalten, weil zehn Zeilen das Feld
 * sonst über den halben Bildschirm ziehen; die Zahl dahinter sagt, wie viel
 * überhaupt zur Wahl steht – 20 Kinos verschieben die Karte anders als 530
 * Kunstwerke.
 */
function SortenWahl({
  ui, arten, proArt, an, setAn,
}: {
  ui: Ui
  arten: string[]
  proArt: number[]
  an: boolean[]
  setAn: (a: boolean[]) => void
}) {
  const alle = an.every(Boolean)
  const keine = !an.some(Boolean)
  const [infoOffen, setInfoOffen] = useState(false)
  const hinweise = arten.filter((art) => ARTEN_HILFE[art])
  return (
    <div className="mt-3 border-t pb-1 pt-2.5" style={{ borderColor: ui.border }}>
      <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
        <span className="flex items-center gap-1" style={{ color: ui.muted }}>
          Sorten
          <button
            type="button"
            onClick={() => setInfoOffen((v) => !v)}
            aria-expanded={infoOffen}
            aria-label="Was die Sorten umfassen"
            className="flex h-[13px] w-[13px] items-center justify-center rounded-full border text-[9px] font-semibold leading-none transition-colors"
            style={{
              borderColor: infoOffen ? AKZENT : ui.border,
              color: infoOffen ? AKZENT : ui.muted,
            }}
          >
            i
          </button>
        </span>
        <span className="flex items-center gap-2">
          {!alle && (
            <button
              onClick={() => setAn(arten.map(() => true))}
              className="transition-opacity hover:opacity-60"
              style={{ color: AKZENT }}
            >
              alle
            </button>
          )}
          {!keine && (
            <button
              onClick={() => setAn(arten.map(() => false))}
              className="transition-opacity hover:opacity-60"
              style={{ color: AKZENT }}
            >
              keine
            </button>
          )}
        </span>
      </div>
      {infoOffen && (
        <dl className="mb-2 space-y-0.5 text-[11px] leading-snug" style={{ color: ui.muted }}>
          {hinweise.map((art) => (
            <div key={art} className="flex gap-1.5">
              <dt className="shrink-0" style={{ color: ui.fg }}>
                {ARTEN_KURZ[art] ?? art}
              </dt>
              <dd>{ARTEN_HILFE[art]}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="grid grid-cols-2 gap-x-3">
        {arten.map((art, i) => (
          <button
            key={art}
            onClick={() => setAn(an.map((x, j) => (j === i ? !x : x)))}
            aria-pressed={an[i]}
            className="flex items-center gap-1.5 py-[3px] text-left text-[12px] transition-opacity hover:opacity-70"
          >
            <span
              className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border"
              style={{
                borderColor: an[i] ? AKZENT : ui.border,
                background: an[i] ? AKZENT : 'transparent',
              }}
            >
              {an[i] && (
                <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden>
                  <path
                    d="M1.5 5.2 3.9 7.5 8.5 2.6"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate" style={{ color: an[i] ? ui.fg : ui.muted }}>
              {ARTEN_KURZ[art] ?? art}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums" style={{ color: ui.muted }}>
              {proArt[i]}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Schalter({
  ui, checked, onChange, label,
}: {
  ui: Ui
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex cursor-pointer select-none items-center gap-1.5 text-[12px]"
    >
      <span
        className="relative inline-block h-[18px] w-[30px] shrink-0 rounded-full transition-colors"
        style={{ background: checked ? ui.fg : ui.weich }}
      >
        <span
          className="absolute top-0.5 h-[14px] w-[14px] rounded-full transition-all"
          style={{
            background: '#ffffff',
            left: checked ? '14px' : '2px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          }}
        />
      </span>
      <span style={{ color: checked ? ui.fg : ui.muted }}>{label}</span>
    </button>
  )
}

function Extrempunkt({
  ui, k, e, wert, onWaehlen,
}: {
  ui: Ui
  k: string
  e: Extrem
  wert: string
  onWaehlen: () => void
}) {
  return (
    <button
      onClick={onWaehlen}
      className="zeile flex w-full items-baseline gap-2 rounded-md px-1.5 -mx-1.5 py-[3px] text-left text-[12px]"
      style={{ '--weich': ui.weich } as React.CSSProperties}
    >
      <span className="shrink-0 tabular-nums" style={{ color: ui.fg }}>{k}:</span>
      <span className="min-w-0 flex-1 truncate" style={{ color: ui.fg }}>
        {e.name ?? e.adresse ?? 'ohne Adresse'}
      </span>
      <span className="shrink-0 tabular-nums">{wert}</span>
    </button>
  )
}

function Kennzahl({ ui, k, v }: { ui: Ui; k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px]" style={{ color: ui.muted }}>{k}</dt>
      <dd className="tabular-nums" style={{ color: ui.fg }}>{v}</dd>
    </div>
  )
}

// ---------------------------------------------------------------- Karteikarte

function Karteikarte({
  treffer, meta, ui, modus, wegModus, sicht, fixiert, geteilt, rangFolgt, onAusrichten, mobil,
  nachricht, onTeilenNativ, onKopieren, onClose,
}: {
  treffer: NonNullable<Treffer>
  meta: Meta
  ui: Ui
  modus: Modus
  wegModus: WegModus
  sicht: Sicht | null
  fixiert: boolean
  geteilt: boolean
  /** Zieht die Hervorhebung dem Haus auf seinen Rang nach – dann stimmt der Farbhinweis. */
  rangFolgt: boolean
  onAusrichten: () => void
  mobil: boolean
  nachricht: { text: string; url: string } | null
  onTeilenNativ: () => void
  onKopieren: () => void
  onClose: () => void
}) {
  const [menuOffen, setMenuOffen] = useState(false)
  const kannNativ = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const kultur = modus === 'kultur'
  const gewaehlt = sicht?.gewaehlt ?? meta.kultur.arten.map((_, i) => i)
  // Anzahl und Rang gelten für die gewählten Sorten, nicht für alle.
  const reihen = treffer.weg[wegModus]
  const orte = gewaehlt.reduce((n, a) => n + (reihen.kb[a] ?? 0), 0)
  const rang = kultur
    ? (sicht?.rangVon(gewaehlt.reduce((w, a) => w + Math.sqrt(reihen.ki[a] ?? 0), 0)) ?? 0)
    : treffer.r
  const besserAls = Math.round((1 - rang / meta.buildings) * 100)

  return (
    <div style={{ color: ui.fg }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {(treffer.name || treffer.adresse) && (
            <div className="mb-2.5 min-w-0">
              {treffer.name && (
                <div className="truncate text-[13px] font-semibold leading-snug">{treffer.name}</div>
              )}
              <div className="truncate text-[12px] leading-snug" style={{ color: ui.muted }}>
                {treffer.adresse ?? 'ohne Adresse in OpenStreetMap'}
              </div>
            </div>
          )}
          <div className="text-3xl font-semibold tabular-nums leading-none">
            {kultur ? orte : fmt(treffer.m)}
            <span className="ml-1 text-base font-normal" style={{ color: ui.muted }}>
              {kultur ? (orte === 1 ? 'Ort' : 'Orte') : 'min'}
            </span>
          </div>
          <div className="mt-1.5 text-[12px]" style={{ color: ui.muted }}>
            {kultur
              ? `in ${meta.kultur.budgets[wegModus]} ${WEG[wegModus].minutenWort}`
              : 'im Schnitt zu einer Adresse der Stadt'}
          </div>
        </div>
        {fixiert && (
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-[16px] leading-none opacity-50 hover:opacity-100"
            aria-label="Schliessen"
            style={{ background: ui.weich }}
          >
            ×
          </button>
        )}
      </div>

      {kultur && orte > 0 && (
        <ul className="mt-3 border-t pt-2.5 text-[12px]" style={{ borderColor: ui.border }}>
          {gewaehlt.map((i) =>
            reihen.kb[i] ? (
              <li key={meta.kultur.arten[i]} className="flex justify-between py-[1px]">
                <span style={{ color: ui.muted }}>
                  {ARTEN_NAMEN[meta.kultur.arten[i]] ?? meta.kultur.arten[i]}
                </span>
                <span className="tabular-nums">{reihen.kb[i]}</span>
              </li>
            ) : null
          )}
        </ul>
      )}

      <div className="mt-3 border-t pt-2.5" style={{ borderColor: ui.border }}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold tabular-nums" style={{ color: AKZENT }}>
            Rang {nf(rang)}
          </span>
          <span className="text-[12px]" style={{ color: ui.muted }}>
            von {nf(meta.buildings)}
          </span>
        </div>
        <div className="mt-1 text-[12px] leading-relaxed" style={{ color: ui.muted }}>
          Besser als <span style={{ color: ui.fg }}>{besserAls}%</span> der Häuser der Stadt.
          {kultur
            ? ` Median ${(sicht?.verteilung ?? meta.kultur.verteilung).median} Orte, bestes Haus ${
                (sicht?.verteilung ?? meta.kultur.verteilung).max
              }.`
            : ` Median ${fmt(meta.minutes.median)} min, bestes Haus ${fmt(meta.minutes.best)} min.`}
        </div>

        {rangFolgt ? (
          <p className="mt-2 text-[12px] leading-relaxed" style={{ color: ui.muted }}>
            {kultur
              ? 'Rot heisst mehr Kultur in der Nähe als bei diesem Haus, Schwarz weniger. Je dunkler das Rot, desto besser der Rang.'
              : 'Rot heisst besser angebunden als dieses Haus, Schwarz schlechter. Je dunkler das Rot, desto besser der Rang.'}
          </p>
        ) : fixiert ? (
          <button
            type="button"
            onClick={onAusrichten}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-opacity hover:opacity-70"
            style={{ borderColor: AKZENT, color: AKZENT }}
          >
            Auf der Karte vergleichen
            {!mobil && (
              <kbd
                className="rounded border px-1 text-[10px] leading-[1.5]"
                style={{ borderColor: ui.border, color: ui.muted }}
              >
                Enter
              </kbd>
            )}
          </button>
        ) : null}
      </div>

      <div className="mt-3 border-t pt-3" style={{ borderColor: ui.border }}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => (kannNativ ? onTeilenNativ() : setMenuOffen((v) => !v))}
            aria-expanded={kannNativ ? undefined : menuOffen}
            className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: AKZENT }}
          >
            <TeilenSymbol />
            Teilen
          </button>
          {geteilt && <span className="text-[12px]" style={{ color: ui.muted }}>Link kopiert</span>}
        </div>

        {menuOffen && !kannNativ && nachricht && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              ['WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${nachricht.text} ${nachricht.url}`)}`],
              ['Telegram', `https://t.me/share/url?url=${encodeURIComponent(nachricht.url)}&text=${encodeURIComponent(nachricht.text)}`],
              ['E-Mail', `mailto:?subject=${encodeURIComponent('angebunden')}&body=${encodeURIComponent(`${nachricht.text}\n\n${nachricht.url}`)}`],
            ].map(([label, href]) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOffen(false)}
                className="rounded-full border px-3 py-1 text-[12px] transition-opacity hover:opacity-70"
                style={{ borderColor: ui.border, color: ui.fg }}
              >
                {label}
              </a>
            ))}
            <button
              onClick={() => {
                onKopieren()
                setMenuOffen(false)
              }}
              className="rounded-full border px-3 py-1 text-[12px] transition-opacity hover:opacity-70"
              style={{ borderColor: ui.border, color: ui.fg }}
            >
              Link kopieren
            </button>
          </div>
        )}
      </div>

      {!fixiert && (
        <div className="mt-2 text-[11px]" style={{ color: ui.muted }}>
          {typeof window !== 'undefined' && 'ontouchstart' in window ? 'Antippen' : 'Klicken'} hält
          den Wert fest.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Kleinkram

// Eine Nachkommastelle, Dezimalpunkt (Schweizer Schreibweise, auch im Teilen-Text).
const fmt = (n: number) => String(Math.round(n * 10) / 10)

/**
 * Tausendertrennung von Hand. `toLocaleString('de-CH')` liefert auf dem Server
 * ein anderes Zeichen als im Browser und bricht damit die Hydration.
 */
function nf(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '’')
}

function formatDatum(yyyymmdd: string) {
  const d = `${yyyymmdd.slice(6, 8)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(0, 4)}`
  const wochentage = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
  const tag = wochentage[
    new Date(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)).getDay()
  ]
  return `${tag}, ${d}`
}
