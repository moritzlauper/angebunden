import type { NextConfig } from 'next'

/**
 * Die Seite hat keinen Serveranteil: alle Daten liegen als Dateien in `public/`
 * und die einzige Route wird beim Bauen vorgerendert. Mit `STATISCH=1` entsteht
 * deshalb ein reiner Ordner voll statischer Dateien, den jeder Gratis-Hoster
 * ausliefern kann (siehe README).
 */
const nextConfig: NextConfig = {
  output: process.env.STATISCH ? 'export' : undefined,
}

export default nextConfig
