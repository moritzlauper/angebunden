import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { MetadataRoute } from 'next'
import { ladeMeta } from './meta'
import { STADT_LISTE } from './staedte'
import { SITE_URL } from './site'

// Ohne das kann `pnpm export` (output: 'export') die Route nicht vorrendern.
export const dynamic = 'force-static'

/**
 * Wann das Velonetz zuletzt gerechnet wurde. Das ist das ehrlichere `lastmod`
 * für den Velonavi als der Zeitpunkt des Builds: Ein Deploy ohne neue Daten
 * soll Google nicht zum Neuindexieren einladen.
 */
async function veloErstellt(): Promise<Date> {
  const roh = await readFile(
    path.join(process.cwd(), 'public', 'data', 'zuerich', 'velo.json'),
    'utf8'
  )
  return new Date(JSON.parse(roh).erstellt)
}

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
      url: `${SITE_URL}/velonavi`,
      lastModified: await veloErstellt(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/methode`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.5,
    },
  ]
}
