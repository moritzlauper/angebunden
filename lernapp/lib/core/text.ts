import { createHash } from 'node:crypto'

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Für Vergleiche: Kleinschreibung, ß → ss, Bindestrich-Varianten und Leerraum vereinheitlicht. */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[‐-―−]/g, '-')
    .replace(/[«»„“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Steht das Zitat (normalisiert) im Text? */
/** Hervorhebungen aus Obsidian-Notes (**fett**, *kursiv*, <u>unterstrichen</u>) zählen beim Zitatvergleich nicht. */
function stripEmphasis(text: string): string {
  return text.replace(/<\/?u>/gi, '').replace(/\*\*|__/g, '').replace(/(^|[\s(])\*([^*\s][^*]*?)\*/g, '$1$2')
}

export function containsQuote(haystack: string, quote: string): boolean {
  const q = normalize(stripEmphasis(quote)).replace(/[.…]+$/, '').trim()
  if (!q) return false
  return normalize(stripEmphasis(haystack)).includes(q)
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const
export type Letter = (typeof LETTERS)[number]

export function formatDateCH(d: Date, timeZone = 'Europe/Zurich'): string {
  return new Intl.DateTimeFormat('de-CH', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}
