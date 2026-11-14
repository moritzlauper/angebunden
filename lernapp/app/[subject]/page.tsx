import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db/index.ts'
import { AppError, resolveSubject } from '@/lib/service.ts'
import { enterName } from '../actions.ts'

export const dynamic = 'force-dynamic'

/** /klibio: Name eingeben, dann geht es auf die eigene Seite /klibio/<name>. */
export default async function NameEingeben({ params, searchParams }: PageProps<'/[subject]'>) {
  const p = await params
  const sp = await searchParams
  const subj = await resolveSubject(await getDb(), decodeURIComponent(p.subject)).catch((e) => {
    if (e instanceof AppError) notFound()
    throw e
  })
  return (
    <div className="mx-auto max-w-sm space-y-5 pt-10">
      <div>
        <h1 className="text-2xl font-bold">{subj.name}</h1>
        <p className="muted text-sm">Klickerfragen mit eigenem Lernstand. Gib deinen Namen ein, die Adresse kannst du dir merken.</p>
      </div>
      {sp.fehler ? <p className="text-sm text-bad">Der Name braucht mindestens zwei Buchstaben oder Ziffern.</p> : null}
      <form action={enterName} className="space-y-3">
        <input type="hidden" name="subject" value={subj.slug} />
        <input type="text" name="name" placeholder="Dein Name" autoFocus required autoComplete="given-name" />
        <button className="btn w-full justify-center">Los</button>
      </form>
    </div>
  )
}
