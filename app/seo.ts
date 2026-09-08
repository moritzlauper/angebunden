import type { Metadata } from 'next'
import type { Meta } from './meta'
import type { Stadt } from './staedte'
import { SITE_NAME, nf } from './site'

/** Was in der Stadt fährt – für den Beschreibungstext. */
const VERKEHR: Record<string, string> = {
  zuerich: 'Tram, Bus und S-Bahn',
  basel: 'Tram und Bus',
  bern: 'Tram und Bus',
}

/**
 * Die vollständigen Metadaten einer Stadtseite: Titel, Beschreibung, canonical
 * und die Karten für WhatsApp, Google und die sozialen Netze. Jede Stadtseite
 * ruft das mit ihrer Stadt und den vorgerechneten Kennzahlen auf; das
 * Vorschaubild kommt aus `opengraph-image.tsx` im selben Ordner dazu.
 */
export function stadtMetadata(stadt: Stadt, meta: Meta): Metadata {
  const titel = `Erreichbarkeit ${stadt.name}`
  const verkehr = VERKEHR[stadt.schluessel] ?? 'Tram, Bus und Bahn'
  const beschreibung =
    `Für jedes der ${nf(meta.buildings)} Häuser in ${stadt.name}: die mittlere ` +
    `Reisezeit mit ${verkehr} zu einer beliebigen Adresse der Stadt, und wie es ` +
    `um die Kulturvielfalt in der Nähe steht.`
  const sozial = `${SITE_NAME} · Wie gut ist dein Haus in ${stadt.name} angebunden?`

  return {
    title: titel,
    description: beschreibung,
    alternates: { canonical: stadt.pfad },
    openGraph: {
      type: 'website',
      locale: 'de_CH',
      siteName: SITE_NAME,
      url: stadt.pfad,
      title: sozial,
      description: beschreibung,
    },
    twitter: {
      card: 'summary_large_image',
      title: sozial,
      description: beschreibung,
    },
  }
}
