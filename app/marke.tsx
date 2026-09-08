/**
 * Die Wortmarke: «angebunden» klein geschrieben, dahinter ein roter Punkt.
 * Der Punkt ist der Anschlusspunkt ans Netz – dieselbe Farbe, in der die Karte
 * die vordersten Ränge und die beiden Extrempunkte markiert.
 *
 * Reine Darstellung, keine Hooks: läuft im Server- wie im Client-Baum.
 */

/** Rot der Hervorhebung, deckungsgleich mit RANG_RAMPE[2] in karte.tsx. */
export const PUNKT = '#dc2626'

export function Wortmarke({
  size = 15,
  className,
  style,
  punkt = PUNKT,
}: {
  size?: number
  className?: string
  style?: React.CSSProperties
  punkt?: string
}) {
  const d = Math.max(2, Math.round(size * 0.24))
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'flex-end',
        fontSize: size,
        fontWeight: 600,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      angebunden
      <span
        aria-hidden
        style={{
          width: d,
          height: d,
          marginLeft: Math.round(size * 0.07),
          marginBottom: Math.round(size * 0.04),
          borderRadius: 999,
          background: punkt,
        }}
      />
    </span>
  )
}

/**
 * Nur das Zeichen: eine kurze Spur, die in einem roten Punkt endet. Für Stellen,
 * an denen der Schriftzug nicht hinpasst.
 */
export function Signet({ size = 24, farbe = 'currentColor', punkt = PUNKT }: {
  size?: number
  farbe?: string
  punkt?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M5 16h13" stroke={farbe} strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="23" cy="16" r="5" fill={punkt} />
    </svg>
  )
}
