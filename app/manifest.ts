import type { MetadataRoute } from 'next'
import { SITE_NAME } from './site'
import { VELO_BESCHREIBUNG } from './velonavi/seo'

// Ohne das kann `pnpm export` (output: 'export') die Route nicht vorrendern.
export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `Velonavi Zürich · ${SITE_NAME}`,
    short_name: 'Velonavi Zürich',
    description: VELO_BESCHREIBUNG,
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f7f5',
    theme_color: '#f7f7f5',
    lang: 'de-CH',
    categories: ['navigation', 'travel', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
    ],
  }
}
