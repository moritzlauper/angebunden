import { beidesBild } from './og/vorschaubild'

// Ohne das kann `pnpm export` (output: 'export') das Bild nicht vorrendern.
export const dynamic = 'force-static'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'angebunden: ÖV-Erreichbarkeit für jedes Haus und Velonavi für Zürich'

export default function Image() {
  return beidesBild()
}
