import { z } from 'zod'
import { getDb } from '../db/index.ts'
import { MANIPULATION_TYPES } from '../core/quality.ts'
import { LETTERS } from '../core/text.ts'
import * as svc from '../service.ts'

/**
 * Werkzeuge, mit denen Claude die App steuert: Fächer und UEs anlegen, Notes und
 * Folien einspielen, Aussagen erzeugen und blind gegenprüfen, freigeben, abfragen
 * und Antworten auswerten. Jedes Werkzeug ruft dieselbe Funktion wie die Weboberfläche.
 */

const subjectRef = z.string().describe('Fach: Name, Kürzel (z. B. «KliBio»), Slug oder ID')
const truth = z.enum(['R', 'F'])

type Tool<S extends z.ZodType> = {
  name: string
  title: string
  description: string
  input: S
  readOnly?: boolean
  run: (args: z.infer<S>) => Promise<unknown>
}

function tool<S extends z.ZodType>(t: Tool<S>) {
  return t
}

async function subjectId(ref: string) {
  return (await svc.resolveSubject(await getDb(), ref)).id
}

export const TOOLS = [
  tool({
    name: 'list_subjects',
    title: 'Fächer auflisten',
    description: 'Alle Fächer mit UE-Grenze, Prüfungsdatum, fälligen und neuen Aussagen, Inbox und Serie.',
    input: z.object({}),
    readOnly: true,
    run: async () => svc.listSubjects(await getDb()),
  }),
  tool({
    name: 'get_subject',
    title: 'Fach im Detail',
    description:
      'UE-Liste mit Fortschritt (Anteil «sicher» = Stabilität über 21 Tage), Trefferquote, Abdeckung Fundstelle × Anzahl Aussagen, Chunks ohne Aussage, die am häufigsten falsch beantworteten Aussagen und die Quellen.',
    input: z.object({ subject: subjectRef }),
    readOnly: true,
    run: async ({ subject }) => {
      const db = await getDb()
      const id = await subjectId(subject)
      return { ...(await svc.subjectOverview(db, id)), sources: await svc.listSources(db, id) }
    },
  }),
  tool({
    name: 'create_subject',
    title: 'Fach anlegen',
    description: 'Neues Fach. vault_path ist der Ordner im Obsidian-Vault, vault_name der Name des Vaults (für obsidian://-Links).',
    input: z.object({
      name: z.string(),
      short_name: z.string().optional(),
      course_code: z.string().optional(),
      dozent: z.string().optional(),
      vault_path: z.string().optional(),
      vault_name: z.string().optional(),
      slides_pattern: z.string().optional().describe('z. B. «Slides/VL{n}.pdf», {n} = Vorlesungsnummer'),
      zm_path: z.string().optional(),
      ue_limit: z.number().int().min(0).optional(),
      exam_date: z.string().optional().describe('YYYY-MM-DD'),
    }),
    run: async (a) =>
      svc.createSubject(await getDb(), {
        name: a.name,
        shortName: a.short_name,
        courseCode: a.course_code,
        dozent: a.dozent,
        vaultPath: a.vault_path,
        vaultName: a.vault_name,
        slidesPattern: a.slides_pattern,
        zmPath: a.zm_path,
        ueLimit: a.ue_limit,
        examDate: a.exam_date,
      }),
  }),
  tool({
    name: 'update_subject',
    title: 'Fach einstellen',
    description:
      'Einstellungen ändern, vor allem die UE-Grenze («bis UE n»), das Prüfungsdatum und den Prüfungsmodus (fragt alles bis zur Grenze einmal durch, gewichtet nach Schwäche). auto_approve: Aussagen werden ohne Freigabe aktiv, wenn Generator und Prüfer übereinstimmen und nichts geflaggt ist.',
    input: z.object({
      subject: subjectRef,
      ue_limit: z.number().int().min(0).optional(),
      exam_date: z.string().nullable().optional(),
      exam_mode: z.boolean().optional(),
      questions_per_session: z.number().int().min(1).max(20).optional(),
      auto_approve: z.boolean().optional(),
      name: z.string().optional(),
      short_name: z.string().optional(),
      dozent: z.string().optional(),
      vault_path: z.string().optional(),
      vault_name: z.string().optional(),
      slides_pattern: z.string().optional(),
      zm_path: z.string().optional(),
    }),
    run: async (a) =>
      svc.updateSubject(await getDb(), await subjectId(a.subject), {
        ueLimit: a.ue_limit,
        examDate: a.exam_date,
        examMode: a.exam_mode,
        questionsPerSession: a.questions_per_session,
        autoApprove: a.auto_approve,
        name: a.name,
        shortName: a.short_name,
        dozent: a.dozent,
        vaultPath: a.vault_path,
        vaultName: a.vault_name,
        slidesPattern: a.slides_pattern,
        zmPath: a.zm_path,
      }),
  }),
  tool({
    name: 'upsert_unit',
    title: 'UE anlegen oder umbenennen',
    description: 'Legt eine Unterrichtseinheit an oder ändert Titel und «bis Folie X».',
    input: z.object({ subject: subjectRef, number: z.number().int().min(0), title: z.string(), slides_until: z.number().int().optional() }),
    run: async (a) => svc.upsertUnit(await getDb(), await subjectId(a.subject), a.number, a.title, a.slides_until),
  }),
  tool({
    name: 'sync_source',
    title: 'Quelle einspielen',
    description:
      'Spielt Inhalte aus dem Vault ein (z. B. Notes.md aus Google Drive, Folientexte). kind=notes ohne unit: wird nach «# UE n» zerlegt, nur geänderte UEs werden neu verarbeitet. Für PDFs pages mit Seitentext angeben. Hat sich eine Quelle geändert, werden Aussagen, deren Zitat nicht mehr vorkommt, auf «neu prüfen» gesetzt. Die Antwort enthält pro UE, ob sie sich geändert hat: Für geänderte UEs danach get_unit_material aufrufen und neue Aussagen vorschlagen.',
    input: z.object({
      subject: subjectRef,
      kind: z.enum(['notes', 'slides', 'zm', 'exam', 'upload', 'mcp']),
      path: z.string().describe('Pfad im Vault, z. B. «Klinische Biopsychologie/Notes.md» oder «Slides/VL4.pdf»'),
      content: z.string().optional(),
      pages: z.array(z.object({ page: z.number().int(), text: z.string() })).optional(),
      unit: z.number().int().optional(),
    }),
    run: async (a) =>
      svc.syncSource(await getDb(), await subjectId(a.subject), { kind: a.kind, path: a.path, content: a.content, pages: a.pages, unit: a.unit }),
  }),
  tool({
    name: 'get_unit_material',
    title: 'Material einer UE',
    description:
      'Alles, was es braucht, um Aussagen zu einer UE zu schreiben: die Textstücke (Chunks) mit ID, die vorhandenen Aussagen (um Doppelte zu vermeiden), die Verteilung der Verfälschungstypen und Stilvorlagen aus OLAT/Altprüfungen. Neue Aussagen nur aus diesen Chunks schreiben.',
    input: z.object({ subject: subjectRef, unit: z.number().int() }),
    readOnly: true,
    run: async (a) => svc.getUnitMaterial(await getDb(), await subjectId(a.subject), a.unit),
  }),
  tool({
    name: 'add_statements',
    title: 'Aussagen vorschlagen',
    description:
      'Speichert neue Aussagen in der Inbox. Belegpflicht: Jede Aussage braucht ein wörtliches Zitat aus dem Chunk (quote) und am besten chunk_id; ohne Zitat wird sie verworfen. F-Aussagen enthalten genau eine Verfälschung und nennen deren Typ. Die App prüft automatisch Absolutwörter, Zahlen und Begriffe, die im Zitat fehlen, und ob das Zitat im Chunk steht. Danach folgt die blinde Gegenprüfung (get_check_queue).',
    input: z.object({
      subject: subjectRef,
      statements: z
        .array(
          z.object({
            unit: z.number().int(),
            text: z.string().describe('Die Aussage, wie sie in der Frage steht'),
            truth,
            reason: z.string().optional().describe('Kurze Begründung, bei F: was richtig wäre'),
            quote: z.string().describe('Wörtliches Zitat aus der Quelle'),
            source_ref: z.string().optional().describe('Fundstelle, z. B. «VL4 p.5» oder «ZM S.69»'),
            chunk_id: z.number().int().optional(),
            topic: z.string().optional().describe('Thema für den Fragestamm, mit Präposition: «zu Hunger- und Sättigungssignalen»'),
            manipulation_type: z.enum(MANIPULATION_TYPES).optional().describe('nur bei F: vertauschung, negation, zahl, zuordnung, doppelt (bewusst schwer), andere'),
            parent_id: z.number().int().optional().describe('Variante/Umformulierung von Aussage …'),
          }),
        )
        .min(1),
    }),
    run: async (a) =>
      svc.addStatements(
        await getDb(),
        await subjectId(a.subject),
        a.statements.map((x) => ({
          unit: x.unit,
          text: x.text,
          truth: x.truth,
          reason: x.reason,
          quote: x.quote,
          sourceRef: x.source_ref,
          chunkId: x.chunk_id,
          topic: x.topic,
          manipulationType: x.manipulation_type,
          parentId: x.parent_id,
        })),
      ),
  }),
  tool({
    name: 'get_check_queue',
    title: 'Blinde Gegenprüfung: Warteschlange',
    description:
      'Aussagen, die noch nicht gegengeprüft sind, nur mit Text und Zitat, ohne Label. Entscheide allein aus dem Zitat, ob R oder F, und melde mit submit_checks. Am besten in einem frischen Kontext (Subagent), der die Generierung nicht gesehen hat.',
    input: z.object({ subject: subjectRef.optional(), limit: z.number().int().min(1).max(100).optional() }),
    readOnly: true,
    run: async (a) => svc.checkQueue(await getDb(), a.subject ? await subjectId(a.subject) : null, a.limit ?? 20),
  }),
  tool({
    name: 'submit_checks',
    title: 'Blinde Gegenprüfung: Urteile',
    description:
      'Urteile der Gegenprüfung. flags z. B. «mehrdeutig», «absolutwort», «nicht_belegt:<Begriff>», «zwei_verfaelschungen». Weicht das Urteil vom Label ab, landet die Aussage als «zu prüfen» in der Inbox.',
    input: z.object({
      checks: z
        .array(z.object({ statement_id: z.number().int(), truth, flags: z.array(z.string()).optional(), comment: z.string().optional() }))
        .min(1),
      model: z.string().optional(),
    }),
    run: async (a) =>
      svc.submitChecks(
        await getDb(),
        a.checks.map((c) => ({ statementId: c.statement_id, truth: c.truth, flags: c.flags, comment: c.comment, model: a.model })),
      ),
  }),
  tool({
    name: 'list_inbox',
    title: 'Inbox',
    description: 'Neue und geflaggte Aussagen mit Zitat, Prüferurteil, Hinweisen und Meldungen. ready=true heisst: Prüfer stimmt zu, keine Hinweise.',
    input: z.object({ subject: subjectRef.optional() }),
    readOnly: true,
    run: async (a) => svc.listInbox(await getDb(), a.subject ? await subjectId(a.subject) : null),
  }),
  tool({
    name: 'review_statement',
    title: 'Aussage freigeben, bearbeiten, verwerfen',
    description:
      'approve = in die Übungen, reject = verwerfen (retired), edit = nur ändern, flag = aus der Rotation nehmen. Nur auf ausdrücklichen Wunsch der Nutzerin oder des Nutzers freigeben.',
    input: z.object({
      id: z.number().int(),
      action: z.enum(['approve', 'reject', 'edit', 'flag']),
      text: z.string().optional(),
      truth: truth.optional(),
      reason: z.string().optional(),
      source_ref: z.string().optional(),
      topic: z.string().optional(),
    }),
    run: async (a) =>
      svc.reviewStatement(await getDb(), a.id, a.action, { text: a.text, truth: a.truth, reason: a.reason, sourceRef: a.source_ref, topic: a.topic }),
  }),
  tool({
    name: 'list_statements',
    title: 'Aussagen suchen',
    description: 'Aussagen eines Fachs, filterbar nach UE, Status (inbox, active, flagged, retired) und Suchtext.',
    input: z.object({
      subject: subjectRef,
      unit: z.number().int().optional(),
      status: z.enum(['inbox', 'active', 'flagged', 'retired']).optional(),
      query: z.string().optional(),
      limit: z.number().int().optional(),
    }),
    readOnly: true,
    run: async (a) => svc.listStatements(await getDb(), await subjectId(a.subject), a),
  }),
  tool({
    name: 'get_due',
    title: 'Fragen für heute',
    description:
      'Startet eine Session: fällige Aussagen zuerst, mit neuen aufgefüllt, gemischt nach den Regeln (nur bis zur UE-Grenze, mind. drei UEs, neueste doppelt, Anzahl richtiger variiert 0–5, nie Aussage und Umkehrung zusammen). Gibt die Fragen ohne Lösung zurück. Stelle sie einzeln im OLAT-Format (A–E), warte auf die Antwort und melde sie mit report_answer.',
    input: z.object({
      subject: subjectRef,
      questions: z.number().int().min(1).max(20).optional(),
      ue_limit: z.number().int().optional().describe('nur für diese Session, sonst die Einstellung des Fachs'),
      exam_mode: z.boolean().optional(),
    }),
    run: async (a) => {
      const view = await svc.startSession(await getDb(), await subjectId(a.subject), {
        channel: 'mcp',
        nQuestions: a.questions,
        ueLimit: a.ue_limit,
        examMode: a.exam_mode,
      })
      return {
        session_id: view.session.id,
        ue_limit: view.session.ueLimit,
        questions: view.questions.map((q) => ({
          question_id: q.id,
          nr: q.position,
          ue: q.unitNumber,
          ue_title: q.unitTitle,
          stem: q.stem,
          options: q.options.map((o) => `${o.letter}) ${o.text}`),
        })),
      }
    },
  }),
  tool({
    name: 'report_answer',
    title: 'Antwort auswerten',
    description:
      'Wertet die Antwort auf eine Frage aus (welche Buchstaben angekreuzt wurden, leer = keine), aktualisiert den Wiederholungsplan pro Aussage und gibt die Lösung mit Begründung und Fundstellen zurück. guessed=true, wenn geraten (zählt als «schwer»).',
    input: z.object({
      question_id: z.number().int(),
      marked: z.array(z.enum(LETTERS)).describe('angekreuzte Aussagen, z. B. ["A","D"]'),
      guessed: z.boolean().optional(),
    }),
    run: async (a) => {
      const r = await svc.answerQuestion(await getDb(), a.question_id, a.marked, { guessed: a.guessed })
      return {
        all_correct: r.question.allCorrect,
        correct_letters: (r.question.results ?? []).filter((x) => x.truth === 'R').map((x) => x.letter),
        results: (r.question.results ?? []).map((x) => ({
          letter: x.letter,
          statement_id: x.statementId,
          truth: x.truth,
          marked: x.marked,
          correct: x.correct,
          reason: x.reason,
          source: x.sourceRef,
          link: x.links.find((l) => l.url)?.url ?? null,
        })),
        session: { id: r.sessionId, finished: r.finished, ...r.score },
      }
    },
  }),
  tool({
    name: 'get_session_summary',
    title: 'Session-Abschluss',
    description: 'x von n Fragen komplett richtig und die zwei Aussagen zum Wiederholen.',
    input: z.object({ session_id: z.number().int() }),
    readOnly: true,
    run: async (a) => svc.sessionSummary(await getDb(), a.session_id),
  }),
  tool({
    name: 'report_error',
    title: 'Fehler melden',
    description: 'Meldet einen Fehler in einer Aussage. Sie wird sofort aus der Rotation genommen und landet in der Inbox.',
    input: z.object({ statement_id: z.number().int(), comment: z.string().optional() }),
    run: async (a) => svc.reportError(await getDb(), a.statement_id, a.comment ?? null),
  }),
  tool({
    name: 'export_markdown',
    title: 'Export für den Exercises-Ordner',
    description:
      'Markdown im Format von Klickerfragen_<Fach>.md (Tagesüberschrift, Fragen, eingeklappte Lösung). Ohne Angabe: alle Sessions von heute. Zum Anhängen an die Datei im Vault.',
    input: z.object({ subject: subjectRef, session_id: z.number().int().optional(), date: z.string().optional().describe('YYYY-MM-DD') }),
    readOnly: true,
    run: async (a) => svc.exportMarkdown(await getDb(), await subjectId(a.subject), { sessionId: a.session_id, date: a.date }),
  }),
  tool({
    name: 'import_bank',
    title: 'Aussagenbank importieren',
    description:
      'Übernimmt eine bestehende Bank 1:1: entweder eine Exercises-Datei (## Frage n (UE x: …) mit Lösungsblock) oder Zeilen «[R]/[F] Text — Begründung (VLx p.y)» unter «# UE n Titel». Doppelte werden übersprungen.',
    input: z.object({ subject: subjectRef, markdown: z.string(), status: z.enum(['active', 'inbox']).optional() }),
    run: async (a) => svc.importBank(await getDb(), await subjectId(a.subject), a.markdown, a.status ?? 'active'),
  }),
  tool({
    name: 'add_style_examples',
    title: 'Stilvorlagen hinzufügen',
    description:
      'OLAT-Klickerfragen oder Altprüfungen als Vorlage für Länge, Fallen und Schwierigkeit. Sie werden nicht abgefragt. truth nur angeben, wenn die Lösung bekannt ist.',
    input: z.object({
      subject: subjectRef,
      examples: z
        .array(
          z.object({
            unit: z.number().int().optional(),
            kind: z.enum(['olat', 'altpruefung', 'andere']).optional(),
            source_label: z.string().optional(),
            stem: z.string(),
            options: z.array(z.object({ text: z.string(), truth: truth.nullable().optional() })),
          }),
        )
        .min(1),
    }),
    run: async (a) =>
      svc.addStyleExamples(
        await getDb(),
        await subjectId(a.subject),
        a.examples.map((e) => ({ unit: e.unit, kind: e.kind, sourceLabel: e.source_label, stem: e.stem, options: e.options })),
      ),
  }),
]

export function toolList() {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input, { target: 'draft-2020-12' }) as Record<string, unknown>
    delete schema.$schema
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: schema,
      annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: false, openWorldHint: false },
    }
  })
}

export async function callTool(name: string, args: unknown): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  const t = TOOLS.find((x) => x.name === name)
  if (!t) return { content: [{ type: 'text', text: `Unbekanntes Werkzeug: ${name}` }], isError: true }
  const parsed = t.input.safeParse(args ?? {})
  if (!parsed.success) {
    return { content: [{ type: 'text', text: `Ungültige Eingabe: ${z.prettifyError(parsed.error)}` }], isError: true }
  }
  try {
    const result = await (t.run as (a: unknown) => Promise<unknown>)(parsed.data)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] }
  } catch (e) {
    const msg = e instanceof svc.AppError ? e.message : `Fehler: ${(e as Error).message}`
    return { content: [{ type: 'text', text: msg }], isError: true }
  }
}
