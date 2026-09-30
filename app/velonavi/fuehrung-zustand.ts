'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Graph, Route } from './router'
import { anweisungen, fortschritt, linieVon, MUSTER, vorlauf, type Anweisung } from './fuehrung.ts'
import { lies, schreib } from './teile'

const INTRO = 'velonavi.fuehrung.intro'
/** So weit neben der Route gilt man noch als auf ihr. */
const ABSEITS_M = 40
/** So lange muss man neben der Route sein, bevor es als abseits zählt. */
const ABSEITS_MS = 8000
/** Frühestens alle so viele Sekunden wird neu gerechnet. */
const NEU_S = 25
/** So nah am Ziel gilt die Fahrt als beendet. */
const ZIEL_M = 25

export type Stand = {
  naechste: Anweisung | null
  /** Meter bis zu ihr. */
  bis: number
  /** Meter bis zum Ziel. */
  rest: number
  abseits: boolean
  angekommen: boolean
}

const LEER: Stand = { naechste: null, bis: 0, rest: 0, abseits: false, angekommen: false }

/** Lässt das Gerät vibrieren, wenn es das kann. Liefert, ob es geklappt hat. */
export const vibrieren = (muster: number[]) => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && navigator.vibrate(muster)

/**
 * Geführtes Fahren: folgt der eigenen Position auf der Route und meldet Abbiegen per Vibration.
 *
 * Ein paar Sekunden vor der Kreuzung vibriert das Handy, bei höherem Tempo früher: einmal lang für
 * rechts, zweimal kurz für links, dreimal kurz für wenden, lang am Ziel. Wer die Route verlässt,
 * spürt vier kurze Stösse, der Velonavi rechnet dann von der Position aus neu.
 *
 * Das läuft in der Seite und braucht deshalb einen Bildschirm, der an bleibt. Dafür hält die Seite ihn an.
 */
export function useFuehrung({
  graph, route, neuRechnen, beiStart, beiEnde,
}: {
  graph: Graph | null
  route: Route | null
  /** Rechnet die Route von dieser Position aus neu. */
  neuRechnen: (pos: [number, number]) => void
  beiStart?: () => void
  beiEnde?: () => void
}) {
  const [aktiv, setAktiv] = useState(false)
  const [introOffen, setIntroOffen] = useState(false)
  const [pos, setPos] = useState<[number, number] | null>(null)
  const [stand, setStand] = useState<Stand>(LEER)
  const [kannVibrieren, setKannVibrieren] = useState(true)

  const liste = useMemo(() => (graph && route ? anweisungen(graph, route) : []), [graph, route])
  const linie = useMemo(() => (route ? linieVon(route) : null), [route])

  const ref = useRef({ route, liste, linie, neuRechnen, beiEnde })
  ref.current = { route, liste, linie, neuRechnen, beiEnde }
  const lauf = useRef({ fort: 0, nr: 0, gemeldet: new Set<number>(), tempo: 5, letzt: null as null | { p: [number, number]; t: number }, abseitsSeit: 0, abseitsGemeldet: false, neuSeit: 0, angekommen: false })
  const watchRef = useRef<number | null>(null)
  const sperreRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => setKannVibrieren(typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'), [])

  // Eine neue Route (zum Beispiel nach dem Neurechnen) fängt vorne an.
  useEffect(() => {
    const l = lauf.current
    l.fort = 0
    l.nr = 0
    l.gemeldet = new Set()
    l.abseitsSeit = 0
    l.abseitsGemeldet = false
    l.angekommen = false
    if (!route) setStand(LEER)
  }, [route])

  const anhalten = useCallback(() => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = null
    sperreRef.current?.release().catch(() => {})
    sperreRef.current = null
    setAktiv(false)
    setPos(null)
    setStand(LEER)
  }, [])

  const beenden = useCallback(() => {
    anhalten()
    ref.current.beiEnde?.()
  }, [anhalten])

  const auswerten = useCallback(
    (p: [number, number], speed: number | null) => {
      const { route: r, liste: a, linie: li, neuRechnen: neu } = ref.current
      const l = lauf.current
      if (!r || !li) return
      const jetzt = Date.now()
      // Tempo: das gemeldete, sonst aus dem letzten Schritt, geglättet. Steht man, bleibt der Vorlauf kurz.
      let v = speed ?? NaN
      if (!Number.isFinite(v) && l.letzt) {
        const dt = (jetzt - l.letzt.t) / 1000
        const m = 111320 * Math.cos((p[1] * Math.PI) / 180)
        if (dt > 0.5) v = Math.hypot((p[0] - l.letzt.p[0]) * m, (p[1] - l.letzt.p[1]) * 111133) / dt
      }
      if (Number.isFinite(v)) l.tempo = 0.7 * l.tempo + 0.3 * Math.min(v, 14)
      l.letzt = { p, t: jetzt }

      const f = fortschritt(li, p, l.fort)
      if (f.abstand <= ABSEITS_M) {
        l.fort = Math.max(l.fort, f.s)
        l.abseitsSeit = 0
        l.abseitsGemeldet = false
      } else {
        if (!l.abseitsSeit) l.abseitsSeit = jetzt
        if (jetzt - l.abseitsSeit > ABSEITS_MS) {
          if (!l.abseitsGemeldet) {
            l.abseitsGemeldet = true
            vibrieren(MUSTER.abseits)
          }
          if (jetzt - l.neuSeit > NEU_S * 1000) {
            l.neuSeit = jetzt
            neu(p)
          }
        }
      }
      // Kreuzungen, die man schon hinter sich hat, ohne dass es gemeldet wurde, überspringen.
      while (l.nr < a.length && a[l.nr].s < l.fort - 12) l.nr++
      const naechste = a[l.nr] ?? null
      const bis = naechste ? naechste.s - l.fort : 0
      if (naechste && !l.gemeldet.has(l.nr) && bis <= vorlauf(l.tempo)) {
        l.gemeldet.add(l.nr)
        vibrieren(MUSTER[naechste.richtung])
      }
      const rest = Math.max(0, r.distanz - l.fort)
      if (rest <= ZIEL_M && !l.angekommen) {
        l.angekommen = true
        vibrieren(MUSTER.ziel)
        window.setTimeout(() => beenden(), 8000)
      }
      setPos(p)
      setStand({ naechste, bis, rest, abseits: l.abseitsGemeldet, angekommen: l.angekommen })
    },
    [beenden]
  )

  const loslegen = useCallback(() => {
    if (!navigator.geolocation) return
    setIntroOffen(false)
    setAktiv(true)
    const l = lauf.current
    l.fort = 0
    l.nr = 0
    l.gemeldet = new Set()
    l.angekommen = false
    l.letzt = null
    navigator.wakeLock
      ?.request('screen')
      .then((s) => (sperreRef.current = s))
      .catch(() => {})
    watchRef.current = navigator.geolocation.watchPosition(
      (g) => auswerten([g.coords.longitude, g.coords.latitude], g.coords.speed),
      (e) => e.code === e.PERMISSION_DENIED && anhalten(),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 }
    )
    beiStart?.()
  }, [auswerten, anhalten, beiStart])

  /** Startet die Führung, beim ersten Mal erst mit der Einführung. */
  const beginnen = useCallback(() => {
    if (lies(INTRO, false)) loslegen()
    else setIntroOffen(true)
  }, [loslegen])

  const introFertig = useCallback(() => {
    schreib(INTRO, true)
    loslegen()
  }, [loslegen])

  // Die Bildschirmsperre fällt weg, sobald die Seite in den Hintergrund geht.
  useEffect(() => {
    if (!aktiv) return
    const sichtbar = () => document.visibilityState === 'visible' && navigator.wakeLock?.request('screen').then((s) => (sperreRef.current = s)).catch(() => {})
    document.addEventListener('visibilitychange', sichtbar)
    return () => document.removeEventListener('visibilitychange', sichtbar)
  }, [aktiv])

  // Wird die Route entfernt oder die Seite verlassen, hört die Führung auf.
  useEffect(() => {
    if (aktiv && !route) anhalten()
  }, [aktiv, route, anhalten])
  useEffect(
    () => () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
      sperreRef.current?.release().catch(() => {})
    },
    []
  )

  return {
    aktiv, introOffen, setIntroOffen, pos, stand, kannVibrieren,
    beginnen, introFertig, beenden,
    /** Für die Einführung: ein Muster zum Ausprobieren. */
    probieren: (m: keyof typeof MUSTER) => vibrieren(MUSTER[m]),
    anweisungen: liste.length,
  }
}

export type Fuehrungsstand = ReturnType<typeof useFuehrung>
