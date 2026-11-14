import type { Metadata, Viewport } from 'next'
import './globals.css'

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0a09' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser-Erweiterungen hängen Attribute ans <html>; die Warnung dazu ist kein Fehler der App.
    <html lang="de-CH" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
