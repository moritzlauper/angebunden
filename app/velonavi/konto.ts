/**
 * Das Konto im Velonavi: Anmeldung und Ablage der Fahrten bei Supabase.
 *
 * Die Seite hat keinen Serveranteil, der Browser spricht direkt mit Supabase.
 * Dafür reichen die Adresse des Projekts und der öffentliche Schlüssel; wer
 * welche Zeile lesen darf, regelt die Datenbank selbst (Row Level Security,
 * siehe `supabase/migrations`). Fehlen die beiden Angaben, gibt es im
 * Velonavi kein Konto und die Seite verhält sich wie zuvor.
 *
 * Die Bibliothek wird erst geladen, wenn jemand sich anmelden will oder schon
 * angemeldet ist. Wer nur eine Route sucht, lädt sie nicht.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// Die Supabase-Integration von Vercel legt die Variablen mit einem frei
// gewählten Präfix an, bei angebunden.ch ist es `STORAGE`. Beide Schreibweisen
// gelten, damit das Deployment ohne von Hand gesetzte Variablen auskommt. Next.js
// setzt nur ausgeschriebene `process.env.NAME` in den Browsercode ein, deshalb
// steht jeder Name einzeln da.
const ADRESSE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_STORAGE_SUPABASE_URL
// Öffentlich ist bei der Integration nur der ältere anon-Schlüssel. Er darf
// dasselbe wie der neuere `sb_publishable_…`.
const SCHLUESSEL =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_STORAGE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_STORAGE_SUPABASE_ANON_KEY

export const KONTO_MOEGLICH = !!ADRESSE && !!SCHLUESSEL

/** Für die Gemeinschaft (`gemeinschaft-netz.ts`), die ohne Anmeldung und ohne die Bibliothek auskommt. */
export const PROJEKT = { adresse: ADRESSE, schluessel: SCHLUESSEL }

/** Unter diesem Namen liegt die Sitzung im localStorage. Cookies gibt es keine. */
const SPEICHER = 'velonavi.konto'

export const TABELLE = 'velonavi_fahrten'

let client: Promise<SupabaseClient> | null = null

/**
 * Angemeldet wird mit dem Zugangsschlüssel im Fragment der Adresse (`#access_token=…`). Anders als
 * PKCE braucht das keinen Prüfwert aus dem Browser, der den Link angefordert hat: Der Link aus der
 * E-Mail öffnet auf dem Handy den Browser, und von dort geht die Sitzung an die App (`appUebergabe`).
 * Beim Zurückkehren steht im Fragment nur der Schlüssel, nie eine Route (`#von=…&nach=…`).
 */
export function konto(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(ADRESSE!, SCHLUESSEL!, {
      auth: { flowType: 'implicit', storageKey: SPEICHER, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  )
  return client
}

/** Geht an `window`, sobald sich jemand an- oder abmeldet, damit sich die Wegweiser gleich anpassen. */
export const KONTO_WECHSEL = 'velonavi-konto'

/** Ob schon eine Sitzung besteht oder gerade eine Anmeldung zurückkommt. */
export function kontoAngefangen() {
  if (!KONTO_MOEGLICH) return false
  try {
    return (
      /(^#|&)access_token=/.test(window.location.hash) ||
      window.localStorage.getItem(SPEICHER) !== null
    )
  } catch {
    return false
  }
}

/** Wohin Supabase nach der Anmeldung zurückschickt: die Startseite. Muss dort als Redirect-URL eingetragen sein. */
export const rueckkehr = () => window.location.origin

/** Anbieter, für die es einen Knopf gibt, sofern sie im Supabase-Projekt eingeschaltet sind. */
const ANBIETER = [
  { id: 'google', name: 'Google' },
  { id: 'apple', name: 'Apple' },
  { id: 'github', name: 'GitHub' },
  { id: 'azure', name: 'Microsoft' },
] as const
export type Anbieter = (typeof ANBIETER)[number]

/**
 * Fragt das Projekt, welche Anmeldewege eingeschaltet sind. So erscheint der
 * Google-Knopf erst, wenn Google im Supabase-Dashboard eingerichtet ist, und
 * führt nie auf eine Fehlerseite.
 */
export async function anmeldewege(): Promise<{ anbieter: Anbieter[]; mail: boolean }> {
  const r = await fetch(`${ADRESSE}/auth/v1/settings`, { headers: { apikey: SCHLUESSEL! } })
  if (!r.ok) throw new Error(`Supabase antwortet mit ${r.status}`)
  const { external } = (await r.json()) as { external?: Record<string, boolean> }
  return { anbieter: ANBIETER.filter((a) => external?.[a.id]), mail: external?.email !== false }
}

/**
 * Kommt die Anmeldung mit einem Fehler zurück, steht er in der Adresse. Liest
 * ihn aus und räumt die Adresse auf.
 */
export function anmeldeFehler(): string | null {
  const suche = new URLSearchParams(window.location.search)
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const code = suche.get('error_code') ?? fragment.get('error_code')
  const text = suche.get('error_description') ?? fragment.get('error_description')
  if (!code && !text) return null
  for (const k of ['error', 'error_code', 'error_description']) suche.delete(k)
  const rest = suche.toString()
  // Steht der Fehler im Fragment, fällt es weg; eine Route im Fragment bleibt.
  const fragmentBleibt = fragment.has('error_code') || fragment.has('error_description') ? '' : window.location.hash
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + fragmentBleibt)
  return code === 'otp_expired'
    ? 'Der Anmeldelink ist abgelaufen oder wurde schon benutzt.'
    : `Die Anmeldung hat nicht geklappt: ${text ?? code}`
}

/**
 * Kommt man aus dem Anmeldelink auf einem Android-Handy im Browser an, öffnet das Schema der App
 * dieselbe Sitzung dort (siehe MainActivity.java). Gibt die Adresse dafür zurück, sonst null.
 */
export function appUebergabe(): string | null {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  if (!fragment.get('access_token') || !fragment.get('refresh_token')) return null
  if (!/Android/i.test(navigator.userAgent)) return null
  return `velonavi://anmeldung#${fragment.toString()}`
}
