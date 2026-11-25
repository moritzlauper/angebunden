export type PackStatement = {
  unit: number
  text: string
  truth: 'R' | 'F'
  reason: string | null
  /** Wörtliches Zitat aus Notes.md (Belegpflicht) */
  quote: string
  sourceRef: string
  topic: string | null
  manipulationType: string | null
  /** Aussagen mit gleicher family stehen nie zusammen in einer Frage (Varianten derselben Ur-Aussage). */
  family: string | null
  flags: string[]
}

export type Pack = {
  id: string
  /** Slug des Fachs */
  subject: string
  /** Titel für UEs, die es noch nicht gibt oder die nur «UE n» heissen */
  unitTitles: Record<number, string>
  statements: PackStatement[]
  /** Aussagen (wörtlich), die aus der Rotation genommen werden: Detailwissen, nicht prüfungsrelevant */
  retire: string[]
  /**
   * Themen, die aus der Rotation genommen werden: reguläre Ausdrücke (ohne Gross-/Kleinschreibung),
   * die auf jede Aussage des Fachs passen, auch auf Varianten und Aussagen, die nur in der Datenbank
   * stehen. Varianten (parentId) ausgemusterter Aussagen gehen jeweils mit.
   */
  retireMatching?: string[]
  /**
   * Felder für die Folienlinks des Fachs. Gesetzt wird ein Feld nur, wenn es noch leer ist oder den
   * alten Wert unter `replace` hat; was jemand von Hand eingetragen hat, bleibt.
   */
  subjectLinks?: {
    vaultName?: string
    vaultPath?: string
    slidesPattern?: string
    zmPath?: string
    /** Bisherige Werte, die überschrieben werden dürfen (z. B. ein Vorgabemuster, das nicht passt) */
    replace?: { vaultName?: string; vaultPath?: string; slidesPattern?: string; zmPath?: string }
  }
}
