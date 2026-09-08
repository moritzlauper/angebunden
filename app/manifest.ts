import type { MetadataRoute } from 'next'
import { SITE_NAME, SITE_TAGLINE } from './site'

// Ohne das kann `pnpm export` (output: 'export') die Route nicht vorrendern.
export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} · ${SITE_TAGLINE}`,
    short_name: SITE_NAME,
    description:
      'Für jedes Haus in Zürich, Basel und Bern die mittlere ÖV-Reisezeit zu einer beliebigen Adresse der Stadt.',
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
