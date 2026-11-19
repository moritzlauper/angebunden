import { asc } from 'drizzle-orm'
import Link from 'next/link'
import * as s from '@/lib/db/schema.ts'
import { learnerContext } from '@/lib/learner.ts'

export const dynamic = 'force-dynamic'

/** Fach wechseln, der Name bleibt: /<fach>/<name>/wechseln → /<anderes-fach>/<name>. */
export default async function Wechseln({ params }: PageProps<'/[subject]/[user]/wechseln'>) {
  const { db, subj, user } = await learnerContext(params, '/wechseln')
  const subjects = await db.select().from(s.subject).orderBy(asc(s.subject.id))
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Fach wechseln</h1>
      <ul className="space-y-2">
        {subjects.map((x) => (
          <li key={x.id}>
            <Link
              className={`card block p-4 ${x.id === subj.id ? 'opacity-60' : ''}`}
              href={`/${x.slug}/${user}`}
              aria-current={x.id === subj.id ? 'page' : undefined}
            >
              <span className="font-semibold">{x.name}</span>
              {x.dozent ? <span className="muted block text-sm">{x.dozent}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      <p className="muted text-sm">
        Nicht {user}?{' '}
        <Link className="link" href={`/${subj.slug}`}>
          Anderen Namen eingeben
        </Link>
      </p>
    </div>
  )
}
