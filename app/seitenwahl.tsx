import Link from 'next/link'

type Ui = { fg: string; muted: string; panel: string; border: string; aktiv: string; weich: string; schatten: string }

/**
 * Der Umschalter zwischen den beiden Teilen von angebunden: Velonavi und
 * Erreichbarkeitskarte. Ein gewöhnliches Segment wie der Schalter für die
 * Darstellung, ohne Symbole und ohne eigene Farbe. Es sind zwei Seiten, die
 * Segmente deshalb Links; das aktive ist keiner, er würde die Route im
 * Fragment verwerfen.
 */
export function Seitenwahl({ ui, aktiv }: { ui: Ui; aktiv: 'velonavi' | 'erreichbarkeit' }) {
  const segment = 'rounded-full px-3.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors'
  const stil = (an: boolean) => (an ? { background: ui.aktiv, color: ui.fg, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : { color: ui.muted })
  return (
    <nav
      aria-label="Ansicht"
      className="flex rounded-full border p-0.5 backdrop-blur-md"
      style={{ background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten }}
    >
      {aktiv === 'velonavi' ? (
        <span className={segment} style={stil(true)} aria-current="page">
          Velonavi
        </span>
      ) : (
        <Link href="/" className={segment} style={stil(false)}>
          Velonavi
        </Link>
      )}
      {aktiv === 'erreichbarkeit' ? (
        <span className={segment} style={stil(true)} aria-current="page">
          Erreichbarkeit
        </span>
      ) : (
        <Link href="/erreichbarkeitskarte" className={segment} style={stil(false)}>
          Erreichbarkeit
        </Link>
      )}
    </nav>
  )
}
