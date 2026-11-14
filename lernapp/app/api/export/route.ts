import { cookies } from 'next/headers'
import { COOKIE, isValidSession } from '@/lib/auth.ts'
import { getDb } from '@/lib/db/index.ts'
import { exportMarkdown, resolveSubject } from '@/lib/service.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** /api/export?subject=KliBio&session=12 oder &date=2026-11-14 → Markdown für den Exercises-Ordner */
export async function GET(req: Request) {
  if (!(await isValidSession((await cookies()).get(COOKIE)?.value))) return new Response('Unauthorized', { status: 401 })
  const url = new URL(req.url)
  const db = await getDb()
  const subj = await resolveSubject(db, url.searchParams.get('subject') ?? '')
  const session = url.searchParams.get('session')
  const { markdown } = await exportMarkdown(db, subj.id, {
    sessionId: session ? Number(session) : undefined,
    date: url.searchParams.get('date') ?? undefined,
  })
  const name = `Klickerfragen_${subj.shortName ?? subj.slug}.md`
  return new Response(markdown || '(keine Fragen)\n', {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `inline; filename="${name}"` },
  })
}
