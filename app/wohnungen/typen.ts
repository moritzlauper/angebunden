/**
 * Das Format von `wohnungen.json`, geteilt zwischen dem Sammler
 * (`pipeline/20-wohnungen.ts`) und der Seite `/wohnungen`. Reine Typen, kein
 * Code: die Datei landet in beiden Welten.
 */

/**
 * Die Quellen, die der Sammler selbst abfragt. Homegate und ImmoScout24 stehen
 * nur über Flatfox drin: Flatfox gehört zur SMG und führt einen Teil ihrer
 * Inserate mit. Direkt sperren beide automatische Abrufe.
 */
export type QuellenId = 'flatfox' | 'ronorp' | 'woko' | 'pwg' | 'abz' | 'gen'

export type Art = 'wohnung' | 'wg' | 'studio' | 'haus' | 'moebliert'

/** Ausstattung, die das Modell aus dem Inseratetext liest (`pipeline/lib/ki.ts`). */
export type Merkmal = 'balkon' | 'waschmaschine' | 'geschirrspueler' | 'lift' | 'haustiere' | 'hindernisfrei'

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
   * Bis wann das Inserat ausgeschrieben ist (JJJJ-MM-TT), falls die Quelle das
   * sagt. Ron Orp zeigt jeweils nur die neuesten Inserate; was früher gesammelt
   * wurde, bleibt bis zu diesem Tag stehen.
   */
  bis?: string | null
  /**
   * Befristet vermietet: aus dem Feld der Quelle, sonst aus Titel und Text
   * erkannt («Untermiete», «December only», «bis Ende März»).
   */
  befristet?: boolean
  /** Ende der Befristung (JJJJ-MM-TT), vom Modell aus dem Text gelesen. */
  befristetBis?: string | null
  /** Ausstattung laut Text. Fehlt, solange das Inserat nicht ausgewertet ist. */
  merkmale?: Merkmal[]
  /** Wohnungstausch: Die Wohnung gibt es nur gegen eine andere. */
  tausch?: boolean
  /** Deutliche Zeichen für ein Betrugsinserat (Vermieter im Ausland, Zahlung vor Besichtigung). */
  vorsicht?: boolean
  /** Von Homegate oder ImmoScout24 an Flatfox weitergereicht. */
  smg?: boolean
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
  /**
   * Gedächtnis des Sammlers: je Inserat-Adresse, wann es zum ersten und zum
   * letzten Mal gesehen wurde (ISO). Fehlt ein Inserat bei einem Lauf und
   * taucht beim nächsten wieder auf, gilt es so nicht als neu. Einträge
   * verfallen zwei Wochen nach dem letzten Sehen.
   */
  gesehen?: Record<string, [string, string]>
  /**
   * Wann ein Ron-Orp-Inserat zuletzt auf seiner Detailseite bestätigt wurde
   * (je Link, ISO). Ältere Bestätigungen gelten nicht mehr und werden neu geprüft.
   */
  geprueft?: Record<string, string>
  /**
   * Auswertungen des Modells je Inserat-Kennung: Prüfsumme des Textes und
   * Ergebnis. Ändert sich der Text, wird neu ausgewertet.
   */
  ki?: Record<string, { h: string; w: KiWerte }>
  /**
   * Vermietungsseiten der Genossenschaften: Prüfsumme des Seitentextes, Zeitpunkt
   * der Auswertung und die gefundenen Wohnungen. Nur eine geänderte Seite geht
   * erneut ans Modell.
   */
  seiten?: Record<string, { h: string; t: string; funde: SeitenFund[] }>
}

/** Was das Modell aus einem Inserat liest. */
export type KiWerte = {
  wgZimmer: boolean
  befristet: boolean
  befristetBis: string | null
  flaeche: number | null
  merkmale: Merkmal[]
  tausch: boolean
  vorsicht: boolean
}

/** Eine freie Wohnung, wie sie auf einer Vermietungsseite steht. */
export type SeitenFund = {
  titel: string
  art: Art
  strasse: string | null
  plz: string | null
  ort: string | null
  zimmer: number | null
  flaeche: number | null
  miete: number | null
  bezug: string | null
  befristet: boolean
  link: string | null
}
