'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Wortmarke } from './marke'

/**
 * Das Seitenmenü, gleich auf allen drei Teilen von angebunden: ein runder
 * Knopf neben der Wortmarke, dahinter eine Leiste von links mit Velonavi,
 * Erreichbarkeit und Wohnungen. Es ersetzt die einzelnen Querverweise, die
 * auf jeder Seite anders aussahen und teils nicht mehr Platz fanden.
 *
 * Farben über die Variablen `--ab-*` aus globals.css, damit es in jedem Thema
 * passt, ohne dass die Seiten etwas durchreichen.
 */

const TEILE = [
  { id: 'velonavi', name: 'Velonavi', href: '/', was: 'Veloroute durch Zürich planen, schnell oder ruhig' },
  { id: 'erreichbarkeit', name: 'Erreichbarkeit', href: '/erreichbarkeitskarte', was: 'ÖV und Kultur für jedes Haus in Zürich, Basel und Bern' },
  { id: 'wohnungen', name: 'Wohnungen', href: '/wohnungen', was: 'Alle Mietinserate in Zürich auf einer Karte, mit Suchabo' },
] as const

export type Teil = (typeof TEILE)[number]['id']

function Striche() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function Menue({ aktiv }: { aktiv: Teil }) {
  const [offen, setOffen] = useState(false)

  useEffect(() => {
    if (!offen) return
    const taste = (e: KeyboardEvent) => e.key === 'Escape' && setOffen(false)
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [offen])

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        aria-label="Menü"
        aria-expanded={offen}
        className="pointer-events-auto grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--ab-linie)] bg-[var(--ab-blatt)] text-[var(--ab-tinte)] transition-colors hover:bg-[var(--ab-weich)]"
      >
        <Striche />
      </button>
      {offen && (
        <div className="pointer-events-auto fixed inset-0 z-[60]" onClick={() => setOffen(false)}>
          <div className="absolute inset-0 bg-black/25" />
          <nav
            aria-label="angebunden"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-[var(--ab-papier)] px-4 text-[var(--ab-tinte)] shadow-[var(--ab-schatten)]"
            style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between">
              <Wortmarke size={17} />
              <button
                type="button"
                onClick={() => setOffen(false)}
                aria-label="Menü schliessen"
                className="grid h-8 w-8 place-items-center rounded-full text-[15px] text-[var(--ab-leise)] hover:bg-[var(--ab-weich)]"
              >
                ✕
              </button>
            </div>
            <ul className="mt-6 flex flex-col gap-1">
              {TEILE.map((t) => {
                const hier = t.id === aktiv
                return (
                  <li key={t.id}>
                    <Link
                      href={t.href}
                      onClick={() => setOffen(false)}
                      aria-current={hier ? 'page' : undefined}
                      className="block rounded-2xl px-3.5 py-3 transition-colors hover:bg-[var(--ab-weich)]"
                      style={hier ? { background: 'var(--ab-weich)' } : undefined}
                    >
                      <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                        {hier && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--ab-karmin)]" />}
                        {t.name}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--ab-leise)]">{t.was}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            <div className="mt-auto border-t border-[var(--ab-linie)] pt-3 text-[12.5px] text-[var(--ab-leise)]">
              <Link href="/methode" onClick={() => setOffen(false)} className="underline underline-offset-2 hover:text-[var(--ab-tinte)]">
                Wie das gerechnet ist
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  )
}
