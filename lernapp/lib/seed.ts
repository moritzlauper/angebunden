import { sql } from 'drizzle-orm'
import type { Db } from './db/index.ts'
import * as s from './db/schema.ts'
import { BANK, OLAT_EXAMPLES, SUBJECT, UNITS } from '../data/seed/klinische-biopsychologie.ts'
import { addStyleExamples, createSubject, importBank, upsertUnit } from './service.ts'

/** Legt Klinische Biopsychologie mit der bestehenden Aussagenbank an. */
export async function seedKliBio(db: Db) {
  const subj = await createSubject(db, SUBJECT)
  for (const u of UNITS) await upsertUnit(db, subj.id, u.number, u.title)
  const imported = await importBank(db, subj.id, BANK, 'active')
  await addStyleExamples(db, subj.id, OLAT_EXAMPLES as Parameters<typeof addStyleExamples>[2])
  return { subject: subj, imported }
}

export async function seedIfEmpty(db: Db) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.subject)
  if (n > 0) return
  try {
    await seedKliBio(db)
  } catch (e) {
    // Zwei Instanzen gleichzeitig: die andere hat das Fach schon angelegt.
    if (!/duplicate key|unique/i.test(String((e as Error).message) + String((e as { cause?: unknown }).cause ?? ''))) throw e
  }
}
