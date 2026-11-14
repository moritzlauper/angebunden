/**
 * Überträgt den Lernstand (Sitzungen, Fragen, Antworten, Wiederholungsstände,
 * Fehlermeldungen) aus der lokalen PGlite-Datenbank in eine Postgres-Datenbank.
 * Aussagen werden über Fach, UE und Text zugeordnet, nicht über die ID.
 *
 *   TARGET_DATABASE_URL=postgres://… node scripts/copy-progress.ts [pglite-ordner]
 */
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { normalize } from '../lib/core/text.ts'

const target = process.env.TARGET_DATABASE_URL
if (!target) throw new Error('TARGET_DATABASE_URL fehlt')
const src = new PGlite(process.argv[2] ?? path.join(process.cwd(), '.data', 'pglite'))
const dst = new pg.Client({ connectionString: target })
await dst.connect()

const STMT_SQL = `select st.id, st.text, u.number as unit, sub.slug from statement st
  join unit u on u.id = st.unit_id join subject sub on sub.id = u.subject_id`
const key = (r: { slug: string; unit: number; text: string }) => `${r.slug}|${r.unit}|${normalize(r.text)}`

const dstStmt = new Map((await dst.query(STMT_SQL)).rows.map((r) => [key(r), r.id as number]))
const stmtMap = new Map<number, number>()
const unmatched: string[] = []
for (const r of (await src.query<{ id: number; text: string; unit: number; slug: string }>(STMT_SQL)).rows) {
  const id = dstStmt.get(key(r))
  if (id) stmtMap.set(r.id, id)
  else unmatched.push(r.text)
}
const subjMap = new Map<number, number>()
const dstSubj = new Map((await dst.query('select id, slug from subject')).rows.map((r) => [r.slug as string, r.id as number]))
for (const r of (await src.query<{ id: number; slug: string }>('select id, slug from subject')).rows) {
  const id = dstSubj.get(r.slug)
  if (id) subjMap.set(r.id, id)
}

await dst.query('begin')
try {
  const sessMap = new Map<number, number>()
  for (const s of (await src.query<Record<string, unknown>>('select * from practice_session order by id')).rows) {
    const subjectId = subjMap.get(s.subject_id as number)
    if (!subjectId) continue
    const { rows } = await dst.query(
      'insert into practice_session (subject_id, user_id, channel, ue_limit, exam_mode, started_at, finished_at) values ($1,$2,$3,$4,$5,$6,$7) returning id',
      [subjectId, s.user_id, s.channel, s.ue_limit, s.exam_mode, s.started_at, s.finished_at],
    )
    sessMap.set(s.id as number, rows[0].id)
  }

  const qMap = new Map<number, number>()
  for (const q of (await src.query<Record<string, unknown>>('select * from question order by id')).rows) {
    const sessionId = sessMap.get(q.session_id as number)
    const ids = (q.statement_ids as number[]).map((i) => stmtMap.get(i))
    if (!sessionId || ids.some((i) => i == null)) continue
    const { rows } = await dst.query(
      'insert into question (session_id, position, stem, unit_number, statement_ids, answered_at) values ($1,$2,$3,$4,$5,$6) returning id',
      [sessionId, q.position, q.stem, q.unit_number, JSON.stringify(ids), q.answered_at],
    )
    qMap.set(q.id as number, rows[0].id)
  }

  let answers = 0
  for (const a of (await src.query<Record<string, unknown>>('select * from answer order by id')).rows) {
    const statementId = stmtMap.get(a.statement_id as number)
    if (!statementId) continue
    await dst.query(
      'insert into answer (question_id, statement_id, user_id, marked, correct, guessed, answered_at) values ($1,$2,$3,$4,$5,$6,$7)',
      [a.question_id ? (qMap.get(a.question_id as number) ?? null) : null, statementId, a.user_id, a.marked, a.correct, a.guessed, a.answered_at],
    )
    answers++
  }

  // Wiederholungsstand: der jüngere gewinnt.
  let cards = 0
  for (const c of (await src.query<Record<string, unknown>>('select * from card_state')).rows) {
    const statementId = stmtMap.get(c.statement_id as number)
    if (!statementId) continue
    const r = await dst.query(
      `insert into card_state (user_id, statement_id, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (user_id, statement_id) do update set due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
         scheduled_days = excluded.scheduled_days, learning_steps = excluded.learning_steps, reps = excluded.reps, lapses = excluded.lapses,
         state = excluded.state, last_review = excluded.last_review
       where card_state.last_review is null or card_state.last_review < excluded.last_review`,
      [c.user_id, statementId, c.due, c.stability, c.difficulty, c.scheduled_days, c.learning_steps, c.reps, c.lapses, c.state, c.last_review],
    )
    cards += r.rowCount ?? 0
  }

  let reports = 0
  for (const r of (await src.query<Record<string, unknown>>('select * from report')).rows) {
    const statementId = stmtMap.get(r.statement_id as number)
    if (!statementId) continue
    const cols = Object.keys(r).filter((k) => k !== 'id')
    const vals = cols.map((k) => (k === 'statement_id' ? statementId : r[k]))
    await dst.query(`insert into report (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals)
    reports++
  }

  await dst.query('commit')
  console.log(`Sitzungen ${sessMap.size}, Fragen ${qMap.size}, Antworten ${answers}, Wiederholungsstände ${cards}, Meldungen ${reports}`)
  if (unmatched.length) console.log(`Ohne Gegenstück im Ziel (${unmatched.length}):`, unmatched.slice(0, 5))
} catch (e) {
  await dst.query('rollback')
  throw e
} finally {
  await dst.end()
  await src.close()
}
