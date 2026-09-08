/**
 * Die Adresse, unter der die Seite produktiv läuft. Sie steckt in den absoluten
 * URLs, die WhatsApp, Google und Co. brauchen: OpenGraph-Bild, canonical,
 * sitemap, der geteilte Link. Lokal beim Entwickeln zeigt der geteilte Link
 * damit auf angebunden.ch statt auf localhost – was beim Teilen auch das
 * Gewünschte ist, eine Vorschau von localhost bekommt sowieso niemand.
 *
 * Beim Deployen auf eine andere Domain `NEXT_PUBLIC_SITE_URL` setzen.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://angebunden.ch'
).replace(/\/$/, '')

export const SITE_NAME = 'angebunden'

/** Der Halbsatz, der die Seite überall gleich beschreibt, ohne Stadtname. */
export const SITE_TAGLINE = 'Erreichbarkeit für jedes Haus'

/** Tausendertrennung mit Hochkomma – wie im Rest der Seite, ohne `toLocaleString`. */
export function nf(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '’')
}
