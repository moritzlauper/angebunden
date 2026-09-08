import { altText, vorschaubild } from '../og/vorschaubild'

// Ohne das kann `pnpm export` (output: 'export') das Bild nicht vorrendern.
export const dynamic = 'force-static'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = altText('Basel')

export default function Image() {
  return vorschaubild('Basel')
}
