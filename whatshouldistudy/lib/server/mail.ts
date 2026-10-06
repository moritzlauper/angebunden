import 'server-only'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

/**
 * Outgoing mail through the site's own mailbox (Infomaniak by default):
 * SMTP_USER is the address, SMTP_PASS a device password generated for it.
 * Nothing is kept: no address, no content, no log of either.
 */

export function mailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}

let transport: Transporter | null = null

function transporter(): Transporter {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 465
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'mail.infomaniak.com',
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  }
  return transport
}

export async function sendMail(m: { to: string; fromName: string; subject: string; text: string; html: string }): Promise<void> {
  const from = process.env.MAIL_FROM || `${m.fromName} <${process.env.SMTP_USER}>`
  await transporter().sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html })
}

/** A plausible single address, nothing that could smuggle in more recipients or headers. */
export function validAddress(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@,;<>"'()\\]+@[^\s@,;<>"'()\\]+\.[a-z]{2,}$/i.test(s)
}

/** Best effort per serverless instance: enough to stop someone using the form to flood an inbox. */
const hits = new Map<string, number[]>()
export function rateLimited(key: string, max: number, windowMs = 3600_000): boolean {
  const now = Date.now()
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (list.length >= max) {
    hits.set(key, list)
    return true
  }
  list.push(now)
  hits.set(key, list)
  if (hits.size > 10_000) hits.clear()
  return false
}
