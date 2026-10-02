'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Map as MapLibreMap, NavigationControl, AttributionControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import { Wortmarke } from '../marke'
import { KARMIN, TINTE, GRAU, GRUND } from '../farben'
import { STAEDTE } from '../staedte'
import { useMedienabfrage } from '../blatt'
import { nf } from '../site'
import { GESAMMELT, WEITERE, type Suche } from './quellen'
import type { Art, Inserat, QuellenId, Wohnungen } from './typen'

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

const SORTEN = {
  neu: 'Neueste zuerst',
  guenstig: 'Günstigste zuerst',
  m2: 'Preis pro m²',
  oev: 'Beste ÖV-Anbindung',
  kultur: 'Meiste Kultur in der Nähe',
  gross: 'Grösste zuerst',
} as const
type Sorte = keyof typeof SORTEN

type Filter = Suche & {
  arten: Art[]
  /** Abgewählte Quellen. Als Ausschlussliste, damit neue Quellen von selbst dazukommen. */
  quellenAus: QuellenId[]
  /** Höchstens so viele Minuten mittlere ÖV-Reisezeit. */
  oevMax: number | null
  text: string
  nurNeu: boolean
  nurGemerkt: boolean
  nurAusschnitt: boolean
  sorte: Sorte
}

const FILTER_LEER: Filter = {
  mieteMax: null,
  zimmerMin: null,
  zimmerMax: null,
  flaecheMin: null,
  arten: ['wohnung', 'wg', 'studio', 'moebliert', 'haus'],
  quellenAus: [],
  oevMax: null,
  text: '',
  nurNeu: false,
  nurGemerkt: false,
  nurAusschnitt: false,
  sorte: 'neu',
}

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

const TAG = 24 * 3600 * 1000

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

/** Farbe nach ÖV-Rang, dieselbe Rampe wie auf der Erreichbarkeitskarte. */
function farbe(rang: number | null, haeuser: number) {
  if (rang == null || !haeuser) return GRAU
  const p = rang / haeuser
  if (p <= 0.1) return KARMIN[0]
  if (p <= 0.25) return KARMIN[1]
  if (p <= 0.5) return KARMIN[2]
  if (p <= 0.75) return KARMIN[3]
  return KARMIN[4]
}

function passt(i: Inserat, f: Filter, gemerkt: Set<string>, jetzt: number, ausschnitt: [number, number, number, number] | null) {
  if (f.nurGemerkt && !gemerkt.has(i.id)) return false
  if (!f.arten.includes(i.art)) return false
  if (i.links.every((l) => f.quellenAus.includes(l.quelle))) return false
  if (f.mieteMax != null && (i.miete == null || i.miete > f.mieteMax)) return false
  if (f.zimmerMin != null && (i.zimmer == null || i.zimmer < f.zimmerMin)) return false
  if (f.zimmerMax != null && (i.zimmer == null || i.zimmer > f.zimmerMax)) return false
  if (f.flaecheMin != null && (i.flaeche == null || i.flaeche < f.flaecheMin)) return false
  if (f.oevMax != null && (i.oev == null || i.oev > f.oevMax)) return false
  if (f.nurNeu && jetzt - Date.parse(i.erstGesehen) > TAG) return false
  if (f.nurAusschnitt && ausschnitt) {
    const [w, s, e, n] = ausschnitt
    if (i.lon == null || i.lat == null || i.lon < w || i.lon > e || i.lat < s || i.lat > n) return false
  }
  if (f.text.trim()) {
    const heu = `${i.titel} ${i.strasse ?? ''} ${i.plz ?? ''} ${i.ort ?? ''}`.toLowerCase()
    if (!f.text.toLowerCase().split(/\s+/).filter(Boolean).every((w) => heu.includes(w))) return false
  }
  return true
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

function alsGeojson(liste: Inserat[], haeuser: number) {
  return {
    type: 'FeatureCollection' as const,
    features: liste
      .filter((i) => i.lon != null && i.lat != null)
      .map((i) => ({
        type: 'Feature' as const,
        properties: { id: i.id, farbe: farbe(i.oevRang, haeuser) },
        geometry: { type: 'Point' as const, coordinates: [i.lon!, i.lat!] },
      })),
  }
}

export default function Wohnungssuche() {
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

  const treffer = useMemo(() => {
    if (!daten) return []
    return daten.inserate
      .filter((i) => !weg.has(i.id) && passt(i, filter, gemerkt, jetzt, ausschnitt))
      .sort(SORTIER[filter.sorte])
  }, [daten, filter, gemerkt, weg, jetzt, ausschnitt])

  const neuSeitBesuch = useMemo(
    () => (letzterBesuch ? treffer.filter((i) => Date.parse(i.erstGesehen) > letzterBesuch).length : 0),
    [treffer, letzterBesuch]
  )

  // ── Karte ──────────────────────────────────────────────────────────────
  const zeigeKarte = breit || ansicht === 'karte'

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
    return daten.inserate.filter((i) => !weg.has(i.id) && passt(i, f, gemerkt, jetzt, null))
  }, [daten, filter, gemerkt, weg, jetzt])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !karteBereit || !daten) return
    ;(map.getSource('inserate') as GeoJSONSource | undefined)?.setData(alsGeojson(punkte, daten.haeuser))
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
  const kopf = (
    <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <Link href="/" aria-label="angebunden · zum Velonavi" className="hover:opacity-70">
          <Wortmarke size={15} />
        </Link>
        <h1 className="truncate text-[15px] font-semibold tracking-tight">Wohnungen in Zürich</h1>
      </div>
    </header>
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
      <div className="flex items-baseline justify-between gap-3 px-1 pt-3 pb-2">
        <div className="text-[13px] font-medium">
          {daten ? `${nf(treffer.length)} ${treffer.length === 1 ? 'Wohnung' : 'Wohnungen'}` : ladefehler ? '' : 'Lade Inserate …'}
          {neuSeitBesuch > 0 && <span className="ml-2 text-[var(--ab-karmin)]">{neuSeitBesuch} neu seit deinem letzten Besuch</span>}
        </div>
        {breit && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-[var(--ab-leise)]">
            <input type="checkbox" checked={filter.nurAusschnitt} onChange={(e) => aendern({ nurAusschnitt: e.target.checked })} />
            Nur Kartenausschnitt
          </label>
        )}
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
        <p className="mx-1 py-6 text-[13px] text-[var(--ab-leise)]">
          Nichts gefunden. Lockere die Filter oder schau bei den Portalen unten nach.
        </p>
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
    </div>
  )

  if (breit) {
    return (
      <div className="flex h-dvh bg-[var(--ab-papier)] text-[var(--ab-tinte)]">
        <div ref={listeRef} className="w-[min(36rem,46vw)] shrink-0 overflow-y-auto border-r border-[var(--ab-linie)]">
          {kopf}
          {stand}
          {filterfeld}
          {liste}
        </div>
        <div className="relative min-w-0 flex-1">
          <div ref={kartenRef} className="h-full w-full" />
          <Legende />
        </div>
      </div>
    )
  }

  return (
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
          <Legende />
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
  )
}

function Legende() {
  const stufen = [
    [KARMIN[0], 'Top 10 %'],
    [KARMIN[1], 'Top 25 %'],
    [KARMIN[2], 'Top 50 %'],
    [KARMIN[3], 'Top 75 %'],
    [KARMIN[4], 'übrige'],
  ] as const
  return (
    <div className="pointer-events-none absolute top-3 right-3 rounded-xl border border-[var(--ab-linie)] bg-[var(--ab-blatt)] px-3 py-2 text-[11px] shadow-[var(--ab-schatten)] backdrop-blur-md">
      <div className="mb-1 font-medium">ÖV-Anbindung</div>
      {stufen.map(([f, t]) => (
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

function Zahlfeld({
  wert, setzen, platzhalter, schritt, breite = 'w-24',
}: {
  wert: number | null
  setzen: (n: number | null) => void
  platzhalter: string
  schritt?: number
  breite?: string
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      step={schritt}
      value={wert ?? ''}
      placeholder={platzhalter}
      onChange={(e) => setzen(e.target.value === '' ? null : Number(e.target.value))}
      className={`${breite} rounded-lg border border-[var(--ab-linie)] bg-[var(--ab-aktiv)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--ab-leise)]`}
    />
  )
}

const ZIMMER = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]

function Filterfeld({
  filter: f, aendern, offen, umklappen, zaehlen,
}: {
  filter: Filter
  aendern: (t: Partial<Filter>) => void
  offen: boolean
  umklappen: (() => void) | null
  zaehlen: Wohnungen['quellen']
}) {
  const auswahl = (wert: number | null, setzen: (n: number | null) => void, leer: string) => (
    <select
      value={wert ?? ''}
      onChange={(e) => setzen(e.target.value === '' ? null : Number(e.target.value))}
      className="rounded-lg border border-[var(--ab-linie)] bg-[var(--ab-aktiv)] px-2 py-1.5 text-[13px]"
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

  return (
    <section className="mx-3 rounded-2xl border border-[var(--ab-linie)] bg-[var(--ab-blatt)] p-3.5 sm:mx-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={f.text}
          onChange={(e) => aendern({ text: e.target.value })}
          placeholder="Strasse, PLZ oder Stichwort"
          className="min-w-[13rem] flex-1 rounded-lg border border-[var(--ab-linie)] bg-[var(--ab-aktiv)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--ab-leise)]"
        />
        <select
          value={f.sorte}
          onChange={(e) => aendern({ sorte: e.target.value as Sorte })}
          className="rounded-lg border border-[var(--ab-linie)] bg-[var(--ab-aktiv)] px-2 py-1.5 text-[13px]"
          aria-label="Sortierung"
        >
          {Object.entries(SORTEN).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {umklappen && (
          <button type="button" onClick={umklappen} className="shrink-0 text-[12px] font-medium underline underline-offset-2">
            {offen ? 'Weniger' : 'Filter'}
          </button>
        )}
      </div>

      {offen && (
        <div className="mt-3 flex flex-col gap-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2">
              <span className="text-[var(--ab-leise)]">Miete bis</span>
              <Zahlfeld wert={f.mieteMax} setzen={(n) => aendern({ mieteMax: n })} platzhalter="CHF" schritt={100} />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[var(--ab-leise)]">ab</span>
              <Zahlfeld wert={f.flaecheMin} setzen={(n) => aendern({ flaecheMin: n })} platzhalter="m²" schritt={5} breite="w-20" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--ab-leise)]">Zimmer</span>
            {auswahl(f.zimmerMin, (n) => aendern({ zimmerMin: n }), 'von')}
            <span className="text-[var(--ab-leise)]">bis</span>
            {auswahl(f.zimmerMax, (n) => aendern({ zimmerMax: n }), 'bis')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ARTEN.map((a) => (
              <Chip key={a.id} an={f.arten.includes(a.id)} onClick={() => aendern({ arten: kippe(f.arten, a.id) })}>
                {a.name}
              </Chip>
            ))}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--ab-leise)]">ÖV: im Schnitt höchstens</span>
              <span className="font-medium tabular-nums">{f.oevMax == null ? 'egal' : `${f.oevMax} Min.`}</span>
            </div>
            <input
              type="range"
              className="regler mt-1"
              min={22}
              max={46}
              step={1}
              value={f.oevMax ?? 46}
              onChange={(e) => aendern({ oevMax: Number(e.target.value) >= 46 ? null : Number(e.target.value) })}
              style={
                {
                  '--fuellung': `linear-gradient(to right, var(--ab-karmin) ${(((f.oevMax ?? 46) - 22) / 24) * 100}%, var(--ab-spur) 0)`,
                  '--knopf': 'var(--ab-knopf)',
                  '--ring': 'var(--ab-ring)',
                } as React.CSSProperties
              }
              aria-label="Höchste mittlere ÖV-Reisezeit"
            />
            <p className="mt-1 text-[11px] leading-snug text-[var(--ab-leise)]">
              Mittlere Reisezeit mit Tram, Bus und S-Bahn zu einer beliebigen Adresse der Stadt. Median 31 Min.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {zaehlen.map((q) => (
              <Chip key={q.id} an={!f.quellenAus.includes(q.id)} onClick={() => aendern({ quellenAus: kippe(f.quellenAus, q.id) })}>
                {q.name}
                <span className="ml-1 opacity-60 tabular-nums">{q.anzahl}</span>
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={f.nurNeu} onChange={(e) => aendern({ nurNeu: e.target.checked })} />
              Nur letzte 24 Std.
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={f.nurGemerkt} onChange={(e) => aendern({ nurGemerkt: e.target.checked })} />
              Nur gemerkte
            </label>
            <button
              type="button"
              onClick={() => aendern({ ...FILTER_LEER, sorte: f.sorte })}
              className="ml-auto text-[12px] text-[var(--ab-leise)] underline underline-offset-2"
            >
              Zurücksetzen
            </button>
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
            <span className="inline-flex items-center gap-1" title="Mittlere ÖV-Reisezeit zu einer beliebigen Adresse der Stadt">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: farbe(i.oevRang, haeuser) }} />
              ÖV {Math.round(i.oev)} Min.
              <span className="text-[var(--ab-leise)]">{top(i.oevRang, haeuser)}</span>
            </span>
          )}
          {i.kultur != null && (
            <span title="Kulturorte in 10 Velominuten">
              {i.kultur} Kulturorte <span className="text-[var(--ab-leise)]">{top(i.kulturRang, haeuser)}</span>
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
