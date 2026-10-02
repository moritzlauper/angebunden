import type { Metadata } from 'next'
import { SITE_NAME } from '../site'
import Wohnungssuche from './wohnungssuche'

const BESCHREIBUNG =
  'Mietwohnungen in der Stadt Zürich aus Flatfox, Homegate und ImmoScout24 auf einer Liste, ' +
  'Doppelte zusammengelegt. Zu jeder Wohnung die ÖV-Anbindung und das Kulturangebot in der Nähe, ' +
  'dazu die Links zu WG-Börsen, Genossenschaften und städtischen Wohnungen.'

const SOZIAL = `Wohnungen in Zürich · ${SITE_NAME}`

export const metadata: Metadata = {
  title: 'Wohnungen in Zürich',
  description: BESCHREIBUNG,
  keywords: [
    'Wohnungssuche Zürich',
    'Wohnung mieten Zürich',
    'Mietwohnung Zürich',
    'WG-Zimmer Zürich',
    'Flatfox',
    'Homegate',
    'ImmoScout24',
    'Genossenschaftswohnung',
    'ÖV-Anbindung',
  ],
  alternates: { canonical: '/wohnungen' },
  openGraph: {
    type: 'website',
    locale: 'de_CH',
    siteName: SITE_NAME,
    url: '/wohnungen',
    title: SOZIAL,
    description: BESCHREIBUNG,
  },
  twitter: {
    card: 'summary_large_image',
    title: SOZIAL,
    description: BESCHREIBUNG,
  },
}

export default function Page() {
  return <Wohnungssuche />
}
