import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { getDb } from './db/index.ts'
import { AppError, learnerSlug, OWNER, resolveSubject } from './service.ts'

/**
 * Fach und Person aus der URL /<fach>/<name>. Unbekanntes Fach → 404,
 * Name in anderer Schreibweise («David») → Weiterleitung auf die Kurzform («david»).
 */
export async function learnerContext(params: Promise<{ subject: string; user: string }>, rest = '') {
  const p = await params
  const db = await getDb()
  const subj = await resolveSubject(db, decodeURIComponent(p.subject)).catch((e) => {
    if (e instanceof AppError) notFound()
    throw e
  })
  const raw = decodeURIComponent(p.user)
  const user = learnerSlug(raw)
  if (!user) notFound()
  if (user !== raw || subj.slug !== p.subject) redirect(`/${subj.slug}/${user}${rest}`)
  return { db, subj, user, base: `/${subj.slug}/${user}`, isOwner: user === OWNER }
}
