import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/index.ts'
import * as s from './db/schema.ts'
import { MANIPULATION_TYPES } from './core/quality.ts'
import { addStatements, AppError, checkQueue, getUnitMaterial, submitChecks } from './service.ts'

/**
 * Generator und blinder Prüfer direkt aus der App (Formular «Neue Aussagen erzeugen»).
 * Braucht ANTHROPIC_API_KEY. Ohne Key geht dasselbe über MCP mit dem eigenen Claude-Zugang.
 *
 * Ablauf pro UE: Claude bekommt nur die Textstücke dieser UE, schreibt Aussagen mit
 * wörtlichem Zitat, die App prüft Belegpflicht und Hinweise (add_statements), dann
 * urteilt ein zweiter Aufruf blind, nur mit Aussage und Zitat.
 */

export const MODEL = 'claude-opus-5-5'

function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError(
      'ANTHROPIC_API_KEY fehlt. In Vercel unter Settings → Environment Variables setzen und neu deployen. Ohne Key: Claude über den MCP-Connector bitten, z. B. «Schlag 15 neue Aussagen pro UE für KliBio vor».',
    )
  }
  return new Anthropic()
}

const GeneratedSchema = z.object({
  statements: z.array(
    z.object({
      text: z.string(),
      truth: z.enum(['R', 'F']),
      reason: z.string(),
      quote: z.string(),
      chunk_id: z.number().int(),
      source_ref: z.string(),
      topic: z.string(),
      manipulation_type: z.enum([...MANIPULATION_TYPES, 'keine']),
    }),
  ),
})

const CheckSchema = z.object({
  checks: z.array(
    z.object({
      id: z.number().int(),
      truth: z.enum(['R', 'F']),
      flags: z.array(z.string()),
      comment: z.string(),
    }),
  ),
})

const GENERATOR_SYSTEM = `Du schreibst Aussagen für Klickerfragen im OLAT-Format einer Psychologie-Vorlesung an der Universität Zürich. In der Prüfung stehen je fünf Aussagen unter einem Fragestamm, und man kreuzt die richtigen an (0 bis 5 können richtig sein).

Regeln:
- Erfinde nichts. Jede Aussage stützt sich auf genau ein Textstück aus dem Material. quote ist ein wörtlicher, zusammenhängender Ausschnitt aus diesem Textstück (Gross-/Kleinschreibung und Satzzeichen wie im Original), chunk_id ist dessen ID.
- Jede Aussage ist eindeutig richtig (R) oder falsch (F), unabhängig von der Lesart. Keine Absolutwörter wie «immer», «nie», «ausschliesslich», «nur», wenn die Quelle sie nicht selbst so sagt.
- F-Aussagen enthalten genau eine Verfälschung. Typen: vertauschung (zwei Begriffe/Richtungen getauscht), negation, zahl (falsche Zahl, falscher Code), zuordnung (richtiger Begriff, falsche Struktur/Person/Kategorie). «doppelt» nur, wenn ausdrücklich verlangt. Wechsle die Typen ab. Bei R-Aussagen manipulation_type = «keine».
- reason: bei F kurz, was richtig wäre; bei R eine knappe Bestätigung oder Ergänzung.
- source_ref: die Fundstelle des Textstücks im Format «VL4 p.5» oder «ZM S.69». Steht im Textstück eine Fundstelle (Überschrift oder Link), übernimm sie.
- topic: Thema für den Fragestamm mit Präposition, z. B. «zu Hunger- und Sättigungssignalen».
- Etwa gleich viele R und F. Prüfungsrelevante Inhalte (Definitionen, Mechanismen, Diagnosekriterien, Zahlen, Leitlinien-Empfehlungen) vor Anekdoten. Keine Aussagen über das klinische Fallbeispiel einer einzelnen Person.
- Keine Doppelten zu den vorhandenen Aussagen, auch nicht umformuliert.
- Stil wie die Stilvorlagen: vollständige Sätze, Fachbegriffe wie in der Vorlesung, Schweizer Schreibweise (ss statt ß).`

const CHECKER_SYSTEM = `Du prüfst Aussagen für Klickerfragen blind. Du siehst nur die Aussage und ein wörtliches Zitat aus den Vorlesungsunterlagen. Entscheide allein anhand des Zitats, ob die Aussage richtig (R) oder falsch (F) ist. Nutze kein Vorwissen, das dem Zitat widerspricht.

flags (leer lassen, wenn alles in Ordnung ist):
- «mehrdeutig»: je nach Lesart richtig oder falsch
- «absolutwort»: «immer», «nie», «nur» o. ä., das das Zitat nicht hergibt
- «nicht_belegt:<Begriff>»: ein Begriff oder eine Zahl der Aussage kommt im Zitat nicht vor und ist für das Urteil wichtig
- «zwei_verfaelschungen»: eine falsche Aussage enthält mehr als einen Fehler
comment: ein kurzer Satz zum Urteil.`

async function ask<T>(schema: z.ZodType<T>, system: string, user: string): Promise<{ data: T; model: string }> {
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: user }],
  })
  if (res.stop_reason === 'refusal') throw new AppError('Claude hat die Anfrage abgelehnt.')
  if (res.stop_reason === 'max_tokens') throw new AppError('Antwort zu lang abgebrochen. Weniger Aussagen auf einmal anfordern.')
  if (!res.parsed_output) throw new AppError('Claude hat kein gültiges Ergebnis geliefert.')
  return { data: res.parsed_output as T, model: res.model }
}

/** Verteilt n Aussagen auf die UEs: mehr, wo viel Material und wenig Aussagen sind. */
export function allocate(n: number, units: { number: number; chunks: number; statements: number }[]): Map<number, number> {
  const usable = units.filter((u) => u.chunks > 0)
  const out = new Map<number, number>()
  if (usable.length === 0 || n <= 0) return out
  const weights = usable.map((u) => u.chunks / (1 + u.statements))
  const total = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (w / total) * n)
  const base = raw.map(Math.floor)
  let rest = n - base.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (rest <= 0) break
    base[i]++
    rest--
  }
  usable.forEach((u, i) => base[i] > 0 && out.set(u.number, base[i]))
  return out
}

export type GenerateOptions = {
  /** Anzahl pro UE (perUnit) oder insgesamt verteilt (total) */
  count: number
  mode: 'perUnit' | 'total'
  fromUnit: number
  toUnit: number
  hint?: string | null
}

export async function generateStatements(db: Db, subjectId: number, opts: GenerateOptions) {
  client() // ohne Key gleich abbrechen, nicht pro UE
  const count = Math.max(1, Math.min(opts.count, 40))
  const units = await db
    .select({
      id: s.unit.id,
      number: s.unit.number,
      title: s.unit.title,
      chunks: sql<number>`(select count(*)::int from ${s.chunk} where ${s.chunk.unitId} = ${s.unit.id})`,
      statements: sql<number>`(select count(*)::int from ${s.statement} where ${s.statement.unitId} = ${s.unit.id} and ${s.statement.status} <> 'retired')`,
    })
    .from(s.unit)
    .where(and(eq(s.unit.subjectId, subjectId), gte(s.unit.number, opts.fromUnit), lte(s.unit.number, opts.toUnit)))
    .orderBy(asc(s.unit.number))
  const missing = units.filter((u) => u.chunks === 0).map((u) => u.number)
  if (units.length === 0 || missing.length === units.length) {
    throw new AppError(`Für UE ${opts.fromUnit}–${opts.toUnit} sind noch keine Notes eingespielt. Lade zuerst Notes.md hoch (Abschnitt «Notes hochladen»).`)
  }
  const plan =
    opts.mode === 'perUnit'
      ? new Map(units.filter((u) => u.chunks > 0).map((u) => [u.number, count]))
      : allocate(count, units)

  const perUnit = await Promise.all(
    [...plan.entries()].map(async ([unitNumber, k]) => {
      const mat = await getUnitMaterial(db, subjectId, unitNumber)
      const material = mat.chunks
        .map((c) => `<chunk id="${c.id}"${c.heading ? ` fundstelle="${c.heading}"` : ''}>\n${c.text}\n</chunk>`)
        .join('\n')
      const existing = mat.statements.map((x) => `- [${x.truth}] ${x.text}`).join('\n') || '(keine)'
      const examples =
        mat.styleExamples.map((e) => `Frage: ${e.stem}\n${e.options.map((o, i) => `${'ABCDE'[i]}) ${o.text}`).join('\n')}`).join('\n\n') || '(keine)'
      const user = `UE ${mat.unit.number}: ${mat.unit.title}

<material>
${material}
</material>

<vorhandene_aussagen>
${existing}
</vorhandene_aussagen>

<verfaelschungstypen_bisher>${JSON.stringify(mat.manipulationCounts)}</verfaelschungstypen_bisher>

<stilvorlagen>
${examples}
</stilvorlagen>
${opts.hint ? `\nHinweis der Nutzerin oder des Nutzers: ${opts.hint}\n` : ''}
Schreibe genau ${k} neue Aussagen zu dieser UE.`
      try {
        const { data } = await ask(GeneratedSchema, GENERATOR_SYSTEM, user)
        const r = await addStatements(
          db,
          subjectId,
          data.statements.map((x) => ({
            unit: unitNumber,
            text: x.text,
            truth: x.truth,
            reason: x.reason || null,
            quote: x.quote,
            sourceRef: x.source_ref || null,
            chunkId: x.chunk_id,
            topic: x.topic || null,
            manipulationType: x.truth === 'F' && x.manipulation_type !== 'keine' ? x.manipulation_type : null,
          })),
        )
        return { unit: unitNumber, requested: k, saved: r.saved.map((x) => x.id), rejected: r.rejected.map((x) => x.reason), error: null as string | null }
      } catch (e) {
        return { unit: unitNumber, requested: k, saved: [] as number[], rejected: [] as string[], error: (e as Error).message }
      }
    }),
  )
  if (perUnit.every((u) => u.error)) throw new AppError(`Erzeugen fehlgeschlagen: ${perUnit[0].error}`)
  const ids = perUnit.flatMap((u) => u.saved)
  const checks = ids.length ? await blindCheck(db, ids) : { checked: 0, agree: 0, disagree: 0 }
  return { perUnit, skippedUnits: missing, checks }
}

/** Blinde Gegenprüfung für die angegebenen oder alle noch ungeprüften Aussagen (höchstens 60). */
export async function blindCheck(db: Db, ids?: number[], subjectId: number | null = null) {
  let queue = await checkQueue(db, subjectId, 200)
  if (ids) queue = queue.filter((q) => ids.includes(q.id))
  queue = queue.slice(0, 60)
  if (queue.length === 0) return { checked: 0, agree: 0, disagree: 0 }
  const list = queue.map((q) => `<aussage id="${q.id}">\n${q.text}\n<zitat>${q.quote}</zitat>\n</aussage>`).join('\n')
  const { data, model } = await ask(CheckSchema, CHECKER_SYSTEM, `Prüfe jede Aussage (id übernehmen):\n\n${list}`)
  const known = new Set(queue.map((q) => q.id))
  const res = await submitChecks(
    db,
    data.checks.filter((c) => known.has(c.id)).map((c) => ({ statementId: c.id, truth: c.truth, flags: c.flags, comment: c.comment, model })),
  )
  return { checked: res.length, agree: res.filter((r) => r.agrees).length, disagree: res.filter((r) => !r.agrees).length }
}

export async function chunkCounts(db: Db, subjectId: number) {
  const rows = await db
    .select({ number: s.unit.number, chunks: sql<number>`count(${s.chunk.id})::int` })
    .from(s.unit)
    .leftJoin(s.chunk, eq(s.chunk.unitId, s.unit.id))
    .where(eq(s.unit.subjectId, subjectId))
    .groupBy(s.unit.number)
  return new Map(rows.map((r) => [r.number, r.chunks]))
}

