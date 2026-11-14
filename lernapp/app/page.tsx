import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/index.ts'
import { listSubjects } from '@/lib/service.ts'

export const dynamic = 'force-dynamic'

/** Startseite: bei einem Fach direkt zur Namenseingabe, sonst Auswahl. */
export default async function Start() {
  const subjects = await listSubjects(await getDb())
  if (subjects.length === 1) redirect(`/${subjects[0].slug}`)
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Fächer</h1>
      {subjects.length === 0 ? (
        <p className="muted">
          Noch kein Fach. Lege eines unter <Link className="link" href="/verbinden">Claude &amp; Import</Link> an.
        </p>
      ) : (
        <ul className="space-y-2">
          {subjects.map((s) => (
            <li key={s.id}>
              <Link className="card block p-4 font-semibold" href={`/${s.slug}`}>
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
