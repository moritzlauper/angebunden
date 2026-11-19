import Link from 'next/link'

/**
 * Eine einzige, kompakte Kopfzeile. Auf dem Handy scrollen die Links waagrecht,
 * statt auf mehrere Zeilen umzubrechen.
 */
export function TopBar({ brand, brandHref = '/', children }: { brand?: React.ReactNode; brandHref?: string; children?: React.ReactNode }) {
  return (
    <header className="topbar sticky top-0 z-10 pt-[env(safe-area-inset-top)]">
      <nav className="mx-auto flex max-w-3xl items-center gap-3 overflow-x-auto px-4 py-3 text-sm whitespace-nowrap">
        <Link href={brandHref} className="logo">
          {brand ?? 'Klicker'}
        </Link>
        {children}
      </nav>
    </header>
  )
}
