import assert from 'node:assert/strict'
import { before, test } from 'node:test'

process.env.DATABASE_URL = 'memory://'
process.env.SEED_ON_EMPTY = '1'

const { getDb } = await import('../lib/db/index.ts')
const svc = await import('../lib/service.ts')
const { handleJsonRpc } = await import('../lib/mcp/server.ts')
const { TOOLS } = await import('../lib/mcp/tools.ts')

let subjectId = 0

async function call(name: string, args: Record<string, unknown>) {
  const res = (await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as {
    result: { content: { text: string }[]; isError?: boolean }
  }
  const text = res.result.content[0].text
  if (res.result.isError) throw new Error(text)
  return JSON.parse(text)
}

before(async () => {
  const db = await getDb()
  subjectId = (await svc.resolveSubject(db, 'KliBio')).id
})

test('Startfach Klinische Biopsychologie ist angelegt', async () => {
  const [kb] = await svc.listSubjects(await getDb())
  assert.equal(kb.name, 'Klinische Biopsychologie')
  assert.equal(kb.ueLimit, 4)
  // 25 aus der Startbank, davon 2 als Detailwissen ausgemustert, dazu Paket 2 mit 20 pro UE 1–9
  assert.equal(kb.counts.active, 23 + 180)
  assert.equal(kb.counts.new, 23 + 4 * 20)
})

test('Paket 2: 20 Aussagen pro UE mit Zitat, Detailwissen ausgemustert, nur einmal eingespielt', async () => {
  const db = await getDb()
  const all = await svc.listStatements(db, subjectId, { limit: 1000 })
  const pack = all.filter((x) => x.origin === 'paket')
  assert.equal(pack.length, 180)
  for (let u = 1; u <= 9; u++) assert.equal(pack.filter((x) => x.unitNumber === u).length, 20, `UE ${u}`)
  assert.ok(pack.every((x) => x.status === 'active' && x.quote && x.sourceRef))
  // Varianten derselben Ur-Aussage hängen zusammen, damit sie nie in derselben Frage stehen
  assert.ok(pack.some((x) => x.parentId !== null))
  const retired = all.filter((x) => x.status === 'retired').map((x) => x.text)
  assert.ok(retired.some((t) => t.includes('1984')))
  assert.ok(retired.some((t) => t.startsWith('Jeder Vorlesungstermin')))
  // UE-Titel aus dem Paket, wo es die UE noch nicht gab
  const ov = await svc.subjectOverview(db, subjectId)
  assert.equal(ov.units.find((u) => u.number === 8)?.title, 'Schmerz')
  // zweiter Start spielt nichts doppelt ein
  const { applyPacks } = await import('../lib/seed.ts')
  await applyPacks(db)
  assert.equal((await svc.listStatements(db, subjectId, { limit: 1000 })).length, all.length)
})

test('Neues Fach RDA: angelegt, 13 UEs, Paket 1 aktiv, Grenze UE 10, nur einmal eingespielt', async () => {
  const db = await getDb()
  const subjects = await svc.listSubjects(db)
  assert.equal(subjects[0].name, 'Klinische Biopsychologie')
  const rda = subjects.find((x) => x.slug === 'rda')
  assert.ok(rda)
  assert.equal(rda.name, 'Rechnergestützte Datenauswertung')
  assert.equal(rda.ueLimit, 10)
  const all = await svc.listStatements(db, rda.id, { limit: 1000 })
  assert.equal(all.length, 324)
  assert.ok(all.every((x) => x.status === 'active' && x.origin === 'paket' && x.quote && x.sourceRef))
  const ov = await svc.subjectOverview(db, rda.id)
  assert.equal(ov.units.length, 13)
  assert.equal(ov.units.find((u) => u.number === 8)?.title, 'Korrelation und einfache Regression')
  // zweiter Start: kein zweites Fach, keine doppelten Aussagen
  const { applyPacks } = await import('../lib/seed.ts')
  await applyPacks(db)
  assert.equal((await svc.listSubjects(db)).filter((x) => x.slug === 'rda').length, 1)
  assert.equal((await svc.listStatements(db, rda.id, { limit: 1000 })).length, 324)
})

test('Neues Fach TT: angelegt, 8 UEs, Paket 1 aktiv, Grenze UE 8, nur einmal eingespielt', async () => {
  const db = await getDb()
  const tt = (await svc.listSubjects(db)).find((x) => x.slug === 'tt')
  assert.ok(tt)
  assert.equal(tt.name, 'Testtheorie')
  assert.equal(tt.ueLimit, 8)
  const all = await svc.listStatements(db, tt.id, { limit: 1000 })
  assert.equal(all.length, 359)
  assert.ok(all.every((x) => x.status === 'active' && x.origin === 'paket' && x.quote && x.sourceRef))
  const ov = await svc.subjectOverview(db, tt.id)
  assert.equal(ov.units.length, 8)
  assert.equal(ov.units.find((u) => u.number === 8)?.title, 'MTMM-Modelle')
  const { applyPacks } = await import('../lib/seed.ts')
  await applyPacks(db)
  assert.equal((await svc.listSubjects(db)).filter((x) => x.slug === 'tt').length, 1)
  assert.equal((await svc.listStatements(db, tt.id, { limit: 1000 })).length, 359)
})

test('MCP: initialize, tools/list, Benachrichtigung', async () => {
  const init = (await handleJsonRpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } })) as any
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.match(init.result.instructions, /Erfinde nichts/)
  assert.equal(await handleJsonRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
  const list = (await handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as any
  assert.equal(list.result.tools.length, TOOLS.length)
  const add = list.result.tools.find((t: any) => t.name === 'add_statements')
  assert.equal(add.inputSchema.type, 'object')
  assert.ok(add.inputSchema.properties.statements)
})

test('MCP: Session über get_due und report_answer, FSRS-Update', async () => {
  const [before] = await svc.listSubjects(await getDb())
  const due = await call('get_due', { subject: 'KliBio' })
  assert.equal(due.questions.length, 5)
  assert.equal(due.questions[0].options.length, 5)
  const q = due.questions[0]
  const r = await call('report_answer', { question_id: q.question_id, marked: ['A'] })
  assert.equal(r.results.length, 5)
  assert.ok(r.results.every((x: any) => typeof x.correct === 'boolean'))
  // doppelt melden ändert nichts
  const again = await call('report_answer', { question_id: q.question_id, marked: ['B', 'C'] })
  assert.deepEqual(again.results.map((x: any) => x.marked), r.results.map((x: any) => x.marked))
  for (const qq of due.questions.slice(1)) await call('report_answer', { question_id: qq.question_id, marked: [] })
  const sum = await call('get_session_summary', { session_id: due.session_id })
  assert.equal(sum.finished, true)
  assert.ok(sum.repeat.length <= 2)
  const [kb] = await svc.listSubjects(await getDb())
  assert.equal(kb.counts.new, before.counts.new - 25)
  const md = await call('export_markdown', { subject: 'KliBio', session_id: due.session_id })
  assert.match(md.markdown, /> \[!check\]- Lösung/)
})

test('MCP: Notes einspielen, Aussage mit Beleg, blinde Prüfung, Freigabe', async () => {
  const notes = `# UE 5 Psychopathologie und Körper\n## Somatische Belastungsstörung\nDie somatische Belastungsstörung ist durch belastende Körpersymptome und exzessive Gedanken, Gefühle oder Verhaltensweisen gekennzeichnet.\n`
  const sync = await call('sync_source', { subject: 'KliBio', kind: 'notes', path: 'Klinische Biopsychologie/Notes.md', content: notes })
  assert.equal(sync.units[0].unit, 5)
  assert.equal(sync.units[0].changed, true)
  const again = await call('sync_source', { subject: 'KliBio', kind: 'notes', path: 'Klinische Biopsychologie/Notes.md', content: notes })
  assert.equal(again.units[0].changed, false)

  const mat = await call('get_unit_material', { subject: 'KliBio', unit: 5 })
  assert.equal(mat.chunks.length, 1)
  assert.equal(mat.styleExamples.length, 3)
  const chunk = mat.chunks[0]
  const added = await call('add_statements', {
    subject: 'KliBio',
    statements: [
      { unit: 5, text: 'Die somatische Belastungsstörung ist durch belastende Körpersymptome gekennzeichnet.', truth: 'R', quote: 'durch belastende Körpersymptome und exzessive Gedanken', chunk_id: chunk.id, source_ref: 'Notes UE 5' },
      { unit: 5, text: 'Die somatische Belastungsstörung setzt immer eine organische Ursache voraus.', truth: 'F', quote: 'belastende Körpersymptome', chunk_id: chunk.id, manipulation_type: 'andere' },
      { unit: 5, text: 'Ohne Beleg', truth: 'R', quote: '' },
    ],
  })
  assert.equal(added.saved.length, 2)
  assert.equal(added.rejected.length, 1)
  assert.ok(added.saved[1].flags.includes('absolutwort:immer'))

  const queue = await call('get_check_queue', { subject: 'KliBio' })
  assert.equal(queue.length, 2)
  assert.equal(queue[0].truth, undefined, 'kein Label in der Prüfwarteschlange')
  await call('submit_checks', { checks: [{ statement_id: queue[0].id, truth: 'R' }, { statement_id: queue[1].id, truth: 'R' }] })
  const inbox = await call('list_inbox', { subject: 'KliBio' })
  const first = inbox.find((x: any) => x.id === queue[0].id)
  const second = inbox.find((x: any) => x.id === queue[1].id)
  assert.equal(first.ready, true)
  assert.ok(second.flags.includes('pruefer_widerspricht'))
  const ok = await call('review_statement', { id: first.id, action: 'approve' })
  assert.equal(ok.status, 'active')

  // Quelle ändert sich, Zitat verschwindet → neu prüfen
  const changed = notes.replace('exzessive Gedanken', 'übermässige Gedanken')
  const res = await call('sync_source', { subject: 'KliBio', kind: 'notes', path: 'Klinische Biopsychologie/Notes.md', content: changed })
  assert.equal(res.units[0].flagged, 1)
})

test('UE-Grenze, Fehler melden, Fehlermeldungen', async () => {
  await call('update_subject', { subject: 'Klinische Biopsychologie', ue_limit: 1 })
  const one = await call('get_due', { subject: 'KliBio' })
  assert.ok(one.questions.length >= 1)
  assert.ok(one.questions.every((q: any) => q.ue === 1), 'nur Aussagen bis UE 1')
  await call('update_subject', { subject: 'KliBio', ue_limit: 0 })
  await assert.rejects(call('get_due', { subject: 'KliBio' }), /Zu wenig aktive Aussagen bis UE 0/)
  await call('update_subject', { subject: 'KliBio', ue_limit: 4 })
  const st = (await call('list_statements', { subject: 'KliBio', query: 'Leptin' }))[0]
  await call('report_error', { statement_id: st.id, comment: 'Quelle prüfen' })
  const inbox = await call('list_inbox', { subject: 'KliBio' })
  assert.deepEqual(inbox.find((x: any) => x.id === st.id).reports, ['Quelle prüfen'])
  await assert.rejects(call('get_subject', { subject: 'Psychopathologie' }), /nicht gefunden/)
  await assert.rejects(call('add_statements', { subject: 'KliBio', statements: [] }), /Ungültige Eingabe/)
})

test('Freunde lernen mit denselben Aussagen, aber eigenem Lernstand und eigener UE-Grenze', async () => {
  const db = await getDb()
  assert.equal(svc.learnerSlug('David M.'), 'david-m')
  assert.equal(svc.learnerSlug('inbox'), null)
  assert.equal(svc.learnerSlug('x'), null)

  const ownerBefore = (await svc.listSubjects(db))[0]
  await svc.setLearnerUeRange(db, 'david', subjectId, 1, 2)
  const [david] = await svc.listSubjects(db, new Date(), 'david')
  assert.equal(david.ueLimit, 2)
  assert.equal(david.counts.seen, 0)
  // Die Grenze des Besitzers bleibt unberührt.
  assert.equal((await svc.listSubjects(db))[0].ueLimit, ownerBefore.ueLimit)

  const view = await svc.startSession(db, subjectId, { user: 'david', nQuestions: 1 })
  assert.equal(view.session.userId, 'david')
  assert.ok(view.questions.every((q) => (q.unitNumber ?? 0) <= 2))
  await svc.answerQuestion(db, view.questions[0].id, ['A'])

  const [davidAfter] = await svc.listSubjects(db, new Date(), 'david')
  assert.equal(davidAfter.counts.seen, 5)
  const [ownerAfter] = await svc.listSubjects(db)
  assert.equal(ownerAfter.counts.seen, ownerBefore.counts.seen)

  // «von» und «bis» verkehrt gewählt: wird vertauscht.
  await svc.setLearnerUeRange(db, 'david', subjectId, 4, 2)
  const [range] = await svc.listSubjects(db, new Date(), 'david')
  assert.deepEqual([range.ueFrom, range.ueLimit], [2, 4])
  const v2 = await svc.startSession(db, subjectId, { user: 'david', nQuestions: 3 })
  assert.deepEqual([v2.session.ueFrom, v2.session.ueLimit], [2, 4])
  assert.ok(v2.questions.every((q) => (q.unitNumber ?? 0) >= 2 && (q.unitNumber ?? 0) <= 4))
  assert.equal(svc.ueRangeLabel(2, 4), 'UE 2–4')
  assert.equal(svc.ueRangeLabel(1, 4), 'bis UE 4')
})

test('Nicht prüfungsrelevant: Besitzer mustert aus, andere melden, Generator bekommt Gegenbeispiele', async () => {
  const db = await getDb()
  const [a, b] = (await svc.listStatements(db, subjectId, { status: 'active', unit: 2 })).slice(0, 2)
  const r1 = await svc.markIrrelevant(db, a.id)
  assert.equal(r1.status, 'retired')
  const r2 = await svc.markIrrelevant(db, b.id, 'david')
  assert.equal(r2.status, 'flagged')
  const examples = await svc.irrelevantExamples(db, subjectId)
  assert.ok(examples.includes(a.text))
  assert.ok(!examples.includes(b.text))
  const inbox = await svc.listInbox(db, subjectId)
  assert.deepEqual(inbox.find((x) => x.id === b.id)?.reports, ['nicht prüfungsrelevant'])
  // MCP-Werkzeug
  const c = (await svc.listStatements(db, subjectId, { status: 'active', unit: 3 }))[0]
  assert.equal((await call('mark_irrelevant', { statement_id: c.id })).status, 'retired')
})

test('Vom App-Generator freigegebenes Detailwissen kommt einmal zurück in die Inbox', async () => {
  const db = await getDb()
  const { moveDetailToInbox } = await import('../lib/seed.ts')
  const schema = await import('../lib/db/schema.ts')
  const { eq } = await import('drizzle-orm')
  const [u] = await db.select().from(schema.unit).where(eq(schema.unit.number, 4))
  const [trivia] = await db
    .insert(schema.statement)
    .values({ unitId: u.id, text: 'Laut Folie gibt es 14 Substanzklassen.', truth: 'R', quote: '14 Substanzklassen', origin: 'claude-app', status: 'active' })
    .returning()
  // Der Merker für diesen Schritt ist beim Start schon gesetzt: ohne ihn läuft er einmal.
  await db.delete(schema.source).where(eq(schema.source.path, 'wartung:detailwissen-v1'))
  assert.equal((await moveDetailToInbox(db)).moved, 1)
  const [after] = await db.select().from(schema.statement).where(eq(schema.statement.id, trivia.id))
  assert.equal(after.status, 'inbox')
  assert.ok(after.flags.includes('detailwissen:anzahl'))
  assert.equal((await moveDetailToInbox(db)).moved, 0)
})
