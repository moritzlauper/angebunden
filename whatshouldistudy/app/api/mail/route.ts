import { NextResponse } from 'next/server'
import { mailConfigured, rateLimited, sendMail, validAddress } from '@/lib/server/mail.ts'
import { ownOrigins } from '@/lib/server/origins.ts'
import { paymentMode, verifyToken } from '@/lib/server/token.ts'
import { decodeSnapshot } from '@/lib/share.ts'
import { emoji, fieldName } from '@/lib/site/labels.ts'
import { SITES } from '@/lib/site/config.ts'
import type { SiteId } from '@/lib/site/config.ts'
import { dict } from '@/lib/site/dict.ts'

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * «Email it to me»: sends the result link to the address given, once. The link
 * has to point at one of our own pages and the text is fixed, so this can't be
 * used to send anything else. Neither address nor link is stored or logged.
 */
export async function POST(req: Request) {
  if (!mailConfigured()) return NextResponse.json({ error: 'not-configured' }, { status: 503 })
  const body = (await req.json().catch(() => null)) as { to?: unknown; url?: unknown; site?: unknown } | null
  const to = typeof body?.to === 'string' ? body.to.trim() : ''
  const url = typeof body?.url === 'string' ? body.url : ''
  const site: SiteId = typeof body?.site === 'string' && body.site in SITES ? (body.site as SiteId) : 'global'
  if (!validAddress(to)) return NextResponse.json({ error: 'address' }, { status: 400 })
  let link: URL
  try {
    link = new URL(url)
  } catch {
    return NextResponse.json({ error: 'link' }, { status: 400 })
  }
  if (url.length > 12_000 || !ownOrigins(req).has(link.origin) || !/^#s=[\w-]+$/.test(link.hash)) return NextResponse.json({ error: 'link' }, { status: 400 })
  // The summary comes from the link itself, so the mail says nothing the link doesn't.
  const snap = decodeSnapshot(link.hash.slice(3))
  if (!snap) return NextResponse.json({ error: 'link' }, { status: 400 })

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  if (rateLimited(`ip:${ip}`, 5) || rateLimited(`to:${to.toLowerCase()}`, 3)) return NextResponse.json({ error: 'busy' }, { status: 429 })

  const conf = SITES[site]
  const s = dict(conf.locale).share
  // Place 1 only where the page would show it too: a paid report, or no payments on this deployment.
  const unlocked = paymentMode() === 'off' || !!verifyToken(snap.token)
  const fields = snap.results.fields.slice(unlocked ? 0 : 1, 6)
  const line = (id: string, score: number, rank: number) => `${rank}. ${emoji(id)} ${fieldName(id, conf.locale)}: ${score} %`
  const top = fields.map((f, i) => line(f.id, f.score, i + (unlocked ? 1 : 2)))
  const code = snap.results.riasec?.code
  const text = [
    s.mailIntro,
    '',
    `${s.mailTop}:`,
    ...(unlocked ? [] : [`1. ${s.mailLockedFirst}`]),
    ...top,
    ...(code ? ['', s.mailType(code)] : []),
    '',
    s.mailMore,
    url,
    '',
    s.mailNote,
    '—',
    s.mailFooter(conf.name),
  ].join('\n')
  const button = `<a href="${escape(url)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#6c3bff;color:#fff;font-weight:700;text-decoration:none">${escape(s.mailButton)}</a>`
  const html = [
    `<p>${escape(s.mailIntro)}</p>`,
    `<p style="font-weight:700;margin-bottom:4px">${escape(s.mailTop)}</p>`,
    '<ol style="margin-top:0;padding-left:20px">',
    ...(unlocked ? [] : [`<li style="color:#5d5473">${escape(s.mailLockedFirst)}</li>`]),
    ...fields.map((f) => `<li>${escape(`${emoji(f.id)} ${fieldName(f.id, conf.locale)}`)} <strong>${f.score} %</strong></li>`),
    '</ol>',
    code ? `<p>${escape(s.mailType(code))}</p>` : '',
    `<p>${escape(s.mailMore)}</p>`,
    `<p>${button}</p>`,
    `<p style="color:#5d5473;font-size:13px">${escape(s.mailNote)}</p>`,
    `<p style="color:#5d5473;font-size:12px">${escape(s.mailFooter(conf.name))}</p>`,
  ].join('')
  try {
    await sendMail({ to, fromName: conf.name, subject: s.mailSubject(conf.name), text, html })
  } catch (e) {
    // Only the error code, never the address or the link.
    console.error('mail failed', (e as { code?: string }).code ?? 'unknown')
    return NextResponse.json({ error: 'send' }, { status: 502 })
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
