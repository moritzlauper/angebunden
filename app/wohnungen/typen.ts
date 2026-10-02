/**
 * Das Format von `wohnungen.json`, geteilt zwischen dem Sammler
 * (`pipeline/20-wohnungen.ts`) und der Seite `/wohnungen`. Reine Typen, kein
 * Code: die Datei landet in beiden Welten.
 */

export type QuellenId = 'flatfox' | 'homegate' | 'immoscout24'

export type Art = 'wohnung' | 'wg' | 'studio' | 'haus' | 'moebliert'

export type Inserat = {
  /** Stabil über Läufe: `quelle:id` des ersten Fundes. */
  id: string
  /** Wo das Inserat überall steht. Doppelte aus mehreren Portalen sind zusammengelegt. */
  links: { quelle: QuellenId; url: string }[]
  titel: string
  art: Art
  strasse: string | null
  plz: string | null
  ort: string | null
  lon: number | null
  lat: number | null
  zimmer: number | null
  /** Wohnfläche in m². */
  flaeche: number | null
  /** Bruttomiete pro Monat in CHF, Nebenkosten inbegriffen, soweit bekannt. */
  miete: number | null
  /** «sofort», «nach Vereinbarung» oder ein Datum JJJJ-MM-TT. */
  bezug: string | null
  bild: string | null
  /** Wann der Sammler das Inserat zum ersten Mal gesehen hat (ISO). */
  erstGesehen: string
  /**
   * Kennzahlen des nächsten Hauses der Erreichbarkeitskarte, sofern eines
   * höchstens 120 m entfernt liegt: mittlere ÖV-Reisezeit in Minuten, ihr
   * Rang unter allen Häusern, die Anzahl Kulturorte und deren Rang.
   */
  oev: number | null
  oevRang: number | null
  kultur: number | null
  kulturRang: number | null
}

export type QuellenStand = {
  id: QuellenId
  name: string
  /** Wie viele Inserate dieser Lauf von der Quelle bekommen hat. */
  anzahl: number
  ok: boolean
  fehler?: string
  /** Letzter erfolgreicher Abruf (ISO). */
  zuletzt: string | null
}

export type Wohnungen = {
  erstellt: string
  /** Anzahl Häuser der Karte, für «Rang x von y». */
  haeuser: number
  quellen: QuellenStand[]
  inserate: Inserat[]
}
