import type { NextConfig } from 'next'

/**
 * Die Seite hat keinen Serveranteil: alle Daten liegen als Dateien in `public/`
 * und die einzige Route wird beim Bauen vorgerendert. Mit `STATISCH=1` entsteht
 * deshalb ein reiner Ordner voll statischer Dateien, den jeder Gratis-Hoster
 * ausliefern kann (siehe README).
 */
/**
 * whatshouldistudy (Unterordner whatshouldistudy/) läuft als eigenes Vercel-Projekt
 * mit basePath /whatshouldistudy. angebunden reicht diesen Pfad dorthin weiter
 * (Next.js Multi-Zones), so ist es unter angebunden.ch/whatshouldistudy erreichbar.
 * Adresse des Projekts: WHATSHOULDISTUDY_URL, sonst seine Produktionsdomain auf Vercel.
 */
const WSIS = (process.env.WHATSHOULDISTUDY_URL || 'https://angebunden-7o69.vercel.app').replace(/\/$/, '')

const nextConfig: NextConfig = {
  output: process.env.STATISCH ? 'export' : undefined,
  // Der statische Export kennt keine Weiterleitungen.
  ...(process.env.STATISCH
    ? {}
    : {
        async rewrites() {
          return [
            { source: '/whatshouldistudy', destination: `${WSIS}/whatshouldistudy` },
            { source: '/whatshouldistudy/:path*', destination: `${WSIS}/whatshouldistudy/:path*` },
          ]
        },
      }),
  // Der Android-Emulator erreicht den Rechner unter 10.0.2.2. Ohne diese Angabe blockiert der
  // Entwicklungsserver die Skripte, und die Seite in der App wird nie interaktiv.
  allowedDevOrigins: ['10.0.2.2'],
}

export default nextConfig
