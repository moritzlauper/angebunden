import type { ReactNode } from 'react'
import { Seitenwahl } from './seitenwahl'

type Ui = { fg: string; muted: string; panel: string; border: string; aktiv: string; schatten: string }

/**
 * Der Umschalter oben in der Mitte der Erreichbarkeitskarte: dasselbe Segment
 * wie im Velonavi (`Seitenwahl`), darunter die kleineren Knöpfe für ÖV und
 * Kultur (`unten`).
 *
 * Nur Zürich hat einen Velonavi. In Basel und Bern fällt das Segment weg, und
 * `unten` steht allein: Ein einzelnes Segment, das auf die Seite zeigt, auf
 * der man schon steht, wäre nur Dekoration.
 */
export function Hauptwahl({ ui, velonavi = true, anfang = true, unten }: { ui: Ui; velonavi?: boolean; /** Noch nichts gewählt: nur dann steht das Segment da. */ anfang?: boolean; unten?: ReactNode }) {
  if (!velonavi) return <div className="pointer-events-auto mx-auto flex w-full max-w-[26rem] flex-col items-center">{unten}</div>
  return (
    <div className="pointer-events-auto mx-auto flex w-full max-w-[26rem] flex-col items-center gap-1.5">
      <Seitenwahl ui={ui} aktiv="erreichbarkeit" anfang={anfang} />
      {unten}
    </div>
  )
}
