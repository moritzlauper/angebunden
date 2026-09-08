import type { MetadataRoute } from 'next'
import { SITE_URL } from './site'

// Ohne das kann `pnpm export` (output: 'export') die Route nicht vorrendern.
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
