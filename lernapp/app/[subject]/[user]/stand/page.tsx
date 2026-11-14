import { learnerContext } from '@/lib/learner.ts'
import { history, listSources, listStatements, subjectOverview } from '@/lib/service.ts'
import { generateQuestions, saveUnit, updateSubject } from '../../../actions.ts'
import { PendingButton } from '../../../pending-button.tsx'
import { Progress, UeOptions } from '../../../ui.tsx'

export const dynamic = 'force-dynamic'

/** Details: Stand pro UE, schwache Aussagen, Verlauf. Einstellungen und Quellen nur für den Besitzer. */
export default async function Stand({ params, searchParams }: PageProps<'/[subject]/[user]/stand'>) {
  const { db, subj, user, isOwner } = await learnerContext(params, '/stand')
  const id = subj.id
  const sp = await searchParams
  const ov = await subjectOverview(db, id, new Date(), user)
  const [sources, hist, statements] = await Promise.all([
    isOwner ? listSources(db, id) : [],
    history(db, id, 30, user),
    isOwner ? listStatements(db, id, { limit: 500 }) : [],
  ])
  const s = ov.subject
  const byDay = new Map<string, { answers: number; correct: number }>()
  for (const h of hist) {
    const d = byDay.get(h.day) ?? { answers: 0, correct: 0 }
    d.answers += h.answers
    d.correct += h.correct
    byDay.set(h.day, d)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{s.name}</h1>
        <p className="muted text-sm">{[s.courseCode, s.dozent, s.vaultPath].filter(Boolean).join(' · ')}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">UEs</h2>
        <ul className="space-y-3">
          {ov.units.map((u) => (
            <li key={u.id} className={`card space-y-2 p-4 ${u.inLimit ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">
                  UE {u.number}: {u.title}
                </h3>
                <span className="muted text-sm">
                  {u.total} aktiv · {u.due} fällig · {u.new} neu
                  {u.inbox ? ` · ${u.inbox} in der Inbox` : ''}
                  {u.accuracy != null ? ` · Trefferquote ${u.accuracy} %` : ''}
                </span>
              </div>
              <Progress safe={u.safe} seen={u.seen} total={u.total} />
              <details className="text-sm">
                <summary className="muted cursor-pointer">
                  Abdeckung: Fundstelle × Aussagen
                  {u.chunks ? `, ${u.chunks} Textstücke` : ''}
                </summary>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {u.coverage.map(([ref, n]) => (
                    <li key={ref} className="rounded px-2 py-0.5" style={{ background: 'var(--bg)' }}>
                      {ref}: <b>{n}</b>
                    </li>
                  ))}
                </ul>
                {u.uncoveredChunks.length ? (
                  <p className="mt-2">
                    <span className="muted">Ohne Aussage:</span> {u.uncoveredChunks.join(' · ')}
                  </p>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Schwache Aussagen</h2>
        {ov.weak.length === 0 ? <p className="muted text-sm">Noch keine falschen Antworten.</p> : null}
        <ul className="space-y-2 text-sm">
          {ov.weak.map((w) => (
            <li key={w.id} className="card p-3">
              <p>
                <span className="muted">UE {w.unitNumber} ·</span> {w.text}
              </p>
              <p className="muted">
                {w.truth === 'R' ? 'richtig' : 'falsch'}
                {w.reason ? `, ${w.reason}` : ''}
                {w.sourceRef ? ` (${w.sourceRef})` : ''} · {w.wrong} von {w.answers} falsch · p = {w.p}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {byDay.size ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Trefferquote pro Tag</h2>
          <table className="w-full text-sm">
            <tbody>
              {[...byDay.entries()].map(([day, d]) => (
                <tr key={day} className="border-b" style={{ borderColor: 'var(--line)' }}>
                  <td className="py-1">{day}</td>
                  <td className="py-1 text-right">{d.answers} Aussagen</td>
                  <td className="py-1 text-right font-semibold">{Math.round((d.correct / d.answers) * 100)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {isOwner ? (
        <>
          <section id="generieren" className="scroll-mt-4 space-y-3">
            <h2 className="text-lg font-semibold">Neue Fragen generieren</h2>
            <p className="muted text-sm">
              Claude schreibt aus deinen Notes neue Aussagen mit wörtlichem Beleg. Eine zweite, blinde Prüfung entscheidet nur aus dem Zitat. Einwandfreie
              Aussagen sind sofort für alle zum Üben da, unsichere landen in der Inbox.
            </p>
            {typeof sp.generiert === 'string' ? <p className="card p-3 text-sm">{sp.generiert}</p> : null}
            <form action={generateQuestions} className="card flex flex-wrap items-end gap-3 p-4 text-sm">
              <input type="hidden" name="subjectId" value={s.id} />
              <input type="hidden" name="user" value={user} />
              <label className="space-y-1">
                <span>UE</span>
                <select name="unit" defaultValue="alle" className="!w-auto">
                  <option value="alle">alle UEs mit Notes</option>
                  {ov.units
                    .filter((u) => u.chunks > 0)
                    .map((u) => (
                      <option key={u.id} value={u.number}>
                        UE {u.number} {u.title} ({u.total} Aussagen)
                      </option>
                    ))}
                </select>
              </label>
              <label className="w-28 space-y-1">
                <span>pro UE</span>
                <input type="number" name="count" min={3} max={20} defaultValue={10} />
              </label>
              <PendingButton pendingText="Claude schreibt … (1–3 Min.)">Generieren</PendingButton>
            </form>
          </section>

          <section id="einstellungen" className="scroll-mt-4 space-y-3">
            <h2 className="text-lg font-semibold">Einstellungen</h2>
            {sp.gespeichert ? <p className="text-sm text-ok">Gespeichert.</p> : null}
            <form action={updateSubject} className="card grid gap-3 p-4 text-sm sm:grid-cols-2">
              <input type="hidden" name="subjectId" value={s.id} />
              <input type="hidden" name="user" value={user} />
              <label className="space-y-1">
                <span>Abfragen bis</span>
                <select name="ueLimit" defaultValue={s.ueLimit}>
                  <UeOptions units={ov.units} ueLimit={s.ueLimit} />
                </select>
              </label>
              <label className="space-y-1">
                <span>Prüfungsdatum</span>
                <input type="date" name="examDate" defaultValue={s.examDate ?? ''} />
              </label>
              <label className="space-y-1">
                <span>Fragen pro Session</span>
                <input type="number" name="questionsPerSession" min={1} max={20} defaultValue={s.questionsPerSession} />
              </label>
              <label className="space-y-1">
                <span>Dozent</span>
                <input type="text" name="dozent" defaultValue={s.dozent ?? ''} />
              </label>
              <label className="space-y-1">
                <span>Obsidian-Vault (Name, für Links)</span>
                <input type="text" name="vaultName" defaultValue={s.vaultName ?? ''} placeholder="z. B. obsidian" />
              </label>
              <label className="space-y-1">
                <span>Ordner im Vault</span>
                <input type="text" name="vaultPath" defaultValue={s.vaultPath ?? ''} />
              </label>
              <label className="space-y-1">
                <span>Folien ({'{n}'} = Vorlesung)</span>
                <input type="text" name="slidesPattern" defaultValue={s.slidesPattern ?? ''} />
              </label>
              <label className="space-y-1">
                <span>Zusammenfassung (ZM)</span>
                <input type="text" name="zmPath" defaultValue={s.zmPath ?? ''} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="examMode" value="1" defaultChecked={s.examMode} /> Prüfungsmodus (alles bis zur Grenze, nach Schwäche)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="autoApprove" value="1" defaultChecked={s.autoApprove} /> Ohne Freigabe aktiv, wenn Prüfer zustimmt
              </label>
              <div className="sm:col-span-2">
                <button className="btn">Speichern</button>
              </div>
            </form>

            <form action={saveUnit} className="card flex flex-wrap items-end gap-3 p-4 text-sm">
              <input type="hidden" name="subjectId" value={s.id} />
              <input type="hidden" name="user" value={user} />
              <label className="w-20 space-y-1">
                <span>UE</span>
                <input type="number" name="number" min={1} max={30} required defaultValue={Math.max(0, ...ov.units.map((u) => u.number)) + 1} />
              </label>
              <label className="min-w-40 flex-1 space-y-1">
                <span>Titel</span>
                <input type="text" name="title" required placeholder="z. B. Sexualität" />
              </label>
              <button className="btn-quiet">UE anlegen oder umbenennen</button>
            </form>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Quellen</h2>
            {sources.length === 0 ? (
              <p className="muted text-sm">Noch keine. Claude spielt Notes und Folien mit sync_source ein.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {sources.map((q) => (
                  <li key={q.id}>
                    <b>{q.kind}</b> {q.path}{' '}
                    <span className="muted">
                      · {q.chunks} Textstücke · {new Date(q.syncedAt).toLocaleString('de-CH')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <details>
              <summary className="cursor-pointer text-lg font-semibold">Alle Aussagen ({statements.length})</summary>
              <ul className="mt-3 space-y-1 text-sm">
                {statements.map((x) => (
                  <li key={x.id} className={x.status === 'active' ? '' : 'muted'}>
                    <span className="font-mono">[{x.truth}]</span> UE {x.unitNumber} · {x.text}
                    <span className="muted">
                      {' '}
                      {x.sourceRef ? `(${x.sourceRef})` : ''} {x.status !== 'active' ? `· ${x.status}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </>
      ) : null}
    </div>
  )
}
