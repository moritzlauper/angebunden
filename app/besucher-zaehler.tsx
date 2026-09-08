'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { SITE_URL } from './site'

/**
 * Zählt cookielos, wie viele verschiedene Leute pro Tag da sind – über
 * GoatCounter. Die Besucher-Kennung ist ein Hash aus IP, Browser und einem
 * täglich wechselnden Salt, den GoatCounter nur im Arbeitsspeicher hält: es
 * landet nichts Personenbezogenes in einer Datenbank, und ein Consent-Banner
 * braucht es nicht. Die Tageszahlen holt die GitHub-Action `besucher-zahlen.yml`
 * einmal pro Tag über die API ab und schreibt sie nach `analytics/`.
 *
 * `count.js` zählt den ersten Seitenaufruf beim Laden selbst. Die Wechsel
 * zwischen `/`, `/basel`, `/bern` und `/methode` laufen client-seitig über
 * `next/link`, davon weiss `count.js` nichts – die zählt der Effekt hier nach.
 * Der Karten-Zustand in `location.hash` löst nichts aus: `count.js` sieht nur
 * `pathname` und `search`.
 *
 * Läuft nur auf der Produktivdomain – Vercel-Vorschau-Deploys und localhost
 * sollen die Statistik nicht verwässern (localhost filtert `count.js` ohnehin).
 */

/** Subdomain vor `.goatcounter.com`; muss zur GitHub-Action passen. */
const GC_CODE = process.env.NEXT_PUBLIC_GOATCOUNTER || 'angebunden'
const PROD_HOST = new URL(SITE_URL).host

declare global {
  interface Window {
    goatcounter?: {
      count?: (vars?: { path?: string; title?: string; referrer?: string; event?: boolean }) => void
    }
  }
}

export function BesucherZaehler() {
  const pfad = usePathname()
  const [aktiv, setAktiv] = useState(false)
  const letzterPfad = useRef<string | null>(null)

  useEffect(() => {
    const host = window.location.host
    setAktiv(host === PROD_HOST || host.endsWith('.' + PROD_HOST))
  }, [])

  useEffect(() => {
    if (!aktiv) return
    // Den ersten Aufruf hat count.js beim Laden gezählt; hier nur echte Wechsel.
    if (letzterPfad.current === null) {
      letzterPfad.current = pfad
      return
    }
    if (letzterPfad.current === pfad) return
    letzterPfad.current = pfad
    window.goatcounter?.count?.({ path: pfad })
  }, [pfad, aktiv])

  if (!aktiv) return null

  return (
    <Script
      data-goatcounter={`https://${GC_CODE}.goatcounter.com/count`}
      src="https://gc.zgo.at/count.js"
      strategy="afterInteractive"
    />
  )
}
