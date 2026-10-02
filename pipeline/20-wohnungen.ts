/**
 * Sammelt Mietinserate für die Stadt Zürich aus mehreren Quellen und legt sie
 * als eine Liste ab: `wohnungen.json`, gelesen von der Seite `/wohnungen`.
 *
 *   node pipeline/20-wohnungen.ts [ausgabe.json]
 *
 * Ohne Angabe schreibt der Sammler nach `public/data/zuerich/wohnungen.json`.
 * Liegt dort schon eine Fassung, liest er sie vorher: Daraus stammt, seit wann
 * ein Inserat online ist, und wenn eine Quelle diesmal ausfällt, bleiben ihre
 * Inserate vom letzten Lauf stehen, bis sie drei Tage alt sind.
 *
 * Quellen, alle von GitHub Actions aus erreichbar (Stand Oktober 2026):
 *
 * * Flatfox über die öffentliche API. `/api/v1/pin/` liefert höchstens 1000
 *   Punkte je Ausschnitt, die Stadt wird deshalb in Kacheln abgefragt, volle
 *   Kacheln weiter geteilt. Die Details kommen gebündelt aus
 *   `/api/v1/public-listing/?pk=…&pk=…`. Flatfox gehört zur SMG und führt einen
 *   Teil der Homegate- und ImmoScout24-Inserate mit (`smg_id`).
 * * Ron Orp: Die Marktseite trägt die neuesten rund zehn Wohnungsinserate in
 *   `__NEXT_DATA__`, mit Koordinaten. Weil die Seite nicht blättert, bleiben
 *   früher gesammelte Inserate bis zu ihrem Ablaufdatum stehen.
 * * WOKO (Zimmer für Studierende) und Stiftung PWG: HTML der Liste freier Objekte.
 * * ABZ: WordPress-Schnittstelle, Beitragstyp `wohnung`.
 *
 * Nicht dabei, weil sie automatische Abrufe sperren (Cloudflare, auch mit
 * echtem Browser) oder eine Anmeldung verlangen: Homegate, ImmoScout24 direkt,
 * Newhome, Comparis, Tutti, Anibis, students.ch, wgzimmer.ch (reCaptcha) und
 * das Vermietungsportal der Stadt. Die Seite verlinkt sie.
 *
 * Danach werden Doppelte zusammengelegt und jedes Inserat bekommt die ÖV- und
 * Kulturwerte des nächsten Hauses der Karte. Wo eine Quelle keine Koordinaten
 * liefert, steht die Adresse für die Suche nach dem Haus.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pointInRings } from './lib/geo.ts'
import type { Art, Inserat, QuellenId, QuellenStand, Wohnungen } from '../app/wohnungen/typen.ts'

const DATEN = 'public/data/zuerich'
const AUSGABE = process.argv[2] ?? `${DATEN}/wohnungen.json`

/** Grosszügige Box um die Stadt; die Stadtgrenze schneidet danach genau zu. */
const BOX = { w: 8.44, s: 47.32, e: 8.63, n: 47.44 }

/** Postleitzahlen der Stadt, für Inserate ohne Koordinaten und ohne bekanntes Haus. */
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
  ronorp: 'Ron Orp',
  woko: 'WOKO',
  pwg: 'Stiftung PWG',
  abz: 'ABZ',
}

/** Ein Fund, bevor er zusammengelegt und eingeordnet ist. */
type Roh = Omit<Inserat, 'id' | 'links' | 'erstGesehen' | 'oev' | 'oevRang' | 'kultur' | 'kulturRang'> & {
  quelle: QuellenId
  quellId: string
  url: string
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms))
const heute = () => new Date().toISOString().slice(0, 10)

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
      if (!res.ok) throw new Error(`HTTP ${res.status} für ${url.slice(0, 120)}`)
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

/** «01.12.2026» oder «2026-12-01» auf JJJJ-MM-TT; liegt es in der Vergangenheit, ist die Wohnung sofort frei. */
function bezugsdatum(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  const ch = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  const d = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : ch ? `${ch[3]}-${ch[2].padStart(2, '0')}-${ch[1].padStart(2, '0')}` : null
  if (!d) return /sofort/i.test(s) ? 'sofort' : /vereinbarung/i.test(s) ? 'nach Vereinbarung' : null
  return d <= heute() ? 'sofort' : d
}

const ENTITAETEN: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', eacute: 'é', egrave: 'è', szlig: 'ss',
}

/** HTML-Schnipsel zu Klartext: Tags weg, Entitäten aufgelöst, Leerraum zusammengezogen. */
function klartext(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITAETEN[n] ?? m)
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()
}

/** Inhalt des ersten Elements mit dieser Klasse. */
function klasse(html: string, name: string): string | null {
  const m = html.match(new RegExp(`class="[^"]*\\b${name}\\b[^"]*"[^>]*>([\\s\\S]*?)</(?:div|p|span|h\\d|strong)>`))
  return m ? klartext(m[1]) : null
}

/** «Honrainweg 19, 8038 Zürich» in Strasse, PLZ und Ort zerlegen. */
function adresse(s: string | null): { strasse: string | null; plz: string | null; ort: string | null } {
  if (!s) return { strasse: null, plz: null, ort: null }
  const m = s.match(/^(.*?),?\s*(\d{4})\s+([^,]+?)(?:,.*)?$/)
  if (!m) return { strasse: s, plz: null, ort: null }
  return { strasse: m[1].replace(/,\s*$/, '').trim() || null, plz: m[2], ort: m[3].trim() }
}

// ─── Flatfox ──────────────────────────────────────────────────────────────

type FlatfoxListing = Record<string, unknown> & {
  pk: number
  cover_image?: { url?: string; url_thumb_m?: string; url_listing_search?: string } | number | null
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
  if (!b || typeof b !== 'object') return null
  const pfad = b.url_thumb_m ?? b.url_listing_search ?? b.url
  if (!pfad) return null
  return pfad.startsWith('http') ? pfad : `https://flatfox.ch${pfad}`
}

/**
 * Alle Pins in der Box. Die API liefert höchstens 1000 je Abfrage; ist eine
 * Kachel voll, wird sie geviertelt, bis jede Kachel weniger zurückgibt.
 */
async function flatfoxPins(box: typeof BOX, tiefe = 0): Promise<number[]> {
  const pins = (await holen(
    `https://flatfox.ch/api/v1/pin/?east=${box.e}&west=${box.w}&north=${box.n}&south=${box.s}&max_count=1000`,
    true
  )) as { pk: number }[]
  if (!Array.isArray(pins)) throw new Error('Antwort ohne Pin-Liste')
  if (pins.length < 1000 || tiefe >= 4) return pins.map((p) => p.pk)
  const mx = (box.w + box.e) / 2
  const my = (box.s + box.n) / 2
  const teile = [
    { w: box.w, e: mx, s: box.s, n: my },
    { w: mx, e: box.e, s: box.s, n: my },
    { w: box.w, e: mx, s: my, n: box.n },
    { w: mx, e: box.e, s: my, n: box.n },
  ]
  const alle: number[] = []
  for (const t of teile) alle.push(...(await flatfoxPins(t, tiefe + 1)))
  return alle
}

async function flatfox(): Promise<Roh[]> {
  const pks = [...new Set(await flatfoxPins(BOX))]
  const listings = new Map<number, FlatfoxListing>()
  for (let i = 0; i < pks.length; i += 40) {
    const teil = pks.slice(i, i + 40)
    const antwort = (await holen(
      `https://flatfox.ch/api/v1/public-listing/?${teil.map((pk) => `pk=${pk}`).join('&')}&expand=cover_image&limit=40`,
      true
    )) as { results?: FlatfoxListing[] }
    for (const l of antwort.results ?? []) listings.set(l.pk, l)
    await warte(250)
  }

  const funde: Roh[] = []
  for (const l of listings.values()) {
    if (l.offer_type !== 'RENT') continue
    const art = flatfoxArt(l)
    if (!art) continue
    const netto = zahl(l.rent_net)
    const nk = zahl(l.rent_charges)
    const bezugTyp = String(l.moving_date_type ?? '')
    funde.push({
      quelle: 'flatfox',
      quellId: String(l.pk),
      url: `https://flatfox.ch${text(l.url) ?? `/${l.pk}/`}`,
      titel: text(l.description_title) ?? text(l.pitch_title) ?? text(l.short_title) ?? 'Inserat auf Flatfox',
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
      smg: Boolean(text(l.smg_id)),
    })
  }
  return funde
}

// ─── Ron Orp ──────────────────────────────────────────────────────────────

type RonorpPost = {
  id?: number
  slug?: string
  title?: string
  post_type?: string
  price?: string | null
  publication_end_date?: string | null
  category?: { id?: number; name?: string } | null
  sub_category?: { id?: number; name?: string } | null
  location?: { address?: string; latitude?: number; longitude?: number; postal_code?: string; locality?: string } | null
  image?: { path?: string }[]
  housing_detail?: {
    looking_to?: string | null
    num_of_rooms?: string | null
    floor_size?: string | null
    ready_to_move?: string | null
    contract?: string | null
    additional_amenities?: string[] | null
  } | null
}

async function ronorp(): Promise<Roh[]> {
  const html = await holen('https://ronorp.net/zurich/market/housing', false)
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('kein __NEXT_DATA__ auf der Marktseite')
  const posts: RonorpPost[] = JSON.parse(m[1])?.props?.pageProps?.ssrPostTypeListPosts?.posts ?? []
  const funde: Roh[] = []
  for (const p of posts) {
    // Nur Angebote in «Wohnen»; Büros, Parkplätze und Suchinserate nicht.
    if (!p.id || !p.slug || p.post_type !== 'offer' || p.category?.name !== 'Wohnen') continue
    const h = p.housing_detail ?? {}
    if (h.looking_to && h.looking_to !== 'rent') continue
    const unter = p.sub_category?.name ?? ''
    const art: Art = /WG|Zimmer/i.test(unter)
      ? 'wg'
      : /Studio/i.test(unter)
        ? 'studio'
        : /Haus/i.test(unter)
          ? 'haus'
          : h.additional_amenities?.includes('furnished_apartment')
            ? 'moebliert'
            : 'wohnung'
    const ort = adresse(text(p.location?.address)?.replace(/,\s*Schweiz$/, '') ?? null)
    funde.push({
      quelle: 'ronorp',
      quellId: String(p.id),
      url: `https://ronorp.net/zurich/market/housing/${p.slug}`,
      titel: text(p.title) ?? 'Inserat auf Ron Orp',
      art,
      strasse: ort.strasse,
      plz: text(p.location?.postal_code) ?? ort.plz,
      ort: text(p.location?.locality) ?? ort.ort,
      lon: zahl(p.location?.longitude),
      lat: zahl(p.location?.latitude),
      zimmer: zahl(h.num_of_rooms),
      flaeche: zahl(h.floor_size),
      miete: zahl(p.price),
      bezug: bezugsdatum(h.ready_to_move),
      bild: text(p.image?.[0]?.path),
      bis: text(p.publication_end_date),
    })
  }
  return funde
}

// ─── WOKO ─────────────────────────────────────────────────────────────────

async function woko(): Promise<Roh[]> {
  const basis = 'https://www.woko.ch/unser-angebot/freie-objekte'
  const html = await holen(basis, false)
  const bloecke = html.split('<div class="crooms__element').slice(1)
  if (bloecke.length === 0 && !html.includes('crooms')) throw new Error('Liste der freien Objekte nicht gefunden')
  const funde: Roh[] = []
  for (const b of bloecke) {
    // data-typ 0 sind Zimmer, 1 Parkplätze.
    if (b.match(/data-typ="(\d+)"/)?.[1] !== '0') continue
    const titel = klartext(b.match(/data-title="([^"]*)"/)?.[1] ?? '') || klasse(b, 'crooms__headline') || 'Zimmer'
    const werte = [...b.matchAll(/<div class="crooms__text">([\s\S]*?)<\/div>/g)].map((x) => klartext(x[1]))
    const schluessel = [...b.matchAll(/<div class="crooms__text crooms__text--key">([\s\S]*?)<\/div>/g)].map((x) => klartext(x[1]))
    const feld = (k: string) => werte[schluessel.indexOf(k)] ?? null
    const ort = adresse(`${feld('Adresse') ?? ''}, ${feld('Ort') ?? ''}`)
    const detail = b.match(/href="\.\.\/unser-angebot\/freie-objekte\/(detail\?oid=\d+)"/)?.[1]
    if (!detail) continue
    funde.push({
      quelle: 'woko',
      quellId: detail.replace(/\D/g, ''),
      url: `${basis}/${detail}`,
      titel,
      art: 'wg',
      strasse: ort.strasse,
      plz: ort.plz,
      ort: ort.ort,
      lon: null,
      lat: null,
      zimmer: 1,
      flaeche: null,
      miete: zahl(b.match(/data-price="([^"]*)"/)?.[1]),
      bezug: bezugsdatum(feld('Wann')),
      bild: b.match(/<img src="([^"]+)"/)?.[1]?.replace(/ /g, '%20') ?? null,
    })
  }
  return funde
}

// ─── Stiftung PWG ─────────────────────────────────────────────────────────

async function pwg(): Promise<Roh[]> {
  const basis = 'https://www.pwg.ch/liegenschaften/zu-vermieten'
  const html = await holen(basis, false)
  const bloecke = html.split(/<div id="item-/).slice(1)
  if (bloecke.length === 0 && !html.includes('liegenschaften-item')) throw new Error('Liste der Objekte nicht gefunden')
  const funde: Roh[] = []
  for (const b of bloecke) {
    const nr = b.match(/^(\d+)/)?.[1]
    const kategorie = klasse(b, 'category') ?? ''
    if (!nr || !/^Wohnung|^Studio|^Zimmer/i.test(kategorie)) continue
    const ort = adresse(klasse(b, 'adresse'))
    const bild = b.match(/<img[^>]+src="([^"]+)"/)?.[1]
    funde.push({
      quelle: 'pwg',
      // Die Bewerbungsadresse trägt eine feste Kennung; die Nummer im Anker ändert sich mit der Liste.
      quellId: b.match(/uuids=([\w-]+)/)?.[1] ?? `${ort.strasse}-${klasse(b, 'floor') ?? nr}`,
      url: `${basis}#item-${nr}`,
      titel: klasse(b, 'titel') ?? `${kategorie.split(' ')[0]} der PWG`,
      art: /^Studio/i.test(kategorie) ? 'studio' : /^Zimmer/i.test(kategorie) ? 'wg' : 'wohnung',
      strasse: ort.strasse,
      plz: ort.plz,
      ort: ort.ort,
      lon: null,
      lat: null,
      zimmer: zahl(klasse(b, 'rooms')?.match(/[\d.,]+/)?.[0]),
      flaeche: zahl(klasse(b, 'area')?.match(/[\d.,]+/)?.[0]),
      miete: zahl(b.match(/Bruttomiete:<\/th>\s*<td>\s*([\d'’.]+)/)?.[1]) ?? zahl(klasse(b, 'prize')?.match(/[\d'’]+/)?.[0]),
      bezug: bezugsdatum(klasse(b, 'move_in_date')),
      bild: bild ? new URL(bild, basis).href : null,
    })
  }
  return funde
}

// ─── ABZ ──────────────────────────────────────────────────────────────────

type WpBeitrag = { id: number; link?: string; title?: { rendered?: string }; acf?: Record<string, unknown> }

async function abz(): Promise<Roh[]> {
  const beitraege = (await holen('https://www.abz.ch/wp-json/wp/v2/wohnung?per_page=100', true)) as WpBeitrag[]
  if (!Array.isArray(beitraege)) throw new Error('Antwort ohne Liste')
  return beitraege.map((w) => {
    const acf = w.acf ?? {}
    const titel = klartext(w.title?.rendered ?? '') || 'Wohnung der ABZ'
    // Die Felder sind nicht dokumentiert; was nach Adresse, Zimmern oder Miete aussieht, wird genommen.
    const finde = (re: RegExp) => Object.entries(acf).find(([k]) => re.test(k))?.[1]
    const ort = adresse(text(finde(/adress|strasse/i)) ?? titel)
    return {
      quelle: 'abz' as const,
      quellId: String(w.id),
      url: w.link ?? 'https://www.abz.ch/wohnen/mieten/',
      titel,
      art: 'wohnung' as const,
      strasse: ort.strasse,
      plz: ort.plz,
      ort: ort.ort ?? 'Zürich',
      lon: null,
      lat: null,
      zimmer: zahl(finde(/zimmer/i)),
      flaeche: zahl(finde(/flaeche|fläche/i)),
      miete: zahl(finde(/miete|brutto/i)),
      bezug: bezugsdatum(finde(/bezug|ab/i)),
      bild: null,
    }
  })
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

type Haus = { x: number; y: number; m: number; r: number; k: number; kr: number; s?: string }

/** «Bülachstrasse 1-11» → «buelachstrasse 1»: Kleinbuchstaben, Umlaute ausgeschrieben, erste Hausnummer. */
function adressSchluessel(s: string): string | null {
  const m = s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/str\.(\s|$)/g, 'strasse$1')
    .match(/^(.*?\D)\s*(\d+[a-z]?)\b/)
  return m ? `${m[1].replace(/[^a-z]/g, '')} ${m[2]}` : null
}

function ladeHaeuser() {
  const geo = JSON.parse(readFileSync(`${DATEN}/buildings.geojson`, 'utf8')) as {
    features: { properties: Haus }[]
  }
  const haeuser = geo.features.map((f) => f.properties)
  const nachAdresse = new Map<string, Haus>()
  for (const h of haeuser) {
    const k = h.s ? adressSchluessel(h.s) : null
    if (k && !nachAdresse.has(k)) nachAdresse.set(k, h)
  }
  // Raster aus Zellen von etwa 100 m.
  const Z = 0.0012
  const zellen = new Map<string, Haus[]>()
  for (const h of haeuser) {
    const s = `${Math.floor(h.x / Z)},${Math.floor(h.y / Z)}`
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
  const finde = (strasse: string | null) => {
    const k = strasse ? adressSchluessel(strasse) : null
    return k ? nachAdresse.get(k) ?? null : null
  }
  return { haeuser, naechstes, finde }
}

function stadtgrenze(): (lon: number, lat: number) => boolean {
  const geo = JSON.parse(readFileSync(`${DATEN}/city.geojson`, 'utf8'))
  const g = geo.type === 'FeatureCollection' ? geo.features[0].geometry : geo.geometry ?? geo
  const polygone: number[][][][] = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
  return (lon, lat) => polygone.some((p) => pointInRings(p, lon, lat))
}

// ─── Lauf ─────────────────────────────────────────────────────────────────

/** Quellen, die nur die neuesten Inserate zeigen: Früher Gesammeltes bleibt bis `bis` stehen. */
const SAMMELND = new Set<QuellenId>(['ronorp'])

async function main() {
  const jetzt = new Date().toISOString()
  const vorher: Wohnungen | null = existsSync(AUSGABE) ? JSON.parse(readFileSync(AUSGABE, 'utf8')) : null
  const bekannt = new Map<string, string>()
  for (const i of vorher?.inserate ?? []) for (const l of i.links) bekannt.set(l.url, i.erstGesehen)

  const quellen: [QuellenId, () => Promise<Roh[]>][] = [
    ['flatfox', flatfox],
    ['ronorp', ronorp],
    ['woko', woko],
    ['pwg', pwg],
    ['abz', abz],
  ]

  const inStadt = stadtgrenze()
  const { haeuser, naechstes, finde } = ladeHaeuser()

  /** Die Inserate einer Quelle aus dem letzten Lauf, je mit nur deren Link. */
  const alteVon = (id: QuellenId) =>
    (vorher?.inserate ?? []).flatMap((i) => {
      const link = i.links.find((l) => l.quelle === id)
      return link ? [{ ...i, id: i.id.startsWith(`${id}:`) ? i.id : `${id}:${link.url}`, links: [link] }] : []
    })

  const stand: QuellenStand[] = []
  const alle: Inserat[] = []
  for (const [id, abruf] of quellen) {
    const alt = vorher?.quellen.find((q) => q.id === id)
    try {
      const funde = await abruf()
      let drin = 0
      const neueUrls = new Set<string>()
      for (const r of funde) {
        // Ohne Koordinaten über die Adresse zum Haus der Karte.
        if (r.lon == null || r.lat == null) {
          const h = finde(r.strasse)
          if (h && (!r.plz || PLZ_STADT.has(r.plz))) {
            r.lon = h.x
            r.lat = h.y
          }
        }
        const mitOrt = r.lon != null && r.lat != null
        if (mitOrt ? !inStadt(r.lon!, r.lat!) : !(r.plz && PLZ_STADT.has(r.plz))) continue
        const { quelle, quellId, url, ...rest } = r
        neueUrls.add(url)
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
      if (SAMMELND.has(id)) {
        for (const i of alteVon(id)) {
          if (neueUrls.has(i.links[0].url) || (i.bis && i.bis < heute())) continue
          alle.push(i)
          drin++
        }
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
        for (const i of alteVon(id)) {
          alle.push(i)
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
