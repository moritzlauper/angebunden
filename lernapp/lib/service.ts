import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm'
import type { Db } from './db/index.ts'
import * as s from './db/schema.ts'
import { composeSession, type Candidate } from './core/compose.ts'
import { dayToMarkdown, type ExportQuestion } from './core/export.ts'
import { sourceLinks } from './core/links.ts'
import { chunkMarkdown, parseBank, splitNotesByUnit, type TextChunk } from './core/parse.ts'
import { checkStatement, variantDiverges } from './core/quality.ts'
import { gradeFor, isSafe, review, type CardFields } from './core/schedule.ts'
import { containsQuote, formatDateCH, LETTERS, normalize, sha256, slugify, type Letter } from './core/text.ts'

/**
 * Alle Abläufe der App an einem Ort. Die Weboberfläche (Server Actions) und der
 * MCP-Server rufen dieselben Funktionen auf, damit Claude genau das kann, was
 * man im Browser kann.
 */

export const USER = 'me'

export class AppError extends Error {}

// ───────────────────────────── Fächer und UEs ─────────────────────────────

export async function resolveSubject(db: Db, ref: string | number): Promise<s.Subject> {
  const all = await db.select().from(s.subject).orderBy(asc(s.subject.id))
  const r = String(ref).trim()
  const n = normalize(r)
  const hit =
    all.find((x) => String(x.id) === r) ??
    all.find((x) => x.slug === r || x.slug === slugify(r)) ??
    all.find((x) => normalize(x.name) === n || (x.shortName && normalize(x.shortName) === n)) ??
    all.find((x) => normalize(x.name).includes(n) || (x.shortName && normalize(x.shortName).includes(n)))
  if (!hit) throw new AppError(`Fach «${r}» nicht gefunden. Vorhanden: ${all.map((x) => x.name).join(', ') || 'keine'}`)
  return hit
}

export type SubjectInput = {
  name: string
  shortName?: string | null
  courseCode?: string | null
  dozent?: string | null
  vaultPath?: string | null
  vaultName?: string | null
  slidesPattern?: string | null
  zmPath?: string | null
  ueLimit?: number
  examDate?: string | null
  questionsPerSession?: number
  autoApprove?: boolean
}

export async function createSubject(db: Db, input: SubjectInput): Promise<s.Subject> {
  const slug = slugify(input.shortName || input.name)
  const [row] = await db
    .insert(s.subject)
    .values({ ...input, slug, ueLimit: input.ueLimit ?? 1 })
    .returning()
  return row
}

export async function updateSubject(
  db: Db,
  id: number,
  patch: Partial<SubjectInput> & { examMode?: boolean },
): Promise<s.Subject> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  if (Object.keys(clean).length === 0) return (await db.select().from(s.subject).where(eq(s.subject.id, id)))[0]
  const [row] = await db.update(s.subject).set(clean).where(eq(s.subject.id, id)).returning()
  return row
}

export async function upsertUnit(
  db: Db,
  subjectId: number,
  number: number,
  title?: string | null,
  slidesUntil?: number | null,
): Promise<s.Unit> {
  const [existing] = await db
    .select()
    .from(s.unit)
    .where(and(eq(s.unit.subjectId, subjectId), eq(s.unit.number, number)))
  if (existing) {
    const patch: Partial<s.Unit> = {}
    if (title && title !== existing.title) patch.title = title
    if (slidesUntil !== undefined && slidesUntil !== existing.slidesUntil) patch.slidesUntil = slidesUntil
    if (Object.keys(patch).length === 0) return existing
    const [row] = await db.update(s.unit).set(patch).where(eq(s.unit.id, existing.id)).returning()
    return row
  }
  const [row] = await db
    .insert(s.unit)
    .values({ subjectId, number, title: title || `UE ${number}`, slidesUntil: slidesUntil ?? null })
    .returning()
  return row
}

async function unitByNumber(db: Db, subjectId: number, number: number): Promise<s.Unit | undefined> {
  const [row] = await db
    .select()
    .from(s.unit)
    .where(and(eq(s.unit.subjectId, subjectId), eq(s.unit.number, number)))
  return row
}

// ───────────────────────────── Statistik ─────────────────────────────

type StatementStats = {
  answers: number
  wrong: number
  lastAnswered: Date | null
}

async function answerStats(db: Db, statementIds: number[]): Promise<Map<number, StatementStats>> {
  const out = new Map<number, StatementStats>()
  if (statementIds.length === 0) return out
  const rows = await db
    .select({
      statementId: s.answer.statementId,
      answers: sql<number>`count(*)::int`,
      wrong: sql<number>`sum(case when ${s.answer.correct} then 0 else 1 end)::int`,
      last: sql<string | null>`max(${s.answer.answeredAt})`,
    })
    .from(s.answer)
    .where(and(eq(s.answer.userId, USER), inArray(s.answer.statementId, statementIds)))
    .groupBy(s.answer.statementId)
  for (const r of rows) {
    out.set(r.statementId, { answers: r.answers, wrong: r.wrong, lastAnswered: r.last ? new Date(r.last) : null })
  }
  return out
}

async function cardStates(db: Db, statementIds: number[]): Promise<Map<number, s.CardStateRow>> {
  if (statementIds.length === 0) return new Map()
  const rows = await db
    .select()
    .from(s.cardState)
    .where(and(eq(s.cardState.userId, USER), inArray(s.cardState.statementId, statementIds)))
  return new Map(rows.map((r) => [r.statementId, r]))
}

export async function listSubjects(db: Db, now = new Date()) {
  const subjects = await db.select().from(s.subject).orderBy(asc(s.subject.id))
  const out = []
  for (const subj of subjects) {
    const rows = await db
      .select({ id: s.statement.id, status: s.statement.status, unitNumber: s.unit.number })
      .from(s.statement)
      .innerJoin(s.unit, eq(s.statement.unitId, s.unit.id))
      .where(eq(s.unit.subjectId, subj.id))
    const activeInLimit = rows.filter((r) => r.status === 'active' && r.unitNumber <= subj.ueLimit).map((r) => r.id)
    const states = await cardStates(db, activeInLimit)
    let due = 0
    let fresh = 0
    let safe = 0
    for (const id of activeInLimit) {
      const st = states.get(id)
      if (!st) fresh++
      else {
        if (st.due <= now) due++
        if (isSafe(st)) safe++
      }
    }
    const streak = await streakDays(db, subj.id, now)
    out.push({
      ...subj,
      counts: {
        active: rows.filter((r) => r.status === 'active').length,
        inLimit: activeInLimit.length,
        inbox: rows.filter((r) => r.status === 'inbox' || r.status === 'flagged').length,
        due,
        new: fresh,
        safe,
      },
      streak,
      daysToExam: subj.examDate ? Math.ceil((new Date(`${subj.examDate}T00:00:00`).getTime() - now.getTime()) / 86_400_000) : null,
    })
  }
  return out
}

/** Aufeinanderfolgende Tage (bis heute oder gestern) mit mindestens einer beantworteten Frage. */
async function streakDays(db: Db, subjectId: number, now: Date): Promise<number> {
  const rows = await db
    .select({ day: sql<string>`to_char(${s.question.answeredAt} at time zone 'Europe/Zurich', 'YYYY-MM-DD')` })
    .from(s.question)
    .innerJoin(s.practiceSession, eq(s.question.sessionId, s.practiceSession.id))
    .where(and(eq(s.practiceSession.subjectId, subjectId), sql`${s.question.answeredAt} is not null`))
    .groupBy(sql`1`)
  const days = new Set(rows.map((r) => r.day))
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(d)
  let streak = 0
  let cursor = new Date(now)
  if (!days.has(fmt(cursor))) cursor = new Date(cursor.getTime() - 86_400_000)
  while (days.has(fmt(cursor))) {
    streak++
    cursor = new Date(cursor.getTime() - 86_400_000)
  }
  return streak
}

export async function subjectOverview(db: Db, subjectId: number, now = new Date()) {
  const [subj] = await db.select().from(s.subject).where(eq(s.subject.id, subjectId))
  if (!subj) throw new AppError('Fach nicht gefunden')
  const units = await db.select().from(s.unit).where(eq(s.unit.subjectId, subjectId)).orderBy(asc(s.unit.number))
  const stmts = await db
    .select()
    .from(s.statement)
    .where(inArray(s.statement.unitId, units.length ? units.map((u) => u.id) : [-1]))
  const ids = stmts.map((x) => x.id)
  const [states, stats] = await Promise.all([cardStates(db, ids), answerStats(db, ids)])

  const chunks = units.length
    ? await db
        .select({ id: s.chunk.id, unitId: s.chunk.unitId, heading: s.chunk.heading, page: s.chunk.page })
        .from(s.chunk)
        .where(inArray(s.chunk.unitId, units.map((u) => u.id)))
    : []

  const unitRows = units.map((u) => {
    const mine = stmts.filter((x) => x.unitId === u.id)
    const active = mine.filter((x) => x.status === 'active')
    const seen = active.filter((x) => states.has(x.id))
    const safe = active.filter((x) => isSafe(states.get(x.id)))
    const due = seen.filter((x) => states.get(x.id)!.due <= now)
    let answers = 0
    let wrong = 0
    for (const x of active) {
      const st = stats.get(x.id)
      if (st) {
        answers += st.answers
        wrong += st.wrong
      }
    }
    // Abdeckung: Fundstelle × Anzahl Aussagen
    const coverage = new Map<string, number>()
    for (const x of mine.filter((m) => m.status !== 'retired')) {
      const key = x.sourceRef ?? 'ohne Fundstelle'
      coverage.set(key, (coverage.get(key) ?? 0) + 1)
    }
    const unitChunks = chunks.filter((c) => c.unitId === u.id)
    const usedChunks = new Set(mine.map((m) => m.chunkId).filter(Boolean))
    return {
      ...u,
      inLimit: u.number <= subj.ueLimit,
      total: active.length,
      inbox: mine.filter((x) => x.status === 'inbox' || x.status === 'flagged').length,
      seen: seen.length,
      safe: safe.length,
      due: due.length,
      new: active.length - seen.length,
      safePct: active.length ? Math.round((safe.length / active.length) * 100) : 0,
      accuracy: answers ? Math.round(((answers - wrong) / answers) * 100) : null,
      coverage: [...coverage.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de', { numeric: true })),
      chunks: unitChunks.length,
      uncoveredChunks: unitChunks.filter((c) => !usedChunks.has(c.id)).map((c) => c.heading ?? (c.page ? `S. ${c.page}` : `#${c.id}`)),
    }
  })

  const weak = stmts
    .filter((x) => x.status === 'active')
    .map((x) => ({ x, st: stats.get(x.id), cs: states.get(x.id) }))
    .filter((r) => r.st && r.st.wrong > 0)
    .sort((a, b) => b.st!.wrong - a.st!.wrong || b.st!.wrong / b.st!.answers - a.st!.wrong / a.st!.answers)
    .slice(0, 12)
    .map((r) => ({
      id: r.x.id,
      text: r.x.text,
      truth: r.x.truth,
      reason: r.x.reason,
      sourceRef: r.x.sourceRef,
      unitNumber: units.find((u) => u.id === r.x.unitId)?.number ?? null,
      wrong: r.st!.wrong,
      answers: r.st!.answers,
      p: Math.round(((r.st!.answers - r.st!.wrong) / r.st!.answers) * 100) / 100,
    }))

  return { subject: subj, units: unitRows, weak }
}

// ───────────────────────────── Quellen ─────────────────────────────

export type SyncInput = {
  kind: 'notes' | 'slides' | 'zm' | 'exam' | 'upload' | 'mcp'
  path: string
  /** Markdown oder Text. Bei kind=notes ohne unit wird nach «# UE n» zerlegt. */
  content?: string
  /** Seitentexte eines PDFs (z. B. Folien), je eine Seite */
  pages?: { page: number; text: string; pdfSelection?: string | null }[]
  unit?: number
}

async function replaceChunks(db: Db, sourceId: number, unitId: number, chunks: TextChunk[]) {
  const old = await db
    .select({ id: s.chunk.id })
    .from(s.chunk)
    .where(and(eq(s.chunk.sourceId, sourceId), eq(s.chunk.unitId, unitId)))
  const oldIds = old.map((c) => c.id)
  const affected = oldIds.length
    ? await db
        .select()
        .from(s.statement)
        .where(and(inArray(s.statement.chunkId, oldIds), inArray(s.statement.status, ['active', 'inbox'])))
    : []
  if (oldIds.length) await db.delete(s.chunk).where(inArray(s.chunk.id, oldIds))
  const inserted = chunks.length
    ? await db
        .insert(s.chunk)
        .values(chunks.map((c, i) => ({ sourceId, unitId, position: i, page: c.page, heading: c.heading, text: c.text })))
        .returning()
    : []
  // Quellenänderung: Zitat noch da → neu verknüpfen, sonst «neu prüfen».
  let relinked = 0
  let flagged = 0
  for (const st of affected) {
    const hit = st.quote ? inserted.find((c) => containsQuote(c.text, st.quote!)) : undefined
    if (hit) {
      await db.update(s.statement).set({ chunkId: hit.id }).where(eq(s.statement.id, st.id))
      relinked++
    } else {
      const flags = [...new Set([...(st.flags ?? []), 'quelle_geaendert'])]
      await db.update(s.statement).set({ status: 'flagged', flags, updatedAt: new Date() }).where(eq(s.statement.id, st.id))
      flagged++
    }
  }
  return { chunks: inserted.length, relinked, flagged }
}

export async function syncSource(db: Db, subjectId: number, input: SyncInput) {
  const body = input.pages ? JSON.stringify(input.pages) : (input.content ?? '')
  if (!body.trim()) throw new AppError('content oder pages fehlt')
  const hash = sha256(body)
  const [existing] = await db
    .select()
    .from(s.source)
    .where(and(eq(s.source.subjectId, subjectId), eq(s.source.path, input.path)))
  let sourceId: number
  if (existing) {
    sourceId = existing.id
    await db.update(s.source).set({ hash, kind: input.kind, syncedAt: new Date() }).where(eq(s.source.id, existing.id))
  } else {
    const [row] = await db.insert(s.source).values({ subjectId, kind: input.kind, path: input.path, hash }).returning()
    sourceId = row.id
  }
  const results: { unit: number; title: string; changed: boolean; chunks?: number; relinked?: number; flagged?: number }[] = []

  if (input.kind === 'notes' && input.unit == null && input.content) {
    const sections = splitNotesByUnit(input.content)
    if (sections.length === 0) throw new AppError('Keine «# UE n»-Überschriften gefunden. Gib unit an oder ergänze die Überschriften.')
    for (const sec of sections) {
      const u = await upsertUnit(db, subjectId, sec.unitNumber, sec.title)
      const h = sha256(sec.markdown)
      if (u.notesHash === h) {
        results.push({ unit: u.number, title: u.title, changed: false })
        continue
      }
      const r = await replaceChunks(db, sourceId, u.id, chunkMarkdown(sec.markdown))
      await db.update(s.unit).set({ notesHash: h }).where(eq(s.unit.id, u.id))
      results.push({ unit: u.number, title: u.title, changed: true, ...r })
    }
    return { sourceId, hash, units: results }
  }

  if (input.unit == null) throw new AppError('unit fehlt (nur Notes mit «# UE n» werden automatisch zugeordnet)')
  const u = (await unitByNumber(db, subjectId, input.unit)) ?? (await upsertUnit(db, subjectId, input.unit))
  const chunks: TextChunk[] = input.pages
    ? input.pages.filter((p) => p.text.trim()).map((p) => ({ heading: null, page: p.page, text: p.text.trim() }))
    : chunkMarkdown(input.content ?? '')
  const r = await replaceChunks(db, sourceId, u.id, chunks)
  if (input.kind === 'notes') await db.update(s.unit).set({ notesHash: sha256(body) }).where(eq(s.unit.id, u.id))
  results.push({ unit: u.number, title: u.title, changed: true, ...r })
  return { sourceId, hash, units: results }
}

export async function listSources(db: Db, subjectId: number) {
  const rows = await db
    .select({
      id: s.source.id,
      kind: s.source.kind,
      path: s.source.path,
      hash: s.source.hash,
      syncedAt: s.source.syncedAt,
      chunks: sql<number>`(select count(*)::int from ${s.chunk} where ${s.chunk.sourceId} = ${s.source.id})`,
    })
    .from(s.source)
    .where(eq(s.source.subjectId, subjectId))
    .orderBy(desc(s.source.syncedAt))
  return rows
}

export async function getUnitMaterial(db: Db, subjectId: number, unitNumber: number) {
  const u = await unitByNumber(db, subjectId, unitNumber)
  if (!u) throw new AppError(`UE ${unitNumber} existiert nicht`)
  const chunks = await db
    .select({
      id: s.chunk.id,
      page: s.chunk.page,
      heading: s.chunk.heading,
      text: s.chunk.text,
      kind: s.source.kind,
      path: s.source.path,
    })
    .from(s.chunk)
    .innerJoin(s.source, eq(s.chunk.sourceId, s.source.id))
    .where(eq(s.chunk.unitId, u.id))
    .orderBy(asc(s.source.path), asc(s.chunk.position))
  const statements = await db
    .select({
      id: s.statement.id,
      text: s.statement.text,
      truth: s.statement.truth,
      status: s.statement.status,
      sourceRef: s.statement.sourceRef,
      chunkId: s.statement.chunkId,
      manipulationType: s.statement.manipulationType,
    })
    .from(s.statement)
    .where(and(eq(s.statement.unitId, u.id), sql`${s.statement.status} <> 'retired'`))
  const examples = await db
    .select()
    .from(s.styleExample)
    .where(eq(s.styleExample.subjectId, subjectId))
    .orderBy(sql`case when ${s.styleExample.unitNumber} = ${unitNumber} then 0 else 1 end`, desc(s.styleExample.id))
    .limit(6)
  const manipulationCounts: Record<string, number> = {}
  for (const st of statements) if (st.truth === 'F') manipulationCounts[st.manipulationType ?? 'ohne'] = (manipulationCounts[st.manipulationType ?? 'ohne'] ?? 0) + 1
  return { unit: u, chunks, statements, styleExamples: examples, manipulationCounts }
}

// ───────────────────────────── Aussagen ─────────────────────────────

export type NewStatement = {
  unit: number
  text: string
  truth: 'R' | 'F'
  reason?: string | null
  quote?: string | null
  sourceRef?: string | null
  chunkId?: number | null
  topic?: string | null
  manipulationType?: string | null
  parentId?: number | null
}

export async function addStatements(db: Db, subjectId: number, items: NewStatement[], origin = 'claude') {
  const saved: { index: number; id: number; flags: string[]; status: string }[] = []
  const rejected: { index: number; text: string; reason: string }[] = []
  const unitCache = new Map<number, s.Unit | undefined>()
  for (const [index, it] of items.entries()) {
    if (!unitCache.has(it.unit)) unitCache.set(it.unit, await unitByNumber(db, subjectId, it.unit))
    const u = unitCache.get(it.unit)
    if (!u) {
      rejected.push({ index, text: it.text, reason: `UE ${it.unit} existiert nicht (zuerst upsert_unit oder sync_source)` })
      continue
    }
    let chunkText: string | null = null
    if (it.chunkId) {
      const [c] = await db.select({ text: s.chunk.text }).from(s.chunk).where(eq(s.chunk.id, it.chunkId))
      if (!c) {
        rejected.push({ index, text: it.text, reason: `Chunk ${it.chunkId} existiert nicht` })
        continue
      }
      chunkText = c.text
    }
    const q = checkStatement({ text: it.text, truth: it.truth, quote: it.quote, manipulationType: it.manipulationType, chunkText })
    if (!q.accept) {
      rejected.push({ index, text: it.text, reason: 'Belegpflicht: wörtliches Zitat aus der Quelle fehlt' })
      continue
    }
    const dup = await db
      .select({ id: s.statement.id, text: s.statement.text })
      .from(s.statement)
      .where(eq(s.statement.unitId, u.id))
    if (dup.some((d) => normalize(d.text) === normalize(it.text))) {
      rejected.push({ index, text: it.text, reason: 'gleiche Aussage existiert schon' })
      continue
    }
    const [row] = await db
      .insert(s.statement)
      .values({
        unitId: u.id,
        text: it.text.trim(),
        truth: it.truth,
        reason: it.reason ?? null,
        quote: it.quote ?? null,
        sourceRef: it.sourceRef ?? null,
        chunkId: it.chunkId ?? null,
        topic: it.topic ?? null,
        manipulationType: it.manipulationType ?? null,
        parentId: it.parentId ?? null,
        flags: q.flags,
        hard: q.hard,
        origin,
        status: 'inbox',
      })
      .returning({ id: s.statement.id, status: s.statement.status })
    saved.push({ index, id: row.id, flags: q.flags, status: row.status })
  }
  return { saved, rejected }
}

/** Für die blinde Gegenprüfung: nur Aussage und Zitat, kein Label, keine Begründung. */
export async function checkQueue(db: Db, subjectId: number | null, limit = 20) {
  const rows = await db
    .select({ id: s.statement.id, text: s.statement.text, quote: s.statement.quote })
    .from(s.statement)
    .innerJoin(s.unit, eq(s.statement.unitId, s.unit.id))
    .where(
      and(
        eq(s.statement.status, 'inbox'),
        sql`${s.statement.quote} is not null`,
        sql`not exists (select 1 from ${s.check} where ${s.check.statementId} = ${s.statement.id})`,
        subjectId ? eq(s.unit.subjectId, subjectId) : undefined,
      ),
    )
    .orderBy(asc(s.statement.id))
    .limit(limit)
  return rows
}

export async function submitChecks(
  db: Db,
  checks: { statementId: number; truth: 'R' | 'F'; flags?: string[]; comment?: string | null; model?: string | null }[],
) {
  const out: { statementId: number; agrees: boolean; status: string }[] = []
  for (const c of checks) {
    const [st] = await db
      .select({ st: s.statement, autoApprove: s.subject.autoApprove })
      .from(s.statement)
      .innerJoin(s.unit, eq(s.statement.unitId, s.unit.id))
      .innerJoin(s.subject, eq(s.unit.subjectId, s.subject.id))
      .where(eq(s.statement.id, c.statementId))
    if (!st) continue
    const agrees = st.st.truth === c.truth
    await db.insert(s.check).values({
      statementId: c.statementId,
      checkerTruth: c.truth,
      agrees,
      flags: c.flags ?? [],
      comment: c.comment ?? null,
      model: c.model ?? null,
    })
    const flags = [...new Set([...(st.st.flags ?? []), ...(c.flags ?? []), ...(agrees ? [] : ['pruefer_widerspricht'])])]
    let status = st.st.status
    if (agrees && flags.length === 0 && st.autoApprove && status === 'inbox') status = 'active'
    await db.update(s.statement).set({ flags, status, updatedAt: new Date() }).where(eq(s.statement.id, c.statementId))
    out.push({ statementId: c.statementId, agrees, status })
  }
  return out
}

export async function listInbox(db: Db, subjectId: number | null) {
  const rows = await db
    .select({ st: s.statement, unitNumber: s.unit.number, unitTitle: s.unit.title, subjectId: s.unit.subjectId })
    .from(s.statement)
    .innerJoin(s.unit, eq(s.statement.unitId, s.unit.id))
    .where(and(inArray(s.statement.status, ['inbox', 'flagged']), subjectId ? eq(s.unit.subjectId, subjectId) : undefined))
    .orderBy(asc(s.unit.number), asc(s.statement.id))
  const ids = rows.map((r) => r.st.id)
  const checks = ids.length ? await db.select().from(s.check).where(inArray(s.check.statementId, ids)).orderBy(desc(s.check.id)) : []
  const reports = ids.length
    ? await db.select().from(s.report).where(and(inArray(s.report.statementId, ids), eq(s.report.resolved, false)))
    : []
  return rows.map((r) => {
    const ck = checks.find((c) => c.statementId === r.st.id)
    return {
      ...r.st,
      unitNumber: r.unitNumber,
      unitTitle: r.unitTitle,
      subjectId: r.subjectId,
      check: ck ? { truth: ck.checkerTruth, agrees: ck.agrees, flags: ck.flags, comment: ck.comment } : null,
      reports: reports.filter((p) => p.statementId === r.st.id).map((p) => p.comment),
      ready: !!ck && ck.agrees && (r.st.flags ?? []).length === 0,
    }
  })
}

export type ReviewAction = 'approve' | 'reject' | 'edit' | 'flag'

export async function reviewStatement(
  db: Db,
  id: number,
  action: ReviewAction,
  patch: { text?: string; truth?: 'R' | 'F'; reason?: string | null; sourceRef?: string | null; topic?: string | null } = {},
) {
  const [st] = await db.select().from(s.statement).where(eq(s.statement.id, id))
  if (!st) throw new AppError(`Aussage ${id} nicht gefunden`)
  const set: Partial<s.Statement> = { updatedAt: new Date() }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (set as Record<string, unknown>)[k] = v
  const contentChanged = (patch.text && patch.text !== st.text) || (patch.truth && patch.truth !== st.truth)
  if (contentChanged) set.version = st.version + 1
  if (action === 'approve') {
    set.status = 'active'
    await db.update(s.report).set({ resolved: true }).where(eq(s.report.statementId, id))
  } else if (action === 'reject') set.status = 'retired'
  else if (action === 'flag') set.status = 'flagged'
  if (action === 'approve') set.flags = (st.flags ?? []).filter((f) => f === 'import_ohne_zitat')
  const [row] = await db.update(s.statement).set(set).where(eq(s.statement.id, id)).returning()
  // Inhalt geändert: alter Lernstand passt nicht mehr zur neuen Formulierung.
  if (contentChanged) await db.delete(s.cardState).where(eq(s.cardState.statementId, id))
  return row
}

export async function reportError(db: Db, statementId: number, comment: string | null) {
  const [st] = await db.select().from(s.statement).where(eq(s.statement.id, statementId))
  if (!st) throw new AppError(`Aussage ${statementId} nicht gefunden`)
  await db.insert(s.report).values({ statementId, comment, userId: USER })
  const flags = [...new Set([...(st.flags ?? []), 'gemeldet'])]
  await db.update(s.statement).set({ status: 'flagged', flags, updatedAt: new Date() }).where(eq(s.statement.id, statementId))
  return { statementId, status: 'flagged' }
}

export async function addStyleExamples(
  db: Db,
  subjectId: number,
  examples: { unit?: number | null; kind?: string; sourceLabel?: string | null; stem: string; options: { text: string; truth?: 'R' | 'F' | null }[] }[],
) {
  if (examples.length === 0) return { added: 0 }
  await db.insert(s.styleExample).values(
    examples.map((e) => ({
      subjectId,
      unitNumber: e.unit ?? null,
      kind: e.kind ?? 'olat',
      sourceLabel: e.sourceLabel ?? null,
      stem: e.stem,
      options: e.options,
    })),
  )
  return { added: examples.length }
}

/** Bestehende Aussagenbank oder Exercises-Datei 1:1 übernehmen. */
export async function importBank(db: Db, subjectId: number, markdown: string, status: 'active' | 'inbox' = 'active') {
  const parsed = parseBank(markdown)
  for (const u of parsed.units) await upsertUnit(db, subjectId, u.number, u.title)
  let added = 0
  let skipped = 0
  for (const st of parsed.statements) {
    const u = (await unitByNumber(db, subjectId, st.unitNumber)) ?? (await upsertUnit(db, subjectId, st.unitNumber))
    const existing = await db.select({ text: s.statement.text }).from(s.statement).where(eq(s.statement.unitId, u.id))
    if (existing.some((e) => normalize(e.text) === normalize(st.text))) {
      skipped++
      continue
    }
    await db.insert(s.statement).values({
      unitId: u.id,
      text: st.text,
      truth: st.truth,
      reason: st.reason,
      sourceRef: st.sourceRef,
      topic: st.topic,
      origin: 'import',
      status,
      flags: ['import_ohne_zitat'],
    })
    added++
  }
  return { units: parsed.units, added, skipped, warnings: parsed.warnings }
}

// ───────────────────────────── Üben ─────────────────────────────

export async function startSession(
  db: Db,
  subjectId: number,
  opts: { channel?: 'web' | 'mcp'; nQuestions?: number; ueLimit?: number; examMode?: boolean; now?: Date; rng?: () => number } = {},
) {
  const now = opts.now ?? new Date()
  const [subj] = await db.select().from(s.subject).where(eq(s.subject.id, subjectId))
  if (!subj) throw new AppError('Fach nicht gefunden')
  const ueLimit = opts.ueLimit ?? subj.ueLimit
  const examMode = opts.examMode ?? subj.examMode
  const rows = await db
    .select({ st: s.statement, unitNumber: s.unit.number, unitTitle: s.unit.title })
    .from(s.statement)
    .innerJoin(s.unit, eq(s.statement.unitId, s.unit.id))
    .where(and(eq(s.unit.subjectId, subjectId), eq(s.statement.status, 'active'), lte(s.unit.number, ueLimit)))
  const ids = rows.map((r) => r.st.id)
  const [states, stats] = await Promise.all([cardStates(db, ids), answerStats(db, ids)])
  const candidates: Candidate[] = rows.map((r) => {
    const cs = states.get(r.st.id)
    const st = stats.get(r.st.id)
    return {
      id: r.st.id,
      unitNumber: r.unitNumber,
      unitTitle: r.unitTitle,
      truth: r.st.truth as 'R' | 'F',
      topic: r.st.topic,
      family: r.st.parentId ?? r.st.id,
      due: cs ? cs.due : null,
      stability: cs ? cs.stability : null,
      lapses: cs ? cs.lapses : 0,
      lastAnswered: st?.lastAnswered ?? null,
      wrongRate: st ? st.wrong / st.answers : null,
    }
  })
  const composed = composeSession(candidates, {
    ueLimit,
    nQuestions: opts.nQuestions ?? subj.questionsPerSession,
    now,
    examMode,
    rng: opts.rng,
  })
  if (composed.length === 0) {
    throw new AppError(
      `Zu wenig aktive Aussagen bis UE ${ueLimit} (${candidates.length}). Für eine Frage braucht es mindestens 5. Neue Aussagen in der Inbox freigeben oder die UE-Grenze erhöhen.`,
    )
  }
  const [sess] = await db
    .insert(s.practiceSession)
    .values({ subjectId, channel: opts.channel ?? 'web', ueLimit, examMode, startedAt: now })
    .returning()
  await db.insert(s.question).values(
    composed.map((q, i) => ({ sessionId: sess.id, position: i + 1, stem: q.stem, unitNumber: q.unitNumber, statementIds: q.statementIds })),
  )
  return getSessionView(db, sess.id)
}

export type StatementResult = {
  letter: Letter
  statementId: number
  text: string
  truth: 'R' | 'F'
  marked: boolean
  correct: boolean
  reason: string | null
  sourceRef: string | null
  links: { label: string; url: string | null }[]
}

export async function getSessionView(db: Db, sessionId: number) {
  const [sess] = await db.select().from(s.practiceSession).where(eq(s.practiceSession.id, sessionId))
  if (!sess) throw new AppError(`Session ${sessionId} nicht gefunden`)
  const [subj] = await db.select().from(s.subject).where(eq(s.subject.id, sess.subjectId))
  const questions = await db.select().from(s.question).where(eq(s.question.sessionId, sessionId)).orderBy(asc(s.question.position))
  const allIds = questions.flatMap((q) => q.statementIds)
  const stmts = allIds.length ? await db.select().from(s.statement).where(inArray(s.statement.id, allIds)) : []
  const byId = new Map(stmts.map((x) => [x.id, x]))
  const qIds = questions.map((q) => q.id)
  const answers = qIds.length ? await db.select().from(s.answer).where(inArray(s.answer.questionId, qIds)) : []
  const units = await db.select().from(s.unit).where(eq(s.unit.subjectId, sess.subjectId))
  const unitTitle = new Map(units.map((u) => [u.number, u.title]))

  const view = questions.map((q) => {
    const answered = !!q.answeredAt
    const options = q.statementIds.map((id, i) => {
      const st = byId.get(id)
      return { letter: LETTERS[i], statementId: id, text: st?.text ?? '(gelöscht)' }
    })
    let results: StatementResult[] | null = null
    let guessed = false
    if (answered) {
      results = q.statementIds.map((id, i) => {
        const st = byId.get(id)!
        const a = answers.find((x) => x.questionId === q.id && x.statementId === id)
        if (a?.guessed) guessed = true
        return {
          letter: LETTERS[i],
          statementId: id,
          text: st.text,
          truth: st.truth as 'R' | 'F',
          marked: a?.marked ?? false,
          correct: a?.correct ?? false,
          reason: st.reason,
          sourceRef: st.sourceRef,
          links: sourceLinks(st.sourceRef, subj),
        }
      })
    }
    return {
      id: q.id,
      position: q.position,
      unitNumber: q.unitNumber,
      unitTitle: q.unitNumber != null ? (unitTitle.get(q.unitNumber) ?? null) : null,
      stem: q.stem,
      options,
      answered,
      guessed,
      allCorrect: results ? results.every((r) => r.correct) : null,
      results,
    }
  })
  const done = view.filter((q) => q.answered)
  return {
    session: sess,
    subject: subj,
    questions: view,
    finished: done.length === view.length,
    score: { fullyCorrect: done.filter((q) => q.allCorrect).length, answered: done.length, total: view.length },
  }
}

export async function answerQuestion(
  db: Db,
  questionId: number,
  marked: Letter[],
  opts: { guessed?: boolean; now?: Date } = {},
) {
  const now = opts.now ?? new Date()
  const [q] = await db.select().from(s.question).where(eq(s.question.id, questionId))
  if (!q) throw new AppError(`Frage ${questionId} nicht gefunden`)
  if (!q.answeredAt) {
    const markedSet = new Set(marked.map((m) => m.toUpperCase()))
    const stmts = await db.select().from(s.statement).where(inArray(s.statement.id, q.statementIds))
    const states = await cardStates(db, q.statementIds)
    for (const [i, id] of q.statementIds.entries()) {
      const st = stmts.find((x) => x.id === id)
      if (!st) continue
      const isMarked = markedSet.has(LETTERS[i])
      const correct = isMarked === (st.truth === 'R')
      await db.insert(s.answer).values({ questionId, statementId: id, userId: USER, marked: isMarked, correct, guessed: !!opts.guessed, answeredAt: now })
      const prev = states.get(id)
      const prevFields: CardFields | null = prev
        ? {
            due: prev.due,
            stability: prev.stability,
            difficulty: prev.difficulty,
            scheduledDays: prev.scheduledDays,
            learningSteps: prev.learningSteps,
            reps: prev.reps,
            lapses: prev.lapses,
            state: prev.state,
            lastReview: prev.lastReview,
          }
        : null
      const next = review(prevFields, gradeFor(correct, !!opts.guessed), now)
      await db
        .insert(s.cardState)
        .values({ userId: USER, statementId: id, ...next })
        .onConflictDoUpdate({ target: [s.cardState.userId, s.cardState.statementId], set: next })
    }
    await db.update(s.question).set({ answeredAt: now }).where(eq(s.question.id, questionId))
    await flagDivergentVariants(db, stmts.filter((x) => x.parentId != null))
    const remaining = await db
      .select({ id: s.question.id })
      .from(s.question)
      .where(and(eq(s.question.sessionId, q.sessionId), sql`${s.question.answeredAt} is null`))
    if (remaining.length === 0) await db.update(s.practiceSession).set({ finishedAt: now }).where(eq(s.practiceSession.id, q.sessionId))
  }
  const view = await getSessionView(db, q.sessionId)
  const question = view.questions.find((x) => x.id === questionId)!
  return { question, finished: view.finished, score: view.score, sessionId: q.sessionId }
}

/** Parallelformen: verhält sich eine Variante deutlich anders als ihre Ur-Aussage, wird sie zur Prüfung markiert. */
async function flagDivergentVariants(db: Db, variants: s.Statement[]) {
  if (variants.length === 0) return
  const stats = await answerStats(db, [...new Set(variants.flatMap((v) => [v.id, v.parentId!]))])
  for (const v of variants) {
    const a = stats.get(v.parentId!)
    const b = stats.get(v.id)
    if (!a || !b || v.status !== 'active') continue
    if (variantDiverges({ answers: a.answers, correct: a.answers - a.wrong }, { answers: b.answers, correct: b.answers - b.wrong })) {
      const flags = [...new Set([...(v.flags ?? []), 'variante_weicht_ab'])]
      await db.update(s.statement).set({ status: 'flagged', flags, updatedAt: new Date() }).where(eq(s.statement.id, v.id))
    }
  }
}

/** Ende der Session: x von n komplett richtig und die zwei Aussagen zum Wiederholen. */
export async function sessionSummary(db: Db, sessionId: number) {
  const view = await getSessionView(db, sessionId)
  const wrong = view.questions.flatMap((q) => (q.results ?? []).filter((r) => !r.correct))
  const ids = wrong.map((w) => w.statementId)
  const states = await cardStates(db, ids)
  const repeat = wrong
    .sort((a, b) => (states.get(b.statementId)?.lapses ?? 0) - (states.get(a.statementId)?.lapses ?? 0))
    .slice(0, 2)
  return { score: view.score, repeat, finished: view.finished }
}

/** Wie viele Fragen pro Tag, für die Auswertung. */
export async function history(db: Db, subjectId: number, days = 30) {
  return db
    .select({
      day: sql<string>`to_char(${s.answer.answeredAt} at time zone 'Europe/Zurich', 'YYYY-MM-DD')`,
      unitNumber: s.unit.number,
      answers: sql<number>`count(*)::int`,
      correct: sql<number>`sum(case when ${s.answer.correct} then 1 else 0 end)::int`,
    })
    .from(s.answer)
    .innerJoin(s.statement, eq(s.answer.statementId, s.statement.id))
    .innerJoin(s.unit, eq(s.statement.unitId, s.unit.id))
    .where(and(eq(s.unit.subjectId, subjectId), sql`${s.answer.answeredAt} > now() - make_interval(days => ${days})`))
    .groupBy(sql`1`, s.unit.number)
    .orderBy(sql`1`)
}

// ───────────────────────────── Export ─────────────────────────────

/** Markdown für den Exercises-Ordner: alle Fragen eines Tages oder einer Session. */
export async function exportMarkdown(db: Db, subjectId: number, opts: { sessionId?: number; date?: string } = {}) {
  const units = await db.select().from(s.unit).where(eq(s.unit.subjectId, subjectId))
  const unitTitle = new Map(units.map((u) => [u.number, u.title]))
  const conds = [eq(s.practiceSession.subjectId, subjectId)]
  if (opts.sessionId) conds.push(eq(s.practiceSession.id, opts.sessionId))
  else {
    const day = opts.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date())
    conds.push(sql`to_char(${s.practiceSession.startedAt} at time zone 'Europe/Zurich', 'YYYY-MM-DD') = ${day}`)
  }
  const rows = await db
    .select({ q: s.question, startedAt: s.practiceSession.startedAt })
    .from(s.question)
    .innerJoin(s.practiceSession, eq(s.question.sessionId, s.practiceSession.id))
    .where(and(...conds))
    .orderBy(asc(s.practiceSession.id), asc(s.question.position))
  if (rows.length === 0) return { markdown: '', questions: 0 }
  const ids = rows.flatMap((r) => r.q.statementIds)
  const stmts = await db.select().from(s.statement).where(inArray(s.statement.id, ids))
  const byId = new Map(stmts.map((x) => [x.id, x]))
  const questions: ExportQuestion[] = rows.map((r) => ({
    unitNumber: r.q.unitNumber,
    unitTitle: r.q.unitNumber != null ? (unitTitle.get(r.q.unitNumber) ?? null) : null,
    stem: r.q.stem,
    statements: r.q.statementIds
      .map((id) => byId.get(id))
      .filter((x): x is s.Statement => !!x)
      .map((x) => ({ text: x.text, truth: x.truth as 'R' | 'F', reason: x.reason, sourceRef: x.sourceRef })),
  }))
  return { markdown: dayToMarkdown(formatDateCH(rows[0].startedAt), questions), questions: questions.length }
}

export async function listStatements(
  db: Db,
  subjectId: number,
  opts: { unit?: number; status?: string; query?: string; limit?: number } = {},
) {
  const rows = await db
    .select({ st: s.statement, unitNumber: s.unit.number })
    .from(s.statement)
    .innerJoin(s.unit, eq(s.statement.unitId, s.unit.id))
    .where(
      and(
        eq(s.unit.subjectId, subjectId),
        opts.unit != null ? eq(s.unit.number, opts.unit) : undefined,
        opts.status ? eq(s.statement.status, opts.status) : undefined,
        opts.query
          ? or(sql`${s.statement.text} ilike ${'%' + opts.query + '%'}`, sql`${s.statement.reason} ilike ${'%' + opts.query + '%'}`)
          : undefined,
      ),
    )
    .orderBy(asc(s.unit.number), asc(s.statement.id))
    .limit(opts.limit ?? 200)
  return rows.map((r) => ({ ...r.st, unitNumber: r.unitNumber }))
}
