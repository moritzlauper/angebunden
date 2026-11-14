import { LETTERS } from './text.ts'

/**
 * Schreibt Fragen im Format der Exercises-Datei zurück (Klickerfragen_KliBio.md):
 * Tagesüberschrift, Frage mit UE, A–E und eine eingeklappte Lösung als Callout.
 */

export type ExportQuestion = {
  unitNumber: number | null
  unitTitle: string | null
  stem: string
  statements: { text: string; truth: 'R' | 'F'; reason: string | null; sourceRef: string | null }[]
}

export function solutionLine(letter: string, s: ExportQuestion['statements'][number]): string {
  const verdict = s.truth === 'R' ? 'richtig' : 'falsch'
  const reason = s.reason ? `, ${s.reason}` : ''
  const ref = s.sourceRef ? ` (${s.sourceRef})` : ''
  return `> - ${letter}: ${verdict}${reason}${ref}`
}

export function questionToMarkdown(q: ExportQuestion, index: number): string {
  const ue = q.unitNumber != null ? ` (UE ${q.unitNumber}${q.unitTitle ? `: ${q.unitTitle}` : ''})` : ''
  const lines = [`## Frage ${index}${ue}`, q.stem, '']
  q.statements.forEach((s, i) => lines.push(`${LETTERS[i]}) ${s.text}`))
  const correct = q.statements.map((s, i) => (s.truth === 'R' ? LETTERS[i] : null)).filter(Boolean)
  lines.push('', '> [!check]- Lösung', `> **Richtig: ${correct.length ? correct.join(', ') : 'keine'}**`)
  q.statements.forEach((s, i) => lines.push(solutionLine(LETTERS[i], s)))
  return lines.join('\n')
}

export function dayToMarkdown(dateLabel: string, questions: ExportQuestion[]): string {
  return [`# ${dateLabel}`, '', ...questions.map((q, i) => questionToMarkdown(q, i + 1)).join('\n\n').split('\n')].join('\n') + '\n'
}
