import Link from 'next/link'
import { learnerContext } from '@/lib/learner.ts'
import { listSubjects, subjectOverview } from '@/lib/service.ts'
import { startSession } from '../../actions.ts'
import { Progress, UeOptions } from '../../ui.tsx'

export const dynamic = 'force-dynamic'

export default async function Lernen({ params, searchParams }: PageProps<'/[subject]/[user]'>) {
  const { db, subj, user, base } = await learnerContext(params)
  const sp = await searchParams
  const s = (await listSubjects(db, new Date(), user)).find((x) => x.id === subj.id)!
  const us = (await subjectOverview(db, subj.id, new Date(), user)).units
  const inLimit = us.filter((u) => u.inLimit)

  return (
    <div className="space-y-6">
      {typeof sp.fehler === 'string' ? <p className="card border-bad p-3 text-sm text-bad">{sp.fehler}</p> : null}
      <section className="card space-y-4 p-5">
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

        <div className="flex flex-wrap items-center gap-3">
          <form action={startSession} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="subjectId" value={s.id} />
            <input type="hidden" name="user" value={user} />
            <button className="btn">{s.questionsPerSession} Fragen</button>
            <label htmlFor="ue-limit">bis</label>
            <select id="ue-limit" name="ueLimit" defaultValue={s.ueLimit} className="!w-auto">
              <UeOptions units={us} ueLimit={s.ueLimit} />
            </select>
          </form>
          <Link href={`${base}/stand`} className="muted ml-auto text-sm underline underline-offset-2">
            Details
          </Link>
        </div>

        <div className="space-y-3">
          <Progress safe={s.counts.safe} seen={s.counts.seen} total={s.counts.inLimit} label={`Stand bis UE ${s.ueLimit}`} />
          {inLimit.length > 1 ? (
            <ul className="space-y-1 text-sm">
              {inLimit.map((u) => (
                <li key={u.id} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3">
                  <span className="truncate" title={u.title}>
                    UE {u.number} {u.title !== `UE ${u.number}` ? u.title : ''}
                  </span>
                  <div className="bar" title={`${u.safe} von ${u.total} sicher · ${u.seen} gesehen`}>
                    <span style={{ width: `${u.total ? (u.safe / u.total) * 100 : 0}%` }} />
                    <span className="seen" style={{ width: `${u.total ? ((u.seen - u.safe) / u.total) * 100 : 0}%` }} />
                  </div>
                  <span className="muted text-right text-xs">{u.total ? `${u.safePct}%` : 'leer'}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="muted text-xs">Sicher heisst: Du weisst es voraussichtlich auch in drei Wochen noch. Hell = schon gesehen, aber noch nicht gefestigt.</p>
        </div>
      </section>
    </div>
  )
}
