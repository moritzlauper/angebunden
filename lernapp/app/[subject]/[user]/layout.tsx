import Link from 'next/link'
import { learnerContext } from '@/lib/learner.ts'

/** Kopfzeile der persönlichen Seite: wer lernt, und für den Besitzer die Verwaltung. */
export default async function LernerLayout({ children, params }: LayoutProps<'/[subject]/[user]'>) {
  const { subj, user, base, isOwner } = await learnerContext(params)
  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-4 text-sm">
        <Link href={base} className="font-semibold">
          {subj.shortName ?? subj.name} · {user}
        </Link>
        <Link href={`${base}/stand`}>Details</Link>
        {isOwner ? (
          <>
            <Link href="/inbox">Inbox</Link>
            <Link href="/verbinden">Claude &amp; Import</Link>
          </>
        ) : null}
        <Link href={`/${subj.slug}`} className="muted ml-auto">
          Andere Person
        </Link>
      </nav>
      {children}
    </div>
  )
}
