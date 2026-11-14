import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod/v4'
import type { Db } from './db/index.ts'
import { MANIPULATION_TYPES } from './core/quality.ts'
import { addStatements, AppError, getUnitMaterial, reviewStatement, submitChecks } from './service.ts'

/**
 * Neue Klicker-Aussagen direkt aus der App erzeugen, ohne claude.ai:
 * 1. Claude schreibt pro UE Aussagen, jede mit wörtlichem Zitat aus einem Notes-Stück.
 * 2. Die App prüft sie deterministisch (Zitat in der Quelle, Absolutwörter, Zahlen).
 * 3. Ein zweiter, blinder Aufruf sieht nur Aussage und Zitat und urteilt R oder F.
 * Stimmen Generator und Prüfer überein und gibt es keine Hinweise, wird die Aussage
 * freigegeben, sonst landet sie in der Inbox.
 */

// Bewusst nur Haiku: günstig genug, um viele Fragen zu erzeugen (Vorgabe des Besitzers).
const MODEL = 'claude-haiku-5-5'

const Generated = z.object({
  statements: z.array(
    z.object({
      text: z.string().describe('Die Aussage, wie sie in der Frage steht, ein Satz'),
      truth: z.enum(['R', 'F']),
      quote: z.string().describe('Wörtliches Zitat aus dem Stück, das die Aussage belegt (bei F: das Richtige)'),
      chunk_id: z.number().int(),
      reason: z.string().describe('Kurze Begründung; bei F, was richtig wäre'),
      source_ref: z.string().describe('Fundstelle, z. B. «VL4 p.5» oder «ZM S.69»'),
      topic: z.string().describe('Thema mit Präposition, z. B. «zu Hunger- und Sättigungssignalen»'),
      manipulation_type: z.enum(MANIPULATION_TYPES).nullable().describe('Nur bei F, sonst null'),
    }),
  ),
})

const Checked = z.object({
  checks: z.array(
    z.object({
      id: z.number().int(),
      truth: z.enum(['R', 'F']),
      flags: z.array(z.string()).describe('z. B. «mehrdeutig», «nicht_belegt», «zwei_verfaelschungen»; leer, wenn alles passt'),
    }),
  ),
})

const GENERATE_SYSTEM = `Du schreibst Aussagen für Klickerfragen (Mehrfachauswahl, jede Aussage einzeln richtig oder falsch) für eine Psychologie-Vorlesung an der Universität. Sprache: Schweizer Hochdeutsch (kein ß), sachlich, Prüfungsniveau.

Regeln:
- Schreib nur über Inhalte, die in den gelieferten Stücken stehen. Erfinde nichts.
- Jede Aussage braucht ein wörtliches Zitat (quote) aus genau einem Stück und dessen chunk_id. Das Zitat muss Zeichen für Zeichen im Stück vorkommen; Markdown-Zeichen wie ** darfst du weglassen.
- Etwa die Hälfte richtig (R), die Hälfte falsch (F). Eine F-Aussage enthält genau eine Verfälschung (vertauschung, negation, zahl, zuordnung, andere) und das Zitat belegt, was stimmt.
- Keine Absolutwörter wie «immer», «nie», «nur», ausser sie sind die gewollte Verfälschung oder stehen im Zitat.
- Prüfungsrelevant: Mechanismen, Befunde, Unterschiede, Definitionen, Zahlen von Folien. ICD-Codenummern müssen nicht auswendig gelernt werden, frag sie nicht ab.
- Keine Doppelungen mit den bestehenden Aussagen, auch nicht umformuliert. Decke Stellen ab, zu denen es noch keine Aussage gibt.
- Fundstelle aus den Verweisen im Stück ableiten, z. B. «KliBio VL4, p.5» → «VL4 p.5», «ZM KliBio, p.69» → «ZM S.69».`

const CHECK_SYSTEM = `Du prüfst Aussagen für Klickerfragen. Du siehst nur die Aussage und ein Zitat aus den Vorlesungsnotizen. Entscheide allein aus dem Zitat, ob die Aussage richtig (R) oder falsch (F) ist. Melde Hinweise, wenn die Aussage mehrdeutig ist, mehr als eine Verfälschung enthält oder etwas behauptet, das das Zitat nicht belegt.`

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AppError('ANTHROPIC_API_KEY fehlt auf dem Server, darum kann die App keine Fragen erzeugen.')
  return new Anthropic()
}

/** Text der ersten parsebaren Antwort oder ein Fehler mit verständlicher Meldung. */
function parsedOrThrow<T>(msg: { stop_reason: string | null; parsed_output?: T | null }, what: string): T {
  if (msg.stop_reason === 'refusal') throw new AppError(`${what}: Claude hat die Anfrage abgelehnt.`)
  if (msg.stop_reason === 'max_tokens') throw new AppError(`${what}: Antwort wurde abgeschnitten.`)
  if (!msg.parsed_output) throw new AppError(`${what}: Antwort liess sich nicht lesen.`)
  return msg.parsed_output
}

export type UnitResult = { unit: number; added: number; approved: number; inbox: number; rejected: number; error?: string }

/** Erzeugt für eine UE etwa `count` neue Aussagen, prüft sie blind und gibt die einwandfreien frei. */
export async function generateForUnit(db: Db, subjectId: number, unitNumber: number, count: number): Promise<UnitResult> {
  const material = await getUnitMaterial(db, subjectId, unitNumber)
  if (material.chunks.length === 0) throw new AppError(`UE ${unitNumber} hat noch keine Notes. Zuerst Notes einspielen.`)
  const anthropic = client()

  const chunksText = material.chunks.map((c) => `<stueck id="${c.id}"${c.heading ? ` titel="${c.heading}"` : ''}>\n${c.text}\n</stueck>`).join('\n\n')
  const existing = material.statements.map((s) => `- [${s.truth}] ${s.text}`).join('\n') || '(noch keine)'
  const styles = material.styleExamples.length
    ? material.styleExamples.map((e) => `${e.stem}\n${e.options.map((o) => `  - ${o.text}`).join('\n')}`).join('\n\n')
    : ''

  const gen = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: zodOutputFormat(Generated) },
    system: GENERATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `UE ${unitNumber}: ${material.unit.title}\n\nNotizen zur UE:\n${chunksText}\n\nBestehende Aussagen (nicht wiederholen):\n${existing}${
          styles ? `\n\nStilvorlagen aus OLAT/Altprüfungen (nur für Länge und Schwierigkeit):\n${styles}` : ''
        }\n\nSchreib ${count} neue Aussagen.`,
      },
    ],
  })
  const { statements } = parsedOrThrow(gen, `UE ${unitNumber}`)
  const validChunks = new Set(material.chunks.map((c) => c.id))

  const added = await addStatements(
    db,
    subjectId,
    statements.map((x) => ({
      unit: unitNumber,
      text: x.text,
      truth: x.truth,
      quote: x.quote,
      chunkId: validChunks.has(x.chunk_id) ? x.chunk_id : null,
      reason: x.reason,
      sourceRef: x.source_ref,
      topic: x.topic,
      manipulationType: x.truth === 'F' ? x.manipulation_type : null,
    })),
    'claude-app',
  )
  if (added.saved.length === 0) return { unit: unitNumber, added: 0, approved: 0, inbox: 0, rejected: added.rejected.length }

  // Blinde Gegenprüfung: nur Aussage und Zitat, ohne Label.
  const byId = new Map(added.saved.map((s) => [s.id, statements[s.index]]))
  const check = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'low', format: zodOutputFormat(Checked) },
    system: CHECK_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [...byId.entries()].map(([id, x]) => `<aussage id="${id}">\n${x.text}\n<zitat>${x.quote}</zitat>\n</aussage>`).join('\n\n'),
      },
    ],
  })
  const { checks } = parsedOrThrow(check, `Prüfung UE ${unitNumber}`)
  const results = await submitChecks(
    db,
    checks.filter((c) => byId.has(c.id)).map((c) => ({ statementId: c.id, truth: c.truth, flags: c.flags, model: MODEL })),
  )

  let approved = 0
  const flagsById = new Map(added.saved.map((s) => [s.id, s.flags]))
  for (const r of results) {
    const clean = r.agrees && (flagsById.get(r.statementId) ?? []).length === 0 && !checks.find((c) => c.id === r.statementId)?.flags.length
    if (clean && r.status === 'inbox') {
      await reviewStatement(db, r.statementId, 'approve', {})
      approved++
    } else if (r.status === 'active') approved++
  }
  return { unit: unitNumber, added: added.saved.length, approved, inbox: added.saved.length - approved, rejected: added.rejected.length }
}

/** Mehrere UEs parallel, damit es in eine Serverfunktion passt. Fehler einer UE stoppen die anderen nicht. */
export async function generateForUnits(db: Db, subjectId: number, units: number[], count: number): Promise<UnitResult[]> {
  return Promise.all(
    units.map((u) =>
      generateForUnit(db, subjectId, u, count).catch((e: unknown) => ({
        unit: u,
        added: 0,
        approved: 0,
        inbox: 0,
        rejected: 0,
        error: e instanceof AppError ? e.message : e instanceof Anthropic.APIError ? `API-Fehler ${e.status}: ${e.message}` : String(e),
      })),
    ),
  )
}
