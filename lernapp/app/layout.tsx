import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { themeScript } from './theme-switch.tsx'

export const metadata: Metadata = {
  title: 'Klicker',
  description: 'Klickerfragen aus dem Vault, abgefragt nach Wiederholungsplan',
  robots: { index: false, follow: false },
  // Auf dem Handy «Zum Home-Bildschirm» → öffnet ohne Browserleiste wie eine App.
  appleWebApp: { capable: true, title: 'Klicker', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // themeColor setzt themeScript passend zur gewählten Darstellung.
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser-Erweiterungen hängen Attribute ans <html>; die Warnung dazu ist kein Fehler der App.
    <html lang="de-CH" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
