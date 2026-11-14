import Link from 'next/link'
import { getDb } from '@/lib/db/index.ts'
import { listSubjects, subjectOverview } from '@/lib/service.ts'
import { setUeLimit, startSession } from './actions.ts'

export const dynamic = 'force-dynamic'

export default async function Heute({ searchParams }: PageProps<'/'>) {
  const sp = await searchParams
  const db = await getDb()
  const subjects = await listSubjects(db)
  const units = new Map(await Promise.all(subjects.map(async (s) => [s.id, (await subjectOverview(db, s.id)).units] as const)))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Heute</h1>
      {typeof sp.fehler === 'string' ? <p className="card border-bad p-3 text-sm text-bad">{sp.fehler}</p> : null}
      {subjects.length === 0 ? (
        <p className="muted">
          Noch kein Fach. Lege eines unter <Link className="link" href="/verbinden">Claude &amp; Import</Link> an oder lass Claude es anlegen.
        </p>
      ) : null}
      {subjects.map((s) => {
        const us = units.get(s.id) ?? []
        return (
          <section key={s.id} className="card space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">
                  <Link href={`/fach/${s.id}`}>{s.name}</Link>
                </h2>
                <p className="muted text-sm">
                  {[s.courseCode, s.dozent].filter(Boolean).join(' · ')}
                  {s.daysToExam != null ? ` · Prüfung in ${s.daysToExam} Tagen` : ''}
                  {s.examMode ? ' · Prüfungsmodus' : ''}
                </p>
              </div>
              <p className="text-sm">{s.streak > 0 ? `🔥 ${s.streak} ${s.streak === 1 ? 'Tag' : 'Tage'} in Folge` : 'Heute noch nicht geübt'}</p>
            </div>

            <dl className="grid grid-cols-4 gap-2 text-center">
              {[
                ['fällig', s.counts.due],
                ['neu', s.counts.new],
                ['sicher', s.counts.safe],
                ['Inbox', s.counts.inbox],
              ].map(([label, n]) => (
                <div key={label as string} className="rounded-lg p-2" style={{ background: 'var(--bg)' }}>
                  <dt className="muted text-xs">{label}</dt>
                  <dd className="text-xl font-bold">{n}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-3">
              <form action={startSession}>
                <input type="hidden" name="subjectId" value={s.id} />
                <button className="btn">{s.questionsPerSession} Fragen</button>
              </form>
              <form action={setUeLimit} className="flex items-center gap-2 text-sm">
                <input type="hidden" name="subjectId" value={s.id} />
                <input type="hidden" name="back" value="/" />
                <label htmlFor={`ue-${s.id}`}>bis</label>
                <select id={`ue-${s.id}`} name="ueLimit" defaultValue={s.ueLimit} className="!w-auto">
                  {us.map((u) => (
                    <option key={u.id} value={u.number}>
                      UE {u.number} {u.title}
                    </option>
                  ))}
                </select>
                <button className="btn-quiet">setzen</button>
              </form>
            </div>
          </section>
        )
      })}
    </div>
  )
}
