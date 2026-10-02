'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { kontoAngefangen, KONTO_WECHSEL } from './velonavi/konto'

type Ui = { fg: string; muted: string; panel: string; border: string; aktiv: string; schatten: string }

/**
 * Ob dieses Gerät schon ein Konto benutzt hat. Wer eines hat, kennt die Seite
 * und braucht keinen Wegweiser mehr. Vor dem Hydrieren gilt `false`, die
 * Wegweiser sind also zuerst da: Für neue Besucher, die sie brauchen, flackert
 * nichts, und wer ein Konto hat, sieht sie nur einen Moment.
 */
export function useKontoVorhanden() {
  const [vorhanden, setVorhanden] = useState(false)
  useEffect(() => {
    const pruefen = () => {
      const da = kontoAngefangen()
      setVorhanden(da)
      // Das Skript in page.tsx setzt `data-konto` vor dem Hydrieren, nach einem Abmelden muss es wieder weg.
      document.documentElement.toggleAttribute('data-konto', da)
    }
    pruefen()
    // Meldet sich jemand an, verschwinden die Wegweiser sofort, nicht erst beim nächsten Laden.
    window.addEventListener(KONTO_WECHSEL, pruefen)
    window.addEventListener('storage', pruefen)
    return () => {
      window.removeEventListener(KONTO_WECHSEL, pruefen)
      window.removeEventListener('storage', pruefen)
    }
  }, [])
  return vorhanden
}

const TEILE = [
  { id: 'velonavi', name: 'Velonavi', href: '/' },
  { id: 'erreichbarkeit', name: 'Erreichbarkeit', href: '/erreichbarkeitskarte' },
  { id: 'wohnungen', name: 'Wohnungen', href: '/wohnungen' },
] as const

/**
 * Der Umschalter zwischen den Teilen von angebunden: Velonavi,
 * Erreichbarkeitskarte und Wohnungssuche. Ein gewöhnliches Segment wie der
 * Schalter für die Darstellung, ohne Symbole und ohne eigene Farbe. Es sind
 * eigene Seiten, die Segmente deshalb Links; das aktive ist keiner, er würde
 * den Zustand im Fragment verwerfen.
 *
 * Er steht nur am Anfang, solange noch nichts gewählt ist (`anfang`), und
 * nie bei jemandem mit Konto. Danach gehört der Platz der Sache selbst.
 * Auf der Wohnungssuche steht er immer (`immer`): Dort gibt es keinen Anfang.
 */
export function Seitenwahl({
  ui, aktiv, anfang = true, immer = false,
}: {
  ui: Ui
  aktiv: (typeof TEILE)[number]['id']
  anfang?: boolean
  immer?: boolean
}) {
  const konto = useKontoVorhanden()
  if (!immer && (!anfang || konto)) return null
  const segment = 'rounded-full px-3.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors'
  const stil = (an: boolean) => (an ? { background: ui.aktiv, color: ui.fg, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : { color: ui.muted })
  return (
    <nav
      aria-label="Ansicht"
      className="flex rounded-full border p-0.5 backdrop-blur-md"
      style={{ background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten }}
    >
      {TEILE.map((t) =>
        t.id === aktiv ? (
          <span key={t.id} className={segment} style={stil(true)} aria-current="page">
            {t.name}
          </span>
        ) : (
          <Link key={t.id} href={t.href} className={segment} style={stil(false)}>
            {t.name}
          </Link>
        )
      )}
    </nav>
  )
}

