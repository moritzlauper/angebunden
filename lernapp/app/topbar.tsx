import Link from 'next/link'

/**
 * Eine einzige, kompakte Kopfzeile. Auf dem Handy scrollen die Links waagrecht,
 * statt auf mehrere Zeilen umzubrechen.
 */
export function TopBar({ brand, brandHref = '/', children }: { brand?: React.ReactNode; brandHref?: string; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b pt-[env(safe-area-inset-top)]" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
      <nav className="mx-auto flex max-w-3xl items-center gap-4 overflow-x-auto px-4 py-3 text-sm whitespace-nowrap">
        <Link href={brandHref} className="font-bold">
          {brand ?? 'Klicker'}
        </Link>
        {children}
      </nav>
    </header>
  )
}
