/**
 * Sammelt Mietinserate für die Stadt Zürich aus mehreren Portalen und legt sie
 * als eine Liste ab: `wohnungen.json`, gelesen von der Seite `/wohnungen`.
 *
 *   node pipeline/20-wohnungen.ts [ausgabe.json]
 *
 * Ohne Angabe schreibt der Sammler nach `public/data/zuerich/wohnungen.json`.
 * Liegt dort schon eine Fassung, liest er sie vorher: Daraus stammt, seit wann
 * ein Inserat online ist, und wenn eine Quelle diesmal ausfällt, bleiben ihre
 * Inserate vom letzten Lauf stehen, bis sie drei Tage alt sind.
 *
 * Quellen:
 *
 * * Flatfox über die öffentliche API (`/api/v1/pin/`, `/api/v1/public-listing/`).
 * * Homegate und ImmoScout24 aus dem Zustand, den die Trefferlisten als
 *   `window.__INITIAL_STATE__` ins HTML schreiben. Beide gehören zur SMG und
 *   haben dasselbe Datenmodell. Sie sperren gern automatische Abrufe; schlägt
 *   einer fehl, steht das in `quellen[].fehler` und die Seite zeigt es an.
 *
 * Danach werden Doppelte zusammengelegt (dieselbe Wohnung steht oft auf
 * Homegate und ImmoScout24, manchmal zusätzlich auf Flatfox) und jedes
 * Inserat bekommt die ÖV- und Kulturwerte des nächsten Hauses der Karte.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pointInRings } from './lib/geo.ts'
import type { Art, Inserat, QuellenId, QuellenStand, Wohnungen } from '../app/wohnungen/typen.ts'

const DATEN = 'public/data/zuerich'
const AUSGABE = process.argv[2] ?? `${DATEN}/wohnungen.json`

/** Grosszügige Box um die Stadt; die Stadtgrenze schneidet danach genau zu. */
const BOX = { w: 8.44, s: 47.32, e: 8.63, n: 47.44 }

/** Postleitzahlen der Stadt, für Inserate ohne Koordinaten. */
const PLZ_STADT = new Set([
  '8001', '8002', '8003', '8004', '8005', '8006', '8008', '8032', '8037', '8038', '8041',
  '8044', '8045', '8046', '8047', '8048', '8049', '8050', '8051', '8052', '8053', '8055',
  '8057', '8064',
])

/** So lange bleiben Inserate einer ausgefallenen Quelle stehen. */
const HALTEN_MS = 3 * 24 * 3600 * 1000

const BROWSER = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Accept-Language': 'de-CH,de;q=0.9,en;q=0.6',
}

const NAMEN: Record<QuellenId, string> = {
  flatfox: 'Flatfox',
  homegate: 'Homegate',
  immoscout24: 'ImmoScout24',
}

/** Ein Fund, bevor er zusammengelegt und eingeordnet ist. */
type Roh = Omit<Inserat, 'id' | 'links' | 'erstGesehen' | 'oev' | 'oevRang' | 'kultur' | 'kulturRang'> & {
  quelle: QuellenId
  quellId: string
  url: string
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function holen(url: string, json: true): Promise<unknown>
async function holen(url: string, json: false): Promise<string>
async function holen(url: string, json: boolean): Promise<unknown> {
  let letzter: unknown
  for (let versuch = 0; versuch < 3; versuch++) {
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER, Accept: json ? 'application/json' : 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 403 || res.status === 401) throw new Error(`HTTP ${res.status} (gesperrt)`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return json ? await res.json() : await res.text()
    } catch (e) {
      letzter = e
      if (String(e).includes('gesperrt')) break
      await warte(2000 * (versuch + 1))
    }
  }
  throw letzter
}

function zahl(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[’'\s]/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Datum auf JJJJ-MM-TT kürzen; liegt es in der Vergangenheit, ist die Wohnung sofort frei. */
function bezugsdatum(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!m) return null
  return m[1] <= new Date().toISOString().slice(0, 10) ? 'sofort' : m[1]
}

// ─── Flatfox ──────────────────────────────────────────────────────────────

type FlatfoxListing = Record<string, unknown> & {
  pk: number
  cover_image?: { url?: string; url_thumb_m?: string; url_listing_search?: string } | null
}

function flatfoxArt(l: FlatfoxListing): Art | null {
  const kat = String(l.object_category ?? '')
  const typ = String(l.object_type ?? '')
  if (kat === 'SHARED') return 'wg'
  if (kat === 'HOUSE') return 'haus'
  if (kat !== 'APARTMENT') return null
  if (l.is_furnished === true || l.is_temporary === true) return 'moebliert'
  if (/STUDIO|SINGLE_ROOM/.test(typ)) return 'studio'
  return 'wohnung'
}

function flatfoxBild(l: FlatfoxListing): string | null {
  const b = l.cover_image
  const pfad = b?.url_thumb_m ?? b?.url_listing_search ?? b?.url
  if (!pfad) return null
  return pfad.startsWith('http') ? pfad : `https://flatfox.ch${pfad}`
}

async function flatfox(): Promise<Roh[]> {
  const pins = (await holen(
    `https://flatfox.ch/api/v1/pin/?east=${BOX.e}&west=${BOX.w}&north=${BOX.n}&south=${BOX.s}&max_count=2000`,
    true
  )) as { pk: number }[]
  if (!Array.isArray(pins)) throw new Error('Antwort ohne Pin-Liste')

  const listings: FlatfoxListing[] = []
  for (let i = 0; i < pins.length; i += 40) {
    const pks = pins.slice(i, i + 40).map((p) => `pk=${p.pk}`).join('&')
    const antwort = (await holen(
      `https://flatfox.ch/api/v1/public-listing/?${pks}&expand=cover_image&limit=40`,
      true
    )) as { results?: FlatfoxListing[] }
    listings.push(...(antwort.results ?? []))
    await warte(300)
  }

  const funde: Roh[] = []
  for (const l of listings) {
    if (l.offer_type && l.offer_type !== 'RENT') continue
    const art = flatfoxArt(l)
    if (!art) continue
    const netto = zahl(l.rent_net)
    const nk = zahl(l.rent_charges)
    const bezugTyp = String(l.moving_date_type ?? '')
    funde.push({
      quelle: 'flatfox',
      quellId: String(l.pk),
      url: `https://flatfox.ch${text(l.url) ?? `/de/flat/${l.pk}/`}`,
      titel: text(l.public_title) ?? text(l.short_title) ?? text(l.description_title) ?? 'Inserat auf Flatfox',
      art,
      strasse: text(l.street),
      plz: l.zipcode != null ? String(l.zipcode) : null,
      ort: text(l.city),
      lon: zahl(l.longitude),
      lat: zahl(l.latitude),
      zimmer: zahl(l.number_of_rooms),
      flaeche: zahl(l.surface_living) ?? zahl(l.livingspace),
      miete: zahl(l.rent_gross) ?? (netto != null ? netto + (nk ?? 0) : null) ?? zahl(l.price_display),
      bezug:
        bezugTyp === 'imm' ? 'sofort' : bezugTyp === 'agr' ? 'nach Vereinbarung' : bezugsdatum(l.moving_date),
      bild: flatfoxBild(l),
    })
  }
  return funde
}

// ─── Homegate und ImmoScout24 ─────────────────────────────────────────────

/** Den Seitenzustand aus `window.__INITIAL_STATE__ = {…}` im HTML ziehen. */
function anfangszustand(html: string): unknown {
  const m = html.match(/__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/)
  if (!m) throw new Error('kein __INITIAL_STATE__ im HTML, vermutlich eine Sperrseite')
  const roh = m[1].trim().replace(/;\s*$/, '').replace(/:undefined\b/g, ':null')
  return JSON.parse(roh)
}

type SmgListing = {
  id: string | number
  offerType?: string
  categories?: string[]
  address?: {
    street?: string
    postalCode?: string
    locality?: string
    geoCoordinates?: { latitude?: number; longitude?: number }
  }
  characteristics?: { numberOfRooms?: number; livingSpace?: number; totalFloorSpace?: number }
  prices?: { rent?: { gross?: number; net?: number; extra?: number; interval?: string } }
  localization?: Record<string, { text?: { title?: string }; attachments?: { type?: string; url?: string; file?: string }[] }> & {
    primary?: string
  }
  availableFrom?: string
  availability?: { availableFrom?: string }
}

/** Alle Objekte im Zustand, die wie ein Inserat aussehen. Robuster als ein fester Pfad. */
function smgListings(zustand: unknown): SmgListing[] {
  const funde = new Map<string, SmgListing>()
  const besucht = new Set<unknown>()
  const lauf = (o: unknown, tiefe: number) => {
    if (!o || typeof o !== 'object' || besucht.has(o) || tiefe > 14) return
    besucht.add(o)
    if (Array.isArray(o)) {
      for (const x of o) lauf(x, tiefe + 1)
      return
    }
    const r = o as Record<string, unknown>
    if (r.id != null && r.address && typeof r.address === 'object' && (r.prices || r.characteristics)) {
      funde.set(String(r.id), r as unknown as SmgListing)
      return
    }
    for (const v of Object.values(r)) lauf(v, tiefe + 1)
  }
  lauf(zustand, 0)
  return [...funde.values()]
}

/** Seitenzahl der Trefferliste, falls im Zustand vorhanden. */
function seitenzahl(zustand: unknown): number | null {
  const m = JSON.stringify(zustand).match(/"pageCount":(\d+)/)
  return m ? Number(m[1]) : null
}

const WOHNEN = /FLAT|APARTMENT|STUDIO|ROOM|HOUSE|LOFT|MAISONETTE|DUPLEX|VILLA|CHALET|ATTIC|TERRACE/
const NICHT_WOHNEN = /PARK|GARAGE|SLOT|OFFICE|COMMERCIAL|INDUSTR|STORAGE|PLOT|HOBBY|RETAIL|GASTRO|WORKSHOP/

function smgArt(kat: string[]): Art | null {
  const alle = kat.join(' ')
  if (!WOHNEN.test(alle) || (NICHT_WOHNEN.test(alle) && !/FLAT|APARTMENT|HOUSE/.test(alle))) return null
  if (/SHARED|SINGLE_ROOM/.test(alle)) return 'wg'
  if (/FURNISHED/.test(alle)) return 'moebliert'
  if (/STUDIO/.test(alle)) return 'studio'
  if (/HOUSE|VILLA|CHALET/.test(alle) && !/FLAT|APARTMENT/.test(alle)) return 'haus'
  return 'wohnung'
}

function smgRoh(l: SmgListing, quelle: 'homegate' | 'immoscout24'): Roh | null {
  if (l.offerType && l.offerType !== 'RENT') return null
  const art = smgArt(l.categories ?? [])
  if (!art) return null
  const lok = l.localization ?? {}
  const sprache = lok.de ?? (lok.primary ? lok[lok.primary] : undefined) ?? Object.values(lok).find((x) => typeof x === 'object')
  const bild = sprache?.attachments?.find((a) => a.type === 'IMAGE' && (a.url || a.file))
  const rent = l.prices?.rent
  const monatlich = !rent?.interval || rent.interval === 'MONTH'
  const brutto = zahl(rent?.gross) ?? (zahl(rent?.net) != null ? zahl(rent?.net)! + (zahl(rent?.extra) ?? 0) : null)
  const basis = quelle === 'homegate' ? 'https://www.homegate.ch/mieten/' : 'https://www.immoscout24.ch/mieten/'
  return {
    quelle,
    quellId: String(l.id),
    url: basis + l.id,
    titel: text(sprache?.text?.title) ?? 'Mietwohnung',
    art,
    strasse: text(l.address?.street),
    plz: text(l.address?.postalCode),
    ort: text(l.address?.locality),
    lon: zahl(l.address?.geoCoordinates?.longitude),
    lat: zahl(l.address?.geoCoordinates?.latitude),
    zimmer: zahl(l.characteristics?.numberOfRooms),
    flaeche: zahl(l.characteristics?.livingSpace) ?? zahl(l.characteristics?.totalFloorSpace),
    miete: monatlich ? brutto : null,
    bezug: bezugsdatum(l.availableFrom ?? l.availability?.availableFrom),
    bild: bild?.url ?? null,
  }
}

async function smg(quelle: 'homegate' | 'immoscout24'): Promise<Roh[]> {
  const seite = (n: number) =>
    quelle === 'homegate'
      ? `https://www.homegate.ch/mieten/immobilien/ort-zuerich/trefferliste${n > 1 ? `?ep=${n}` : ''}`
      : `https://www.immoscout24.ch/de/immobilien/mieten/ort-zuerich${n > 1 ? `?pn=${n}` : ''}`

  const funde = new Map<string, Roh>()
  let seiten = 1
  for (let n = 1; n <= Math.min(seiten, 60); n++) {
    const zustand = anfangszustand(await holen(seite(n), false))
    if (n === 1) seiten = seitenzahl(zustand) ?? 60
    const vorher = funde.size
    for (const l of smgListings(zustand)) {
      const r = smgRoh(l, quelle)
      if (r) funde.set(r.quellId, r)
    }
    if (n === 1 && funde.size === 0 && smgListings(zustand).length === 0) {
      throw new Error('Trefferliste ohne Inserate, das Seitenformat hat sich wohl geändert')
    }
    if (funde.size === vorher && n > 1) break
    // Höflich bleiben: eine Seite alle zwei Sekunden.
    await warte(2000)
  }
  return [...funde.values()]
}

// ─── Zusammenführen ───────────────────────────────────────────────────────

/** Meter zwischen zwei Punkten, flach gerechnet; reicht innerhalb der Stadt. */
function meter(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const dx = (a.lon - b.lon) * 111320 * Math.cos((47.37 * Math.PI) / 180)
  const dy = (a.lat - b.lat) * 111133
  return Math.hypot(dx, dy)
}

/** Dieselbe Wohnung? Nahe beieinander, gleich viele Zimmer, fast dieselbe Miete. */
function gleich(a: Inserat, b: Inserat): boolean {
  if (a.lon == null || a.lat == null || b.lon == null || b.lat == null) return false
  if (meter({ lon: a.lon, lat: a.lat }, { lon: b.lon, lat: b.lat }) > 40) return false
  if (a.zimmer != null && b.zimmer != null && a.zimmer !== b.zimmer) return false
  if (a.miete != null && b.miete != null && Math.abs(a.miete - b.miete) > Math.max(a.miete, b.miete) * 0.03) return false
  if (a.flaeche != null && b.flaeche != null && Math.abs(a.flaeche - b.flaeche) > 3) return false
  return a.miete != null || a.flaeche != null || a.zimmer != null
}

function zusammenlegen(liste: Inserat[]): Inserat[] {
  const raus: Inserat[] = []
  for (const i of liste) {
    const da = raus.find((r) => !r.links.some((l) => l.quelle === i.links[0].quelle) && gleich(r, i))
    if (!da) {
      raus.push(i)
      continue
    }
    da.links.push(...i.links)
    // Die Lücken des einen füllt der andere.
    for (const k of ['strasse', 'plz', 'flaeche', 'miete', 'bezug', 'bild', 'zimmer'] as const) {
      if (da[k] == null) (da as Record<string, unknown>)[k] = i[k]
    }
    if (i.erstGesehen < da.erstGesehen) da.erstGesehen = i.erstGesehen
  }
  return raus
}

// ─── Einordnen mit den Werten der Karte ───────────────────────────────────

type Haus = { x: number; y: number; m: number; r: number; k: number; kr: number }

function ladeHaeuser(): { haeuser: Haus[]; naechstes: (lon: number, lat: number) => Haus | null } {
  const geo = JSON.parse(readFileSync(`${DATEN}/buildings.geojson`, 'utf8')) as {
    features: { properties: Haus }[]
  }
  const haeuser = geo.features.map((f) => f.properties)
  // Raster aus Zellen von etwa 100 m.
  const Z = 0.0012
  const zellen = new Map<string, Haus[]>()
  const schluessel = (lon: number, lat: number) => `${Math.floor(lon / Z)},${Math.floor(lat / Z)}`
  for (const h of haeuser) {
    const s = schluessel(h.x, h.y)
    const z = zellen.get(s)
    if (z) z.push(h)
    else zellen.set(s, [h])
  }
  const naechstes = (lon: number, lat: number) => {
    const cx = Math.floor(lon / Z)
    const cy = Math.floor(lat / Z)
    let best: Haus | null = null
    let bestD = 120
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const h of zellen.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = meter({ lon, lat }, { lon: h.x, lat: h.y })
          if (d < bestD) {
            bestD = d
            best = h
          }
        }
      }
    }
    return best
  }
  return { haeuser, naechstes }
}

function stadtgrenze(): (lon: number, lat: number) => boolean {
  const geo = JSON.parse(readFileSync(`${DATEN}/city.geojson`, 'utf8'))
  const g = geo.type === 'FeatureCollection' ? geo.features[0].geometry : geo.geometry ?? geo
  const polygone: number[][][][] = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
  return (lon, lat) => polygone.some((p) => pointInRings(p, lon, lat))
}

// ─── Lauf ─────────────────────────────────────────────────────────────────

async function main() {
  const jetzt = new Date().toISOString()
  const vorher: Wohnungen | null = existsSync(AUSGABE) ? JSON.parse(readFileSync(AUSGABE, 'utf8')) : null
  const bekannt = new Map<string, string>()
  for (const i of vorher?.inserate ?? []) for (const l of i.links) bekannt.set(l.url, i.erstGesehen)

  const quellen: [QuellenId, () => Promise<Roh[]>][] = [
    ['flatfox', flatfox],
    ['homegate', () => smg('homegate')],
    ['immoscout24', () => smg('immoscout24')],
  ]

  const inStadt = stadtgrenze()
  const { haeuser, naechstes } = ladeHaeuser()

  const stand: QuellenStand[] = []
  const alle: Inserat[] = []
  for (const [id, abruf] of quellen) {
    const alt = vorher?.quellen.find((q) => q.id === id)
    try {
      const funde = await abruf()
      let drin = 0
      for (const r of funde) {
        const mitOrt = r.lon != null && r.lat != null
        if (mitOrt ? !inStadt(r.lon!, r.lat!) : !(r.plz && PLZ_STADT.has(r.plz))) continue
        const { quelle, quellId, url, ...rest } = r
        alle.push({
          ...rest,
          id: `${quelle}:${quellId}`,
          links: [{ quelle, url }],
          erstGesehen: bekannt.get(url) ?? jetzt,
          oev: null,
          oevRang: null,
          kultur: null,
          kulturRang: null,
        })
        drin++
      }
      console.log(`${NAMEN[id]}: ${funde.length} Inserate, ${drin} in der Stadt`)
      stand.push({ id, name: NAMEN[id], anzahl: drin, ok: true, zuletzt: jetzt })
    } catch (e) {
      const fehler = e instanceof Error ? e.message : String(e)
      console.warn(`${NAMEN[id]}: ${fehler}`)
      // Was beim letzten erfolgreichen Abruf da war, bleibt eine Weile stehen.
      const zuletzt = alt?.zuletzt ?? null
      let gehalten = 0
      if (zuletzt && Date.parse(jetzt) - Date.parse(zuletzt) < HALTEN_MS) {
        for (const i of vorher?.inserate ?? []) {
          const link = i.links.find((l) => l.quelle === id)
          if (!link) continue
          alle.push({ ...i, id: i.id.startsWith(`${id}:`) ? i.id : `${id}:${link.url}`, links: [link] })
          gehalten++
        }
      }
      stand.push({ id, name: NAMEN[id], anzahl: gehalten, ok: false, fehler, zuletzt })
    }
  }

  // Flatfox zuerst: Dort inserieren oft die Verwaltungen selbst, die Links sind die direktesten.
  const inserate = zusammenlegen(alle)
  for (const i of inserate) {
    if (i.lon == null || i.lat == null) continue
    const h = naechstes(i.lon, i.lat)
    if (!h) continue
    i.oev = h.m
    i.oevRang = h.r
    i.kultur = h.k
    i.kulturRang = h.kr
  }
  inserate.sort((a, b) => b.erstGesehen.localeCompare(a.erstGesehen))

  if (inserate.length === 0 && (vorher?.inserate.length ?? 0) > 0) {
    throw new Error('Keine einzige Quelle hat geliefert, die alte Datei bleibt stehen.')
  }

  const ergebnis: Wohnungen = { erstellt: jetzt, haeuser: haeuser.length, quellen: stand, inserate }
  mkdirSync(path.dirname(AUSGABE), { recursive: true })
  writeFileSync(AUSGABE, JSON.stringify(ergebnis))
  const doppelt = alle.length - inserate.length
  console.log(`${inserate.length} Wohnungen geschrieben (${doppelt} Doppelte zusammengelegt) → ${AUSGABE}`)
}

await main()
