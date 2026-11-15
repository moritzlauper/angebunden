import { and, eq, sql } from 'drizzle-orm'
import type { Db } from './db/index.ts'
import * as s from './db/schema.ts'
import { BANK, OLAT_EXAMPLES, SLIDE_FILES, SUBJECT, UNITS } from '../data/seed/klinische-biopsychologie.ts'
import * as pack1 from '../data/seed/klibio-paket-1.ts'
import type { PackStatement } from '../data/seed/types.ts'
import { normalize } from './core/text.ts'
import { addStyleExamples, createSubject, importBank, upsertUnit } from './service.ts'

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

/**
 * Aussagenpakete, die nach dem ersten Start dazukommen. Jedes Paket wird genau einmal
 * in die Inbox gespielt; als Merker dient eine Quelle «paket:<id>».
 */
const PACKS: { id: string; subject: string; statements: PackStatement[]; slideFiles?: Record<string, string> }[] = [
  { id: pack1.PACK_ID, subject: pack1.PACK_SUBJECT, statements: pack1.STATEMENTS, slideFiles: SLIDE_FILES },
]

export async function applyPacks(db: Db) {
  for (const p of PACKS) {
    const [subj] = await db.select().from(s.subject).where(eq(s.subject.slug, p.subject))
    if (!subj) continue
    const marker = `paket:${p.id}`
    const [done] = await db.select({ id: s.source.id }).from(s.source).where(and(eq(s.source.subjectId, subj.id), eq(s.source.path, marker)))
    if (done) continue
    try {
      await db.insert(s.source).values({ subjectId: subj.id, kind: 'mcp', path: marker, hash: p.id })
    } catch (e) {
      if (isDuplicate(e)) continue // andere Instanz spielt das Paket gerade ein
      throw e
    }
    if (p.slideFiles && Object.keys(subj.slideFiles ?? {}).length === 0) {
      await db.update(s.subject).set({ slideFiles: p.slideFiles }).where(eq(s.subject.id, subj.id))
    }
    const units = new Map<number, number>()
    for (const st of p.statements) {
      if (!units.has(st.unit)) units.set(st.unit, (await upsertUnit(db, subj.id, st.unit)).id)
      const unitId = units.get(st.unit)!
      const existing = await db.select({ text: s.statement.text }).from(s.statement).where(eq(s.statement.unitId, unitId))
      if (existing.some((e) => normalize(e.text) === normalize(st.text))) continue
      await db.insert(s.statement).values({
        unitId,
        text: st.text,
        truth: st.truth,
        reason: st.reason,
        quote: st.quote,
        sourceRef: st.sourceRef,
        topic: st.topic,
        manipulationType: st.manipulationType,
        flags: st.flags,
        origin: 'claude',
        status: 'inbox',
      })
    }
  }
}
