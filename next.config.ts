import type { NextConfig } from 'next'

/**
 * Die Seite hat keinen Serveranteil: alle Daten liegen als Dateien in `public/`
 * und die einzige Route wird beim Bauen vorgerendert. Mit `STATISCH=1` entsteht
 * deshalb ein reiner Ordner voll statischer Dateien, den jeder Gratis-Hoster
 * ausliefern kann (siehe README).
 */
/**
 * whatshouldistudy läuft unter whatshouldistudy.ch. Der frühere Pfad auf
 * angebunden.ch leitet dorthin weiter. WHATSHOULDISTUDY_URL kann für Vorschauen
 * oder einen abweichenden Domainnamen gesetzt werden.
 */
const WSIS = (process.env.WHATSHOULDISTUDY_URL || 'https://whatshouldistudy.ch').replace(/\/$/, '')

const nextConfig: NextConfig = {
  output: process.env.STATISCH ? 'export' : undefined,
  // Der statische Export kennt keine Weiterleitungen.
  ...(process.env.STATISCH
    ? {}
    : {
        async redirects() {
          return [
            { source: '/whatshouldistudy', destination: WSIS, permanent: true },
            { source: '/whatshouldistudy/:path*', destination: `${WSIS}/:path*`, permanent: true },
          ]
        },
      }),
  // Der Android-Emulator erreicht den Rechner unter 10.0.2.2. Ohne diese Angabe blockiert der
  // Entwicklungsserver die Skripte, und die Seite in der App wird nie interaktiv.
  allowedDevOrigins: ['10.0.2.2'],
}

export default nextConfig
