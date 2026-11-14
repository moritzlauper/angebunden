import { LETTERS, type Letter } from './text.ts'

/**
 * Liest die beiden Formate der bisherigen Klicker-Routine:
 *
 * 1. Die Übungsdatei im Exercises-Ordner (Klickerfragen_KliBio.md):
 *      # 14.11.2026
 *      ## Frage 1 (UE 4: Essen und Konsum)
 *      Welche Aussagen zu … treffen zu?
 *      A) …
 *      > [!check]- Lösung
 *      > **Richtig: A, B**
 *      > - A: richtig (VL4 p.5)
 *      > - C: falsch, Leptin kommt aus den Fettzellen (VL4 p.5)
 *
 * 2. Die Aussagenbank aus dem Prompt:
 *      # UE 3 Stress
 *      [R] Text — Begründung (VL3 p.15)
 *      [F] Text — Begründung (VL3 p.5)
 */

export type ParsedStatement = {
  unitNumber: number
  text: string
  truth: 'R' | 'F'
  reason: string | null
  sourceRef: string | null
  topic: string | null
}

export type ParsedUnit = { number: number; title: string }

export type ParsedQuestion = {
  date: string | null
  unitNumber: number
  stem: string
  options: { letter: Letter; text: string; truth: 'R' | 'F' | null; reason: string | null; sourceRef: string | null }[]
}

export type ParsedBank = {
  units: ParsedUnit[]
  questions: ParsedQuestion[]
  statements: ParsedStatement[]
  warnings: string[]
}

/** Entfernt Markdown-Escapes, wie sie Google Drive beim Export setzt (\#, \>, \[\!check\]). */
function unescapeMarkdown(md: string): string {
  return md.replace(/\\([#>[\]!*_\-()`.])/g, '$1').replace(/\r\n?/g, '\n')
}

const REF_RE = /\(([^()]*(?:VL\s*\d|ZM|Skript|Folie|Notes|p\.\s*\d|S\.\s*\d)[^()]*)\)\s*\.?\s*$/i

/** «falsch, Leptin kommt aus den Fettzellen (VL4 p.5)» → Begründung und Fundstelle */
export function splitReasonAndRef(text: string): { reason: string | null; sourceRef: string | null } {
  let rest = text.trim()
  let sourceRef: string | null = null
  const m = rest.match(REF_RE)
  if (m) {
    sourceRef = m[1].trim()
    rest = rest.slice(0, m.index).trim()
  }
  rest = rest.replace(/^[,;:–—-]\s*/, '').replace(/[,;:–—-]\s*$/, '').trim()
  return { reason: rest || null, sourceRef }
}

/** «Welche Aussagen zur Regulation des Schlafs treffen zu?» → «zur Regulation des Schlafs» */
export function topicFromStem(stem: string): string | null {
  const m = stem.match(/Welche Aussagen\s+((?:zu[mr]?|über|zum)\s.+?)\s+(?:treffen|sind)\b/i)
  return m ? m[1].trim() : null
}

export function stemFromTopic(topic: string): string {
  const t = /^(zu[mr]?|über)\s/i.test(topic) ? topic : `zu ${topic}`
  return `Welche Aussagen ${t} treffen zu?`
}

export function parseBank(markdown: string): ParsedBank {
  const lines = unescapeMarkdown(markdown).split('\n')
  const units = new Map<number, string>()
  const questions: ParsedQuestion[] = []
  const statements: ParsedStatement[] = []
  const warnings: string[] = []

  let date: string | null = null
  let currentUnit: number | null = null
  let q: ParsedQuestion | null = null
  let correctList: Set<string> | null = null

  const finishQuestion = () => {
    if (!q) return
    for (const o of q.options) {
      if (o.truth === null && correctList) o.truth = correctList.has(o.letter) ? 'R' : 'F'
    }
    const topic = topicFromStem(q.stem)
    for (const o of q.options) {
      if (o.truth === null) {
        warnings.push(`Frage «${q.stem.slice(0, 40)}…» ${o.letter}: keine Lösung gefunden, übersprungen`)
        continue
      }
      statements.push({
        unitNumber: q.unitNumber,
        text: o.text,
        truth: o.truth,
        reason: o.reason,
        sourceRef: o.sourceRef,
        topic,
      })
    }
    questions.push(q)
    q = null
    correctList = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // # 14.11.2026
    const dateM = line.match(/^#\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*$/)
    if (dateM) {
      finishQuestion()
      date = dateM[1]
      continue
    }

    // ## Frage 1 (UE 4: Essen und Konsum)
    const frageM = line.match(/^#{1,4}\s*Frage\s*\d+\s*\(\s*UE\s*(\d+)\s*[:–—-]?\s*([^)]*)\)/i)
    if (frageM) {
      finishQuestion()
      const n = Number(frageM[1])
      if (frageM[2]?.trim() && !units.has(n)) units.set(n, frageM[2].trim())
      q = { date, unitNumber: n, stem: '', options: [] }
      currentUnit = n
      continue
    }

    // # UE 3 Stress  /  ## UE 3: Stress
    const ueM = line.match(/^#{1,4}\s*UE\s*(\d+)\s*[:–—-]?\s*(.*)$/i)
    if (ueM) {
      finishQuestion()
      currentUnit = Number(ueM[1])
      if (ueM[2]?.trim()) units.set(currentUnit, ueM[2].trim())
      else if (!units.has(currentUnit)) units.set(currentUnit, `UE ${currentUnit}`)
      continue
    }

    // [R] Text — Begründung (VL3 p.15)
    const bankM = line.match(/^[-*]?\s*\[(R|F)\]\s*(.+)$/i)
    if (bankM && !q) {
      if (currentUnit === null) {
        warnings.push(`Zeile ohne UE-Überschrift: «${line.slice(0, 50)}»`)
        continue
      }
      const truth = bankM[1].toUpperCase() as 'R' | 'F'
      const body = bankM[2]
      const dash = body.search(/\s[—–]\s/)
      let text: string
      let reason: string | null
      let sourceRef: string | null
      if (dash >= 0) {
        text = body.slice(0, dash).trim()
        ;({ reason, sourceRef } = splitReasonAndRef(body.slice(dash).replace(/^\s*[—–]\s*/, '')))
      } else {
        const r = splitReasonAndRef(body)
        text = r.reason ?? body.trim()
        reason = null
        sourceRef = r.sourceRef
      }
      statements.push({ unitNumber: currentUnit, text, truth, reason, sourceRef, topic: null })
      continue
    }

    if (!q) continue

    // Lösungsblock
    if (line.startsWith('>')) {
      const body = line.replace(/^>\s*/, '')
      const richtigM = body.match(/^\*{0,2}Richtig:\s*([^*]*)\*{0,2}/i)
      if (richtigM) {
        const list = richtigM[1].trim()
        correctList = new Set(/^keine/i.test(list) ? [] : list.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))
        continue
      }
      const optM = body.match(/^[-*]\s*([A-E])\s*:\s*(richtig|falsch)\b\s*(.*)$/i)
      if (optM) {
        const opt = q.options.find((o) => o.letter === optM[1].toUpperCase())
        if (opt) {
          opt.truth = optM[2].toLowerCase() === 'richtig' ? 'R' : 'F'
          const { reason, sourceRef } = splitReasonAndRef(optM[3])
          opt.reason = reason
          opt.sourceRef = sourceRef
        }
      }
      continue
    }

    // A) Text   (auch «A)Text» ohne Leerzeichen)
    const optLine = line.match(/^([A-E])\)\s*(.+)$/)
    if (optLine && LETTERS.includes(optLine[1] as Letter)) {
      q.options.push({ letter: optLine[1] as Letter, text: optLine[2].trim(), truth: null, reason: null, sourceRef: null })
      continue
    }

    if (q.options.length === 0) q.stem = q.stem ? `${q.stem} ${line}` : line
  }
  finishQuestion()

  return {
    units: [...units.entries()].map(([number, title]) => ({ number, title })).sort((a, b) => a.number - b.number),
    questions,
    statements,
    warnings,
  }
}

export type NotesSection = { unitNumber: number; title: string; markdown: string }

/** Zerlegt Notes.md nach «# UE n». Text vor der ersten UE wird ignoriert. */
export function splitNotesByUnit(markdown: string): NotesSection[] {
  const lines = unescapeMarkdown(markdown).split('\n')
  const out: NotesSection[] = []
  let cur: NotesSection | null = null
  for (const line of lines) {
    const m = line.match(/^#\s+UE\s*(\d+)\s*[:–—-]?\s*(.*)$/i)
    if (m) {
      if (cur) out.push(cur)
      cur = { unitNumber: Number(m[1]), title: m[2].trim() || `UE ${m[1]}`, markdown: '' }
      continue
    }
    if (cur) cur.markdown += `${line}\n`
  }
  if (cur) out.push(cur)
  return out.map((s) => ({ ...s, markdown: s.markdown.trim() }))
}

export type TextChunk = { heading: string | null; text: string; page: number | null }

/**
 * Zerlegt einen UE-Abschnitt in Stücke von höchstens ~1200 Zeichen entlang von
 * Überschriften und Absätzen. Die Überschrift wandert als Kontext mit.
 */
export function chunkMarkdown(markdown: string, maxChars = 1200): TextChunk[] {
  const out: TextChunk[] = []
  let heading: string | null = null
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) out.push({ heading, text, page: null })
    buf = []
  }
  for (const block of markdown.split(/\n{2,}/)) {
    const h = block.match(/^#{2,6}\s+(.+)$/m)
    if (h && block.trim().startsWith('#')) {
      flush()
      heading = h[1].trim()
      const rest = block.replace(/^#{2,6}\s+.+$/m, '').trim()
      if (rest) buf.push(rest)
      continue
    }
    if (buf.join('\n').length + block.length > maxChars) flush()
    buf.push(block)
  }
  flush()
  return out
}
