'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Map as MapLibreMap, NavigationControl, AttributionControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import { Wortmarke } from '../marke'
import { KARMIN, TINTE, GRUND } from '../farben'
import { STAEDTE } from '../staedte'
import { useMedienabfrage } from '../blatt'
import { Seitenwahl } from '../seitenwahl'
import { nf } from '../site'
import { GESAMMELT, WEITERE, type Suche } from './quellen'
import { Anmeldung, useAbmeldelink, useKonto, useMerklisteImKonto } from './konto'
import { SuchaboDialog } from './suchabo'
import type { Art, Inserat, QuellenId, Wohnungen } from './typen'
import type { Kreis } from './kreise'
import { FILTER_LEER, SORTEN, TAG, meter, passt, type Filter, type Gebiet, type Sorte } from './filter'

/**
 * Woher die Inserate kommen. Der Workflow `wohnungen.yml` legt die Datei
 * mehrmals am Tag auf den Zweig «wohnungen», damit main nicht bei jedem Lauf
 * einen Commit bekommt und die Seite nicht neu gebaut werden muss. GitHub
 * liefert Rohdateien mit `Access-Control-Allow-Origin: *` aus. Wer selbst
 * betreibt, setzt `NEXT_PUBLIC_WOHNUNGEN_URL` oder legt die Datei unter
 * `public/data/zuerich/wohnungen.json` ab, das ist der Rückfall.
 */
const DATEN_URL =
  process.env.NEXT_PUBLIC_WOHNUNGEN_URL ||
  'https://raw.githubusercontent.com/moritzlauper/angebunden/wohnungen/wohnungen.json'
const DATEN_LOKAL = '/data/zuerich/wohnungen.json'

const ARTEN: { id: Art; name: string }[] = [
  { id: 'wohnung', name: 'Wohnung' },
  { id: 'wg', name: 'WG-Zimmer' },
  { id: 'studio', name: 'Studio' },
  { id: 'moebliert', name: 'Möbliert' },
  { id: 'haus', name: 'Haus' },
]


const SPEICHER = {
  filter: 'wohnungen.filter2',
  gemerkt: 'wohnungen.gemerkt',
  weg: 'wohnungen.ausgeblendet',
  besuch: 'wohnungen.besuch',
}

/** localStorage kann fehlen oder werfen (privates Fenster, gesperrte Websitedaten). */
function lies<T>(schluessel: string, sonst: T): T {
  try {
    const roh = localStorage.getItem(schluessel)
    return roh == null ? sonst : (JSON.parse(roh) as T)
  } catch {
    return sonst
  }
}
function schreib(schluessel: string, wert: unknown) {
  try {
    localStorage.setItem(schluessel, JSON.stringify(wert))
  } catch {}
}


function vor(iso: string, jetzt: number) {
  const min = Math.max(0, Math.round((jetzt - Date.parse(iso)) / 60000))
  if (min < 60) return min <= 1 ? 'gerade eben' : `vor ${min} Min.`
  const std = Math.round(min / 60)
  if (std < 24) return `vor ${std} Std.`
  const tage = Math.round(std / 24)
  return tage === 1 ? 'gestern' : `vor ${tage} Tagen`
}

function bezugText(b: string | null) {
  if (!b) return null
  if (b === 'sofort' || b === 'nach Vereinbarung') return `Bezug ${b}`
  const [j, m, t] = b.split('-')
  return `Bezug ab ${t}.${m}.${j}`
}

function zimmerText(z: number) {
  return String(z).replace('.5', '½')
}

/** Anteil der Häuser, die mindestens so gut dastehen, als «Top x %». */
function top(rang: number | null, haeuser: number) {
  if (rang == null || !haeuser) return null
  const p = (rang / haeuser) * 100
  return p < 1 ? 'Top 1 %' : `Top ${Math.ceil(p)} %`
}


/** Ein Kreis als Polygon für die Karte. */
function kreisPolygon(g: Gebiet) {
  const ring: [number, number][] = []
  for (let k = 0; k <= 64; k++) {
    const w = (k / 64) * 2 * Math.PI
    ring.push([g.lon + (Math.cos(w) * g.r) / 75_400, g.lat + (Math.sin(w) * g.r) / 111_133])
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } }
}


const SORTIER: Record<Sorte, (a: Inserat, b: Inserat) => number> = {
  neu: (a, b) => b.erstGesehen.localeCompare(a.erstGesehen),
  guenstig: (a, b) => (a.miete ?? Infinity) - (b.miete ?? Infinity),
  m2: (a, b) =>
    (a.miete && a.flaeche ? a.miete / a.flaeche : Infinity) - (b.miete && b.flaeche ? b.miete / b.flaeche : Infinity),
  oev: (a, b) => (a.oev ?? Infinity) - (b.oev ?? Infinity),
  kultur: (a, b) => (b.kultur ?? -1) - (a.kultur ?? -1),
  gross: (a, b) => (b.flaeche ?? -1) - (a.flaeche ?? -1),
}

/** Die helle Zürcher Basiskarte, wie auf der Erreichbarkeitskarte. */
function zuriWms() {
  const dicht = typeof window !== 'undefined' && window.devicePixelRatio > 1.5
  const px = Math.round(512 * (dicht ? 2 : 1) * 1.5)
  return (
    'https://www.ogd.stadt-zuerich.ch/wms/geoportal/Basiskarte_Zuerich_Raster?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
    `&LAYERS=${encodeURIComponent('Basiskarte Zürich Raster')}&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}` +
    `&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/png${dicht ? '&DPI=192' : ''}`
  )
}

function alsGeojson(liste: Inserat[]) {
  return {
    type: 'FeatureCollection' as const,
    features: liste
      .filter((i) => i.lon != null && i.lat != null)
      .map((i) => ({
        type: 'Feature' as const,
        // Dunkel unbefristet, hell befristet. Die ÖV-Anbindung steht in der Karteikarte.
        properties: { id: i.id, farbe: i.befristet ? KARMIN[4] : KARMIN[1] },
        geometry: { type: 'Point' as const, coordinates: [i.lon!, i.lat!] },
      })),
  }
}

/**
 * `kreis` beschränkt die Seite auf einen Stadtkreis (`/wohnungen/kreis-4`),
 * `unten` ist der Text unter der Liste, vom Server gerendert, damit ihn
 * Suchmaschinen lesen.
 */
export default function Wohnungssuche({ kreis, unten }: { kreis?: Kreis; unten?: ReactNode } = {}) {
  const [daten, setDaten] = useState<Wohnungen | null>(null)
  const [ladefehler, setLadefehler] = useState(false)
  const [filter, setFilter] = useState<Filter>(FILTER_LEER)
  const [gemerkt, setGemerkt] = useState<Set<string>>(new Set())
  const [weg, setWeg] = useState<Set<string>>(new Set())
  const [letzterBesuch, setLetzterBesuch] = useState<number | null>(null)
  const [auswahl, setAuswahl] = useState<string | null>(null)
  const [ausschnitt, setAusschnitt] = useState<[number, number, number, number] | null>(null)
  const [anzahl, setAnzahl] = useState(40)
  const [ansicht, setAnsicht] = useState<'liste' | 'karte'>('liste')
  const [filterOffen, setFilterOffen] = useState(false)
  const [jetzt, setJetzt] = useState(() => Date.now())
  const breit = useMedienabfrage('(min-width: 900px)')

  // Mit Konto liegt die Merkliste zusätzlich dort und gilt auf jedem Gerät.
  const k = useKonto()
  const [aboOffen, setAboOffen] = useState(false)
  const [abmeldung, setAbmeldung] = useAbmeldelink()
  const merkliste = useMemo(() => ({ gemerkt: [...gemerkt], weg: [...weg], filter: { ...filter, nurAusschnitt: false } }), [gemerkt, weg, filter])
  useMerklisteImKonto(k.nutzer, merkliste, (m) => {
    setGemerkt(new Set(m.gemerkt))
    schreib(SPEICHER.gemerkt, m.gemerkt)
    setWeg(new Set(m.weg))
    schreib(SPEICHER.weg, m.weg)
    if (m.filter) {
      const f = { ...FILTER_LEER, ...(m.filter as Partial<Filter>), nurAusschnitt: false }
      setFilter(f)
      schreib(SPEICHER.filter, f)
    }
  })

  const kartenRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  // Erst nach `load` nimmt die Karte Daten an. Als State, damit die Effekte unten danach nachziehen.
  const [karteBereit, setKarteBereit] = useState(false)
  const listeRef = useRef<HTMLDivElement>(null)

  // Die Grundkarte ist hell; wer vom dunklen Velonavi herüberkommt, bekäme sonst dunkle Knöpfe darauf.
  useEffect(() => {
    document.documentElement.dataset.thema = 'hell'
  }, [])

  // Gespeichertes aus dem Browser. Der letzte Besuch zählt erst ab einer Stunde
  // Abstand, sonst wäre nach jedem Neuladen nichts mehr «neu».
  useEffect(() => {
    setFilter({ ...FILTER_LEER, ...lies<Partial<Filter>>(SPEICHER.filter, {}), nurAusschnitt: false })
    setGemerkt(new Set(lies<string[]>(SPEICHER.gemerkt, [])))
    setWeg(new Set(lies<string[]>(SPEICHER.weg, [])))
    const besuch = lies<{ zuletzt: number; davor: number | null } | null>(SPEICHER.besuch, null)
    const t = Date.now()
    if (!besuch) {
      schreib(SPEICHER.besuch, { zuletzt: t, davor: null })
    } else if (t - besuch.zuletzt > 3600_000) {
      setLetzterBesuch(besuch.zuletzt)
      schreib(SPEICHER.besuch, { zuletzt: t, davor: besuch.zuletzt })
    } else {
      setLetzterBesuch(besuch.davor)
      schreib(SPEICHER.besuch, { ...besuch, zuletzt: t })
    }
    const uhr = setInterval(() => setJetzt(Date.now()), 60_000)
    return () => clearInterval(uhr)
  }, [])

  useEffect(() => {
    let weg = false
    const laden = async () => {
      for (const url of [DATEN_URL, DATEN_LOKAL]) {
        try {
          const res = await fetch(url, { cache: 'no-cache' })
          if (!res.ok) continue
          const d = (await res.json()) as Wohnungen
          if (!weg) setDaten(d)
          return
        } catch {}
      }
      if (!weg) setLadefehler(true)
    }
    laden()
    // Der Sammler läuft mehrmals am Tag; wer die Seite offen lässt, bekommt neue Inserate ohne Neuladen.
    const t = setInterval(laden, 5 * 60_000)
    return () => {
      weg = true
      clearInterval(t)
    }
  }, [])

  const aendern = useCallback((teil: Partial<Filter>) => {
    setFilter((f) => {
      const neu = { ...f, ...teil }
      schreib(SPEICHER.filter, neu)
      return neu
    })
    setAnzahl(40)
  }, [])

  const umschalten = (menge: Set<string>, id: string, setzen: (s: Set<string>) => void, schluessel: string) => {
    const neu = new Set(menge)
    if (neu.has(id)) neu.delete(id)
    else neu.add(id)
    setzen(neu)
    schreib(schluessel, [...neu])
  }

  // Auf einer Kreisseite nur die Inserate dieses Kreises.
  const basis = useMemo(
    () => (daten ? (kreis ? daten.inserate.filter((i) => i.plz != null && kreis.plz.includes(i.plz)) : daten.inserate) : []),
    [daten, kreis]
  )

  const treffer = useMemo(() => {
    if (!daten) return []
    return basis
      .filter((i) => !weg.has(i.id) && passt(i, filter, gemerkt, jetzt, ausschnitt))
      .sort(SORTIER[filter.sorte])
  }, [daten, basis, filter, gemerkt, weg, jetzt, ausschnitt])

  const neuSeitBesuch = useMemo(
    () => (letzterBesuch ? treffer.filter((i) => Date.parse(i.erstGesehen) > letzterBesuch).length : 0),
    [treffer, letzterBesuch]
  )

  // ── Karte ──────────────────────────────────────────────────────────────
  const zeigeKarte = breit || ansicht === 'karte'

  // Zeichnen läuft in MapLibre-Ereignissen; die lesen den Zustand über Refs.
  const [zeichnen, setZeichnen] = useState(false)
  const zeichnenRef = useRef(false)
  const entwurfRef = useRef<Gebiet | null>(null)
  const gebieteRef = useRef<Gebiet[]>([])
  gebieteRef.current = filter.gebiete
  const gebietDazuRef = useRef((g: Gebiet) => {})
  gebietDazuRef.current = (g) => {
    setZeichnen(false)
    aendern({ gebiete: [...filter.gebiete, g] })
  }
  const zeichneGebiete = useCallback(() => {
    const map = mapRef.current
    const quelle = map?.getSource('gebiete') as GeoJSONSource | undefined
    const alle = entwurfRef.current ? [...gebieteRef.current, entwurfRef.current] : gebieteRef.current
    quelle?.setData({ type: 'FeatureCollection', features: alle.map(kreisPolygon) })
  }, [])

  useEffect(() => {
    zeichnenRef.current = zeichnen
    const map = mapRef.current
    if (!map) return
    // Beim Zeichnen verschiebt ein Ziehen nicht die Karte.
    if (zeichnen) {
      map.dragPan.disable()
      map.touchZoomRotate.disable()
      map.getCanvas().style.cursor = 'crosshair'
    } else {
      map.dragPan.enable()
      map.touchZoomRotate.enable()
      map.touchZoomRotate.disableRotation()
      map.getCanvas().style.cursor = ''
    }
  }, [zeichnen, karteBereit])

  useEffect(() => {
    if (karteBereit) zeichneGebiete()
  }, [filter.gebiete, karteBereit, zeichneGebiete])

  useEffect(() => {
    if (!zeigeKarte || !kartenRef.current || mapRef.current) return
    setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')
    const stadt = STAEDTE.zuerich
    const map = new MapLibreMap({
      container: kartenRef.current,
      style: {
        version: 8,
        glyphs: '/fonts/{fontstack}/{range}.pbf',
        sources: {
          stadt: { type: 'geojson', data: `${stadt.daten}/city.geojson` },
          wasser: { type: 'geojson', data: `${stadt.daten}/water.geojson` },
          strassen: { type: 'geojson', data: `${stadt.daten}/streets.geojson` },
          zuri: {
            type: 'raster',
            tiles: [zuriWms()],
            tileSize: 512,
            attribution: '© Stadt Zürich',
          },
          inserate: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
          gebiete: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          // Eigene Grundkarte aus den Daten der Erreichbarkeitskarte. Darüber, sobald geladen,
          // die Basiskarte der Stadt mit Hausnummern und Namen.
          { id: 'grund', type: 'background', paint: { 'background-color': '#f7f7f5' } },
          { id: 'stadt', type: 'fill', source: 'stadt', paint: { 'fill-color': '#ffffff' } },
          { id: 'wasser', type: 'fill', source: 'wasser', paint: { 'fill-color': GRUND.wasser } },
          {
            id: 'strassen-neben',
            type: 'line',
            source: 'strassen',
            filter: ['==', ['get', 'k'], 'neben'],
            paint: {
              'line-color': GRUND.strasseNeben,
              'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 14, 0.8, 17, 3],
            },
          },
          {
            id: 'strassen-haupt',
            type: 'line',
            source: 'strassen',
            filter: ['==', ['get', 'k'], 'haupt'],
            paint: {
              'line-color': GRUND.strasseHaupt,
              'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 14, 2, 17, 7],
            },
          },
          {
            id: 'zuri',
            type: 'raster',
            source: 'zuri',
            paint: { 'raster-saturation': -0.6, 'raster-contrast': -0.05, 'raster-fade-duration': 150 },
          },
          {
            id: 'gebiete-flaeche',
            type: 'fill',
            source: 'gebiete',
            paint: { 'fill-color': KARMIN[2], 'fill-opacity': 0.08 },
          },
          {
            id: 'gebiete-rand',
            type: 'line',
            source: 'gebiete',
            paint: { 'line-color': KARMIN[1], 'line-width': 2, 'line-dasharray': [2, 1.5] },
          },
          {
            id: 'inserate',
            type: 'circle',
            source: 'inserate',
            paint: {
              'circle-color': ['get', 'farbe'],
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 7, 18, 10],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1.5,
            },
          },
          {
            id: 'auswahl',
            type: 'circle',
            source: 'inserate',
            filter: ['==', ['get', 'id'], ''],
            paint: {
              'circle-color': ['get', 'farbe'],
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 8, 15, 11, 18, 14],
              'circle-stroke-color': TINTE,
              'circle-stroke-width': 2.5,
            },
          },
        ],
      },
      center: stadt.center,
      zoom: 12.2,
      minZoom: 10,
      maxZoom: 18,
      maxBounds: stadt.maxBounds,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-left')
    map.touchZoomRotate.disableRotation()

    const merkeAusschnitt = () => {
      const b = map.getBounds()
      setAusschnitt([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    }
    // Nicht auf `load` warten: Das kommt erst, wenn alle Kacheln da sind, und bleibt
    // ganz aus, solange die Basiskarte der Stadt nicht erreichbar ist.
    map.once('style.load', () => {
      merkeAusschnitt()
      setKarteBereit(true)
    })
    map.on('moveend', merkeAusschnitt)
    map.on('click', 'inserate', (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (!id) return
      setAuswahl(id)
      if (!breit) setAnsicht('karte')
    })
    // Gebiet zeichnen: drücken setzt die Mitte, ziehen den Radius, loslassen legt den Kreis ab.
    let start: { lon: number; lat: number } | null = null
    const ziehen = (lon: number, lat: number) => {
      if (!start) return
      entwurfRef.current = { ...start, r: meter(start.lon, start.lat, lon, lat) }
      zeichneGebiete()
    }
    const anfangen = (e: { lngLat: { lng: number; lat: number }; preventDefault: () => void }) => {
      if (!zeichnenRef.current) return
      e.preventDefault()
      start = { lon: e.lngLat.lng, lat: e.lngLat.lat }
      entwurfRef.current = { ...start, r: 0 }
    }
    const aufhoeren = () => {
      if (!start) return
      const g = entwurfRef.current
      start = null
      entwurfRef.current = null
      // Ein Tippen ohne Ziehen gibt einen Kreis von 400 m.
      gebietDazuRef.current({ ...g!, r: Math.round(g!.r < 60 ? 400 : g!.r) })
    }
    map.on('mousedown', anfangen)
    map.on('touchstart', anfangen)
    map.on('mousemove', (e) => ziehen(e.lngLat.lng, e.lngLat.lat))
    map.on('touchmove', (e) => ziehen(e.lngLat.lng, e.lngLat.lat))
    map.on('mouseup', aufhoeren)
    map.on('touchend', aufhoeren)
    map.on('mouseenter', 'inserate', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'inserate', () => (map.getCanvas().style.cursor = ''))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setKarteBereit(false)
    }
    // `breit` nur beim Aufbau: Wechselt die Breite, baut der Effekt die Karte über `zeigeKarte` neu auf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeigeKarte])

  // Die Punkte zeigen, was der Filter durchlässt, ausser dem Kartenausschnitt selbst:
  // Sonst verschwände beim Verschieben alles, was gerade erst ins Bild käme.
  const punkte = useMemo(() => {
    if (!daten) return []
    const f = { ...filter, nurAusschnitt: false }
    return basis.filter((i) => !weg.has(i.id) && passt(i, f, gemerkt, jetzt, null))
  }, [daten, basis, filter, gemerkt, weg, jetzt])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !karteBereit || !daten) return
    ;(map.getSource('inserate') as GeoJSONSource | undefined)?.setData(alsGeojson(punkte))
  }, [punkte, daten, karteBereit])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !karteBereit) return
    map.setFilter('auswahl', ['==', ['get', 'id'], auswahl ?? ''])
  }, [auswahl, karteBereit])

  // Ein Klick auf einen Punkt holt das Inserat in der Liste ins Bild.
  useEffect(() => {
    if (!auswahl || !breit) return
    const idx = treffer.findIndex((i) => i.id === auswahl)
    if (idx >= anzahl) setAnzahl(idx + 10)
    requestAnimationFrame(() =>
      document.getElementById(`inserat-${auswahl}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auswahl])

  const aufKarte = (i: Inserat) => {
    setAuswahl(i.id)
    if (!breit) setAnsicht('karte')
    if (i.lon != null && i.lat != null) {
      // Auf dem Handy existiert die Karte erst nach dem Umschalten.
      requestAnimationFrame(() =>
        mapRef.current?.flyTo({ center: [i.lon!, i.lat!], zoom: Math.max(mapRef.current.getZoom(), 15) })
      )
    }
  }

  const ausgewaehlt = auswahl ? daten?.inserate.find((i) => i.id === auswahl) ?? null : null

  // ── Darstellung ────────────────────────────────────────────────────────
  const ui = {
    fg: 'var(--ab-tinte)',
    muted: 'var(--ab-leise)',
    panel: 'var(--ab-blatt)',
    border: 'var(--ab-linie)',
    aktiv: 'var(--ab-aktiv)',
    schatten: 'none',
  }
  const kopf = (
    <>
    <div className="flex justify-center px-4 pt-4">
      <Seitenwahl ui={ui} aktiv="wohnungen" immer />
    </div>
    <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <Link href="/" aria-label="angebunden · zum Velonavi" className="hover:opacity-70">
          <Wortmarke size={15} />
        </Link>
        <h1 className="truncate text-[15px] font-semibold tracking-tight">
          {kreis ? `Wohnungen Zürich Kreis ${kreis.nummer}` : 'Wohnungen in Zürich'}
        </h1>
      </div>
      <Anmeldung k={k} />
    </header>
    </>
  )

  const stand = daten && (
    <div className="px-4 pb-2 text-[12px] leading-relaxed text-[var(--ab-leise)] sm:px-5">
      {nf(daten.inserate.length)} Inserate aus {daten.quellen.filter((q) => q.anzahl > 0).length} Quellen, zuletzt
      gesammelt {vor(daten.erstellt, jetzt)}
      {/* «vor 5 Min.» endet schon auf einen Punkt. */}
      {vor(daten.erstellt, jetzt).endsWith('.') ? ' ' : '. '}
      {daten.quellen
        .filter((q) => !q.ok)
        .map((q) => (
          <span key={q.id}>
            {q.name} hat diesmal nicht geantwortet
            {q.zuletzt ? ` (letzter Abruf ${vor(q.zuletzt, jetzt)})` : ''}.{' '}
          </span>
        ))}
    </div>
  )

  const filterfeld = (
    <Filterfeld
      filter={filter}
      aendern={aendern}
      offen={filterOffen || breit}
      umklappen={breit ? null : () => setFilterOffen((o) => !o)}
      zaehlen={daten ? daten.quellen : []}
    />
  )

  const liste = (
    <div className="px-3 pb-6 sm:px-4">
      {abmeldung && (
        <div className="mx-1 mt-3 flex items-start justify-between gap-3 rounded-2xl bg-[var(--ab-weich)] px-3.5 py-2.5 text-[13px]">
          <span>{abmeldung}</span>
          <button type="button" onClick={() => setAbmeldung(null)} aria-label="Schliessen" className="text-[var(--ab-leise)]">
            ✕
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setAboOffen(true)}
        className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-[var(--ab-linie)] bg-[var(--ab-blatt)] px-3.5 py-2.5 text-left hover:bg-[var(--ab-weich)]"
      >
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ab-tinte)] text-[14px] text-[var(--ab-papier)]">
          ✉
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium">Suchabo per E-Mail</span>
          <span className="block truncate text-[12px] text-[var(--ab-leise)]">Mail, sobald eine neue Wohnung zu diesen Filtern passt</span>
        </span>
        <span aria-hidden className="text-[var(--ab-leise)]">→</span>
      </button>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 pt-4 pb-2.5">
        <div className="text-[15px] font-semibold tracking-tight">
          {daten ? `${nf(treffer.length)} ${treffer.length === 1 ? 'Wohnung' : 'Wohnungen'}` : ladefehler ? '' : 'Lade Inserate …'}
          {neuSeitBesuch > 0 && (
            <span className="ml-2 rounded-full bg-[var(--ab-karmin)] px-2 py-0.5 align-middle text-[11px] font-semibold text-white">
              {neuSeitBesuch} neu
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[12px] text-[var(--ab-leise)]">
          {breit && (
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={filter.nurAusschnitt} onChange={(e) => aendern({ nurAusschnitt: e.target.checked })} />
              Nur Kartenausschnitt
            </label>
          )}
          <select
            value={filter.sorte}
            onChange={(e) => aendern({ sorte: e.target.value as Sorte })}
            className="rounded-full border border-[var(--ab-linie)] bg-[var(--ab-aktiv)] px-2.5 py-1 text-[12px] font-medium text-[var(--ab-tinte)]"
            aria-label="Sortierung"
          >
            {Object.entries(SORTEN).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {ladefehler && !daten && (
        <p className="mx-1 rounded-xl border border-[var(--ab-linie)] p-4 text-[13px] leading-relaxed">
          Die gesammelten Inserate liessen sich gerade nicht laden. Die Portale unten führen direkt zur
          passenden Suche.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {treffer.slice(0, anzahl).map((i) => (
          <Karteikarte
            key={i.id}
            i={i}
            haeuser={daten!.haeuser}
            jetzt={jetzt}
            neu={letzterBesuch != null && Date.parse(i.erstGesehen) > letzterBesuch}
            gewaehlt={auswahl === i.id}
            gemerkt={gemerkt.has(i.id)}
            merken={() => umschalten(gemerkt, i.id, setGemerkt, SPEICHER.gemerkt)}
            ausblenden={() => umschalten(weg, i.id, setWeg, SPEICHER.weg)}
            zeigen={() => aufKarte(i)}
            hover={breit ? (an) => setAuswahl(an ? i.id : null) : undefined}
          />
        ))}
      </ul>

      {treffer.length > anzahl && (
        <button
          type="button"
          onClick={() => setAnzahl((a) => a + 40)}
          className="mt-3 w-full rounded-xl border border-[var(--ab-linie)] py-2.5 text-[13px] font-medium hover:bg-[var(--ab-weich)]"
        >
          {nf(Math.min(40, treffer.length - anzahl))} weitere zeigen
        </button>
      )}

      {daten && treffer.length === 0 && (
        <div className="mx-1 rounded-2xl border border-dashed border-[var(--ab-linie)] px-4 py-8 text-center">
          <p className="text-[14px] font-medium">Keine Wohnung passt</p>
          <p className="mt-1 text-[12.5px] text-[var(--ab-leise)]">
            Lockere die Filter, oder lass dich mit einem Suchabo benachrichtigen, sobald eine kommt.
          </p>
          <button
            type="button"
            onClick={() => aendern({ ...FILTER_LEER, sorte: filter.sorte, gebiete: filter.gebiete })}
            className="mt-3 rounded-full border border-[var(--ab-linie)] px-3.5 py-1.5 text-[12.5px] font-medium hover:bg-[var(--ab-weich)]"
          >
            Filter zurücksetzen
          </button>
        </div>
      )}

      {weg.size > 0 && (
        <button
          type="button"
          onClick={() => {
            setWeg(new Set())
            schreib(SPEICHER.weg, [])
          }}
          className="mt-3 px-1 text-[12px] text-[var(--ab-leise)] underline underline-offset-2"
        >
          {weg.size} ausgeblendete wieder zeigen
        </button>
      )}

      <Portale filter={filter} />
      {unten}
    </div>
  )

  const werkzeug = (
    <div className="absolute top-3 right-3 z-10 flex max-w-[15rem] flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setZeichnen((z) => !z)}
        className="rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium shadow-[var(--ab-schatten)]"
        style={
          zeichnen
            ? { background: 'var(--ab-tinte)', color: 'var(--ab-papier)', borderColor: 'var(--ab-tinte)' }
            : { background: 'var(--ab-blatt)', borderColor: 'var(--ab-linie)' }
        }
      >
        {zeichnen ? 'Abbrechen' : filter.gebiete.length ? 'Weiteres Gebiet zeichnen' : 'Gebiet zeichnen'}
      </button>
      {zeichnen && (
        <div className="rounded-xl border border-[var(--ab-linie)] bg-[var(--ab-blatt)] px-3 py-2 text-[11.5px] leading-snug shadow-[var(--ab-schatten)] backdrop-blur-md">
          Drücken, wo das Gebiet in der Mitte liegt, und ziehen, bis der Kreis passt.
        </div>
      )}
      {filter.gebiete.length > 0 && !zeichnen && (
        <button
          type="button"
          onClick={() => aendern({ gebiete: [] })}
          className="rounded-full border border-[var(--ab-linie)] bg-[var(--ab-blatt)] px-3 py-1 text-[12px] shadow-[var(--ab-schatten)]"
        >
          {filter.gebiete.length === 1 ? 'Gebiet' : `${filter.gebiete.length} Gebiete`} löschen ✕
        </button>
      )}
      <Legende />
    </div>
  )

  const dialog = aboOffen && <SuchaboDialog k={k} filter={filter} kreis={kreis} schliessen={() => setAboOffen(false)} />

  if (breit) {
    return (
      <>
      {dialog}
      <div className="flex h-dvh bg-[var(--ab-papier)] text-[var(--ab-tinte)]">
        <div ref={listeRef} className="w-[min(36rem,46vw)] shrink-0 overflow-y-auto border-r border-[var(--ab-linie)]">
          {kopf}
          {stand}
          {filterfeld}
          {liste}
        </div>
        <div className="relative min-w-0 flex-1">
          <div ref={kartenRef} className="h-full w-full" />
          {werkzeug}
        </div>
      </div>
      </>
    )
  }

  return (
    <>
    {dialog}
    <div className="flex h-dvh flex-col bg-[var(--ab-papier)] text-[var(--ab-tinte)]">
      <div className="shrink-0">
        {kopf}
        <div className="flex gap-1 px-4 pb-2">
          {(['liste', 'karte'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAnsicht(a)}
              className="rounded-full px-3.5 py-1 text-[12px] font-medium"
              style={ansicht === a ? { background: 'var(--ab-tinte)', color: 'var(--ab-papier)' } : { color: 'var(--ab-leise)' }}
            >
              {a === 'liste' ? 'Liste' : 'Karte'}
            </button>
          ))}
        </div>
      </div>
      {ansicht === 'liste' ? (
        <div ref={listeRef} className="min-h-0 flex-1 overflow-y-auto">
          {stand}
          {filterfeld}
          {liste}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div ref={kartenRef} className="h-full w-full" />
          {werkzeug}
          {ausgewaehlt && daten && (
            <div className="absolute inset-x-2 bottom-2 z-10">
              <ul>
                <Karteikarte
                  i={ausgewaehlt}
                  haeuser={daten.haeuser}
                  jetzt={jetzt}
                  neu={letzterBesuch != null && Date.parse(ausgewaehlt.erstGesehen) > letzterBesuch}
                  gewaehlt
                  gemerkt={gemerkt.has(ausgewaehlt.id)}
                  merken={() => umschalten(gemerkt, ausgewaehlt.id, setGemerkt, SPEICHER.gemerkt)}
                  ausblenden={() => {
                    umschalten(weg, ausgewaehlt.id, setWeg, SPEICHER.weg)
                    setAuswahl(null)
                  }}
                  schliessen={() => setAuswahl(null)}
                />
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  )
}

function Legende() {
  return (
    <div className="pointer-events-none rounded-xl border border-[var(--ab-linie)] bg-[var(--ab-blatt)] px-3 py-2 text-[11px] shadow-[var(--ab-schatten)] backdrop-blur-md">
      {(
        [
          [KARMIN[1], 'Unbefristet'],
          [KARMIN[4], 'Befristet'],
        ] as const
      ).map(([f, t]) => (
        <div key={t} className="flex items-center gap-1.5 text-[var(--ab-leise)]">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: f }} />
          {t}
        </div>
      ))}
    </div>
  )
}

function Chip({ an, onClick, children }: { an: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={an}
      className="rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors"
      style={
        an
          ? { background: 'var(--ab-tinte)', color: 'var(--ab-papier)', borderColor: 'var(--ab-tinte)' }
          : { borderColor: 'var(--ab-linie)', color: 'var(--ab-leise)' }
      }
    >
      {children}
    </button>
  )
}

/** Ein Feld mit kleiner Überschrift, wie bei den Portalen: Miete, Fläche, Zimmer. */
function Feld({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col rounded-xl border border-[var(--ab-linie)] bg-[var(--ab-aktiv)] px-3 pt-1.5 pb-1 focus-within:border-[var(--ab-leise)]">
      <span className="text-[10.5px] font-medium tracking-wide text-[var(--ab-leise)] uppercase">{titel}</span>
      {children}
    </label>
  )
}

function Zahlfeld({
  wert, setzen, platzhalter, schritt, einheit,
}: {
  wert: number | null
  setzen: (n: number | null) => void
  platzhalter: string
  schritt?: number
  einheit: string
}) {
  return (
    <span className="flex items-baseline gap-1">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={schritt}
        value={wert ?? ''}
        placeholder={platzhalter}
        onChange={(e) => setzen(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full min-w-0 bg-transparent text-[14px] font-medium tabular-nums outline-none placeholder:font-normal placeholder:text-[var(--ab-leise)]"
      />
      <span className="text-[12px] text-[var(--ab-leise)]">{einheit}</span>
    </span>
  )
}

/** Ein Segment wie der Umschalter oben: genau eine Wahl. */
function Segment<T extends string>({ wahl, setzen, optionen }: { wahl: T; setzen: (w: T) => void; optionen: readonly (readonly [T, string])[] }) {
  return (
    <div className="flex rounded-full border border-[var(--ab-linie)] bg-[var(--ab-weich)] p-0.5">
      {optionen.map(([w, name]) => (
        <button
          key={w}
          type="button"
          onClick={() => setzen(w)}
          aria-pressed={wahl === w}
          className="flex-1 rounded-full px-3 py-1 text-[12px] font-medium whitespace-nowrap transition-colors"
          style={wahl === w ? { background: 'var(--ab-aktiv)', color: 'var(--ab-tinte)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : { color: 'var(--ab-leise)' }}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

const ZIMMER = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]

/** Wie viele Filter von der Grundeinstellung abweichen, für «Filter (3)» und «Zurücksetzen». */
function aktiveFilter(f: Filter) {
  return [
    f.mieteMax != null,
    f.flaecheMin != null,
    f.zimmerMin != null || f.zimmerMax != null,
    f.arten.length !== FILTER_LEER.arten.length,
    f.dauer !== 'alle',
    f.quellenAus.length > 0,
    f.oevMax != null,
    f.nurNeu,
    f.nurGemerkt,
    f.gebiete.length > 0,
    f.text.trim() !== '',
  ].filter(Boolean).length
}

function Filterfeld({
  filter: f, aendern, offen, umklappen, zaehlen,
}: {
  filter: Filter
  aendern: (t: Partial<Filter>) => void
  offen: boolean
  umklappen: (() => void) | null
  zaehlen: Wohnungen['quellen']
}) {
  const [mehr, setMehr] = useState(false)
  const zimmer = (wert: number | null, setzen: (n: number | null) => void, leer: string) => (
    <select
      value={wert ?? ''}
      onChange={(e) => setzen(e.target.value === '' ? null : Number(e.target.value))}
      className="min-w-0 appearance-none bg-transparent text-[14px] font-medium outline-none"
    >
      <option value="">{leer}</option>
      {ZIMMER.map((z) => (
        <option key={z} value={z}>
          {zimmerText(z)}
        </option>
      ))}
    </select>
  )
  const kippe = <T,>(liste: T[], x: T) => (liste.includes(x) ? liste.filter((y) => y !== x) : [...liste, x])
  const anzahl = aktiveFilter(f)
  const mehrAktiv = [f.oevMax != null, f.nurNeu, f.nurGemerkt].filter(Boolean).length

  return (
    <section className="mx-3 rounded-[20px] border border-[var(--ab-linie)] bg-[var(--ab-blatt)] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:mx-4">
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--ab-linie)] bg-[var(--ab-aktiv)] px-3.5 py-2 focus-within:border-[var(--ab-leise)]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-[var(--ab-leise)]">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={f.text}
            onChange={(e) => aendern({ text: e.target.value })}
            placeholder="Strasse, Quartier, PLZ oder Stichwort"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--ab-leise)]"
          />
        </label>
        {umklappen && (
          <button
            type="button"
            onClick={umklappen}
            className="shrink-0 rounded-full border border-[var(--ab-linie)] px-3.5 py-2 text-[13px] font-medium"
            style={anzahl ? { background: 'var(--ab-tinte)', color: 'var(--ab-papier)', borderColor: 'var(--ab-tinte)' } : undefined}
          >
            {offen ? 'Fertig' : anzahl ? `Filter · ${anzahl}` : 'Filter'}
          </button>
        )}
      </div>

      {offen && (
        <div className="mt-3 flex flex-col gap-3 text-[13px]">
          <div className="grid grid-cols-3 gap-2">
            <Feld titel="Miete bis">
              <Zahlfeld wert={f.mieteMax} setzen={(n) => aendern({ mieteMax: n })} platzhalter="egal" schritt={100} einheit="CHF" />
            </Feld>
            <Feld titel="Fläche ab">
              <Zahlfeld wert={f.flaecheMin} setzen={(n) => aendern({ flaecheMin: n })} platzhalter="egal" schritt={5} einheit="m²" />
            </Feld>
            <Feld titel="Zimmer">
              <span className="flex items-baseline gap-1">
                {zimmer(f.zimmerMin, (n) => aendern({ zimmerMin: n }), 'ab')}
                <span className="text-[var(--ab-leise)]">–</span>
                {zimmer(f.zimmerMax, (n) => aendern({ zimmerMax: n }), 'bis')}
              </span>
            </Feld>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {ARTEN.map((a) => (
              <Chip key={a.id} an={f.arten.includes(a.id)} onClick={() => aendern({ arten: kippe(f.arten, a.id) })}>
                {a.name}
              </Chip>
            ))}
          </div>

          <Segment
            wahl={f.dauer}
            setzen={(dauer) => aendern({ dauer })}
            optionen={[
              ['alle', 'Alle'],
              ['unbefristet', 'Unbefristet'],
              ['befristet', 'Befristet / Untermiete'],
            ] as const}
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-medium tracking-wide text-[var(--ab-leise)] uppercase">Quellen</span>
              {f.quellenAus.length > 0 && (
                <button type="button" onClick={() => aendern({ quellenAus: [] })} className="text-[11.5px] text-[var(--ab-leise)] underline underline-offset-2">
                  alle
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {zaehlen.map((q) => (
                <Chip key={q.id} an={!f.quellenAus.includes(q.id)} onClick={() => aendern({ quellenAus: kippe(f.quellenAus, q.id) })}>
                  {q.name}
                  <span className="ml-1 opacity-60 tabular-nums">{nf(q.anzahl)}</span>
                </Chip>
              ))}
            </div>
          </div>

          {f.gebiete.length > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-[var(--ab-weich)] px-3 py-2">
              <span>
                Nur in {f.gebiete.length === 1 ? 'dem gezeichneten Gebiet' : `${f.gebiete.length} gezeichneten Gebieten`}
              </span>
              <button type="button" onClick={() => aendern({ gebiete: [] })} className="text-[12px] underline underline-offset-2">
                aufheben
              </button>
            </div>
          )}

          {mehr && (
            <div className="flex flex-col gap-2.5 border-t border-[var(--ab-linie)] pt-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={f.nurNeu} onChange={(e) => aendern({ nurNeu: e.target.checked })} />
                  Nur letzte 24 Std.
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={f.nurGemerkt} onChange={(e) => aendern({ nurGemerkt: e.target.checked })} />
                  Nur gemerkte
                </label>
              </div>
              <div className="mt-1">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">ÖV-Anbindung</span>
                  <span className="font-medium tabular-nums">{f.oevMax == null ? 'egal' : `höchstens ${f.oevMax} Min.`}</span>
                </div>
                <input
                  type="range"
                  className="regler mt-1.5"
                  min={22}
                  max={46}
                  step={1}
                  value={f.oevMax ?? 46}
                  onChange={(e) => aendern({ oevMax: Number(e.target.value) >= 46 ? null : Number(e.target.value) })}
                  style={
                    {
                      // Ohne Grenze bleibt die Spur grau: Es ist nichts gefiltert.
                      '--fuellung':
                        f.oevMax == null
                          ? 'var(--ab-spur)'
                          : `linear-gradient(to right, var(--ab-karmin) ${((f.oevMax - 22) / 24) * 100}%, var(--ab-spur) 0)`,
                      '--knopf': 'var(--ab-knopf)',
                      '--ring': 'var(--ab-ring)',
                    } as React.CSSProperties
                  }
                  aria-label="Höchste mittlere ÖV-Reisezeit in Minuten"
                />
                <div className="mt-0.5 flex justify-between text-[11px] text-[var(--ab-leise)] tabular-nums">
                  <span>22 Min. zentral</span>
                  <span>31 Min. Median</span>
                  <span>egal</span>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ab-leise)]">
                  Wie lange man von der Wohnung aus mit Tram, Bus und S-Bahn im Schnitt zu einer beliebigen Adresse in
                  Zürich braucht, Türe zu Türe mit Fussweg, Warten und Umsteigen. Je kleiner, desto besser angebunden: Am
                  Hauptbahnhof sind es gut 20 Minuten, die Hälfte der Häuser liegt unter 31, am Stadtrand über 40.{' '}
                  <Link href="/methode" className="underline underline-offset-2">
                    Wie das gerechnet ist
                  </Link>
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-[12px]">
            <button type="button" onClick={() => setMehr((m) => !m)} className="font-medium text-[var(--ab-leise)] hover:text-[var(--ab-tinte)]">
              {mehr ? 'Weniger Filter ▴' : `Mehr Filter${mehrAktiv ? ` · ${mehrAktiv}` : ''} ▾`}
            </button>
            {anzahl > 0 && (
              <button
                type="button"
                onClick={() => aendern({ ...FILTER_LEER, sorte: f.sorte })}
                className="text-[var(--ab-leise)] underline underline-offset-2 hover:text-[var(--ab-tinte)]"
              >
                Alle Filter zurücksetzen
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function Karteikarte({
  i, haeuser, jetzt, neu, gewaehlt, gemerkt, merken, ausblenden, zeigen, hover, schliessen,
}: {
  i: Inserat
  haeuser: number
  jetzt: number
  neu: boolean
  gewaehlt: boolean
  gemerkt: boolean
  merken: () => void
  ausblenden: () => void
  zeigen?: () => void
  hover?: (an: boolean) => void
  schliessen?: () => void
}) {
  const proM2 = i.miete && i.flaeche ? i.miete / i.flaeche : null
  const eckdaten = [
    i.zimmer != null ? `${zimmerText(i.zimmer)} Zi.` : null,
    i.flaeche != null ? `${Math.round(i.flaeche)} m²` : null,
    bezugText(i.bezug),
  ].filter(Boolean)
  const adresse = [i.strasse, [i.plz, i.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const haupt = i.links[0]

  return (
    <li
      id={`inserat-${i.id}`}
      onMouseEnter={hover && (() => hover(true))}
      onMouseLeave={hover && (() => hover(false))}
      className="flex gap-3 overflow-hidden rounded-2xl border bg-[var(--ab-blatt)] p-2.5 transition-colors"
      style={{
        borderColor: gewaehlt ? 'var(--ab-tinte)' : 'var(--ab-linie)',
        boxShadow: schliessen ? 'var(--ab-schatten)' : undefined,
      }}
    >
      <a href={haupt.url} target="_blank" rel="noopener noreferrer" className="relative block h-[84px] w-[84px] shrink-0 sm:h-[92px] sm:w-[116px] overflow-hidden rounded-xl bg-[var(--ab-weich)]">
        {i.bild && (
          // Fremde Bilder ohne Referrer: manche Portale sperren eingebettete Bilder sonst.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={i.bild} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        )}
        {neu && (
          <span className="absolute top-1.5 left-1.5 rounded-full bg-[var(--ab-karmin)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
            neu
          </span>
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tabular-nums tracking-tight">
              {i.miete != null ? `CHF ${nf(i.miete)}` : 'Preis auf Anfrage'}
              {proM2 != null && <span className="ml-1.5 text-[11px] font-normal text-[var(--ab-leise)]">{proM2.toFixed(0)}/m²</span>}
              {i.befristet && (
                <span className="ml-1.5 rounded-full bg-[var(--ab-weich)] px-1.5 py-0.5 align-middle text-[10.5px] font-medium text-[var(--ab-leise)]">
                  befristet
                </span>
              )}
            </div>
            <a href={haupt.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[13px] leading-snug hover:underline sm:line-clamp-1">
              {i.titel}
            </a>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={merken}
              aria-label={gemerkt ? 'Nicht mehr merken' : 'Merken'}
              aria-pressed={gemerkt}
              className="rounded-full p-1 text-[15px] leading-none hover:bg-[var(--ab-weich)]"
              style={{ color: gemerkt ? 'var(--ab-karmin)' : 'var(--ab-leise)' }}
            >
              {gemerkt ? '★' : '☆'}
            </button>
            <button
              type="button"
              onClick={schliessen ?? ausblenden}
              aria-label={schliessen ? 'Schliessen' : 'Ausblenden'}
              title={schliessen ? 'Schliessen' : 'Ausblenden'}
              className="rounded-full p-1 text-[13px] leading-none text-[var(--ab-leise)] hover:bg-[var(--ab-weich)]"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="truncate text-[12px] text-[var(--ab-leise)]">
          {eckdaten.join(' · ')}
          {adresse && <> · {adresse}</>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px]">
          {i.oev != null && (
            <span className="text-[var(--ab-leise)]" title={`Mittlere ÖV-Reisezeit zu einer beliebigen Adresse der Stadt, ${top(i.oevRang, haeuser)}`}>
              ÖV {Math.round(i.oev)} Min.
            </span>
          )}
          {i.kultur != null && (
            <span className="text-[var(--ab-leise)]" title={`Kulturorte in 10 Velominuten, ${top(i.kulturRang, haeuser)}`}>
              {i.kultur} Kulturorte
            </span>
          )}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1.5 text-[11.5px] text-[var(--ab-leise)]">
          {i.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[var(--ab-linie)] px-2 py-0.5 font-medium text-[var(--ab-tinte)] hover:bg-[var(--ab-weich)]"
            >
              {GESAMMELT[l.quelle]?.name ?? l.quelle} ↗
            </a>
          ))}
          {i.smg && <span title="Von Homegate oder ImmoScout24 an Flatfox weitergereicht">auch Homegate/ImmoScout24</span>}
          {zeigen && i.lon != null && (
            <button type="button" onClick={zeigen} className="underline underline-offset-2 hover:text-[var(--ab-tinte)]">
              Karte
            </button>
          )}
          {i.oev != null && i.lon != null && (
            <a
              href={`/erreichbarkeitskarte#haus=${i.lon.toFixed(5)},${i.lat!.toFixed(5)}`}
              className="underline underline-offset-2 hover:text-[var(--ab-tinte)]"
            >
              Erreichbarkeit
            </a>
          )}
          <span className="ml-auto">{vor(i.erstGesehen, jetzt)}</span>
        </div>
      </div>
    </li>
  )
}

function Portale({ filter }: { filter: Filter }) {
  return (
    <section className="mt-8 px-1">
      <h2 className="text-[13px] font-semibold">Weitere Quellen</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--ab-leise)]">
        Oben stehen Flatfox (mit einem Teil der Homegate- und ImmoScout24-Inserate), Ron Orp, WOKO,
        die Stiftung PWG und die ABZ. Die Seiten hier sperren automatische Abrufe oder verlangen eine
        Anmeldung, ihre Inserate lassen sich nicht einsammeln. Bei Homegate und ImmoScout24 öffnet der
        Link dieselbe Suche mit Miete, Zimmern und Fläche aus den Filtern.
      </p>
      {WEITERE.map((g) => (
        <div key={g.gruppe} className="mt-4">
          <h3 className="text-[12px] font-medium text-[var(--ab-leise)]">{g.gruppe}</h3>
          <ul className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {g.quellen.map((q) => (
              <li key={q.name}>
                <a
                  href={q.url(filter)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-[var(--ab-linie)] px-3 py-2 hover:bg-[var(--ab-weich)]"
                >
                  <span className="text-[13px] font-medium">{q.name} ↗</span>
                  <span className="block text-[11.5px] text-[var(--ab-leise)]">{q.was}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
