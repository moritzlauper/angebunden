import { containsQuote, normalize } from './text.ts'

/**
 * Deterministische Prüfungen, bevor eine Aussage in die Inbox kommt.
 * Sie ersetzen die blinde Gegenprüfung nicht, sondern fangen das Offensichtliche ab:
 * fehlender Beleg, Zitat nicht in der Quelle, Absolutwörter und Zahlen, die im Zitat
 * nicht vorkommen.
 */

export const MANIPULATION_TYPES = ['vertauschung', 'negation', 'zahl', 'zuordnung', 'doppelt', 'andere'] as const
export type ManipulationType = (typeof MANIPULATION_TYPES)[number]

const ABSOLUTE_WORDS = [
  'immer',
  'nie',
  'niemals',
  'ausschliesslich',
  'ausnahmslos',
  'stets',
  'nur',
  'alle',
  'sämtliche',
  'grundsätzlich',
  'vollständig',
  'keinesfalls',
  'jede',
  'jeder',
  'jedes',
]

export type QualityInput = {
  text: string
  truth: 'R' | 'F'
  quote: string | null | undefined
  manipulationType?: string | null
  /** Text des Chunks, aus dem das Zitat stammen soll */
  chunkText?: string | null
}

export type QualityResult = {
  /** false = wird nicht gespeichert (Belegpflicht) */
  accept: boolean
  flags: string[]
  hard: boolean
}

function words(text: string): string[] {
  return normalize(text).split(/[^a-zäöüéèà0-9]+/i).filter(Boolean)
}

export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.'))
}

export function checkStatement(input: QualityInput): QualityResult {
  const flags: string[] = []
  const quote = input.quote?.trim() ?? ''
  if (quote.length < 8) return { accept: false, flags: ['kein_zitat'], hard: false }

  if (input.chunkText != null && !containsQuote(input.chunkText, quote)) flags.push('zitat_nicht_in_quelle')

  const statementWords = new Set(words(input.text))
  const quoteWords = new Set(words(quote))
  for (const w of ABSOLUTE_WORDS) {
    if (statementWords.has(w) && !quoteWords.has(w)) flags.push(`absolutwort:${w}`)
  }

  // Zahlen, die im Zitat fehlen. Bei F-Aussagen vom Typ «zahl» ist das gewollt.
  if (!(input.truth === 'F' && input.manipulationType === 'zahl')) {
    const quoteNumbers = new Set(numbersIn(quote))
    for (const n of numbersIn(input.text)) if (!quoteNumbers.has(n)) flags.push(`zahl_fehlt_im_zitat:${n}`)
  }

  // Fachbegriffe einer R-Aussage müssen in der Quelle stehen (Wortanfang genügt, wegen Flexion).
  // Verglichen wird mit dem ganzen Chunk, wenn bekannt, sonst mit dem Zitat.
  if (input.truth === 'R') {
    const nq = normalize(`${quote} ${input.chunkText ?? ''}`)
    const missing = [...statementWords]
      .filter((w) => w.length >= 7 && !/^\d/.test(w))
      .filter((w) => !nq.includes(w.slice(0, Math.max(6, Math.ceil(w.length * 0.7)))))
    if (missing.length >= 2) flags.push(`begriffe_nicht_in_quelle:${missing.slice(0, 4).join(',')}`)
  }

  let hard = false
  if (input.truth === 'F') {
    if (!input.manipulationType) flags.push('f_ohne_verfaelschungstyp')
    if (input.manipulationType === 'doppelt') hard = true
  }
  return { accept: true, flags, hard }
}

/** Verhält sich eine Variante deutlich anders als ihre Ur-Aussage? */
export function variantDiverges(
  parent: { answers: number; correct: number },
  variant: { answers: number; correct: number },
  minAnswers = 4,
  threshold = 0.5,
): boolean {
  if (parent.answers < minAnswers || variant.answers < minAnswers) return false
  return Math.abs(parent.correct / parent.answers - variant.correct / variant.answers) >= threshold
}
