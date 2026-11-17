import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composeSession, planUnits, truthTargets, type Candidate } from '../lib/core/compose.ts'
import { dayToMarkdown } from '../lib/core/export.ts'
import { refToUrl, parseSourceRefs, slidesFile, sourceLinks } from '../lib/core/links.ts'
import { chunkMarkdown, parseBank, splitNotesByUnit, splitReasonAndRef, topicFromStem } from '../lib/core/parse.ts'
import { checkStatement } from '../lib/core/quality.ts'
import { gradeFor, review } from '../lib/core/schedule.ts'
import { BANK } from '../data/seed/klinische-biopsychologie.ts'
import { containsQuote } from '../lib/core/text.ts'

function seeded(seed = 1) {
  let x = seed
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646
}

test('liest die Exercises-Datei: 25 Aussagen mit Lösung und Fundstelle', () => {
  const p = parseBank(BANK)
  assert.equal(p.statements.length, 25)
  assert.deepEqual(p.units.map((u) => u.number), [1, 2, 3, 4])
  assert.equal(p.units.find((u) => u.number === 4)?.title, 'Essen und Konsum')
  const leptin = p.statements.find((s) => s.text.startsWith('Leptin'))!
  assert.equal(leptin.truth, 'F')
  assert.equal(leptin.reason, 'Leptin kommt aus den Fettzellen und hemmt den Appetit')
  assert.equal(leptin.sourceRef, 'VL4 p.5')
  const ghrelin = p.statements.find((s) => s.text.startsWith('Ghrelin'))!
  assert.equal(ghrelin.truth, 'R')
  assert.equal(ghrelin.sourceRef, 'ZM S.69')
  assert.equal(p.statements.filter((s) => s.unitNumber === 1 && s.truth === 'R').length, 0)
  assert.equal(p.statements.filter((s) => s.unitNumber === 2 && s.truth === 'R').length, 5)
  assert.equal(p.warnings.length, 0)
})

test('liest Drive-Export mit Markdown-Escapes', () => {
  const escaped = BANK.replace(/^#/gm, '\\#').replace(/^>/gm, '\\>').replace('[!check]', '\\[\\!check\\]')
  assert.equal(parseBank(escaped).statements.length, 25)
})

test('liest die Aussagenbank aus dem Prompt', () => {
  const p = parseBank(`# UE 3 Stress\n[R] Die akute Belastungsreaktion klingt innert Tagen ab — normale Reaktion (VL3 p.13)\n[F] Adrenalin kommt aus der Nebennierenrinde — aus dem Mark (VL3 p.5)\n`)
  assert.equal(p.statements.length, 2)
  assert.deepEqual(p.statements[1], { unitNumber: 3, text: 'Adrenalin kommt aus der Nebennierenrinde', truth: 'F', reason: 'aus dem Mark', sourceRef: 'VL3 p.5', topic: null })
})

test('Begründung und Fundstelle trennen, Thema aus dem Fragestamm', () => {
  assert.deepEqual(splitReasonAndRef(', Grad 0, «kann angeboten werden» (VL4 p.17)'), { reason: 'Grad 0, «kann angeboten werden»', sourceRef: 'VL4 p.17' })
  assert.equal(topicFromStem('Welche Aussagen zur Regulation des Schlafs treffen zu?'), 'zur Regulation des Schlafs')
})

test('Notes nach # UE n zerlegen und in Stücke teilen', () => {
  const md = `Vorspann\n# UE 1 Einführung\n## Begriffe\nText eins.\n\nText zwei.\n# UE 2: Schlaf\n## Prozess S\nAdenosin steigt.`
  const sec = splitNotesByUnit(md)
  assert.deepEqual(sec.map((s) => [s.unitNumber, s.title]), [[1, 'Einführung'], [2, 'Schlaf']])
  // Ohne Titel bleibt er leer, damit ein bestehender UE-Titel nicht überschrieben wird.
  assert.deepEqual(splitNotesByUnit('# UE 6\nText\n# UE3 Stress\nText').map((s) => [s.unitNumber, s.title]), [[6, ''], [3, 'Stress']])
  const chunks = chunkMarkdown(sec[0].markdown)
  assert.equal(chunks[0].heading, 'Begriffe')
  assert.match(chunks[0].text, /Text zwei/)
})

test('Belegpflicht und Prüferhinweise', () => {
  assert.equal(checkStatement({ text: 'X', truth: 'R', quote: '' }).accept, false)
  const r = checkStatement({
    text: 'Melatonin wird immer in der Zirbeldrüse gebildet, Peak um 3 Uhr.',
    truth: 'R',
    quote: 'Melatonin wird in der Zirbeldrüse gebildet',
    chunkText: 'Bla. Melatonin wird in der Zirbeldrüse gebildet. Bla.',
  })
  assert.ok(r.accept)
  assert.ok(r.flags.includes('absolutwort:immer'))
  assert.ok(r.flags.includes('zahl_fehlt_im_zitat:3'))
  assert.ok(!r.flags.includes('zitat_nicht_in_quelle'))
  const f = checkStatement({ text: 'Der IPQ wurde 1984 entwickelt.', truth: 'F', quote: 'IPQ von Moss-Morris et al. (2002)', manipulationType: 'zahl', chunkText: 'anders' })
  assert.deepEqual(f.flags, ['zitat_nicht_in_quelle', 'detailwissen:jahr'])
  assert.ok(checkStatement({ text: 'a b c', truth: 'F', quote: 'ein langes Zitat' }).flags.includes('f_ohne_verfaelschungstyp'))
})

test('Fundstellen werden zu obsidian-Links', () => {
  assert.deepEqual(parseSourceRefs('VL3 p.15'), [{ kind: 'slides', lecture: 3, page: 15, label: 'VL3 p.15' }])
  const cfg = { vaultName: 'obsidian', vaultPath: 'Klinische Biopsychologie', slidesPattern: 'Slides/VL{n}.pdf', zmPath: 'Zusammenfassungen/ZM.pdf' }
  assert.equal(refToUrl(parseSourceRefs('VL3 p.15')[0], cfg), 'obsidian://open?vault=obsidian&file=Klinische%20Biopsychologie%2FSlides%2FVL3.pdf%23page%3D15')
  assert.equal(sourceLinks('ZM S.69', cfg)[0].url?.includes('ZM.pdf%23page%3D69'), true)
  assert.equal(sourceLinks('VL1 p.2', { ...cfg, vaultName: null })[0].url, null)
})

test('Folienmuster als Dateiliste: n-ter Eintrag für die n-te Vorlesung', () => {
  const list = 'Slides/Lektion_01_Folien_Einfuehrung.pdf|Slides/Lektion_02_Folien_ErsteSchritteR.pdf'
  assert.equal(slidesFile(list, 2), 'Slides/Lektion_02_Folien_ErsteSchritteR.pdf')
  assert.equal(slidesFile(list, 3), null)
  assert.equal(slidesFile('Slides/VL{n}.pdf', 4), 'Slides/VL4.pdf')
  const cfg = { vaultName: 'obsidian', vaultPath: 'Rechnergestützte Datenauswertung', slidesPattern: list }
  assert.ok(refToUrl(parseSourceRefs('VL2 p.6')[0], cfg)?.endsWith('Lektion_02_Folien_ErsteSchritteR.pdf%23page%3D6'))
  assert.equal(refToUrl(parseSourceRefs('VL5 p.1')[0], cfg), null)
})

test('FSRS: falsch kommt in der nächsten Session wieder, richtig später', () => {
  const now = new Date('2026-11-14T10:00:00Z')
  const wrong = review(null, gradeFor(false, false), now)
  assert.ok(wrong.due.getTime() - now.getTime() <= 60_000)
  const good = review(null, gradeFor(true, false), now)
  assert.ok(good.due.getTime() - now.getTime() >= 86_400_000)
  const hard = review(null, gradeFor(true, true), now)
  assert.ok(hard.stability < good.stability)
})

function cands(): Candidate[] {
  const out: Candidate[] = []
  let id = 1
  for (let u = 1; u <= 6; u++)
    for (let k = 0; k < 10; k++)
      out.push({ id, unitNumber: u, unitTitle: `UE${u}`, truth: k % 2 ? 'R' : 'F', topic: null, family: id++, due: null, stability: null, lapses: 0, lastAnswered: null, wrongRate: null })
  return out
}

test('Session: Grenze, mind. drei UEs, neueste doppelt, variierende Anzahl richtig', () => {
  for (let seed = 1; seed < 30; seed++) {
    const qs = composeSession(cands(), { ueLimit: 4, nQuestions: 5, rng: seeded(seed), now: new Date('2026-11-14') })
    assert.equal(qs.length, 5)
    const all = qs.flatMap((q) => q.statementIds)
    assert.equal(new Set(all).size, 25)
    const units = new Set(all.map((id) => Math.ceil(id / 10)))
    assert.ok([...units].every((u) => u <= 4), 'nur bis UE 4')
    assert.ok(units.size >= 3)
    assert.equal(qs.filter((q) => q.unitNumber === 4).length, 2)
    assert.ok(new Set(qs.map((q) => q.trueCount)).size >= 3)
  }
})

test('Session: Bereich «von UE 2 bis 4» lässt UE 1 weg', () => {
  for (let seed = 1; seed < 10; seed++) {
    const qs = composeSession(cands(), { ueFrom: 2, ueLimit: 4, nQuestions: 5, rng: seeded(seed) })
    assert.equal(qs.length, 5)
    const units = new Set(qs.flatMap((q) => q.statementIds).map((id) => Math.ceil(id / 10)))
    assert.ok([...units].every((u) => u >= 2 && u <= 4), 'nur UE 2–4')
  }
})

test('Session: Varianten derselben Ur-Aussage nie zusammen', () => {
  const c = cands().map((x) => ({ ...x, family: Math.ceil(x.id / 2) }))
  const qs = composeSession(c, { ueLimit: 6, rng: seeded(3) })
  const fams = qs.flatMap((q) => q.statementIds).map((id) => Math.ceil(id / 2))
  assert.equal(new Set(fams).size, fams.length)
})

test('Session: fällige vor neuen', () => {
  const now = new Date('2026-11-14')
  const c = cands().map((x) => (x.id === 7 ? { ...x, due: new Date('2026-11-01'), stability: 2 } : x))
  const qs = composeSession(c, { ueLimit: 6, rng: seeded(5), now })
  assert.ok(qs.flatMap((q) => q.statementIds).includes(7))
})

test('Session: zu wenig Aussagen ergibt keine Fragen', () => {
  assert.deepEqual(composeSession(cands().slice(0, 4), { ueLimit: 6 }), [])
  assert.equal(planUnits(new Map([[1, 1]]), 3).length, 3)
  assert.equal(truthTargets(5, seeded(9)).length, 5)
})

test('Export im Format der Exercises-Datei', () => {
  const md = dayToMarkdown('14.11.2026', [
    { unitNumber: 3, unitTitle: 'Stress', stem: 'Welche Aussagen treffen zu?', statements: [
      { text: 'a', truth: 'R', reason: null, sourceRef: 'VL3 p.5' },
      { text: 'b', truth: 'F', reason: 'Mark', sourceRef: 'VL3 p.5' },
      { text: 'c', truth: 'F', reason: null, sourceRef: null },
      { text: 'd', truth: 'F', reason: null, sourceRef: null },
      { text: 'e', truth: 'R', reason: null, sourceRef: null },
    ] },
  ])
  assert.match(md, /^# 14\.11\.2026\n\n## Frage 1 \(UE 3: Stress\)/)
  assert.match(md, /> \*\*Richtig: A, E\*\*/)
  assert.match(md, /> - B: falsch, Mark \(VL3 p\.5\)/)
  // und wieder einlesbar
  assert.equal(parseBank(md).statements.length, 5)
})

test('Parallelformen: deutlich abweichende Variante', async () => {
  const { variantDiverges } = await import('../lib/core/quality.ts')
  assert.equal(variantDiverges({ answers: 5, correct: 5 }, { answers: 5, correct: 0 }), true)
  assert.equal(variantDiverges({ answers: 5, correct: 4 }, { answers: 5, correct: 3 }), false)
  assert.equal(variantDiverges({ answers: 2, correct: 2 }, { answers: 2, correct: 0 }), false)
})

test('Zitatprüfung ignoriert Hervorhebungen aus den Notes', () => {
  const chunk = 'Bei **Jungen** ist es <u>umgekehrt</u>: Sie halten sich für *fähiger*.'
  assert.equal(containsQuote(chunk, 'Bei Jungen ist es umgekehrt: Sie halten sich für fähiger'), true)
  assert.equal(containsQuote(chunk, 'Bei Mädchen ist es umgekehrt'), false)
})

test('Bezeichnungen wie GLP-1 oder ICD-11 gelten nicht als Zahlen', () => {
  const r = checkStatement({ text: 'GLP-1 steht im ICD-11 bei 25% der Fälle, 5–10 Tage.', truth: 'R', quote: 'GLP-1 bei 25% der Fälle, 5–10 Tage' })
  assert.deepEqual(r.flags.filter((f) => f.startsWith('zahl')), [])
})

test('Detailwissen erkennen: Anzahlen, Jahre, Codes, Prozent, Autoren', async () => {
  const { detailFlags } = await import('../lib/core/quality.ts')
  assert.deepEqual(detailFlags('Im ICD-11 werden bei den Störungen durch Substanzgebrauch 14 Substanzklassen unterschieden.'), ['detailwissen:anzahl'])
  assert.deepEqual(detailFlags('Der Code R63.0 gehört zur Kategorie F50.'), ['detailwissen:code'])
  assert.deepEqual(detailFlags('Die PTBS trägt den Code 6B40.'), ['detailwissen:code'])
  assert.deepEqual(detailFlags('Migräne findet sich bei jungen Frauen in rund 25 % der Fälle.'), ['detailwissen:prozent'])
  assert.deepEqual(detailFlags('Laut Eckstein et al. wirkt Oxytocin.'), ['detailwissen:autor'])
  assert.deepEqual(detailFlags('Das Konzept hat vier Dimensionen.'), ['detailwissen:anzahl'])
  // Bezeichnungen sind kein Detailwissen
  assert.deepEqual(detailFlags('Typ-1-Diabetes, Stadium N2, ICD-11, GLP-1, S3-Leitlinie und VL4 p.5.'), [])
})

test('Paket 2: jedes Zitat da, keine Hinweise, 10/10 pro UE', async () => {
  const { PACK } = await import('../data/seed/klibio-paket-2.ts')
  const { checkStatement } = await import('../lib/core/quality.ts')
  assert.equal(PACK.statements.length, 180)
  for (const s of PACK.statements) {
    assert.deepEqual(s.flags, [], s.text)
    assert.ok(s.quote.length >= 8, s.text)
    assert.deepEqual(checkStatement({ text: s.text, truth: s.truth, quote: s.quote, manipulationType: s.manipulationType }).flags.filter((f) => !f.startsWith('begriffe_')), [], s.text)
    if (s.truth === 'F') assert.ok(s.manipulationType, s.text)
  }
  for (let u = 2; u <= 9; u++) {
    const mine = PACK.statements.filter((s) => s.unit === u)
    assert.equal(mine.filter((s) => s.truth === 'R').length, 10, `UE ${u}`)
  }
})

test('RDA Paket 1: jedes Zitat da, keine Hinweise, F mit Verfälschungstyp, UE 1–13', async () => {
  const { PACK, SUBJECT } = await import('../data/seed/rda-paket-1.ts')
  assert.equal(PACK.subject, 'rda')
  assert.equal(SUBJECT.shortName, 'RDA')
  assert.equal(SUBJECT.slidesPattern?.split('|').length, 9)
  assert.equal(PACK.statements.length, 315)
  for (const s of PACK.statements) {
    assert.deepEqual(s.flags, [], s.text)
    assert.ok(s.quote.length >= 8, s.text)
    assert.match(s.sourceRef, /^(ZM S\.\d+|VL\d p\.\d+)$/, s.text)
    assert.deepEqual(checkStatement({ text: s.text, truth: s.truth, quote: s.quote, manipulationType: s.manipulationType }).flags.filter((f) => !f.startsWith('begriffe_')), [], s.text)
    if (s.truth === 'F') assert.ok(s.manipulationType && s.reason, s.text)
    assert.ok(s.topic && /^(zu|zum|zur) /.test(s.topic), s.text)
  }
  for (let u = 1; u <= 13; u++) {
    const mine = PACK.statements.filter((s) => s.unit === u)
    assert.ok(mine.length >= 20, `UE ${u}`)
    assert.ok(mine.filter((s) => s.truth === 'F').length >= 7, `UE ${u}`)
    assert.ok(PACK.unitTitles[u], `UE ${u}`)
  }
})
