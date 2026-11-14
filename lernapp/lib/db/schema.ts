import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Kette: Fach → UE → Quelle/Chunk → Aussage → Antwort.
 * Fragen sind nur gespeicherte Zusammenstellungen von fünf Aussagen.
 * Der Vault bleibt die Wahrheit für Inhalte; hier liegen abgeleitete Chunks,
 * die Aussagen und der Lernstand.
 */

export const subject = pgTable('subject', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  courseCode: text('course_code'),
  dozent: text('dozent'),
  /** Ordner im Vault, z. B. «Klinische Biopsychologie/» */
  vaultPath: text('vault_path'),
  /** Name des Obsidian-Vaults für obsidian://-Links */
  vaultName: text('vault_name'),
  /** Muster für Folien, {n} = Vorlesungsnummer, z. B. «Slides/VL{n}.pdf» */
  slidesPattern: text('slides_pattern').default('Slides/VL{n}.pdf'),
  /** Zusammenfassung (ZM) als PDF im Vault */
  zmPath: text('zm_path'),
  /** Regler «bis UE n» */
  ueLimit: integer('ue_limit').notNull().default(1),
  examDate: date('exam_date'),
  /** Prüfungsmodus: ignoriert den Plan, fragt alles bis zur Grenze einmal durch */
  examMode: boolean('exam_mode').notNull().default(false),
  /** Fragen pro Session */
  questionsPerSession: integer('questions_per_session').notNull().default(5),
  /** Darf eine Aussage ohne Freigabe aktiv werden, wenn Generator und Prüfer übereinstimmen? */
  autoApprove: boolean('auto_approve').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const unit = pgTable(
  'unit',
  {
    id: serial('id').primaryKey(),
    subjectId: integer('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    notesHash: text('notes_hash'),
    /** «bis Folie X» */
    slidesUntil: integer('slides_until'),
  },
  (t) => [uniqueIndex('unit_subject_number').on(t.subjectId, t.number)],
)

export const source = pgTable(
  'source',
  {
    id: serial('id').primaryKey(),
    subjectId: integer('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'cascade' }),
    /** notes | slides | zm | exam | upload | mcp */
    kind: text('kind').notNull(),
    path: text('path').notNull(),
    hash: text('hash'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('source_subject_path').on(t.subjectId, t.path)],
)

export const chunk = pgTable(
  'chunk',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade' }),
    unitId: integer('unit_id').references(() => unit.id, { onDelete: 'set null' }),
    page: integer('page'),
    /** Reihenfolge innerhalb von Quelle und UE */
    position: integer('position').notNull().default(0),
    heading: text('heading'),
    text: text('text').notNull(),
    /** Elementindizes a,b,c,d für PDF++-Auswahllinks */
    pdfSelection: text('pdf_selection'),
  },
  (t) => [index('chunk_unit').on(t.unitId), index('chunk_source').on(t.sourceId)],
)

export const statement = pgTable(
  'statement',
  {
    id: serial('id').primaryKey(),
    unitId: integer('unit_id')
      .notNull()
      .references(() => unit.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    /** R oder F */
    truth: text('truth').notNull(),
    reason: text('reason'),
    /** Wörtliches Zitat aus der Quelle (Belegpflicht) */
    quote: text('quote'),
    /** Fundstelle als Text, z. B. «VL4 p.5» oder «ZM S.69» */
    sourceRef: text('source_ref'),
    chunkId: integer('chunk_id').references(() => chunk.id, { onDelete: 'set null' }),
    /** Thema für den Fragestamm, z. B. «Hunger- und Sättigungssignale» */
    topic: text('topic'),
    /** vertauschung | negation | zahl | zuordnung | doppelt | andere */
    manipulationType: text('manipulation_type'),
    /** Variante von (Parallelform derselben Ur-Aussage) */
    parentId: integer('parent_id'),
    /** inbox | active | flagged | retired */
    status: text('status').notNull().default('inbox'),
    /** Hinweise der automatischen Prüfung, z. B. absolutwort, fehlende_zahl */
    flags: jsonb('flags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** import | claude | manuell */
    origin: text('origin').notNull().default('claude'),
    hard: boolean('hard').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('statement_unit').on(t.unitId), index('statement_status').on(t.status)],
)

/** Blinde Gegenprüfung: der Prüfer sieht nur Aussage und Zitat, nicht das Label. */
export const check = pgTable('check', {
  id: serial('id').primaryKey(),
  statementId: integer('statement_id')
    .notNull()
    .references(() => statement.id, { onDelete: 'cascade' }),
  checkerTruth: text('checker_truth').notNull(),
  agrees: boolean('agrees').notNull(),
  flags: jsonb('flags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  comment: text('comment'),
  model: text('model'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const practiceSession = pgTable('practice_session', {
  id: serial('id').primaryKey(),
  subjectId: integer('subject_id')
    .notNull()
    .references(() => subject.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().default('me'),
  /** web | mcp */
  channel: text('channel').notNull().default('web'),
  ueLimit: integer('ue_limit').notNull(),
  examMode: boolean('exam_mode').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export const question = pgTable('question', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id')
    .notNull()
    .references(() => practiceSession.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  stem: text('stem').notNull(),
  unitNumber: integer('unit_number'),
  /** Reihenfolge A–E */
  statementIds: jsonb('statement_ids').$type<number[]>().notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
})

export const answer = pgTable(
  'answer',
  {
    id: serial('id').primaryKey(),
    questionId: integer('question_id').references(() => question.id, { onDelete: 'set null' }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => statement.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().default('me'),
    marked: boolean('marked').notNull(),
    correct: boolean('correct').notNull(),
    guessed: boolean('guessed').notNull().default(false),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('answer_statement').on(t.statementId)],
)

export const cardState = pgTable(
  'card_state',
  {
    userId: text('user_id').notNull().default('me'),
    statementId: integer('statement_id')
      .notNull()
      .references(() => statement.id, { onDelete: 'cascade' }),
    due: timestamp('due', { withTimezone: true }).notNull(),
    stability: doublePrecision('stability').notNull(),
    difficulty: doublePrecision('difficulty').notNull(),
    scheduledDays: integer('scheduled_days').notNull().default(0),
    learningSteps: integer('learning_steps').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: integer('state').notNull().default(0),
    lastReview: timestamp('last_review', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.statementId] })],
)

export const report = pgTable('report', {
  id: serial('id').primaryKey(),
  statementId: integer('statement_id')
    .notNull()
    .references(() => statement.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().default('me'),
  comment: text('comment'),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Hochgeladene OLAT-Klickerfragen und Altprüfungen als Vorlage für Stil und Schwierigkeit. */
export const styleExample = pgTable('style_example', {
  id: serial('id').primaryKey(),
  subjectId: integer('subject_id')
    .notNull()
    .references(() => subject.id, { onDelete: 'cascade' }),
  unitNumber: integer('unit_number'),
  /** olat | altpruefung | andere */
  kind: text('kind').notNull().default('olat'),
  sourceLabel: text('source_label'),
  stem: text('stem').notNull(),
  options: jsonb('options').$type<{ text: string; truth?: 'R' | 'F' | null }[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Subject = typeof subject.$inferSelect
export type Unit = typeof unit.$inferSelect
export type Statement = typeof statement.$inferSelect
export type CardStateRow = typeof cardState.$inferSelect
export type Question = typeof question.$inferSelect
