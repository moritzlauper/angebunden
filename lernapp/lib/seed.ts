import { and, eq, sql } from 'drizzle-orm'
import type { Db } from './db/index.ts'
import * as s from './db/schema.ts'
import { BANK, OLAT_EXAMPLES, SUBJECT, UNITS } from '../data/seed/klinische-biopsychologie.ts'
import { PACK as PACK_2 } from '../data/seed/klibio-paket-2.ts'
import { PACK as RDA_PACK_1, SUBJECT as RDA_SUBJECT } from '../data/seed/rda-paket-1.ts'
import { PACK as TT_PACK_1, SUBJECT as TT_SUBJECT } from '../data/seed/tt-paket-1.ts'
import { PACK as KPF_PACK_1, SUBJECT as KPF_SUBJECT } from '../data/seed/kpf-paket-1.ts'
import type { Pack } from '../data/seed/types.ts'
import { detailFlags } from './core/quality.ts'
import { normalize, slugify } from './core/text.ts'
import { addStyleExamples, createSubject, importBank, upsertUnit, type SubjectInput } from './service.ts'

/** Legt Klinische Biopsychologie mit der bestehenden Aussagenbank an. */
export async function seedKliBio(db: Db) {
  const subj = await createSubject(db, SUBJECT)
  for (const u of UNITS) await upsertUnit(db, subj.id, u.number, u.title)
  const imported = await importBank(db, subj.id, BANK, 'active')
  await addStyleExamples(db, subj.id, OLAT_EXAMPLES as Parameters<typeof addStyleExamples>[2])
  return { subject: subj, imported }
}

const isDuplicate = (e: unknown) => /duplicate key|unique/i.test(String((e as Error).message) + String((e as { cause?: unknown }).cause ?? ''))

export async function seedIfEmpty(db: Db) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.subject)
  if (n > 0) return
  try {
    await seedKliBio(db)
  } catch (e) {
    // Zwei Instanzen gleichzeitig: die andere hat das Fach schon angelegt.
    if (!isDuplicate(e)) throw e
  }
}

/** Fächer, die nach dem ersten Start dazukommen. Ihre Aussagen kommen als Paket (PACKS). */
export const SUBJECTS: SubjectInput[] = [RDA_SUBJECT, TT_SUBJECT, KPF_SUBJECT]

/** Legt fehlende Fächer an. Ein Fach gilt als vorhanden, wenn Slug oder Name schon vergeben sind. */
export async function ensureSubjects(db: Db) {
  let created = 0
  for (const input of SUBJECTS) {
    const slug = slugify(input.shortName || input.name)
    const existing = await db.select({ id: s.subject.id, slug: s.subject.slug, name: s.subject.name }).from(s.subject)
    if (existing.some((x) => x.slug === slug || normalize(x.name) === normalize(input.name))) continue
    try {
      await createSubject(db, input)
      created++
    } catch (e) {
      // Zwei Instanzen gleichzeitig: die andere hat das Fach schon angelegt.
      if (!isDuplicate(e)) throw e
    }
  }
  return { created }
}

/** Aussagenpakete, die nach dem ersten Start dazukommen, in der Reihenfolge, in der sie entstanden sind. */
export const PACKS: Pack[] = [PACK_2, RDA_PACK_1, TT_PACK_1, KPF_PACK_1]

/**
 * Setzt einen Merker (Quelle «<name>») und sagt, ob dieser Schritt hier zum ersten Mal läuft.
 * So läuft jedes Paket genau einmal, auch wenn mehrere Instanzen gleichzeitig starten.
 */
async function once(db: Db, subjectId: number, name: string): Promise<boolean> {
  const [done] = await db.select({ id: s.source.id }).from(s.source).where(and(eq(s.source.subjectId, subjectId), eq(s.source.path, name)))
  if (done) return false
  try {
    await db.insert(s.source).values({ subjectId, kind: 'mcp', path: name, hash: name })
    return true
  } catch (e) {
    if (isDuplicate(e)) return false
    throw e
  }
}

/** Alle Aussagen eines Fachs mit UE-Nummer. */
async function subjectStatements(db: Db, subjectId: number) {
  return db
    .select({ st: s.statement, unitNumber: s.unit.number })
    .from(s.statement)
    .innerJoin(s.unit, eq(s.statement.unitId, s.unit.id))
    .where(eq(s.unit.subjectId, subjectId))
}

/**
 * Fach eines Pakets: per Slug, sonst ein Fach aus SUBJECTS, das schon unter seinem Namen (mit
 * anderem Slug) angelegt war, damit das Paket dort landet statt still zu entfallen.
 */
async function packSubject(db: Db, slug: string) {
  const all = await db.select().from(s.subject)
  const bySlug = all.find((x) => x.slug === slug)
  if (bySlug) return bySlug
  const input = SUBJECTS.find((x) => slugify(x.shortName || x.name) === slug)
  return input ? all.find((x) => normalize(x.name) === normalize(input.name)) : undefined
}

export async function applyPack(db: Db, pack: Pack) {
  const subj = await packSubject(db, pack.subject)
  if (!subj || !(await once(db, subj.id, `paket:${pack.id}`))) return { added: 0, retired: 0, skipped: true }

  // UEs anlegen; vorhandene Titel bleiben, nur Platzhalter «UE n» werden ersetzt.
  const unitIds = new Map<number, number>()
  for (const n of [...new Set(pack.statements.map((x) => x.unit))]) {
    const [existing] = await db.select().from(s.unit).where(and(eq(s.unit.subjectId, subj.id), eq(s.unit.number, n)))
    const title = pack.unitTitles[n]
    const placeholder = !existing || /^UE\s*\d+$/i.test(existing.title)
    const u = await upsertUnit(db, subj.id, n, placeholder ? title : null)
    unitIds.set(n, u.id)
  }

  const known = new Set((await subjectStatements(db, subj.id)).map((r) => `${r.unitNumber}:${normalize(r.st.text)}`))
  const families = new Map<string, number>()
  let added = 0
  for (const x of pack.statements) {
    if (known.has(`${x.unit}:${normalize(x.text)}`)) continue
    const parentId = x.family ? (families.get(x.family) ?? null) : null
    const [row] = await db
      .insert(s.statement)
      .values({
        unitId: unitIds.get(x.unit)!,
        text: x.text,
        truth: x.truth,
        reason: x.reason,
        quote: x.quote,
        sourceRef: x.sourceRef,
        topic: x.topic,
        manipulationType: x.manipulationType,
        parentId,
        flags: x.flags,
        origin: 'paket',
        // Geprüft beim Schreiben (Zitat in den Notes, keine Hinweise): gleich in die Übungen.
        status: x.flags.length ? 'inbox' : 'active',
      })
      .returning({ id: s.statement.id })
    if (x.family && parentId === null) families.set(x.family, row.id)
    added++
  }

  const retire = new Set(pack.retire.map(normalize))
  let retired = 0
  for (const r of await subjectStatements(db, subj.id)) {
    if (r.st.status === 'retired' || !retire.has(normalize(r.st.text))) continue
    await db
      .update(s.statement)
      .set({ status: 'retired', flags: [...new Set([...(r.st.flags ?? []), 'nicht_relevant'])], updatedAt: new Date() })
      .where(eq(s.statement.id, r.st.id))
    retired++
  }
  return { added, retired, skipped: false }
}

/**
 * Vom Generator in der App direkt freigegebene Aussagen mit Detailwissen (Jahreszahlen, Codes,
 * Anzahlen …) zurück in die Inbox. Läuft einmal pro Fach; neue Aussagen prüft checkStatement.
 */
export async function moveDetailToInbox(db: Db) {
  const subjects = await db.select({ id: s.subject.id }).from(s.subject)
  let moved = 0
  for (const subj of subjects) {
    if (!(await once(db, subj.id, 'wartung:detailwissen-v1'))) continue
    for (const r of await subjectStatements(db, subj.id)) {
      if (r.st.status !== 'active' || r.st.origin !== 'claude-app') continue
      const extra = detailFlags(r.st.text)
      if (!extra.length) continue
      await db
        .update(s.statement)
        .set({ status: 'inbox', flags: [...new Set([...(r.st.flags ?? []), ...extra])], updatedAt: new Date() })
        .where(eq(s.statement.id, r.st.id))
      moved++
    }
  }
  return { moved }
}

export async function applyPacks(db: Db) {
  await ensureSubjects(db)
  for (const p of PACKS) await applyPack(db, p)
  await moveDetailToInbox(db)
}
