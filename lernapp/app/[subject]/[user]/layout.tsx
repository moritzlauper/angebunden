import { asc } from 'drizzle-orm'
import Link from 'next/link'
import * as s from '@/lib/db/schema.ts'
import { learnerContext } from '@/lib/learner.ts'
import { TopBar } from '../../topbar.tsx'

/** Kopfzeile der persönlichen Seite: wer lernt, Fächer zum direkten Wechseln (Name bleibt), Verwaltung für den Besitzer. */
export default async function LernerLayout({ children, params }: LayoutProps<'/[subject]/[user]'>) {
  const { db, subj, user, base, isOwner } = await learnerContext(params)
  const subjects = await db.select().from(s.subject).orderBy(asc(s.subject.id))
  return (
    <>
      <TopBar brand={user} brandHref={base}>
        {subjects.map((x) =>
          x.id === subj.id ? (
            <Link key={x.id} href={base} aria-current="page" className="btn-quiet">
              {x.shortName ?? x.name}
            </Link>
          ) : (
            <Link key={x.id} href={`/${x.slug}/${user}`} className="btn-quiet">
              {x.shortName ?? x.name}
            </Link>
          ),
        )}
        <Link href={`${base}/stand`}>Details</Link>
        {isOwner ? <Link href="/inbox">Inbox</Link> : null}
        <Link href={`/${subj.slug}`} className="muted ml-auto">
          Anderer Name
        </Link>
      </TopBar>
      <main className="mx-auto max-w-3xl px-4 py-4 sm:py-6">{children}</main>
    </>
  )
}
