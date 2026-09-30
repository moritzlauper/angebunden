import type { NextConfig } from 'next'

/**
 * Die Seite hat keinen Serveranteil: alle Daten liegen als Dateien in `public/`
 * und die einzige Route wird beim Bauen vorgerendert. Mit `STATISCH=1` entsteht
 * deshalb ein reiner Ordner voll statischer Dateien, den jeder Gratis-Hoster
 * ausliefern kann (siehe README).
 */
const nextConfig: NextConfig = {
  output: process.env.STATISCH ? 'export' : undefined,
  // Der Android-Emulator erreicht den Rechner unter 10.0.2.2. Ohne diese Angabe blockiert der
  // Entwicklungsserver die Skripte, und die Seite in der App wird nie interaktiv.
  allowedDevOrigins: ['10.0.2.2'],
}

export default nextConfig
