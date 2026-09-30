/**
 * Holt die Rohdaten für den Velonavi (nur Zürich).
 *
 * Grundlage ist das Fuss- und Velowegnetz der Stadt Zürich: ein verknotetes
 * Routingnetz mit Velofreigabe, Einbahn, Velostreifen je Richtung und
 * Abbiegeverboten. Was darin fehlt, kommt aus weiteren Quellen:
 *
 * * Stadt Zürich (WFS): Knoten mit Lichtsignalanlage, signalisierte
 *   Geschwindigkeiten, Velonetzplanung (Vorzugsrouten, Hauptnetz).
 * * Stadt Zürich (CSV): polizeilich registrierte Verkehrsunfälle seit 2011 und
 *   die Verkehrszählung an den Lichtsignalanlagen (Fahrzeuge je Stunde).
 * * OpenStreetMap: Strassenklasse, Belag, Brücken und Tunnel, Tramgleise und
 *   Ampeln, die die Stadt nicht als Knoten führt (Fussgängerampeln).
 *
 * Alles landet unter `data/raw/velo/` und wird bei weiteren Läufen aus dem
 * Cache gelesen. Zum Auffrischen den Ordner löschen.
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { readCsv } from './lib/csv.ts'

const RAW = new URL('../data/raw/velo/', import.meta.url).pathname
mkdirSync(RAW, { recursive: true })

const WFS = 'https://www.ogd.stadt-zuerich.ch/wfs/geoportal/'
const OVERPASS = ['https://overpass.osm.ch/api/interpreter', 'https://overpass-api.de/api/interpreter']
/** Stadtgebiet plus etwas Rand, damit Wege an der Grenze noch einen OSM-Partner finden. */
const BBOX = { s: 47.31, w: 8.43, n: 47.44, e: 8.64 }

async function hole(datei: string, laden: () => Promise<string>) {
  const pfad = RAW + datei
  if (existsSync(pfad)) {
    console.log(`  ${datei}: aus Cache`)
    return
  }
  let letzterFehler: unknown
  for (let versuch = 0; versuch < 4; versuch++) {
    try {
      const t0 = Date.now()
      const text = await laden()
      writeFileSync(pfad, text)
      console.log(`  ${datei}: ${(text.length / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      return
    } catch (err) {
      letzterFehler = err
      console.log(`  ${datei}: Versuch ${versuch + 1} fehlgeschlagen (${err})`)
      await new Promise((r) => setTimeout(r, 10_000 * (versuch + 1)))
    }
  }
  throw new Error(`${datei} endgültig fehlgeschlagen: ${letzterFehler}`)
}

async function text(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(600_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function wfs(dienst: string, layer: string) {
  return async () => {
    const t = await text(
      `${WFS}${dienst}?service=WFS&version=1.1.0&request=GetFeature&outputFormat=GeoJSON&srsName=EPSG:4326&typename=${layer}`
    )
    if (!JSON.parse(t).features?.length) throw new Error('keine Features')
    return t
  }
}

let overpassZaehler = 0
function overpass(abfrage: string) {
  return async () => {
    const url = OVERPASS[overpassZaehler++ % OVERPASS.length]
    const t = await text(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'angebunden-velonavi/1.0 (OSM-Auswertung, Kontakt via GitHub)',
      },
      body: 'data=' + encodeURIComponent(abfrage),
    })
    if (!JSON.parse(t).elements) throw new Error('keine elements')
    return t
  }
}

/**
 * Verkehrszählung der Dienstabteilung Verkehr: Fahrzeuge je Stunde an gut 200
 * Messstellen, fast alle an den Detektoren einer Lichtsignalanlage. Signalpläne
 * und Grünzeiten veröffentlicht die Stadt nicht, die Zählung ist das Nächste
 * dazu: Sie zeigt, wie viel Verkehr an einer Kreuzung über welche Strasse
 * fliesst, und danach richtet sich die Verteilung der Grünzeit.
 *
 * Die Jahresdatei hat rund 400 MB und 1,4 Mio. Zeilen. Sie wird im Durchlauf
 * gelesen, behalten wird nur das Mittel je Messstelle über die Werktage von
 * 6 bis 20 Uhr, aus gemessenen Werten (ohne «Fehlend» und «Imputiert»).
 */
async function zaehlung() {
  const heute = new Date()
  // Im Januar und Februar ist das laufende Jahr noch zu dünn.
  const jahr = heute.getMonth() < 2 ? heute.getFullYear() - 1 : heute.getFullYear()
  const res = await fetch(
    `https://data.stadt-zuerich.ch/dataset/sid_dav_verkehrszaehlung_miv_od2031/download/sid_dav_verkehrszaehlung_miv_OD2031_${jahr}.csv`,
    { signal: AbortSignal.timeout(900_000) }
  )
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  type Stelle = {
    ms: string; zs: string; name: string; achse: string; richtung: string
    knoten: number; e: number; n: number; stunden: number; fz: number
  }
  const stellen = new Map<string, Stelle>()
  let tag = ''
  let werktag = false
  await readCsv(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), (r, col) => {
    if (r[col('AnzFahrzeugeStatus')] !== 'Gemessen') return
    const zeit = r[col('MessungDatZeit')] // 2026-01-01T07:00:00
    const stunde = +zeit.slice(11, 13)
    if (stunde < 6 || stunde >= 20) return
    if (zeit.slice(0, 10) !== tag) {
      tag = zeit.slice(0, 10)
      const wt = new Date(tag + 'T12:00:00Z').getUTCDay()
      werktag = wt >= 1 && wt <= 5
    }
    if (!werktag) return
    const fz = +r[col('AnzFahrzeuge')]
    if (!Number.isFinite(fz)) return
    const ms = r[col('MSID')]
    let s = stellen.get(ms)
    if (!s) {
      s = {
        ms, zs: r[col('ZSID')], name: r[col('ZSName')], achse: r[col('Achse')], richtung: r[col('Richtung')],
        knoten: +r[col('Knummer')] || 0, e: +r[col('EKoord')], n: +r[col('NKoord')], stunden: 0, fz: 0,
      }
      stellen.set(ms, s)
    }
    s.stunden++
    s.fz += fz
  })
  if (stellen.size < 50) throw new Error(`nur ${stellen.size} Messstellen`)
  for (const s of stellen.values()) s.fz = Math.round(s.fz / s.stunden)
  return JSON.stringify({ jahr, stellen: [...stellen.values()] })
}

const b = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`

console.log('Stadt Zürich')
await hole('netz.geojson', wfs('Fuss__und_Velowegnetz', 'tbl_routennetz'))
await hole('abbiegeverbote.geojson', wfs('Fuss__und_Velowegnetz', 'tbl_routennetz_abbiegeverbote'))
await hole('lichtsignale.geojson', wfs('Verkehrsknoten_mit_Lichtsignalanlage', 'tbl_knoten_p'))
await hole('tempo.geojson', wfs('Signalisierte_Geschwindigkeiten', 'view_geoserver_tempo_ist'))
await hole('velonetz.geojson', wfs('Velonetzplanung', 'view_velonetz'))
await hole('vorzugsrouten.geojson', wfs('Velonetzplanung', 'view_gs_umsetzungsstrecken'))
await hole('unfaelle.csv', () =>
  text('https://data.stadt-zuerich.ch/dataset/sid_dav_strassenverkehrsunfallorte/download/RoadTrafficAccidentLocations.csv')
)
await hole('verkehrszaehlung.json', zaehlung)

console.log('OpenStreetMap')
await hole(
  'osm-wege.json',
  overpass(`[out:json][timeout:600];
    way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|pedestrian|service|track|path|footway|cycleway|bridleway|steps|road)$"]["area"!="yes"](${b});
    out tags geom;`)
)
await hole(
  'osm-tram.json',
  overpass(`[out:json][timeout:300];
    way["railway"="tram"](${b});
    out geom;`)
)
// Was ein Velo zum Halten oder Absteigen zwingt: Poller, Tore, Drängelgitter,
// Treppen am Weg, Bahnübergänge, dazu Wege mit «bicycle=dismount».
await hole(
  'osm-huerden.json',
  overpass(`[out:json][timeout:300];
    (node["barrier"](${b});
     node["railway"="level_crossing"](${b});
     node["railway"="crossing"](${b});
     node["highway"="crossing"]["crossing"!="traffic_signals"](${b}););
    out;`)
)
// Abbiegeverbote, die in OSM ausdrücklich nicht fürs Velo gelten: die Tafel
// «ausser Velo» als Datenfeld. Geholt werden die Via-Knoten der Relationen,
// über die sie sich in `11-velo-netz.ts` den Verboten der Stadt zuordnen lassen.
await hole(
  'osm-abbiegeverbote.json',
  overpass(`[out:json][timeout:300];
    relation["type"="restriction"]["except"~"bicycle"](${b});
    node(r:"via");
    out;`)
)
await hole(
  'osm-ampeln.json',
  overpass(`[out:json][timeout:300];
    (node["highway"="traffic_signals"](${b});
     node["crossing"="traffic_signals"](${b}););
    out;`)
)
console.log('fertig')
