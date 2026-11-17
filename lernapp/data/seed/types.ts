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
}
