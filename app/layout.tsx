import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SITE_NAME, SITE_URL } from './site'
import { VELO_TITEL } from './velonavi/seo'
import { BesucherZaehler } from './besucher-zaehler'
import './globals.css'

const BESCHREIBUNG =
  'Velonavi Zürich, Wohnungen in Zürich und ÖV-Erreichbarkeitskarten für Zürich, Basel und Bern: ' +
  'Plane deine Veloroute, finde eine Wohnung und vergleiche Reisezeiten und Kulturangebote.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${VELO_TITEL} · ${SITE_NAME}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: BESCHREIBUNG,
  applicationName: SITE_NAME,
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
    title: `${VELO_TITEL} · ${SITE_NAME}`,
    description: BESCHREIBUNG,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${VELO_TITEL} · ${SITE_NAME}`,
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
    { media: '(prefers-color-scheme: dark)', color: '#0f0f11' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="de-CH"
      className="h-full"
      /* Das Velonavi setzt `data-thema` schon vor dem Hydrieren, damit das
         dunkle Thema nicht sichtbar aufblitzt. Serverseitig steht das Attribut
         deshalb noch nicht da - React soll das nicht als Fehler melden. */
      suppressHydrationWarning
    >
      <body className="h-full">
        {children}
        <BesucherZaehler />
        <Analytics />
      </body>
    </html>
  )
}
