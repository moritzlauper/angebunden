export type PackStatement = {
  unit: number
  text: string
  truth: 'R' | 'F'
  reason: string | null
  quote: string
  sourceRef: string
  topic: string | null
  manipulationType: string | null
  flags: string[]
}
