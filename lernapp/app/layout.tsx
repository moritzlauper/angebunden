import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Klicker',
  description: 'Klickerfragen aus dem Vault, abgefragt nach Wiederholungsplan',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de-CH">
      <body className="min-h-screen antialiased">
        <header className="border-b" style={{ borderColor: 'var(--line)' }}>
          <nav className="mx-auto flex max-w-3xl items-center gap-5 px-4 py-3 text-sm">
            <Link href="/" className="font-bold">
              Klicker
            </Link>
            <Link href="/inbox">Inbox</Link>
            <Link href="/verbinden">Claude &amp; Import</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  )
}
