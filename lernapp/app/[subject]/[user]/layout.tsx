import Link from 'next/link'
import { learnerContext } from '@/lib/learner.ts'
import { TopBar } from '../../topbar.tsx'

/** Kopfzeile der persönlichen Seite: wer lernt, und für den Besitzer die Verwaltung. */
export default async function LernerLayout({ children, params }: LayoutProps<'/[subject]/[user]'>) {
  const { subj, user, base, isOwner } = await learnerContext(params)
  return (
    <>
      <TopBar brand={`${subj.shortName ?? subj.name} · ${user}`} brandHref={base}>
        <Link href={`${base}/stand`}>Details</Link>
        {isOwner ? (
          <>
            <Link href="/inbox">Inbox</Link>
            <Link href="/verbinden">Claude &amp; Import</Link>
          </>
        ) : null}
        <Link href={`/${subj.slug}`} className="muted ml-auto">
          Wechseln
        </Link>
      </TopBar>
      <main className="mx-auto max-w-3xl px-4 py-4 sm:py-6">{children}</main>
    </>
  )
}
