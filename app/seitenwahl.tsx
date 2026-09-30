'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { kontoAngefangen } from './velonavi/konto'

type Ui = { fg: string; muted: string; panel: string; border: string; aktiv: string; schatten: string }

/**
 * Ob dieses Gerät schon ein Konto benutzt hat. Wer eines hat, kennt die Seite
 * und braucht keinen Wegweiser mehr. Vor dem Hydrieren gilt `false`, die
 * Wegweiser sind also zuerst da: Für neue Besucher, die sie brauchen, flackert
 * nichts, und wer ein Konto hat, sieht sie nur einen Moment.
 */
export function useKontoVorhanden() {
  const [vorhanden, setVorhanden] = useState(false)
  useEffect(() => setVorhanden(kontoAngefangen()), [])
  return vorhanden
}

/**
 * Der Umschalter zwischen den beiden Teilen von angebunden: Velonavi und
 * Erreichbarkeitskarte. Ein gewöhnliches Segment wie der Schalter für die
 * Darstellung, ohne Symbole und ohne eigene Farbe. Es sind zwei Seiten, die
 * Segmente deshalb Links; das aktive ist keiner, er würde die Route im
 * Fragment verwerfen.
 *
 * Er steht nur am Anfang, solange noch nichts gewählt ist (`anfang`), und
 * nie bei jemandem mit Konto. Danach gehört der Platz der Sache selbst.
 */
export function Seitenwahl({ ui, aktiv, anfang = true }: { ui: Ui; aktiv: 'velonavi' | 'erreichbarkeit'; anfang?: boolean }) {
  const konto = useKontoVorhanden()
  if (!anfang || konto) return null
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
