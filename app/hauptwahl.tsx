import Link from 'next/link'
import type { ReactNode } from 'react'

type Ui = { fg: string; muted: string; panel: string; border: string; aktiv: string; schatten: string }

/**
 * Der Umschalter oben in der Mitte: Vergleichskarte oder Velonavi, beides
 * gleich gross. Beide sind eigene Seiten, die Knöpfe deshalb Links.
 * `unten` nimmt kleinere Unterknöpfe auf (ÖV und Kultur auf der Karte).
 *
 * Nur Zürich hat einen Velonavi. In Basel und Bern bliebe von der Reihe ein
 * einzelner Knopf «Vergleich» übrig, der auf die Seite zeigt, auf der man
 * schon steht. Der fällt deshalb weg, und `unten` steht allein.
 */
export function Hauptwahl({
  ui, aktiv, vergleichHref = '/', velonavi = true, unten,
}: {
  ui: Ui
  aktiv: 'vergleich' | 'velonavi'
  /** Die Vergleichskarte der aktuellen Stadt. */
  vergleichHref?: string
  /** Nur Zürich hat einen Velonavi. */
  velonavi?: boolean
  unten?: ReactNode
}) {
  const knopf = 'flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors'
  const stil = (an: boolean) => (an ? { background: ui.aktiv, color: ui.fg } : { color: ui.muted })
  if (!velonavi)
    return <div className="pointer-events-auto mx-auto flex w-full max-w-[26rem] flex-col items-center">{unten}</div>
  return (
    <div className="pointer-events-auto mx-auto flex w-full max-w-[26rem] flex-col items-center gap-1.5">
      <div
        className="flex gap-1 rounded-full border p-1 backdrop-blur-md"
        style={{ background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten }}
      >
        {/* Auf der Karte selbst kein Link: er würde das gewählte Haus aus dem Fragment werfen. */}
        {aktiv === 'vergleich' ? (
          <span className={knopf} style={stil(true)} aria-current="page">
            Vergleich
          </span>
        ) : (
          <Link href={vergleichHref} className={knopf} style={stil(false)}>
            Vergleich
          </Link>
        )}
        {velonavi && (
          <Link href="/velonavi" className={knopf} style={stil(aktiv === 'velonavi')}>
            <VeloSymbol />
            Velonavi
          </Link>
        )}
      </div>
      {unten}
    </div>
  )
}

export function VeloSymbol({ groesse = 15 }: { groesse?: number }) {
  return (
    <svg width={groesse} height={groesse} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="5.5" cy="16.5" r="3.5" />
      <circle cx="18.5" cy="16.5" r="3.5" />
      <path d="M5.5 16.5 9 9h6l3.5 7.5M9 9l3 7.5L15 9M13.5 6H16" />
    </svg>
  )
}
