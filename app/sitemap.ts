import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { MetadataRoute } from 'next'
import { ladeMeta } from './meta'
import { STADT_LISTE } from './staedte'
import { SITE_URL } from './site'
import { KREISE } from './wohnungen/kreise'
import { VELO_INHALT_AKTUALISIERT } from './velonavi/seo'

// Ohne das kann `pnpm export` (output: 'export') die Route nicht vorrendern.
export const dynamic = 'force-static'

/**
 * Änderungen am Velonetz und am Seiteninhalt zählen beide für `lastmod`.
 * Ein reiner Deploy verändert dieses Datum nicht.
 */
async function veloErstellt(): Promise<Date> {
  const roh = await readFile(
    path.join(process.cwd(), 'public', 'data', 'zuerich', 'velo.json'),
    'utf8'
  )
  return new Date(Math.max(
    new Date(JSON.parse(roh).erstellt).getTime(),
    new Date(VELO_INHALT_AKTUALISIERT).getTime(),
  ))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staedte = await Promise.all(
    STADT_LISTE.map(async (stadt) => {
      const meta = await ladeMeta(stadt.schluessel)
      return {
        url: `${SITE_URL}${stadt.pfad}`,
        lastModified: new Date(meta.builtAt),
        changeFrequency: 'monthly' as const,
        priority: stadt.schluessel === 'zuerich' ? 0.9 : 0.8,
      }
    })
  )

  return [
    ...staedte,
    {
      url: `${SITE_URL}/`,
      lastModified: await veloErstellt(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/wohnungen`,
      lastModified: new Date(),
      changeFrequency: 'hourly' as const,
      priority: 0.9,
    },
    ...KREISE.map((k) => ({
      url: `${SITE_URL}/wohnungen/${k.slug}`,
      lastModified: new Date(),
      changeFrequency: 'hourly' as const,
      priority: 0.7,
    })),
    {
      url: `${SITE_URL}/methode`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.5,
    },
  ]
}
