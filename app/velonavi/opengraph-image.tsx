import { velonaviBild } from '../og/vorschaubild'

// Ohne das kann `pnpm export` (output: 'export') das Bild nicht vorrendern.
export const dynamic = 'force-static'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Velonavi Zürich: die schnellste Veloroute, mit Vorzugsrouten, Verkehr und Lichtsignalen gerechnet'

export default function Image() {
  return velonaviBild()
}
