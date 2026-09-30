'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

type Ui = { fg: string; panel: string; border: string; schatten: string }

/** Reagiert auf eine CSS-Medienabfrage. Vor dem ersten Anstrich gilt `false`. */
export function useMedienabfrage(abfrage: string) {
  const [passt, setPasst] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(abfrage)
    const merke = () => setPasst(mq.matches)
    merke()
    mq.addEventListener('change', merke)
    return () => mq.removeEventListener('change', merke)
  }, [abfrage])
  return passt
}

/** Anteil der Fensterhöhe, den das halb offene Blatt einnimmt. */
const HALB = 0.42

type Rast = 'zu' | 'halb' | 'voll'

type Zug = {
  id: number
  y0: number
  start: number
  aktiv: boolean
  aktuell: number
  letztY: number
  letztZeit: number
  tempo: number
}

/**
 * Das Blatt, das auf dem Handy am unteren Rand hereinfährt: halb offen deckt
 * es das untere Drittel, hochgezogen fast den ganzen Schirm – wie die
 * Ortskarte in Google Maps. Gezogen wird am Griff, im halb offenen Zustand
 * auch am Inhalt, dort erst ab sechs Pixeln Weg, sonst verschluckt der Zug
 * die Klicks auf die Knöpfe darin.
 */
export function Blatt({
  ui, offen, onSchliessen, onHoehe, children,
}: {
  ui: Ui
  offen: boolean
  onSchliessen: () => void
  onHoehe?: (h: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [hoehe, setHoehe] = useState(0)
  const [sicht, setSicht] = useState(0)
  const [rast, setRast] = useState<Rast>('zu')
  const [ziehend, setZiehend] = useState(false)
  const [verschub, setVerschub] = useState<number | null>(null)
  const zugRef = useRef<Zug | null>(null)

  // Die Höhe richtet sich nach dem Inhalt, gedeckelt auf 88 % des Schirms.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const messen = () => setHoehe(el.offsetHeight)
    messen()
    const ro = new ResizeObserver(messen)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const messen = () => setSicht(window.innerHeight)
    messen()
    window.addEventListener('resize', messen)
    return () => window.removeEventListener('resize', messen)
  }, [])

  const halbeHoehe = Math.min(hoehe, Math.max(200, Math.round(sicht * HALB)))
  const ziel = (r: Rast) => (r === 'voll' ? 0 : r === 'halb' ? hoehe - halbeHoehe : hoehe)

  useEffect(() => setRast(offen ? 'halb' : 'zu'), [offen])

  // Ausserhalb des Ziehens bestimmt die Rastung die Lage – auch wenn der Inhalt
  // wächst oder das Fenster sich dreht.
  useEffect(() => {
    if (!ziehend) setVerschub(ziel(rast))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rast, hoehe, halbeHoehe, ziehend])

  // Die Karte soll den Ausschnitt über dem Blatt nutzen, nicht den ganzen Schirm.
  useEffect(() => {
    onHoehe?.(offen ? Math.max(0, hoehe - ziel(rast)) : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rast, hoehe, halbeHoehe, offen])

  const rasten = (r: Rast) => {
    setRast(r)
    if (r === 'zu') onSchliessen()
  }

  const beginn = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    zugRef.current = {
      id: e.pointerId,
      y0: e.clientY,
      start: verschub ?? 0,
      aktiv: false,
      aktuell: verschub ?? 0,
      letztY: e.clientY,
      letztZeit: performance.now(),
      tempo: 0,
    }
  }

  const bewegung = (e: React.PointerEvent) => {
    const z = zugRef.current
    if (!z || z.id !== e.pointerId) return
    const weg = e.clientY - z.y0
    if (!z.aktiv) {
      if (Math.abs(weg) < 6) return
      z.aktiv = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setZiehend(true)
    }
    const jetzt = performance.now()
    const dt = jetzt - z.letztZeit
    if (dt > 0) z.tempo = (e.clientY - z.letztY) / dt
    z.letztY = e.clientY
    z.letztZeit = jetzt
    z.aktuell = Math.min(hoehe, Math.max(0, z.start + weg))
    setVerschub(z.aktuell)
  }

  const schluss = (e: React.PointerEvent) => {
    const z = zugRef.current
    if (!z || z.id !== e.pointerId) return
    zugRef.current = null
    if (!z.aktiv) return
    setZiehend(false)

    // Ein schneller Wisch zählt mehr als die Nähe zur Rastung: wer runterwischt,
    // will schliessen, auch wenn das Blatt noch fast ganz offen ist.
    if (z.tempo > 0.6) return rasten(z.aktuell > hoehe - halbeHoehe - 8 ? 'zu' : 'halb')
    if (z.tempo < -0.6) return rasten('voll')

    const naechste = ([['voll', 0], ['halb', hoehe - halbeHoehe], ['zu', hoehe]] as [Rast, number][])
      .sort((a, b) => Math.abs(a[1] - z.aktuell) - Math.abs(b[1] - z.aktuell))[0][0]
    rasten(naechste)
  }

  const zugAmInhalt = rast !== 'voll'

  // Ganz offen scrollt der Inhalt. Steht er dabei ganz oben, zieht ein Wisch nach unten das Blatt
  // herunter, wie bei jedem Blatt auf dem Handy. Die Zeiger-Ereignisse reichen dafür nicht: Sobald der
  // Browser einen Wisch als Scrollen übernimmt, bricht er sie ab. Deshalb echte Touch-Ereignisse,
  // die das Scrollen mit `preventDefault` verhindern dürfen.
  const inhaltRef = useRef<HTMLDivElement>(null)
  const stand = useRef({ rast, hoehe, halbeHoehe, rasten })
  stand.current = { rast, hoehe, halbeHoehe, rasten }
  useEffect(() => {
    const el = inhaltRef.current
    if (!el) return
    let y0 = 0
    let aktiv = false
    let letztY = 0
    let letztZeit = 0
    let tempo = 0
    let aktuell = 0
    const runter = (e: TouchEvent) => {
      y0 = letztY = e.touches[0].clientY
      letztZeit = performance.now()
      aktiv = false
      tempo = 0
    }
    const bewegt = (e: TouchEvent) => {
      const { rast: r, hoehe: h } = stand.current
      if (r !== 'voll') return
      const y = e.touches[0].clientY
      const weg = y - y0
      if (!aktiv) {
        if (el.scrollTop > 0 || weg < 8) return
        aktiv = true
        setZiehend(true)
      }
      e.preventDefault()
      const jetzt = performance.now()
      const dt = jetzt - letztZeit
      if (dt > 0) tempo = (y - letztY) / dt
      letztY = y
      letztZeit = jetzt
      aktuell = Math.min(h, Math.max(0, weg))
      setVerschub(aktuell)
    }
    const hoch = () => {
      if (!aktiv) return
      aktiv = false
      setZiehend(false)
      const { hoehe: h, halbeHoehe: hh, rasten: ra } = stand.current
      // Von ganz offen aus: ein Stück oder ein schneller Wisch bis halb, weit bis zu.
      if (tempo > 0.6) return ra(aktuell > (h - hh) * 0.9 ? 'zu' : 'halb')
      const naechste = ([['voll', 0], ['halb', h - hh], ['zu', h]] as [Rast, number][]).sort((a, b) => Math.abs(a[1] - aktuell) - Math.abs(b[1] - aktuell))[0][0]
      ra(naechste)
    }
    el.addEventListener('touchstart', runter, { passive: true })
    el.addEventListener('touchmove', bewegt, { passive: false })
    el.addEventListener('touchend', hoch)
    el.addEventListener('touchcancel', hoch)
    return () => {
      el.removeEventListener('touchstart', runter)
      el.removeEventListener('touchmove', bewegt)
      el.removeEventListener('touchend', hoch)
      el.removeEventListener('touchcancel', hoch)
    }
  }, [])

  return (
    <div
      ref={ref}
      className="fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t backdrop-blur-md"
      style={{
        background: ui.panel,
        borderColor: ui.border,
        color: ui.fg,
        boxShadow: '0 -8px 30px -8px rgba(0,0,0,0.35)',
        maxHeight: '88dvh',
        transform: verschub === null ? 'translateY(100%)' : `translateY(${verschub}px)`,
        transition: ziehend ? 'none' : 'transform 340ms cubic-bezier(0.32,0.72,0,1)',
        pointerEvents: rast === 'zu' ? 'none' : 'auto',
        visibility: rast === 'zu' && !ziehend ? 'hidden' : 'visible',
      }}
      role="dialog"
      aria-hidden={!offen}
    >
      <div
        onPointerDown={beginn}
        onPointerMove={bewegung}
        onPointerUp={schluss}
        onPointerCancel={schluss}
        className="shrink-0 touch-none select-none px-4 pb-3 pt-4"
      >
        <div className="mx-auto h-1 w-10 rounded-full" style={{ background: ui.border }} />
      </div>

      <div
        ref={inhaltRef}
        onPointerDown={zugAmInhalt ? beginn : undefined}
        onPointerMove={zugAmInhalt ? bewegung : undefined}
        onPointerUp={zugAmInhalt ? schluss : undefined}
        onPointerCancel={zugAmInhalt ? schluss : undefined}
        className="min-h-0 flex-1 px-4 pt-1"
        style={{
          overflowY: zugAmInhalt ? 'hidden' : 'auto',
          overscrollBehavior: 'contain',
          touchAction: zugAmInhalt ? 'none' : 'pan-y',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
