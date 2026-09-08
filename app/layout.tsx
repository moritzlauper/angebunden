import type { Metadata, Viewport } from 'next'
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from './site'
import { BesucherZaehler } from './besucher-zaehler'
import './globals.css'

const BESCHREIBUNG =
  'Für jedes Haus in Zürich, Basel und Bern: die mittlere Reisezeit mit Tram, ' +
  'Bus und Bahn zu einer beliebigen Adresse der Stadt, und wie es um die ' +
  'Kulturvielfalt in Velo- oder Gehweite steht.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} · ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: BESCHREIBUNG,
  applicationName: SITE_NAME,
  keywords: [
    'ÖV-Erreichbarkeit',
    'öffentlicher Verkehr',
    'Erreichbarkeit',
    'Reisezeit',
    'Zürich',
    'Basel',
    'Bern',
    'Tram',
    'S-Bahn',
    'Wohnungssuche',
    'Pendeln',
    'Kulturvielfalt',
    'Isochrone',
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: 'technology',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'de_CH',
    siteName: SITE_NAME,
    url: '/',
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: BESCHREIBUNG,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: BESCHREIBUNG,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  formatDetection: { telephone: false },
}

/**
 * `viewportFit: 'cover'` lässt die Karte bis unter die Notch laufen, den
 * Ausgleich übernehmen die `env(safe-area-inset-*)`-Ränder in karte.tsx.
 * Zoomen bleibt der Karte vorbehalten: `userScalable: false`, sonst kollidiert
 * die Geste mit MapLibres eigenem Pinch-Zoom.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0c' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="de-CH" className="h-full">
      <body className="h-full">
        {children}
        <BesucherZaehler />
      </body>
    </html>
  )
}
