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
  assert.equal(kb.counts.active, 25)
  assert.equal(kb.counts.new, 25)
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
  assert.equal(kb.counts.new, 0)
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
  assert.equal(one.questions.length, 1, 'bis UE 1 gibt es genau 5 Aussagen')
  assert.ok(one.questions.every((q: any) => q.ue === 1))
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
