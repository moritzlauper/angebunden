'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  AttributionControl,
  setWorkerUrl,
  config,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl'
import { Blatt, useMedienabfrage } from '../blatt'
import { Suchleiste, bauIndex, suchen, Sternsymbol, type Eintrag } from '../suche'
import { Wortmarke } from '../marke'
import { STAEDTE } from '../staedte'
import { nf } from '../site'
import {
  ladeGraph, einrasten, route, kantenKosten, alsGpx, VOREINSTELLUNGEN,
  veloErlaubt, stressVon, netzVon, NETZ,
  type Graph, type Profil, type Route, type VeloMeta,
} from './router'

const STADT = STAEDTE.zuerich

/**
 * Grundkarte ist die Basiskarte der Stadt Zürich, dieselbe wie im Züriplan:
 * Gebäude, Hausnummern, Strassennamen. Die Stadt bietet ihre Kacheln nur in
 * LV95 an, der WMS rechnet aber auf Anfrage in Web Mercator um. Anders als
 * die ÖV-Karte lädt der Velonavi damit Bilder von einem fremden Server.
 */
/**
 * Eine Kachel ist 512 Punkte gross. Auf Bildschirmen mit doppelter Pixeldichte
 * holt sie 1024 Pixel, sonst wäre das Bild sichtbar hochgezogen. `DPI=192`
 * sagt dem Server, dass er dafür auch Schrift und Linien doppelt so dick
 * zeichnen soll; ohne das wären die Strassennamen halb so gross.
 */
function wms(dienst: string, layer: string, transparent = false) {
  const dicht = typeof window !== 'undefined' && window.devicePixelRatio > 1.5
  const px = dicht ? 1024 : 512
  return (
    `https://www.ogd.stadt-zuerich.ch/wms/geoportal/${dienst}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${layer}&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=${px}&HEIGHT=${px}` +
    `&FORMAT=image/png${dicht ? '&DPI=192' : ''}${transparent ? '&TRANSPARENT=true' : ''}`
  )
}

/**
 * Wie angenehm ein Abschnitt zu fahren ist, Stufe 1 bis 4 in den Statusfarben,
 * Index 0 für geschobene Stücke. Es zählt nicht nur der Autoverkehr: auch
 * Kopfsteinpflaster, Tramgleise und Fussgängerzonen ziehen eine Strecke nach unten.
 */
export const STUFEN = [
  { farbe: '#8a8a86', name: 'Geschoben', kurz: 'Schieben' },
  { farbe: '#0ca30c', name: 'Angenehm: ruhig und glatt', kurz: 'Angenehm' },
  { farbe: '#fab219', name: 'Mässig: etwas Verkehr oder ruppig', kurz: 'Mässig' },
  { farbe: '#ec835a', name: 'Unangenehm: Velostreifen, Pflaster', kurz: 'Unangenehm' },
  { farbe: '#d03b3b', name: 'Hart: Mischverkehr, Gleise, grobes Pflaster', kurz: 'Hart' },
] as const
const VORZUG = '#7c5cd6'
const AKZENT = '#2563eb'

const ui = {
  bg: '#f7f7f5',
  fg: '#18181b',
  panel: 'rgba(255,255,255,0.88)',
  border: 'rgba(24,24,27,0.07)',
  muted: '#71717a',
  weich: 'rgba(24,24,27,0.045)',
  aktiv: '#ffffff',
  ring: 'rgba(37,99,235,0.35)',
  schatten: '0 1px 1px rgba(24,24,27,0.03), 0 10px 30px -12px rgba(24,24,27,0.22)',
}

type Punkt = { lon: number; lat: number; titel: string }

/**
 * Zwei Varianten, beide immer gerechnet: die schnellste und die komfortable.
 * Die komfortable lässt sich in der Feineinstellung selbst gewichten.
 */
type Variante = 'schnell' | 'komfort'
const VARIANTEN: { id: Variante; titel: string; hilfe: string }[] = [
  { id: 'schnell', titel: 'Schnell', hilfe: 'Kürzeste Fahrzeit, Verkehr zählt kaum' },
  { id: 'komfort', titel: 'Komfort', hilfe: 'Meidet Verkehr, Tramgleise, Pflaster und Steigungen' },
]

const REGLER: { id: 'sicherheit' | 'steigung' | 'ampeln' | 'belag'; titel: string }[] = [
  { id: 'sicherheit', titel: 'Verkehr und Tramgleise meiden' },
  { id: 'steigung', titel: 'Steigungen meiden' },
  { id: 'ampeln', titel: 'Warten an Ampeln meiden' },
  { id: 'belag', titel: 'Kopfsteinpflaster und Kies meiden' },
]

// ---------------------------------------------------------------- URL

/** Start, Ziel und Profil stehen im Fragment, damit man eine Route teilen kann. */
function leseUrl() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const punkt = (s: string | null, titel: string | null): Punkt | null => {
    if (!s) return null
    const [lon, lat] = s.split(',').map(Number)
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat, titel: titel || koordText(lon, lat) } : null
  }
  return {
    start: punkt(p.get('von'), p.get('vn')),
    ziel: punkt(p.get('nach'), p.get('nn')),
    // «ideal» stammt aus der Zeit mit drei Varianten und zeigt jetzt auf Komfort.
    wahl: ((w) => (w === 'schnell' ? 'schnell' : w === 'komfort' || w === 'ideal' ? 'komfort' : null))(p.get('wahl')) as Variante | null,
  }
}

function schreibeUrl(start: Punkt | null, ziel: Punkt | null, wahl: Variante) {
  const p = new URLSearchParams()
  if (start) p.set('von', `${start.lon.toFixed(5)},${start.lat.toFixed(5)}`), p.set('vn', start.titel)
  if (ziel) p.set('nach', `${ziel.lon.toFixed(5)},${ziel.lat.toFixed(5)}`), p.set('nn', ziel.titel)
  if (wahl !== 'komfort') p.set('wahl', wahl)
  const s = p.toString()
  window.history.replaceState(null, '', window.location.pathname + (s ? `#${s}` : ''))
}

const koordText = (lon: number, lat: number) => `Punkt ${lat.toFixed(4)}, ${lon.toFixed(4)}`

/** «Werdstrasse 21» → «Werdstrasse». Ohne Hausnummer bleibt der Titel stehen. */
function strasseVon(titel: string) {
  const m = titel.match(/^(.+?)\s+\d+[a-zA-Z]?$/)
  return m ? m[1] : undefined
}

// ---------------------------------------------------------------- Gedächtnis

/**
 * Zuletzt gesuchte Orte, das Zuhause und die letzte Strecke liegen im
 * localStorage des Browsers. Sie verlassen das Gerät nie, und wer keinen
 * Speicher erlaubt (privates Fenster), merkt davon nur, dass nichts bleibt.
 */
const SCHLUESSEL = { verlauf: 'velonavi.verlauf', zuhause: 'velonavi.zuhause', letzte: 'velonavi.letzte' }
const VERLAUF_MAX = 10

function lies<T>(schluessel: string, vorgabe: T): T {
  try {
    const roh = window.localStorage.getItem(schluessel)
    return roh ? (JSON.parse(roh) as T) : vorgabe
  } catch {
    return vorgabe
  }
}
function schreib(schluessel: string, wert: unknown) {
  try {
    if (wert === null) window.localStorage.removeItem(schluessel)
    else window.localStorage.setItem(schluessel, JSON.stringify(wert))
  } catch {
    /* privates Fenster oder voller Speicher */
  }
}

// ---------------------------------------------------------------- Formatierung

function minuten(s: number) {
  const m = Math.max(1, Math.round(s / 60))
  return m < 60 ? `${m} Min.` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}
function km(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}
const meter = (m: number) => `${nf(m)} m`
const prozent = (teil: number, ganz: number) => `${Math.round((100 * teil) / Math.max(ganz, 1))}%`

// ---------------------------------------------------------------- Komponente

export default function Velonavi() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<{ start: Marker | null; ziel: Marker | null }>({ start: null, ziel: null })
  const graphRef = useRef<Graph | null>(null)
  const indexRef = useRef<Eintrag[] | null>(null)

  const [kartenBereit, setKartenBereit] = useState(false)
  const [graphBereit, setGraphBereit] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [start, setStart] = useState<Punkt | null>(null)
  const [ziel, setZiel] = useState<Punkt | null>(null)
  const [wahl, setWahl] = useState<Variante>('komfort')
  const [gewichte, setGewichte] = useState<{ sicherheit: number; steigung: number; ampeln: number; belag: number }>({
    ...VOREINSTELLUNGEN.entspannt,
  })
  // Schieben ist aus: Wer eine Veloroute sucht, will fahren. Wo es ohne
  // Schiebestück gar nicht geht, sagt das der Hinweis bei «keine Verbindung».
  const [schieben, setSchieben] = useState(false)
  const [netzFarbig, setNetzFarbig] = useState(false)
  const [feinOffen, setFeinOffen] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [kopiert, setKopiert] = useState(false)
  const [blattOffen, setBlattOffen] = useState(true)
  const [deckung, setDeckung] = useState(0)

  // Suche: zwei Felder mit eigenem Text, ein gemeinsamer Index.
  const [startText, setStartText] = useState('')
  const [zielText, setZielText] = useState('')
  const [offenFeld, setOffenFeld] = useState<'start' | 'ziel' | null>(null)
  const [indexBereit, setIndexBereit] = useState(false)
  const [verlauf, setVerlauf] = useState<Punkt[]>([])
  const [zuhause, setZuhause] = useState<Punkt | null>(null)

  const mobil = !useMedienabfrage('(min-width: 768px)')

  const profile: Record<Variante, Profil> = useMemo(
    () => ({
      schnell: { schieben, ...VOREINSTELLUNGEN.schnell },
      komfort: { schieben, ...gewichte },
    }),
    [schieben, gewichte]
  )

  // --- Zustand aus dem Link übernehmen
  useEffect(() => {
    setVerlauf(lies<Punkt[]>(SCHLUESSEL.verlauf, []))
    setZuhause(lies<Punkt | null>(SCHLUESSEL.zuhause, null))
    const u = leseUrl()
    // Ohne Angaben im Link die letzte Strecke wieder aufnehmen.
    const letzte = u.start || u.ziel ? null : lies<{ start: Punkt | null; ziel: Punkt | null } | null>(SCHLUESSEL.letzte, null)
    const s = u.start ?? letzte?.start ?? null
    const z = u.ziel ?? letzte?.ziel ?? null
    if (s) setStart(s), setStartText(s.titel)
    if (z) setZiel(z), setZielText(z.titel)
    if (u.wahl) setWahl(u.wahl)
  }, [])

  useEffect(() => {
    schreibeUrl(start, ziel, wahl)
    if (start || ziel) schreib(SCHLUESSEL.letzte, { start, ziel })
  }, [start, ziel, wahl])

  /**
   * Was gesucht oder angetippt wurde, kommt oben in den Verlauf. Punkte ohne
   * Namen (Klick in die Karte) nicht: «Punkt 47.3721, 8.5150» hilft später niemandem.
   */
  const merken = useCallback((p: Punkt) => {
    if (p.titel.startsWith('Punkt ')) return
    setVerlauf((alt) => {
      const neu = [p, ...alt.filter((o) => o.titel !== p.titel)].slice(0, VERLAUF_MAX)
      schreib(SCHLUESSEL.verlauf, neu)
      return neu
    })
  }, [])

  // --- Graph und Suchindex laden
  useEffect(() => {
    let weg = false
    ;(async () => {
      try {
        const [meta, puffer] = await Promise.all([
          fetch(`${STADT.daten}/velo.json`).then((r) => r.json() as Promise<VeloMeta>),
          fetch(`${STADT.daten}/velo.bin`).then((r) => r.arrayBuffer()),
        ])
        if (weg) return
        graphRef.current = ladeGraph(meta, puffer)
        setGraphBereit(true)
      } catch (e) {
        console.error(e)
        setFehler('Das Velonetz liess sich nicht laden.')
      }
    })()
    ;(async () => {
      const [adressen, kultur, halte] = await Promise.all([
        fetch(`${STADT.daten}/velo-adressen.json`).then((r) => r.json() as Promise<[string, string | null, number, number][]>),
        fetch(`${STADT.daten}/kultur.geojson`).then((r) => r.json()),
        fetch(`${STADT.daten}/stops.geojson`).then((r) => r.json()),
      ])
      if (weg) return
      const haeuser = adressen.map(([s, n, x, y]) => ({ properties: { s, n: n ?? undefined, x, y }, geometry: { coordinates: [x, y] } }))
      indexRef.current = bauIndex(haeuser, kultur.features, halte.features, ARTEN_NAMEN, STADT.name)
      setIndexBereit(true)
    })()
    return () => {
      weg = true
    }
  }, [])

  // --- Die drei Varianten rechnen
  type Ergebnis =
    | { fehler: string }
    | { routen: Record<Variante, Route | null>; gleichWie: Record<Variante, Variante | null>; ms: number; notSchieben: boolean }
  const ergebnis = useMemo((): Ergebnis | null => {
    const g = graphRef.current
    if (!graphBereit || !g || !start || !ziel) return null
    const t0 = performance.now()
    /** Alle drei Varianten mit einer Einstellung durchrechnen. */
    const rechne = (mitSchieben: boolean) => {
      const s = einrasten(g, start.lon, start.lat, mitSchieben, strasseVon(start.titel))
      const z = einrasten(g, ziel.lon, ziel.lat, mitSchieben, strasseVon(ziel.titel))
      if (!s || !z) return null
      const out = {} as Record<Variante, Route | null>
      for (const v of VARIANTEN) {
        const pr = { ...profile[v.id], schieben: mitSchieben }
        out[v.id] = route(g, pr, s, z, kantenKosten(g, pr))
      }
      return out.komfort ? out : null
    }
    // Erst fahren. Nur wenn es so keine Verbindung gibt, ein Schiebestück
    // zulassen: manche Ziele, etwa der Vorplatz von Bahnhof Stettbach, hängen
    // ausschliesslich an Fusswegen.
    let routen = rechne(schieben)
    let notSchieben = false
    if (!routen && !schieben) {
      routen = rechne(true)
      notSchieben = !!routen
    }
    const ms = performance.now() - t0
    if (!routen)
      return { fehler: 'Keine Verbindung gefunden. Start oder Ziel liegt ausserhalb des Velonetzes der Stadt Zürich.' }
    // Varianten, die (fast) gleich verlaufen, zusammenlegen: die spätere zeigt
    // auf die frühere. Verglichen wird die befahrene Kantenmenge.
    const gleichWie = {} as Record<Variante, Variante | null>
    const kantenVon = (r: Route) => new Set(r.stuecke.map((x) => x.a >> 1))
    VARIANTEN.forEach((v, i) => {
      gleichWie[v.id] = null
      const rv = routen[v.id]
      if (!rv) return
      const kv = kantenVon(rv)
      for (const w of VARIANTEN.slice(0, i)) {
        const rw = routen[w.id]
        if (!rw || gleichWie[w.id]) continue
        const kw = kantenVon(rw)
        let gemeinsam = 0
        for (const e of kv) if (kw.has(e)) gemeinsam++
        if (gemeinsam / Math.max(kv.size, kw.size) > 0.97) {
          gleichWie[v.id] = w.id
          break
        }
      }
    })
    return { routen, gleichWie, ms, notSchieben }
  }, [graphBereit, start, ziel, profile, schieben])
  const routen = ergebnis && 'routen' in ergebnis ? ergebnis : null
  // Die gewählte Variante, bei Zusammenlegung die, auf die sie zeigt.
  const aktiv: Variante | null = routen ? (routen.gleichWie[wahl] ?? (routen.routen[wahl] ? wahl : 'komfort')) : null
  const r = routen && aktiv ? routen.routen[aktiv] : null
  const andere = useMemo(
    () =>
      routen
        ? VARIANTEN.filter((v) => v.id !== aktiv && !routen.gleichWie[v.id] && routen.routen[v.id]).map((v) => ({ id: v.id, r: routen.routen[v.id]! }))
        : [],
    [routen, aktiv]
  )

  // --- Karte aufbauen
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')
    // Der Kartendienst der Stadt rendert jedes Bild einzeln und weist unter
    // Last Verbindungen ab. Sechs gleichzeitige Anfragen kommen durch,
    // sechzehn nicht. Den Rest übernimmt der Zwischenspeicher im Service Worker.
    config.MAX_PARALLEL_IMAGE_REQUESTS = 6
    navigator.serviceWorker?.register('/velonavi-sw.js').catch(() => {})
    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: '/fonts/{fontstack}/{range}.pbf',
        sources: {
          basiskarte: {
            type: 'raster',
            tiles: [wms('Basiskarte_Zuerich_Raster', 'Basiskarte%20Z%C3%BCrich%20Raster')],
            tileSize: 512,
            attribution: 'Basiskarte © Stadt Zürich',
          },
          // Die schräg gezeichneten Gebäude wie im Züriplan. Die Stadt liefert
          // sie erst ab etwa 1:10'000, darunter bleibt die Ebene leer.
          gebaeude: {
            type: 'raster',
            tiles: [wms('Gebaeude_verkippt', 'Geb%C3%A4ude%20verkippt', true)],
            tileSize: 512,
            minzoom: 15,
          },
        },
        layers: [
          { id: 'grund', type: 'background', paint: { 'background-color': ui.bg } },
          // Erst ab Zoomstufe 13: In der Übersicht wechselt die Stadtkarte
          // sonst mehrfach die Detailstufe, was beim Zoomen unruhig wirkt.
          { id: 'basiskarte', type: 'raster', source: 'basiskarte', minzoom: 13, paint: { 'raster-fade-duration': 150 } },
          { id: 'gebaeude', type: 'raster', source: 'gebaeude', minzoom: 15, paint: { 'raster-fade-duration': 150 } },
        ],
      },
      center: STADT.center,
      zoom: 13,
      minZoom: 10,
      maxZoom: 18.5,
      maxBounds: STADT.maxBounds,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    map.on('error', (e) => console.error('[velonavi]', e.error?.message ?? e))
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution:
          'Velonetz, Lichtsignale, Tempo, Velonetzplanung, Unfälle © Stadt Zürich (OGD) · Wege, Belag, Tramgleise © OpenStreetMap-Mitwirkende · Höhen: AWS Terrain Tiles',
      }),
      'bottom-left'
    )
    const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
    attrib?.classList.add('maplibregl-compact')
    attrib?.classList.remove('maplibregl-compact-show')
    attrib?.removeAttribute('open')

    map.on('load', async () => {
      const [vorzug, stadtGeo, wasser] = await Promise.all(
        ['velo-vorzug', 'city', 'water'].map((n) => fetch(`${STADT.daten}/${n}.geojson`).then((r) => r.json()))
      )
      const leer = { type: 'FeatureCollection' as const, features: [] }
      // Unterhalb von Zoom 13 eine ruhige eigene Übersicht statt der Stadtkarte.
      map.addSource('stadt', { type: 'geojson', data: stadtGeo })
      map.addSource('wasser', { type: 'geojson', data: wasser })
      map.addSource('vorzug', { type: 'geojson', data: vorzug })
      map.addSource('netz', { type: 'geojson', data: leer })
      map.addSource('ampeln', { type: 'geojson', data: leer })
      map.addSource('andere', { type: 'geojson', data: leer })
      map.addSource('route', { type: 'geojson', data: leer })
      map.addSource('route-ampeln', { type: 'geojson', data: leer })
      map.addSource('zeiger', { type: 'geojson', data: leer })

      // Das Velonetz, nur eingeblendet, wenn es nach Stress eingefärbt wird.
      map.addLayer({ id: 'stadt-flaeche', type: 'fill', source: 'stadt', maxzoom: 13.3, paint: { 'fill-color': '#ffffff' } })
      map.addLayer({
        id: 'wasser-flaeche', type: 'fill', source: 'wasser', maxzoom: 13.3,
        filter: ['==', ['get', 'kind'], 'area'], paint: { 'fill-color': '#dcdcd6' },
      })
      map.addLayer({
        id: 'wasser-linie', type: 'line', source: 'wasser', maxzoom: 13.3,
        filter: ['==', ['get', 'kind'], 'line'],
        paint: { 'line-color': '#dcdcd6', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 13, 8] },
      })
      map.addLayer({ id: 'stadt-rand', type: 'line', source: 'stadt', maxzoom: 13.3, paint: { 'line-color': '#c9c9c4', 'line-width': 1 } })
      map.addLayer({
        id: 'netz',
        type: 'line',
        source: 'netz',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: {
          'line-color': '#d4d4ce',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 1.2, 17, 4],
        },
      })
      map.addLayer({
        id: 'vorzug',
        type: 'line',
        source: 'vorzug',
        filter: ['!', ['has', 'beschriftung']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': VORZUG,
          'line-opacity': 0.45,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3, 17, 7],
        },
      })
      map.addLayer({
        id: 'vorzug-name',
        type: 'symbol',
        source: 'vorzug',
        minzoom: 13.5,
        filter: ['has', 'beschriftung'],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 400,
          'text-field': ['concat', 'Vorzugsroute ', ['to-string', ['get', 'nr']]],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'text-max-angle': 30,
        },
        paint: { 'text-color': VORZUG, 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      })
      map.addLayer({
        id: 'ampeln',
        type: 'circle',
        source: 'ampeln',
        minzoom: 14,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.8, 17, 4],
          'circle-color': '#3f3f46',
          'circle-opacity': 0.55,
        },
      })

      // Die nicht gewählten Varianten, grau und anklickbar.
      map.addLayer({
        id: 'andere-huelle',
        type: 'line',
        source: 'andere',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 9] },
      })
      map.addLayer({
        id: 'andere',
        type: 'line',
        source: 'andere',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#9a9a96', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 6] },
      })
      map.addLayer({
        id: 'andere-name',
        type: 'symbol',
        source: 'andere',
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'titel'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
        },
        paint: { 'text-color': '#52525b', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      })
      map.addLayer({
        id: 'route-huelle',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 11] },
      })
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'stufe'], 0, STUFEN[0].farbe, 1, STUFEN[1].farbe, 2, STUFEN[2].farbe, 3, STUFEN[3].farbe, STUFEN[4].farbe],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 16, 7],
          'line-dasharray': ['case', ['==', ['get', 'stufe'], 0], ['literal', [0.6, 1.2]], ['literal', [1, 0]]],
        },
      })
      map.addLayer({
        id: 'route-ampeln',
        type: 'circle',
        source: 'route-ampeln',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 6],
          'circle-color': ['case', ['==', ['get', 'geradeaus'], 1], '#18181b', '#ffffff'],
          'circle-stroke-color': '#18181b',
          'circle-stroke-width': 1.5,
        },
      })
      map.addLayer({
        id: 'zeiger',
        type: 'circle',
        source: 'zeiger',
        paint: { 'circle-radius': 6, 'circle-color': AKZENT, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      })
      setKartenBereit(true)
    })
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // --- Ampeln zeichnen, sobald Karte und Graph da sind
  useEffect(() => {
    const map = mapRef.current
    const g = graphRef.current
    if (!kartenBereit || !graphBereit || !map || !g) return
    ;(map.getSource('ampeln') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: g.meta.ampeln.map(([lon, lat, art]) => ({
        type: 'Feature' as const,
        properties: { art },
        geometry: { type: 'Point' as const, coordinates: [lon, lat] },
      })),
    })
  }, [kartenBereit, graphBereit])

  // Die 38'000 Kanten des Velonetzes kommen erst in die Karte, wenn man sie
  // einfärbt. Als stille Quelle würden sie bei jedem Zoom neu zerlegt.
  const netzGezeichnet = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    const g = graphRef.current
    if (!kartenBereit || !map) return
    map.setLayoutProperty('netz', 'visibility', netzFarbig ? 'visible' : 'none')
    if (!netzFarbig || !graphBereit || !g || netzGezeichnet.current) return
    netzGezeichnet.current = true
    const features = []
    for (let e = 0; e < g.E; e++) {
      const vor = veloErlaubt(g, 2 * e)
      const rueck = veloErlaubt(g, 2 * e + 1)
      if (!vor && !rueck) continue
      const coords: [number, number][] = []
      for (let i = g.kantePunkte[e]; i < g.kantePunkte[e + 1]; i++) coords.push([g.punkte[2 * i] / 1e6, g.punkte[2 * i + 1] / 1e6])
      // Die schlechtere der beiden Richtungen, die man befahren darf.
      const stufe = Math.max(vor ? stressVon(g, 2 * e) : 0, rueck ? stressVon(g, 2 * e + 1) : 0)
      features.push({ type: 'Feature' as const, properties: { s: stufe, v: netzVon(g, e) === NETZ.vorzug ? 1 : 0 }, geometry: { type: 'LineString' as const, coordinates: coords } })
    }
    ;(map.getSource('netz') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    map.setPaintProperty('netz', 'line-color', [
      'match', ['get', 's'], 1, STUFEN[1].farbe, 2, STUFEN[2].farbe, 3, STUFEN[3].farbe, STUFEN[4].farbe,
    ])
    map.setPaintProperty('netz', 'line-opacity', 0.8)
  }, [kartenBereit, graphBereit, netzFarbig])

  // --- Route zeichnen
  useEffect(() => {
    const map = mapRef.current
    if (!kartenBereit || !map) return
    const leer = { type: 'FeatureCollection' as const, features: [] }
    ;(map.getSource('route') as GeoJSONSource).setData(r ? routeAlsLinien(r) : leer)
    ;(map.getSource('andere') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: andere.map((a) => ({
        type: 'Feature' as const,
        properties: { id: a.id, titel: `${VARIANTEN.find((v) => v.id === a.id)!.titel} · ${minuten(a.r.zeit)}` },
        geometry: { type: 'LineString' as const, coordinates: a.r.koordinaten },
      })),
    })
    ;(map.getSource('route-ampeln') as GeoJSONSource).setData(
      r
        ? {
            type: 'FeatureCollection',
            features: r.ampeln.orte.map(([lon, lat, mv]) => ({
              type: 'Feature' as const,
              properties: { geradeaus: mv === 'geradeaus' ? 1 : 0 },
              geometry: { type: 'Point' as const, coordinates: [lon, lat] },
            })),
          }
        : leer
    )
  }, [kartenBereit, r, andere])

  // Beim ersten Ergebnis zu einer neuen Start-Ziel-Kombination die Route einpassen.
  const eingepasst = useRef('')
  useEffect(() => {
    const map = mapRef.current
    if (!map || !r || !start || !ziel) return
    const k = `${start.lon},${start.lat},${ziel.lon},${ziel.lat}`
    if (eingepasst.current === k) return
    eingepasst.current = k
    let w = Infinity, s = Infinity, o = -Infinity, n = -Infinity
    for (const [lon, lat] of r.koordinaten) {
      w = Math.min(w, lon); o = Math.max(o, lon); s = Math.min(s, lat); n = Math.max(n, lat)
    }
    map.fitBounds(
      [[w, s], [o, n]],
      {
        padding: mobil
          ? { top: 190, bottom: Math.max(deckung, 120) + 20, left: 30, right: 30 }
          : { top: 70, bottom: 60, left: 440, right: 60 },
        duration: 900,
        maxZoom: 16,
      }
    )
  }, [r, start, ziel, mobil, deckung])

  // --- Zeiger aus dem Höhenprofil
  useEffect(() => {
    const map = mapRef.current
    if (!kartenBereit || !map) return
    const p = hover !== null && r ? r.koordinaten[hover] : null
    ;(map.getSource('zeiger') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: p ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }] : [],
    })
  }, [kartenBereit, hover, r])

  // --- Start- und Zielmarken, verschiebbar
  const setzeMarke = useCallback((art: 'start' | 'ziel', p: Punkt | null) => {
    const map = mapRef.current
    if (!map) return
    const vorhanden = markerRef.current[art]
    if (!p) {
      vorhanden?.remove()
      markerRef.current[art] = null
      return
    }
    if (vorhanden) {
      vorhanden.setLngLat([p.lon, p.lat])
      return
    }
    const el = document.createElement('div')
    el.style.cssText = `width:22px;height:22px;border-radius:999px;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:grab;background:${art === 'start' ? '#18181b' : AKZENT}`
    el.setAttribute('aria-label', art === 'start' ? 'Start' : 'Ziel')
    const mk = new Marker({ element: el, draggable: true }).setLngLat([p.lon, p.lat]).addTo(map)
    mk.on('dragend', () => {
      const { lng, lat } = mk.getLngLat()
      const neu = ortBeimRef.current(lng, lat, map.getZoom())
      mk.setLngLat([neu.lon, neu.lat])
      if (art === 'start') setStart(neu), setStartText(neu.titel)
      else setZiel(neu), setZielText(neu.titel)
    })
    markerRef.current[art] = mk
  }, [])

  useEffect(() => {
    if (kartenBereit) setzeMarke('start', start)
  }, [kartenBereit, start, setzeMarke])
  useEffect(() => {
    if (kartenBereit) setzeMarke('ziel', ziel)
  }, [kartenBereit, ziel, setzeMarke])

  /**
   * Zum Klick den nächsten bekannten Ort suchen: Hausadresse, Kulturort oder
   * Haltestelle. So wird aus dem Tippen auf ein Haus die «Nussbaumstrasse 4»
   * statt einer blossen Koordinate. Der Fangradius hängt am Zoom, damit man in
   * der Übersicht nicht ein Haus drei Strassen weiter erwischt.
   */
  const ortBeim = useCallback((lon: number, lat: number, zoom: number): Punkt => {
    const index = indexRef.current
    const grenze = Math.max(12, 260 / 2 ** (zoom - 14))
    if (index) {
      const mx = 111320 * Math.cos((lat * Math.PI) / 180)
      let beste: Eintrag | null = null
      let besteD = grenze
      for (const e of index) {
        // Adressen liegen im Hausinneren, Haltestellen und Kulturorte am Weg:
        // ein kleiner Zuschlag lässt bei gleicher Nähe die Adresse gewinnen.
        const d = Math.hypot((e.x - lon) * mx, (e.y - lat) * 111133) + (e.art === 'adresse' ? 0 : 8)
        if (d < besteD) {
          besteD = d
          beste = e
        }
      }
      if (beste) return { lon: beste.x, lat: beste.y, titel: beste.titel }
    }
    return { lon, lat, titel: koordText(lon, lat) }
  }, [])

  // Das Einrasten steht in einem Ref, damit die Marken nicht bei jeder
  // Zustandsänderung neu gebaut werden müssen.
  const ortBeimRef = useRef(ortBeim)
  ortBeimRef.current = ortBeim

  // --- Klick auf die Karte: in das Feld, in dem man gerade steht. Sonst erst
  // Start, dann Ziel, danach wird das Ziel versetzt.
  const startRef = useRef(start)
  startRef.current = start
  const feldRef = useRef(offenFeld)
  feldRef.current = offenFeld
  useEffect(() => {
    const map = mapRef.current
    if (!kartenBereit || !map) return
    const klick = (e: MapMouseEvent) => {
      // Klick auf eine graue Variante wählt sie aus, statt das Ziel zu versetzen.
      const { x, y } = e.point
      const f = map.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], { layers: ['andere'] })[0]
      if (f) {
        setWahl(f.properties.id as Variante)
        return
      }
      const p = ortBeim(e.lngLat.lng, e.lngLat.lat, map.getZoom())
      const feld = feldRef.current ?? (startRef.current ? 'ziel' : 'start')
      if (feld === 'start') setStart(p), setStartText(p.titel)
      else setZiel(p), setZielText(p.titel)
      merken(p)
      setOffenFeld(null)
      setBlattOffen(true)
    }
    map.on('click', klick)
    return () => {
      map.off('click', klick)
    }
  }, [kartenBereit, ortBeim, merken])

  const setzeGewicht = (id: (typeof REGLER)[number]['id'], v: number) => {
    setWahl('komfort')
    setGewichte((g) => ({ ...g, [id]: v }))
  }

  const tausche = () => {
    setStart(ziel)
    setZiel(start)
    setStartText(ziel?.titel ?? '')
    setZielText(start?.titel ?? '')
  }

  const standort = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const p = { lon: pos.coords.longitude, lat: pos.coords.latitude, titel: 'Mein Standort' }
        setStart(p)
        setStartText(p.titel)
      },
      () => setFehler('Der Standort ist nicht verfügbar.'),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const gpx = () => {
    if (!r) return
    const name = `${start?.titel ?? 'Start'} nach ${ziel?.titel ?? 'Ziel'}`
    const blob = new Blob([alsGpx(r, name)], { type: 'application/gpx+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'velonavi.gpx'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const teilen = async () => {
    const url = window.location.href
    try {
      if (navigator.share && mobil) await navigator.share({ title: 'Veloroute', url })
      else {
        await navigator.clipboard.writeText(url)
        setKopiert(true)
        setTimeout(() => setKopiert(false), 1800)
      }
    } catch {
      /* abgebrochen */
    }
  }

  // --- Suche
  /** Zuhause und Verlauf, solange nichts getippt ist. */
  const vorschlaege: Eintrag[] = useMemo(() => {
    const aus = (p: Punkt, symbol: 'stern' | 'uhr', unter: string): Eintrag => ({
      art: 'adresse', titel: p.titel, unter, x: p.lon, y: p.lat, nr: 0, norm: '', symbol,
    })
    return [
      ...(zuhause ? [aus(zuhause, 'stern', 'Zuhause')] : []),
      ...verlauf.filter((p) => p.titel !== zuhause?.titel).map((p) => aus(p, 'uhr', 'Zuletzt gesucht')),
    ]
  }, [zuhause, verlauf])

  const treffer = useCallback(
    (text: string, gewaehlt: Punkt | null) => {
      // Leeres Feld oder eines, in dem noch die getroffene Wahl steht: den
      // ganzen Verlauf zeigen, auch den Ort, der schon im Feld steht. Wer
      // weitertippt, sucht.
      if (text.length < 2 || text === gewaehlt?.titel) return vorschlaege
      return indexBereit ? suchen(indexRef.current!, text) : []
    },
    [indexBereit, vorschlaege]
  )
  const trefferStart = useMemo(
    () => (offenFeld === 'start' ? treffer(startText, start) : []),
    [offenFeld, startText, start, treffer]
  )
  const trefferZiel = useMemo(
    () => (offenFeld === 'ziel' ? treffer(zielText, ziel) : []),
    [offenFeld, zielText, ziel, treffer]
  )

  const felder = (
    <div className="flex flex-col gap-2">
      <div className="relative z-[41]">
        <Suchleiste
          ui={ui}
          wert={startText}
          setWert={setStartText}
          treffer={trefferStart}
          offen={offenFeld === 'start'}
          setOffen={(o) => setOffenFeld(o ? 'start' : null)}
          onWaehlen={(e) => {
            const p = { lon: e.x, lat: e.y, titel: e.titel }
            setStart(p)
            merken(p)
          }}
          platzhalter="Start: Adresse oder Haus in der Karte"
          links={<Marke farbe="#18181b" />}
          rechts={
            <button
              onClick={standort}
              aria-label="Mein Standort als Start"
              title="Mein Standort als Start"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full border backdrop-blur-md"
              style={{ background: ui.panel, borderColor: ui.border, color: ui.fg, boxShadow: ui.schatten }}
            >
              <OrtungSymbol />
            </button>
          }
        />
      </div>
      <div className="relative z-40">
        <Suchleiste
          ui={ui}
          wert={zielText}
          setWert={setZielText}
          treffer={trefferZiel}
          offen={offenFeld === 'ziel'}
          setOffen={(o) => setOffenFeld(o ? 'ziel' : null)}
          onWaehlen={(e) => {
            const p = { lon: e.x, lat: e.y, titel: e.titel }
            setZiel(p)
            merken(p)
          }}
          platzhalter="Ziel"
          links={<Marke farbe={AKZENT} />}
          rechts={
            <button
              onClick={tausche}
              aria-label="Start und Ziel tauschen"
              title="Start und Ziel tauschen"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full border backdrop-blur-md"
              style={{ background: ui.panel, borderColor: ui.border, color: ui.fg, boxShadow: ui.schatten }}
            >
              <TauschSymbol />
            </button>
          }
        />
      </div>
      <Zuhausezeile
        zuhause={zuhause}
        setzen={() => {
          // Das Zuhause ist der Ort, von dem man losfährt.
          const p = start ?? ziel
          if (!p) return
          setZuhause(p)
          schreib(SCHLUESSEL.zuhause, p)
        }}
        loeschen={() => {
          setZuhause(null)
          schreib(SCHLUESSEL.zuhause, null)
        }}
        waehlen={() => {
          if (!zuhause) return
          // Ohne Start wird das Zuhause der Start, sonst das Ziel.
          if (!start) setStart(zuhause), setStartText(zuhause.titel)
          else setZiel(zuhause), setZielText(zuhause.titel)
        }}
        kannSetzen={!!(start ?? ziel)}
      />
    </div>
  )

  const einstellungen = (
    <Einstellungen
      gewichte={gewichte}
      setzeGewicht={setzeGewicht}
      schieben={schieben}
      setSchieben={setSchieben}
      netzFarbig={netzFarbig}
      setNetzFarbig={setNetzFarbig}
      feinOffen={feinOffen}
      setFeinOffen={setFeinOffen}
    />
  )

  const inhalt = (
    <div className="flex flex-col gap-4" style={{ color: ui.fg }}>
      {fehler && <Hinweis>{fehler}</Hinweis>}
      {ergebnis && 'fehler' in ergebnis && <Hinweis>{ergebnis.fehler}</Hinweis>}
      {routen?.notSchieben && (
        <p className="rounded-2xl px-3 py-2 text-[12.5px] leading-snug" style={{ background: ui.weich, color: ui.muted }}>
          Fahrend gibt es keinen Weg. Diese Route enthält ein kurzes Stück, auf dem du das Velo schiebst.
        </p>
      )}
      {routen && r && aktiv ? (
        <Ergebnis
          r={r}
          routen={routen.routen}
          gleichWie={routen.gleichWie}
          aktiv={aktiv}
          setWahl={setWahl}
          hover={hover}
          setHover={setHover}
          gpx={gpx}
          teilen={teilen}
          kopiert={kopiert}
        />
      ) : (
        !fehler && !(ergebnis && 'fehler' in ergebnis) && (
          <Leerzustand geladen={graphBereit} statistik={graphRef.current?.meta.statistik} />
        )
      )}
      {einstellungen}
      <Legende />
      <p className="text-[11.5px] leading-snug" style={{ color: ui.muted }}>
        Grundlage ist das Fuss- und Velowegnetz der Stadt Zürich, ergänzt um Lichtsignale, Tempo,
        Velonetzplanung und Unfalldaten der Stadt sowie Belag und Tramgleise aus OpenStreetMap.{' '}
        <Link href="/methode#velonavi" className="underline underline-offset-2">
          Wie das gerechnet ist
        </Link>
        {' · '}
        <Link href="/" className="underline underline-offset-2">
          Zur Vergleichskarte
        </Link>
      </p>
    </div>
  )

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: ui.bg }}>
      <div ref={containerRef} className="h-full w-full" />

      {mobil ? (
        <>
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 px-3"
            style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
          >
            <div className="pointer-events-auto">{felder}</div>
          </div>
          <Blatt ui={ui} offen={blattOffen} onSchliessen={() => setBlattOffen(false)} onHoehe={setDeckung}>
            {inhalt}
          </Blatt>
          {!blattOffen && (
            <button
              onClick={() => setBlattOffen(true)}
              className="absolute inset-x-0 bottom-4 z-20 mx-auto w-max rounded-full border px-4 py-2 text-[13px] font-medium backdrop-blur-md"
              style={{ background: ui.panel, borderColor: ui.border, color: ui.fg, boxShadow: ui.schatten }}
            >
              {r ? `${minuten(r.zeit)} · ${km(r.distanz)}` : 'Einstellungen'}
            </button>
          )}
        </>
      ) : (
        <>
          <div
            className="absolute bottom-3 left-3 top-3 z-30 flex w-[24rem] flex-col overflow-hidden rounded-3xl border backdrop-blur-md"
            style={{ background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten }}
          >
            <div className="px-4 pb-3 pt-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h1 className="flex items-baseline gap-2 text-[15px] font-semibold">
                  <Link href="/" aria-label="Zur Startseite">
                    <Wortmarke size={15} />
                  </Link>
                  <span style={{ color: ui.muted }}>Velonavi Zürich</span>
                </h1>
                {routen && (
                  <span className="text-[11px] tabular-nums" style={{ color: ui.muted }}>
                    2 Routen in {Math.round(routen.ms)} ms
                  </span>
                )}
              </div>
              {felder}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-1.5">{inhalt}</div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Teile

/** Die Route als Linienstücke gleicher Stressstufe, für die Einfärbung. */
function routeAlsLinien(r: Route) {
  const features: { type: 'Feature'; properties: { stufe: number }; geometry: { type: 'LineString'; coordinates: [number, number][] } }[] = []
  let lauf: [number, number][] = []
  let stufe = r.stufen[1] ?? r.stufen[0]
  for (let i = 0; i < r.koordinaten.length; i++) {
    // Die Stufe eines Punkts gilt für das Stück, das zu ihm hinführt.
    const s = r.stufen[i]
    if (i > 0 && s !== stufe && lauf.length) {
      features.push({ type: 'Feature', properties: { stufe }, geometry: { type: 'LineString', coordinates: lauf } })
      lauf = [lauf[lauf.length - 1]]
    }
    stufe = s
    lauf.push(r.koordinaten[i])
  }
  if (lauf.length > 1) features.push({ type: 'Feature', properties: { stufe }, geometry: { type: 'LineString', coordinates: lauf } })
  return { type: 'FeatureCollection' as const, features }
}

function Ergebnis({
  r, routen, gleichWie, aktiv, setWahl, hover, setHover, gpx, teilen, kopiert,
}: {
  r: Route
  routen: Record<Variante, Route | null>
  gleichWie: Record<Variante, Variante | null>
  aktiv: Variante
  setWahl: (v: Variante) => void
  hover: number | null
  setHover: (i: number | null) => void
  gpx: () => void
  teilen: () => void
  kopiert: boolean
}) {
  const fakten: { titel: string; wert: string; hilfe?: string }[] = []
  const warten = Math.round(r.ampeln.wartezeit / 60)
  fakten.push({
    titel: 'Lichtsignale',
    wert:
      r.ampeln.geradeaus + r.ampeln.abbiegen === 0
        ? 'keine'
        : `${r.ampeln.geradeaus} geradeaus, ${r.ampeln.abbiegen} abbiegend`,
    hilfe: r.ampeln.geradeaus ? `im Mittel rund ${warten || '<1'} Min. Warten` : undefined,
  })
  if (r.vorzugM > 50) fakten.push({ titel: 'Auf Vorzugsrouten', wert: `${km(r.vorzugM)} (${prozent(r.vorzugM, r.distanz)})` })
  if (r.tramM > 30) fakten.push({ titel: 'Neben Tramgleisen', wert: km(r.tramM), hilfe: 'ohne Velostreifen, Gleise im Blick behalten' })
  if (r.kopfsteinM > 30) fakten.push({ titel: 'Kopfsteinpflaster', wert: km(r.kopfsteinM) })
  if (r.kiesM > 50) fakten.push({ titel: 'Kies oder Naturweg', wert: km(r.kiesM) })
  if (r.meterNachStufe[0] > 10) fakten.push({ titel: 'Schieben', wert: km(r.meterNachStufe[0]), hilfe: r.treppen ? `inkl. ${r.treppen} Treppe${r.treppen > 1 ? 'n' : ''}` : 'Fussweg, Velofahren nicht erlaubt' })
  if (r.huerden > 4)
    fakten.push({
      titel: 'Poller, Tore, Querungen',
      wert: `rund ${Math.round(r.huerden)} s`,
      hilfe: 'Abbremsen an Hindernissen und ungesicherten Übergängen',
    })
  fakten.push({ titel: 'Velounfälle entlang der Route', wert: nf(r.unfaelle), hilfe: 'seit 2016, polizeilich registriert' })

  return (
    <section className="flex flex-col gap-3">
      <Variantenwahl routen={routen} gleichWie={gleichWie} aktiv={aktiv} setWahl={setWahl} />

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">{minuten(r.zeit)}</div>
          <div className="mt-1.5 text-[13px] tabular-nums" style={{ color: ui.muted }}>
            {km(r.distanz)} · ↑ {meter(r.hoch)} · ↓ {meter(r.runter)}
          </div>
        </div>
        <div className="flex gap-1.5">
          <KleinKnopf onClick={gpx} titel="Als GPX-Datei für Navigationsgerät oder App">
            GPX
          </KleinKnopf>
          <KleinKnopf onClick={teilen} titel="Link auf diese Route">
            {kopiert ? 'Kopiert' : 'Teilen'}
          </KleinKnopf>
        </div>
      </div>

      <StressBalken r={r} />

      <Hoehenprofil r={r} hover={hover} setHover={setHover} />

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        {fakten.map((f) => (
          <div key={f.titel} className="contents">
            <dt style={{ color: ui.muted }}>{f.titel}</dt>
            <dd className="text-right tabular-nums">
              {f.wert}
              {f.hilfe && (
                <span className="block text-[11px]" style={{ color: ui.muted }}>
                  {f.hilfe}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <Wegbeschreibung r={r} />
    </section>
  )
}

/** Die drei Varianten nebeneinander; zusammengelegte teilen sich eine Karte. */
function Variantenwahl({
  routen, gleichWie, aktiv, setWahl,
}: {
  routen: Record<Variante, Route | null>
  gleichWie: Record<Variante, Variante | null>
  aktiv: Variante
  setWahl: (v: Variante) => void
}) {
  const karten = VARIANTEN.filter((v) => routen[v.id] && !gleichWie[v.id]).map((v) => ({
    id: v.id,
    titel: [v.titel, ...VARIANTEN.filter((w) => gleichWie[w.id] === v.id).map((w) => w.titel)].join(' = '),
    hilfe: v.hilfe,
    r: routen[v.id]!,
  }))
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${karten.length}, minmax(0, 1fr))` }}>
      {karten.map((k) => {
        const an = k.id === aktiv
        // «Angenehm» heisst Stufe 1 und 2: ruhig und höchstens leicht ruppig.
        const ruhig = k.r.meterNachStufe[1] + k.r.meterNachStufe[2]
        return (
          <button
            key={k.id}
            onClick={() => setWahl(k.id)}
            title={k.hilfe}
            aria-pressed={an}
            className="rounded-2xl border px-2.5 py-2 text-left transition-colors"
            style={{
              borderColor: an ? AKZENT : 'rgba(24,24,27,0.1)',
              background: an ? 'rgba(37,99,235,0.06)' : 'transparent',
              boxShadow: an ? `0 0 0 1px ${AKZENT}` : undefined,
            }}
          >
            <div className="truncate text-[11.5px] font-medium" style={{ color: an ? AKZENT : ui.muted }}>
              {k.titel}
            </div>
            <div className="mt-0.5 text-[17px] font-semibold leading-tight tabular-nums">{minuten(k.r.zeit)}</div>
            <div className="mt-0.5 text-[11px] leading-snug tabular-nums" style={{ color: ui.muted }}>
              {km(k.r.distanz)} · ↑{Math.round(k.r.hoch)} m
              <br />
              {prozent(ruhig, k.r.distanz)} angenehm · {k.r.ampeln.geradeaus} Ampeln
            </div>
          </button>
        )
      })}
    </div>
  )
}

function StressBalken({ r }: { r: Route }) {
  const reihenfolge = [1, 2, 3, 4, 0]
  const teile = reihenfolge.map((i) => ({ i, m: r.meterNachStufe[i] })).filter((t) => t.m > 0.5)
  return (
    <div>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Anteile der Strecke danach, wie angenehm sie zu fahren ist">
        {teile.map((t) => (
          <div
            key={t.i}
            title={`${STUFEN[t.i].name}: ${km(t.m)} (${prozent(t.m, r.distanz)})`}
            style={{ width: `${(100 * t.m) / r.distanz}%`, background: STUFEN[t.i].farbe, minWidth: 3 }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px]" style={{ color: ui.muted }}>
        {teile.map((t) => (
          <span key={t.i} className="flex items-center gap-1 tabular-nums">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: STUFEN[t.i].farbe }} />
            {STUFEN[t.i].kurz} <span style={{ color: ui.fg }}>{prozent(t.m, r.distanz)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Höhenprofil mit Fadenkreuz. Die Stelle erscheint zugleich auf der Karte. */
function Hoehenprofil({ r, hover, setHover }: { r: Route; hover: number | null; setHover: (i: number | null) => void }) {
  const B = 340
  const H = 78
  const P = { l: 30, r: 4, t: 6, b: 16 }
  const hs = r.profil.map((p) => p[1])
  const min = Math.floor(Math.min(...hs) / 10) * 10
  const max = Math.max(min + 30, Math.ceil(Math.max(...hs) / 10) * 10)
  const D = r.distanz || 1
  const x = (d: number) => P.l + ((B - P.l - P.r) * d) / D
  const y = (h: number) => P.t + ((H - P.t - P.b) * (max - h)) / (max - min)
  const linie = r.profil.map(([d, h], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(h).toFixed(1)}`).join('')
  const flaeche = `${linie}L${x(D).toFixed(1)},${y(min)}L${x(0)},${y(min)}Z`
  const ref = useRef<SVGSVGElement>(null)

  const bewegen = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect()
    const d = (((e.clientX - box.left) / box.width) * B - P.l) / (B - P.l - P.r) * D
    let lo = 0, hi = r.profil.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (r.profil[mid][0] < d) lo = mid + 1
      else hi = mid
    }
    setHover(lo)
  }
  const h = hover !== null ? r.profil[hover] : null
  return (
    <figure className="m-0">
      <figcaption className="mb-1 flex justify-between text-[11.5px]" style={{ color: ui.muted }}>
        <span>Höhenprofil</span>
        {h && (
          <span className="tabular-nums">
            <span style={{ color: ui.fg }}>{Math.round(h[1])} m ü. M.</span> bei {km(h[0])}
          </span>
        )}
      </figcaption>
      <svg
        ref={ref}
        viewBox={`0 0 ${B} ${H}`}
        className="w-full touch-none select-none"
        onPointerMove={bewegen}
        onPointerDown={bewegen}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Höhenprofil von ${Math.round(hs[0])} bis ${Math.round(hs[hs.length - 1])} m ü. M., tiefster Punkt ${Math.round(Math.min(...hs))}, höchster ${Math.round(Math.max(...hs))}`}
      >
        {[min, max].map((v) => (
          <g key={v}>
            <line x1={P.l} x2={B - P.r} y1={y(v)} y2={y(v)} stroke="rgba(24,24,27,0.08)" />
            <text x={P.l - 4} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill={ui.muted}>
              {v}
            </text>
          </g>
        ))}
        <text x={B - P.r} y={H - 3} textAnchor="end" fontSize="9.5" fill={ui.muted}>
          {km(D)}
        </text>
        <text x={P.l} y={H - 3} fontSize="9.5" fill={ui.muted}>
          0
        </text>
        <path d={flaeche} fill="rgba(37,99,235,0.1)" />
        <path d={linie} fill="none" stroke={AKZENT} strokeWidth="2" strokeLinejoin="round" />
        {h && (
          <g>
            <line x1={x(h[0])} x2={x(h[0])} y1={P.t} y2={H - P.b} stroke="#18181b" strokeWidth="1" strokeOpacity="0.4" />
            <circle cx={x(h[0])} cy={y(h[1])} r="4" fill={AKZENT} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
    </figure>
  )
}

/** Strassenfolge, kurze Stücke zusammengelegt. */
function Wegbeschreibung({ r }: { r: Route }) {
  const [offen, setOffen] = useState(false)
  const zeilen: { name: string; meter: number }[] = []
  for (const s of r.strassen) {
    const name = /^(fussweg|park|parkplatz|brücke|weg)$/i.test(s.name) || !s.name ? 'Weg' : s.name
    const letzte = zeilen[zeilen.length - 1]
    if (letzte && (letzte.name === name || s.meter < 40)) letzte.meter += s.meter
    else zeilen.push({ name, meter: s.meter })
  }
  return (
    <div>
      <button onClick={() => setOffen(!offen)} className="text-[12.5px] font-medium" style={{ color: AKZENT }}>
        {offen ? 'Strassenfolge ausblenden' : `Strassenfolge (${zeilen.length})`}
      </button>
      {offen && (
        <ol className="mt-2 flex flex-col gap-1 text-[12.5px]">
          {zeilen.map((z, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="truncate">{z.name}</span>
              <span className="shrink-0 tabular-nums" style={{ color: ui.muted }}>
                {km(z.meter)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Einstellungen({
  gewichte, setzeGewicht, schieben, setSchieben,
  netzFarbig, setNetzFarbig, feinOffen, setFeinOffen,
}: {
  gewichte: Record<(typeof REGLER)[number]['id'], number>
  setzeGewicht: (id: (typeof REGLER)[number]['id'], v: number) => void
  schieben: boolean
  setSchieben: (v: boolean) => void
  netzFarbig: boolean
  setNetzFarbig: (v: boolean) => void
  feinOffen: boolean
  setFeinOffen: (v: boolean) => void
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <button onClick={() => setFeinOffen(!feinOffen)} className="self-start text-[12.5px] font-medium" style={{ color: AKZENT }}>
        {feinOffen ? 'Feineinstellung ausblenden' : 'Komfort-Route selbst gewichten'}
      </button>
      {feinOffen && (
        <div className="flex flex-col gap-2.5">
          <p className="text-[11.5px]" style={{ color: ui.muted }}>
            Gilt für die Variante «Komfort». «Schnell» bleibt fest.
          </p>
          {REGLER.map((rg) => (
            <label key={rg.id} className="block text-[12.5px]">
              <span className="flex justify-between">
                <span>{rg.titel}</span>
                <span className="tabular-nums" style={{ color: ui.muted }}>
                  {Math.round(gewichte[rg.id] * 100)}%
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={gewichte[rg.id]}
                onChange={(e) => setzeGewicht(rg.id, Number(e.target.value))}
                className="regler mt-1"
                style={
                  {
                    '--fuellung': `linear-gradient(to right, ${AKZENT} ${gewichte[rg.id] * 100}%, rgba(24,24,27,0.12) ${gewichte[rg.id] * 100}%)`,
                    '--knopf': '#ffffff',
                    '--ring': ui.ring,
                  } as React.CSSProperties
                }
              />
            </label>
          ))}
          <Schalter an={schieben} setAn={setSchieben} titel="Schieben erlauben" hilfe="Kurze Stücke zu Fuss, wo Velos nicht fahren dürfen" />
        </div>
      )}
      <Schalter an={netzFarbig} setAn={setNetzFarbig} titel="Ganzes Velonetz einfärben" />
    </section>
  )
}

/** Zuhause als Ein-Klick-Ziel, dazu der Stern zum Setzen und Entfernen. */
function Zuhausezeile({
  zuhause, setzen, loeschen, waehlen, kannSetzen,
}: {
  zuhause: Punkt | null
  setzen: () => void
  loeschen: () => void
  waehlen: () => void
  kannSetzen: boolean
}) {
  if (!zuhause)
    return kannSetzen ? (
      <button
        onClick={setzen}
        className="flex items-center gap-1.5 self-start rounded-full border px-3 py-1 text-[12px] backdrop-blur-md"
        style={{ background: ui.panel, borderColor: ui.border, color: ui.muted, boxShadow: ui.schatten }}
      >
        <Sternsymbol gefuellt={false} />
        Als Zuhause merken
      </button>
    ) : null
  return (
    <div
      className="flex items-center gap-1 self-start rounded-full border pl-2.5 pr-1 backdrop-blur-md"
      style={{ background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten }}
    >
      <button onClick={waehlen} className="flex items-center gap-1.5 py-1 text-[12px]" style={{ color: ui.fg }}>
        <span style={{ color: '#eab308' }}>
          <Sternsymbol />
        </span>
        <span className="max-w-[12rem] truncate">{zuhause.titel}</span>
      </button>
      <button onClick={loeschen} aria-label="Zuhause entfernen" className="px-1.5 text-[14px] leading-none" style={{ color: ui.muted }}>
        ×
      </button>
    </div>
  )
}

function Segmente({ werte, aktiv, onWahl }: { werte: { id: string; titel: string }[]; aktiv: string; onWahl: (id: string) => void }) {
  return (
    <div className="flex gap-1 rounded-full p-1" style={{ background: ui.weich }}>
      {werte.map((w) => (
        <button
          key={w.id}
          onClick={() => onWahl(w.id)}
          className="flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors"
          style={aktiv === w.id ? { background: ui.aktiv, color: ui.fg, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : { color: ui.muted }}
          aria-pressed={aktiv === w.id}
        >
          {w.titel}
        </button>
      ))}
    </div>
  )
}

function Schalter({ an, setAn, titel, hilfe }: { an: boolean; setAn: (v: boolean) => void; titel: string; hilfe?: string }) {
  return (
    <button onClick={() => setAn(!an)} className="flex items-center justify-between gap-3 text-left text-[12.5px]" role="switch" aria-checked={an}>
      <span>
        {titel}
        {hilfe && (
          <span className="block text-[11px]" style={{ color: ui.muted }}>
            {hilfe}
          </span>
        )}
      </span>
      <span className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ background: an ? AKZENT : 'rgba(24,24,27,0.15)' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: an ? 18 : 2 }} />
      </span>
    </button>
  )
}

function Legende() {
  return (
    <section className="flex flex-col gap-1.5 text-[11.5px]" style={{ color: ui.muted }}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {[1, 2, 3, 4, 0].map((i) => (
          <span key={i} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="2" y1="3" x2="16" y2="3" stroke={STUFEN[i].farbe} strokeWidth="4" strokeLinecap="round" strokeDasharray={i === 0 ? '2 4' : undefined} />
            </svg>
            {STUFEN[i].name}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="2" y1="3" x2="16" y2="3" stroke={VORZUG} strokeOpacity="0.6" strokeWidth="4" strokeLinecap="round" />
          </svg>
          Vorzugsroute
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="10" aria-hidden>
            <circle cx="9" cy="5" r="3.5" fill="#18181b" />
          </svg>
          Ampel geradeaus
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="10" aria-hidden>
            <circle cx="9" cy="5" r="3.5" fill="#fff" stroke="#18181b" strokeWidth="1.5" />
          </svg>
          Ampel beim Abbiegen
        </span>
      </div>
    </section>
  )
}

function Leerzustand({ geladen, statistik }: { geladen: boolean; statistik?: VeloMeta['statistik'] }) {
  return (
    <section className="text-[13px] leading-snug">
      <p>
        Start und Ziel eingeben oder in die Karte tippen. Die Route berücksichtigt Verkehr, Velostreifen,
        Tramgleise, Kopfsteinpflaster, Steigung, Poller und Tore, und bei Lichtsignalen, ob man geradeaus
        über die Kreuzung muss oder nur abbiegt.
      </p>
      <p className="mt-2 text-[12px]" style={{ color: ui.muted }}>
        {geladen && statistik
          ? `${nf(statistik.veloKm)} km Velonetz, ${nf(statistik.ampelKnoten)} Kreuzungen mit Ampel, ${nf(statistik.verbote)} Abbiegeverbote.`
          : 'Velonetz wird geladen …'}
      </p>
    </section>
  )
}

function Hinweis({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl px-3 py-2.5 text-[12.5px]" style={{ background: 'rgba(208,59,59,0.08)', color: '#8f2323' }}>
      {children}
    </p>
  )
}

function KleinKnopf({ onClick, titel, children }: { onClick: () => void; titel: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={titel}
      className="rounded-full border px-3 py-1.5 text-[12px] font-medium"
      style={{ borderColor: 'rgba(24,24,27,0.12)', color: ui.fg }}
    >
      {children}
    </button>
  )
}

function Marke({ farbe }: { farbe: string }) {
  return <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: farbe, boxShadow: '0 0 0 2px #fff, 0 0 0 3px rgba(0,0,0,0.12)' }} />
}

function OrtungSymbol() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  )
}

function TauschSymbol() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
    </svg>
  )
}

const ARTEN_NAMEN: Record<string, string> = {
  cafe: 'Café',
  bar: 'Bar',
  buehne: 'Bühne',
  kino: 'Kino',
  museum: 'Museum',
  kunst: 'Kunst',
  bibliothek: 'Bibliothek',
  badi: 'Badi',
  treff: 'Quartiertreff',
  restaurant: 'Restaurant',
}
