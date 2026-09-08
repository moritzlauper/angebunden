import type { MetadataRoute } from 'next'
import { ladeMeta } from './meta'
import { STADT_LISTE } from './staedte'
import { SITE_URL } from './site'

// Ohne das kann `pnpm export` (output: 'export') die Route nicht vorrendern.
export const dynamic = 'force-static'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staedte = await Promise.all(
    STADT_LISTE.map(async (stadt) => {
      const meta = await ladeMeta(stadt.schluessel)
      return {
        url: `${SITE_URL}${stadt.pfad}`,
        lastModified: new Date(meta.builtAt),
        changeFrequency: 'monthly' as const,
        priority: stadt.pfad === '/' ? 1 : 0.8,
      }
    })
  )

  return [
    ...staedte,
    {
      url: `${SITE_URL}/methode`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.5,
    },
  ]
}
