import { learnerContext } from '@/lib/learner.ts'
import { listSubjects, subjectOverview } from '@/lib/service.ts'
import { startSession } from '../../actions.ts'
import { Progress, UeOptions } from '../../ui.tsx'

export const dynamic = 'force-dynamic'

export default async function Lernen({ params, searchParams }: PageProps<'/[subject]/[user]'>) {
  const { db, subj, user } = await learnerContext(params)
  const sp = await searchParams
  const s = (await listSubjects(db, new Date(), user)).find((x) => x.id === subj.id)!
  const us = (await subjectOverview(db, subj.id, new Date(), user)).units
  const inLimit = us.filter((u) => u.inLimit)
  const answers = inLimit.reduce((n, u) => n + u.answers, 0)
  const accuracy = answers ? Math.round((inLimit.reduce((n, u) => n + u.correct, 0) / answers) * 100) : null

  return (
    <div className="space-y-6">
      {typeof sp.fehler === 'string' ? <p className="card border-bad p-3 text-sm text-bad">{sp.fehler}</p> : null}
      <section className="card space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{s.name}</h1>
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
            ['gesehen', s.counts.seen],
          ].map(([label, n]) => (
            <div key={label as string} className="rounded-lg p-2" style={{ background: 'var(--bg)' }}>
              <dt className="muted text-xs">{label}</dt>
              <dd className="text-xl font-bold">{n}</dd>
            </div>
          ))}
        </dl>

        <form action={startSession} className="flex items-center gap-2 text-sm">
          <input type="hidden" name="subjectId" value={s.id} />
          <input type="hidden" name="user" value={user} />
          <button className="btn shrink-0">{s.questionsPerSession} Fragen</button>
          <label htmlFor="ue-limit" className="shrink-0">
            bis
          </label>
          <select id="ue-limit" name="ueLimit" defaultValue={s.ueLimit} className="min-w-0 flex-1 sm:max-w-xs">
            <UeOptions units={us} ueLimit={s.ueLimit} />
          </select>
        </form>

        <div className="space-y-3">
          <Progress
            safe={s.counts.safe}
            seen={s.counts.seen}
            total={s.counts.inLimit}
            label={`Stand bis UE ${s.ueLimit}${accuracy != null ? ` · ${accuracy}% richtig beantwortet` : ''}`}
          />
          {inLimit.length > 1 ? (
            <ul className="space-y-2 text-sm sm:space-y-1">
              {inLimit.map((u) => (
                // Handy: Name und Quote oben, Balken darunter in voller Breite. Ab sm: alles in einer Zeile.
                <li key={u.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,10rem)_1fr_5rem]">
                  <span className="truncate" title={u.title}>
                    UE {u.number} {u.title !== `UE ${u.number}` ? u.title : ''}
                  </span>
                  <div className="bar order-last col-span-2 sm:order-none sm:col-span-1" title={`${u.safe} von ${u.total} sicher · ${u.seen} gesehen`}>
                    <span style={{ width: `${u.total ? (u.safe / u.total) * 100 : 0}%` }} />
                    <span className="seen" style={{ width: `${u.total ? ((u.seen - u.safe) / u.total) * 100 : 0}%` }} />
                  </div>
                  <span className="muted text-right text-xs" title="Anteil richtig beantworteter Aussagen">
                    {!u.total ? 'leer' : u.accuracy != null ? `${u.accuracy}% richtig` : 'neu'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <details className="muted text-xs">
            <summary className="cursor-pointer">Was heisst «sicher»?</summary>
            <p className="mt-1">
              Hell = schon gesehen, dunkel = sicher. Sicher wird eine Aussage erst, wenn du sie an mehreren Tagen richtig beantwortet hast und sie erst in über drei
              Wochen wiederkommt. Am ersten Tag steht darum überall 0% sicher, die Trefferquote rechts zeigt, wie gut es schon klappt.
            </p>
          </details>
        </div>
      </section>
    </div>
  )
}
