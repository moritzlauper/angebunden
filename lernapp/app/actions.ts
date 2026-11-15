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

export async function startSession(fd: FormData) {
  await guard()
  const db = await getDb()
  let id: number
  try {
    const view = await svc.startSession(db, num(fd, 'subjectId'), {
      channel: 'web',
      examMode: str(fd, 'examMode') === '1' ? true : undefined,
    })
    id = view.session.id
  } catch (e) {
    if (e instanceof svc.AppError) redirect(`/?fehler=${encodeURIComponent(e.message)}`)
    throw e
  }
  redirect(`/ueben/${id}`)
}

export async function answer(fd: FormData) {
  await guard()
  const marked = fd.getAll('marked').filter((v): v is Letter => typeof v === 'string' && (LETTERS as readonly string[]).includes(v))
  const r = await svc.answerQuestion(await getDb(), num(fd, 'questionId'), marked, { guessed: str(fd, 'guessed') === '1' })
  redirect(`/ueben/${r.sessionId}?q=${num(fd, 'questionId')}`)
}

export async function reportError(fd: FormData) {
  await guard()
  await svc.reportError(await getDb(), num(fd, 'statementId'), str(fd, 'comment') || null)
  const back = str(fd, 'back')
  redirect(back.startsWith('/') ? back : '/')
}

export async function updateSubject(fd: FormData) {
  await guard()
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
  revalidatePath(`/fach/${id}`)
  redirect(`/fach/${id}?gespeichert=1`)
}

export async function setUeLimit(fd: FormData) {
  await guard()
  await svc.updateSubject(await getDb(), num(fd, 'subjectId'), { ueLimit: num(fd, 'ueLimit') })
  revalidatePath('/')
  redirect(str(fd, 'back') || '/')
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
  redirect(`/fach/${subj.id}`)
}

export async function uploadNotes(fd: FormData) {
  await guard()
  const file = fd.get('file')
  const pasted = str(fd, 'content')
  const content = file instanceof File && file.size > 0 ? await file.text() : pasted
  const subjectId = num(fd, 'subjectId')
  if (!content) redirect(`/verbinden?fehler=${encodeURIComponent('Keine Datei und kein Text.')}#notes`)
  let msg: string
  try {
    const path = file instanceof File && file.name ? file.name : 'Notes.md'
    const r = await svc.syncSource(await getDb(), subjectId, { kind: 'notes', path, content })
    const changed = r.units.filter((u) => u.changed)
    msg = changed.length
      ? `Eingespielt: ${changed.map((u) => `UE ${u.unit} (${u.chunks} Textstücke)`).join(', ')}.`
      : 'Keine Änderungen seit dem letzten Hochladen.'
    const flagged = changed.reduce((a, u) => a + (u.flagged ?? 0), 0)
    if (flagged) msg += ` ${flagged} Aussagen auf «neu prüfen» gesetzt.`
  } catch (e) {
    if (e instanceof svc.AppError) redirect(`/verbinden?fehler=${encodeURIComponent(e.message)}#notes`)
    throw e
  }
  revalidatePath('/verbinden')
  redirect(`/verbinden?ok=${encodeURIComponent(msg)}#notes`)
}

export async function generate(fd: FormData) {
  await guard()
  const { generateStatements } = await import('@/lib/generate.ts')
  let msg: string
  try {
    const r = await generateStatements(await getDb(), num(fd, 'subjectId'), {
      count: num(fd, 'count') || 15,
      mode: str(fd, 'mode') === 'total' ? 'total' : 'perUnit',
      fromUnit: num(fd, 'fromUnit') || 1,
      toUnit: num(fd, 'toUnit') || 1,
      hint: str(fd, 'hint') || null,
    })
    const saved = r.perUnit.reduce((a, u) => a + u.saved.length, 0)
    const parts = r.perUnit.map((u) => `UE ${u.unit}: ${u.error ? `Fehler (${u.error})` : `${u.saved.length} von ${u.requested}`}`)
    msg = `${saved} neue Aussagen in der Inbox (${parts.join(', ')}). Blind geprüft: ${r.checks.agree} bestätigt, ${r.checks.disagree} abweichend.`
    if (r.skippedUnits.length) msg += ` Ohne Notes übersprungen: UE ${r.skippedUnits.join(', ')}.`
  } catch (e) {
    if (e instanceof svc.AppError) redirect(`/verbinden?fehler=${encodeURIComponent(e.message)}#erzeugen`)
    throw e
  }
  revalidatePath('/inbox')
  redirect(`/verbinden?ok=${encodeURIComponent(msg)}#erzeugen`)
}

export async function runBlindCheck() {
  await guard()
  const { blindCheck } = await import('@/lib/generate.ts')
  let msg: string
  try {
    const r = await blindCheck(await getDb())
    msg = r.checked ? `Blind geprüft: ${r.checked}, davon ${r.agree} bestätigt und ${r.disagree} abweichend.` : 'Nichts zu prüfen.'
  } catch (e) {
    if (e instanceof svc.AppError) redirect(`/inbox?fehler=${encodeURIComponent(e.message)}`)
    throw e
  }
  revalidatePath('/inbox')
  redirect(`/inbox?ok=${encodeURIComponent(msg)}`)
}

export async function approveMany(fd: FormData) {
  await guard()
  const r = await svc.approveMany(await getDb(), null, str(fd, 'mode') === 'unflagged' ? 'unflagged' : 'ready')
  revalidatePath('/inbox')
  redirect(`/inbox?ok=${encodeURIComponent(`${r.approved} Aussagen freigegeben.`)}`)
}
