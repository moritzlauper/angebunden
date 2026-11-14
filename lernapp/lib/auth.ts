/**
 * Login nur für dich: ein Passwort (APP_PASSWORD), danach ein signiertes Cookie.
 * Ohne APP_PASSWORD ist die Oberfläche offen, das ist nur lokal sinnvoll.
 * Läuft mit Web Crypto, damit es auch im Proxy funktioniert.
 */

export const COOKIE = 'lernapp_session'

function secret(): string {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
}

export function authEnabled(): boolean {
  return !!process.env.APP_PASSWORD
}

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sessionToken(): Promise<string> {
  return hmac('lernapp:v1')
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true
  if (!cookie) return false
  return safeEqual(cookie, await sessionToken())
}

/** MCP: Token aus dem Pfad (/api/mcp/<token>) oder als Bearer-Header. Lokal ohne MCP_TOKEN gilt «dev». */
export function isValidMcpToken(token: string | null | undefined): boolean {
  const expected = process.env.MCP_TOKEN || (process.env.NODE_ENV !== 'production' ? 'dev' : '')
  if (!expected || !token) return false
  return safeEqual(token, expected)
}
