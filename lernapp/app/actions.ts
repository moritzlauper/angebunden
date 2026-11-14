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
  const subjectId = num(fd, 'subjectId')
  // Die Auswahl «bis UE n» neben dem Start-Knopf gilt ab jetzt als Grenze des Fachs.
  const ueLimit = num(fd, 'ueLimit')
  if (Number.isInteger(ueLimit) && ueLimit > 0) await svc.updateSubject(db, subjectId, { ueLimit })
  let id: number
  try {
    const view = await svc.startSession(db, subjectId, {
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

export async function saveUnit(fd: FormData) {
  await guard()
  const id = num(fd, 'subjectId')
  const number = num(fd, 'number')
  const title = str(fd, 'title')
  if (Number.isInteger(number) && number > 0 && title) await svc.upsertUnit(await getDb(), id, number, title)
  revalidatePath(`/fach/${id}`)
  redirect(`/fach/${id}?gespeichert=1#einstellungen`)
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
