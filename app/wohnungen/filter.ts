/**
 * Die Filter der Wohnungssuche und die Prüfung, ob ein Inserat passt. Geteilt
 * zwischen der Seite und dem Versand der Suchabos (`pipeline/21-suchabos.ts`),
 * damit eine Mail genau das bringt, was die Seite mit denselben Filtern zeigt.
 * Kein React, kein Browser.
 */
import type { Inserat, QuellenId, Art } from './typen'
import type { Suche } from './quellen'

export const SORTEN = {
  neu: 'Neueste zuerst',
  guenstig: 'Günstigste zuerst',
  m2: 'Preis pro m²',
  oev: 'Beste ÖV-Anbindung',
  kultur: 'Meiste Kultur in der Nähe',
  gross: 'Grösste zuerst',
} as const
export type Sorte = keyof typeof SORTEN

export type Filter = Suche & {
  arten: Art[]
  /** Abgewählte Quellen. Als Ausschlussliste, damit neue Quellen von selbst dazukommen. */
  quellenAus: QuellenId[]
  /** Höchstens so viele Minuten mittlere ÖV-Reisezeit. */
  oevMax: number | null
  text: string
  nurNeu: boolean
  nurGemerkt: boolean
  nurAusschnitt: boolean
  /** Befristet oder nicht, erkannt vom Sammler aus Feldern und Text. */
  dauer: 'alle' | 'unbefristet' | 'befristet'
  /** Auf der Karte gezeichnete Kreise: Mittelpunkt und Radius in Metern. */
  gebiete: Gebiet[]
  /** Nur diese Postleitzahlen; setzt ein Suchabo, das auf einer Kreisseite angelegt wurde. */
  plz?: string[]
  sorte: Sorte
}

export const FILTER_LEER: Filter = {
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
  dauer: 'alle',
  gebiete: [],
  sorte: 'neu',
}

export const TAG = 24 * 3600 * 1000

export type Gebiet = { lon: number; lat: number; r: number }

/** Meter zwischen zwei Punkten, flach gerechnet; reicht innerhalb der Stadt. */
export function meter(alon: number, alat: number, blon: number, blat: number) {
  return Math.hypot((alon - blon) * 75_400, (alat - blat) * 111_133)
}

export function passt(i: Inserat, f: Filter, gemerkt: Set<string>, jetzt: number, ausschnitt: [number, number, number, number] | null) {
  if (f.nurGemerkt && !gemerkt.has(i.id)) return false
  if (!f.arten.includes(i.art)) return false
  if (i.links.every((l) => f.quellenAus.includes(l.quelle))) return false
  if (f.mieteMax != null && (i.miete == null || i.miete > f.mieteMax)) return false
  if (f.zimmerMin != null && (i.zimmer == null || i.zimmer < f.zimmerMin)) return false
  if (f.zimmerMax != null && (i.zimmer == null || i.zimmer > f.zimmerMax)) return false
  if (f.flaecheMin != null && (i.flaeche == null || i.flaeche < f.flaecheMin)) return false
  if (f.oevMax != null && (i.oev == null || i.oev > f.oevMax)) return false
  if (f.nurNeu && jetzt - Date.parse(i.erstGesehen) > TAG) return false
  if (f.dauer === 'befristet' && !i.befristet) return false
  if (f.dauer === 'unbefristet' && i.befristet) return false
  if (f.plz?.length && !(i.plz && f.plz.includes(i.plz))) return false
  if (f.gebiete.length) {
    if (i.lon == null || i.lat == null) return false
    if (!f.gebiete.some((g) => meter(i.lon!, i.lat!, g.lon, g.lat) <= g.r)) return false
  }
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
