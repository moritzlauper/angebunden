'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { COOKIE, authEnabled, isValidSession, safeEqual, sessionToken } from '@/lib/auth.ts'
import { getDb } from '@/lib/db/index.ts'
import { LETTERS, type Letter } from '@/lib/core/text.ts'
import * as svc from '@/lib/service.ts'

async function guard() {
  if (!(await isValidSession((await cookies()).get(COOKIE)?.value))) redirect('/login')
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k)
  return typeof v === 'string' ? v.trim() : ''
}
const num = (fd: FormData, k: string) => Number(str(fd, k))

export async function login(fd: FormData) {
  const next = str(fd, 'next') || '/'
  if (!authEnabled() || safeEqual(str(fd, 'password'), process.env.APP_PASSWORD ?? '')) {
    ;(await cookies()).set(COOKIE, await sessionToken(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 180,
      path: '/',
    })
    redirect(next.startsWith('/') ? next : '/')
  }
  redirect(`/login?fehler=1&next=${encodeURIComponent(next)}`)
}

export async function logout() {
  ;(await cookies()).delete(COOKIE)
  redirect('/login')
}

/** Person aus dem Formular, auf die gültige Kurzform gebracht. Ohne Angabe: der Besitzer. */
function userOf(fd: FormData): string {
  return svc.learnerSlug(str(fd, 'user')) ?? svc.OWNER
}

/** Pfad /<fach>/<person> zu einer Fach-ID. */
async function basePath(subjectId: number, user: string): Promise<string> {
  const subj = await svc.resolveSubject(await getDb(), subjectId)
  return `/${subj.slug}/${user}`
}

/** Fach-Einstellungen und UEs ändert nur der Besitzer der Unterlagen. */
function ownerOnly(fd: FormData) {
  if (userOf(fd) !== svc.OWNER) throw new Error('Nur der Besitzer der Unterlagen kann das ändern.')
}

/** /klibio: Name eingeben → /klibio/<name> */
export async function enterName(fd: FormData) {
  const subject = svc.learnerSlug(str(fd, 'subject')) ?? ''
  const name = svc.learnerSlug(str(fd, 'name'))
  if (!name) redirect(`/${subject}?fehler=1`)
  redirect(`/${subject}/${name}`)
}

export async function startSession(fd: FormData) {
  await guard()
  const db = await getDb()
  const subjectId = num(fd, 'subjectId')
  const user = userOf(fd)
  const base = await basePath(subjectId, user)
  // Die Auswahl «bis UE n» neben dem Start-Knopf gilt ab jetzt als persönliche Grenze.
  const ueLimit = num(fd, 'ueLimit')
  if (Number.isInteger(ueLimit) && ueLimit > 0) await svc.setLearnerUeLimit(db, user, subjectId, ueLimit)
  let id: number
  try {
    const view = await svc.startSession(db, subjectId, {
      channel: 'web',
      user,
      examMode: str(fd, 'examMode') === '1' ? true : undefined,
    })
    id = view.session.id
  } catch (e) {
    if (e instanceof svc.AppError) redirect(`${base}?fehler=${encodeURIComponent(e.message)}`)
    throw e
  }
  redirect(`${base}/ueben/${id}`)
}

export async function answer(fd: FormData) {
  await guard()
  const marked = fd.getAll('marked').filter((v): v is Letter => typeof v === 'string' && (LETTERS as readonly string[]).includes(v))
  const db = await getDb()
  const r = await svc.answerQuestion(db, num(fd, 'questionId'), marked, { guessed: str(fd, 'guessed') === '1' })
  const view = await svc.getSessionView(db, r.sessionId)
  redirect(`/${view.subject.slug}/${view.session.userId}/ueben/${r.sessionId}?q=${num(fd, 'questionId')}`)
}

export async function reportError(fd: FormData) {
  await guard()
  await svc.reportError(await getDb(), num(fd, 'statementId'), str(fd, 'comment') || null, userOf(fd))
  const back = str(fd, 'back')
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/')
}

export async function updateSubject(fd: FormData) {
  await guard()
  ownerOnly(fd)
  const id = num(fd, 'subjectId')
  await svc.updateSubject(await getDb(), id, {
    ueLimit: num(fd, 'ueLimit'),
    examDate: str(fd, 'examDate') || null,
    examMode: str(fd, 'examMode') === '1',
    questionsPerSession: num(fd, 'questionsPerSession') || 5,
    autoApprove: str(fd, 'autoApprove') === '1',
    dozent: str(fd, 'dozent') || null,
    vaultName: str(fd, 'vaultName') || null,
    vaultPath: str(fd, 'vaultPath') || null,
    slidesPattern: str(fd, 'slidesPattern') || null,
    zmPath: str(fd, 'zmPath') || null,
  })
  const base = await basePath(id, svc.OWNER)
  revalidatePath(base, 'layout')
  redirect(`${base}/stand?gespeichert=1#einstellungen`)
}

export async function saveUnit(fd: FormData) {
  await guard()
  ownerOnly(fd)
  const id = num(fd, 'subjectId')
  const number = num(fd, 'number')
  const title = str(fd, 'title')
  if (Number.isInteger(number) && number > 0 && title) await svc.upsertUnit(await getDb(), id, number, title)
  const base = await basePath(id, svc.OWNER)
  revalidatePath(base, 'layout')
  redirect(`${base}/stand?gespeichert=1#einstellungen`)
}

/** Neue Aussagen mit Claude erzeugen, für eine UE oder alle bis zur Grenze. Nur der Besitzer. */
export async function generateQuestions(fd: FormData) {
  await guard()
  ownerOnly(fd)
  const db = await getDb()
  const subjectId = num(fd, 'subjectId')
  const count = Math.min(20, Math.max(3, num(fd, 'count') || 10))
  const which = str(fd, 'unit')
  const ov = await svc.subjectOverview(db, subjectId)
  const units = which === 'alle' ? ov.units.filter((u) => u.chunks > 0).map((u) => u.number) : [Number(which)].filter((n) => ov.units.some((u) => u.number === n))
  const { generateForUnits } = await import('@/lib/generate.ts')
  const results = await generateForUnits(db, subjectId, units, count)
  const summary = results
    .map((r) => (r.error ? `UE ${r.unit}: ${r.error}` : `UE ${r.unit}: ${r.approved} freigegeben${r.inbox ? `, ${r.inbox} in der Inbox` : ''}`))
    .join(' · ')
  const base = await basePath(subjectId, svc.OWNER)
  revalidatePath(base, 'layout')
  redirect(`${base}/stand?generiert=${encodeURIComponent(summary || 'keine UE mit Notes')}#generieren`)
}

export async function review(fd: FormData) {
  await guard()
  const action = str(fd, 'action') as svc.ReviewAction
  const truth = str(fd, 'truth')
  await svc.reviewStatement(await getDb(), num(fd, 'statementId'), action, {
    text: fd.has('text') ? str(fd, 'text') : undefined,
    truth: truth === 'R' || truth === 'F' ? truth : undefined,
    reason: fd.has('reason') ? str(fd, 'reason') || null : undefined,
    sourceRef: fd.has('sourceRef') ? str(fd, 'sourceRef') || null : undefined,
  })
  revalidatePath('/inbox')
  redirect(str(fd, 'back') || '/inbox')
}

export async function importBank(fd: FormData) {
  await guard()
  const r = await svc.importBank(await getDb(), num(fd, 'subjectId'), str(fd, 'markdown'), str(fd, 'status') === 'inbox' ? 'inbox' : 'active')
  redirect(`/verbinden?importiert=${r.added}&uebersprungen=${r.skipped}`)
}

export async function createSubject(fd: FormData) {
  await guard()
  const subj = await svc.createSubject(await getDb(), {
    name: str(fd, 'name'),
    shortName: str(fd, 'shortName') || null,
    dozent: str(fd, 'dozent') || null,
    vaultPath: str(fd, 'vaultPath') || null,
    ueLimit: num(fd, 'ueLimit') || 1,
  })
  redirect(`/${subj.slug}/${svc.OWNER}/stand`)
}
