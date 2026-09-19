import type { Metadata } from 'next'
import Velonavi from './velonavi'

export const metadata: Metadata = {
  title: 'Velonavi Zürich',
  description:
    'Veloroutenplaner für Zürich: schnell, ideal oder komfortabel. Berücksichtigt Verkehr, Velostreifen, Tramgleise, Lichtsignale je nach Abbiegerichtung, Steigung, Belag und Vorzugsrouten.',
  alternates: { canonical: '/velonavi' },
  openGraph: {
    type: 'website',
    title: 'Velonavi Zürich · angebunden',
    description: 'Veloroutenplaner für Zürich mit Verkehr, Ampeln, Steigung, Belag und Vorzugsrouten.',
    url: '/velonavi',
  },
}

export default function Page() {
  return <Velonavi />
}
