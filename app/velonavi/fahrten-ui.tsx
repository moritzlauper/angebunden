'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  anmeldeFehler, anmeldewege, codeOhnePruefwert, konto, kontoAngefangen, rueckkehr, KONTO_MOEGLICH, TABELLE, type Anbieter,
} from './konto'
import {
  deckung, lerne, spurAusGpx, spurDistanz, verdichten, zuordnen, DISTANZ_SCHRITT,
  type Fahrt, type Lernstand, type Ort, type Spurpunkt, type Vorschlag, type Zuordnung,
} from './fahrten.ts'
import type { Graph, Route } from './router'
import { ui, km, lies, minuten, schreib, Hinweis, KleinKnopf, Schalter } from './teile'

/**
 * Was der Kontobereich im Browser ablegt. Die Fahrten selbst liegen im Konto;
 * hier stehen nur die beiden Schalter und eine Aufzeichnung, die noch läuft
 * oder sich nicht speichern liess.
 */
const SCHLUESSEL = {
  aufzeichnen: 'velonavi.aufzeichnen',
  lernen: 'velonavi.lernen',
  laufend: 'velonavi.laufend',
}

/** Ungenauere Standorte (Mobilfunkzelle statt GPS) kommen nicht in die Spur. */
const GENAU_MAX = 60
/** So nah am Ziel endet die Aufzeichnung von selbst. */
const ANKUNFT = 30
/** Liegt der Anfang oder das Ende der Spur so nah am geplanten Ort, trägt die Fahrt dessen Namen. */
const ORT_NAH = 80
/** Nach einem Neuladen läuft eine Aufzeichnung weiter, wenn ihr letzter Punkt jünger ist, in Millisekunden. */
const WEITER_BIS = 10 * 60_000
/** Mehr Fahrten lädt und lernt der Velonavi nicht, die neusten zuerst. */
const FAHRTEN_MAX = 200
const FREMDER_BROWSER =
  'Die Anmeldung hat nicht geklappt. Den Link aus der E-Mail im selben Browser öffnen, in dem du ihn angefordert hast.'

const MY = 111133
const mx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)
const abstand = (lon0: number, lat0: number, lon1: number, lat1: number) =>
  Math.hypot((lon1 - lon0) * mx(lat0), (lat1 - lat0) * MY)

type Zeile = {
  id: string
  begonnen: string
  dauer_s: number
  distanz_m: number
  start: Ort
  ziel: Ort
  spur: Spurpunkt[]
  vorschlag: Vorschlag | null
  quelle: Fahrt['quelle']
}
const ausZeile = (z: Zeile): Fahrt => ({
  id: z.id, begonnen: z.begonnen, dauer: z.dauer_s, distanz: z.distanz_m,
  start: z.start, ziel: z.ziel, spur: z.spur, vorschlag: z.vorschlag, quelle: z.quelle,
})

type Offen = { beginn: number; spur: Spurpunkt[]; vorschlag: Vorschlag | null; quelle?: Fahrt['quelle'] }

/** Stand der laufenden Aufzeichnung, für die Anzeige. */
export type Aufzeichnung = {
  /** Beginn in Millisekunden seit 1970. */
  seit: number
  distanz: number
  ort: [number, number] | null
}

/**
 * Zustand und Handlungen rund ums Konto: Anmeldung, Aufzeichnung, gespeicherte
 * Fahrten und was daraus gelernt wurde.
 *
 * Der Haken sitzt im Velonavi selbst und nicht im Kontobereich. Dieser wird je
 * nach Fensterbreite im Blatt oder in der Seitenleiste gezeichnet und beim
 * Wechsel neu aufgebaut; eine laufende Aufzeichnung darf das nicht beenden.
 */
export function useFahrten({
  graph, start, ziel, benenne, zeigeStrecke,
}: {
  graph: Graph | null
  start: Ort | null
  ziel: Ort | null
  /** Der nächste bekannte Ort zu einer Koordinate. */
  benenne: (lon: number, lat: number) => Ort
  /** Start und Ziel einer Fahrt in den Routenplaner übernehmen. */
  zeigeStrecke: (f: Fahrt) => void
}) {
  // Was die Rückrufe des Standortdienstes brauchen, steht in Refs: Sie leben
  // länger als ein Anstrich und sähen sonst veraltete Werte.
  const startRef = useRef(start)
  startRef.current = start
  const zielRef = useRef(ziel)
  zielRef.current = ziel
  const benenneRef = useRef(benenne)
  benenneRef.current = benenne
  const zeigeStreckeRef = useRef(zeigeStrecke)
  zeigeStreckeRef.current = zeigeStrecke

  const [angebunden, setAngebunden] = useState(false)
  const [nutzer, setNutzer] = useState<User | null>(null)
  const [fahrten, setFahrten] = useState<Fahrt[]>([])
  const [aufzeichnen, setAufzeichnenRoh] = useState(false)
  const [lernen, setLernenRoh] = useState(true)
  const [laufend, setLaufend] = useState<Aufzeichnung | null>(null)
  const [gezeigt, setGezeigt] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const nutzerId = nutzer?.id

  // --- Anmeldung
  useEffect(() => {
    setAufzeichnenRoh(lies(SCHLUESSEL.aufzeichnen, false))
    setLernenRoh(lies(SCHLUESSEL.lernen, true))
    if (!KONTO_MOEGLICH) return
    const fehler = anmeldeFehler()
    if (fehler) setMeldung(fehler)
    else if (codeOhnePruefwert()) setMeldung(FREMDER_BROWSER)
    if (kontoAngefangen()) setAngebunden(true)
  }, [])

  useEffect(() => {
    if (!angebunden) return
    let weg = false
    let abbestellen: (() => void) | undefined
    konto()
      .then(async (sb) => {
        if (weg) return
        const { data } = sb.auth.onAuthStateChange((_ereignis, sitzung) => setNutzer(sitzung?.user ?? null))
        abbestellen = () => data.subscription.unsubscribe()
        // Scheitert das Einlösen des Codes, ist er abgelaufen oder schon benutzt.
        const { error } = await sb.auth.initialize()
        if (error && !weg) setMeldung(`Die Anmeldung hat nicht geklappt: ${error.message}`)
      })
      .catch(() => !weg && setMeldung('Die Anmeldung liess sich nicht laden.'))
    return () => {
      weg = true
      abbestellen?.()
    }
  }, [angebunden])

  const mit = useCallback(async (anbieter: Anbieter['id']) => {
    const sb = await konto()
    const { error } = await sb.auth.signInWithOAuth({ provider: anbieter, options: { redirectTo: rueckkehr() } })
    if (error) setMeldung(`Die Anmeldung hat nicht geklappt: ${error.message}`)
  }, [])

  const perMail = useCallback(async (mail: string) => {
    const sb = await konto()
    const { error } = await sb.auth.signInWithOtp({ email: mail, options: { emailRedirectTo: rueckkehr() } })
    if (error) setMeldung(`Der Anmeldelink liess sich nicht verschicken: ${error.message}`)
    return !error
  }, [])

  // --- Gespeicherte Fahrten
  useEffect(() => {
    if (!nutzerId) {
      setFahrten([])
      setGezeigt(null)
      return
    }
    let weg = false
    konto()
      .then((sb) => sb.from(TABELLE).select('*').order('begonnen', { ascending: false }).limit(FAHRTEN_MAX))
      .then(({ data, error }) => {
        if (weg) return
        if (error) setMeldung(`Die Fahrten liessen sich nicht laden: ${error.message}`)
        else setFahrten((data as Zeile[]).map(ausZeile))
      })
    return () => {
      weg = true
    }
  }, [nutzerId])

  const sichern = useCallback(async (offen: Offen): Promise<Fahrt | null> => {
    /** Der geplante Ort, wenn die Spur dort beginnt oder endet, sonst die nächste Adresse. */
    const ortFuer = (geplant: Ort | null, [lon, lat]: Spurpunkt): Ort =>
      geplant && geplant.titel !== 'Mein Standort' && abstand(geplant.lon, geplant.lat, lon, lat) < ORT_NAH
        ? { lon: geplant.lon, lat: geplant.lat, titel: geplant.titel }
        : benenneRef.current(lon, lat)
    const spur = verdichten(offen.spur)
    const distanz = spur.length ? spurDistanz(spur) : 0
    if (spur.length < 10 || distanz < 150) {
      schreib(SCHLUESSEL.laufend, null)
      setMeldung('Die Aufzeichnung war zu kurz und wurde nicht gespeichert.')
      return null
    }
    const erster = spur[0]
    const letzter = spur[spur.length - 1]
    // Der Vorschlag vom Losfahren lässt sich nur mit einer Fahrt vergleichen,
    // die am geplanten Start begann und am geplanten Ziel ankam.
    const nah = (geplant: Ort | null, [lon, lat]: Spurpunkt) => !!geplant && abstand(geplant.lon, geplant.lat, lon, lat) < ORT_NAH
    const wieGeplant = nah(startRef.current, erster) && nah(zielRef.current, letzter)
    try {
      const sb = await konto()
      const { data, error } = await sb
        .from(TABELLE)
        .insert({
          begonnen: new Date(offen.beginn + erster[2] * 1000).toISOString(),
          dauer_s: letzter[2] - erster[2],
          distanz_m: distanz,
          start: ortFuer(startRef.current, erster),
          ziel: ortFuer(zielRef.current, letzter),
          spur,
          vorschlag: wieGeplant ? offen.vorschlag : null,
          quelle: offen.quelle ?? 'aufzeichnung',
        })
        .select()
        .single()
      if (error) throw error
      schreib(SCHLUESSEL.laufend, null)
      const f = ausZeile(data as Zeile)
      setFahrten((alt) => [f, ...alt].sort((a, b) => (a.begonnen < b.begonnen ? 1 : -1)))
      return f
    } catch {
      // Die Spur bleibt im Browser liegen und wird beim nächsten Öffnen noch einmal gesichert.
      schreib(SCHLUESSEL.laufend, offen)
      setMeldung('Die Fahrt liess sich nicht speichern. Sie bleibt in diesem Browser, bis es klappt.')
      return null
    }
  }, [])

  const zeigen = useCallback((f: Fahrt | null) => {
    setGezeigt(f?.id ?? null)
    if (f) zeigeStreckeRef.current(f)
  }, [])

  // --- Aufzeichnung
  const offenRef = useRef<Offen>({ beginn: 0, spur: [], vorschlag: null })
  const distanzRef = useRef({ summe: 0, lon: 0, lat: 0 })
  const watchRef = useRef<number | null>(null)
  const sperreRef = useRef<WakeLockSentinel | null>(null)
  const beendenRef = useRef<() => void>(() => {})

  /** Hält den Bildschirm an: Im Hintergrund liefert der Browser keinen Standort. */
  const wachhalten = useCallback(() => {
    navigator.wakeLock
      ?.request('screen')
      .then((s) => (sperreRef.current = s))
      .catch(() => {})
  }, [])

  const anhalten = useCallback(() => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = null
    sperreRef.current?.release().catch(() => {})
    sperreRef.current = null
    setLaufend(null)
  }, [])

  const horchen = useCallback(() => {
    if (!navigator.geolocation) {
      setMeldung('Dieser Browser gibt keinen Standort her.')
      return false
    }
    const offen = offenRef.current
    const d = distanzRef.current
    d.summe = spurDistanz(offen.spur)
    const letzter = offen.spur[offen.spur.length - 1]
    if (letzter) (d.lon = letzter[0]), (d.lat = letzter[1])
    setLaufend({ seit: offen.beginn, distanz: d.summe, ort: letzter ? [letzter[0], letzter[1]] : null })
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude: lon, latitude: lat, accuracy } = pos.coords
        if (accuracy > GENAU_MAX) return
        const t = (Date.now() - offen.beginn) / 1000
        const vorher = offen.spur[offen.spur.length - 1]
        if (vorher && t - vorher[2] < 0.9) return
        offen.spur.push([lon, lat, t, accuracy])
        // Gezählt wird wie in `spurDistanz`.
        if (offen.spur.length === 1) (d.lon = lon), (d.lat = lat)
        const schritt = abstand(d.lon, d.lat, lon, lat)
        if (schritt >= DISTANZ_SCHRITT) (d.summe += schritt), (d.lon = lon), (d.lat = lat)
        if (offen.spur.length % 15 === 0) schreib(SCHLUESSEL.laufend, offen)
        setLaufend({ seit: offen.beginn, distanz: d.summe, ort: [lon, lat] })
        const z = zielRef.current
        if (z && t > 60 && d.summe > 200 && abstand(z.lon, z.lat, lon, lat) < ANKUNFT) beendenRef.current()
      },
      (e) => {
        if (e.code !== e.PERMISSION_DENIED) return
        anhalten()
        setMeldung('Ohne Freigabe des Standorts lässt sich keine Fahrt aufzeichnen.')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 }
    )
    wachhalten()
    return true
  }, [anhalten, wachhalten])

  const starten = useCallback(
    (vorschlag: Vorschlag | null) => {
      offenRef.current = { beginn: Date.now(), spur: [], vorschlag }
      setGezeigt(null)
      setMeldung(null)
      horchen()
    },
    [horchen]
  )

  const beenden = useCallback(async () => {
    if (watchRef.current === null) return
    anhalten()
    const f = await sichern(offenRef.current)
    if (f) zeigen(f)
  }, [anhalten, sichern, zeigen])
  beendenRef.current = beenden

  const verwerfen = useCallback(() => {
    anhalten()
    schreib(SCHLUESSEL.laufend, null)
  }, [anhalten])

  // Die Bildschirmsperre fällt weg, sobald die Seite in den Hintergrund geht.
  const laeuft = !!laufend
  useEffect(() => {
    if (!laeuft) return
    const sichtbar = () => document.visibilityState === 'visible' && wachhalten()
    document.addEventListener('visibilitychange', sichtbar)
    return () => document.removeEventListener('visibilitychange', sichtbar)
  }, [laeuft, wachhalten])

  // Beim Verlassen der Seite aufhören zu horchen. Die Spur liegt im Browser.
  useEffect(
    () => () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
      sperreRef.current?.release().catch(() => {})
    },
    []
  )

  // Was vom letzten Mal liegen blieb: Wurde die Seite mitten in der Fahrt neu
  // geladen, geht die Aufzeichnung weiter. Ist sie älter, wird sie gesichert.
  const aufgenommen = useRef(false)
  useEffect(() => {
    if (!nutzerId || aufgenommen.current) return
    aufgenommen.current = true
    const offen = lies<Offen | null>(SCHLUESSEL.laufend, null)
    const letzter = offen?.spur?.[offen.spur.length - 1]
    if (!offen || !letzter) return
    const frisch = Date.now() - (offen.beginn + letzter[2] * 1000) < WEITER_BIS
    if (frisch && offen.quelle !== 'gpx' && lies(SCHLUESSEL.aufzeichnen, false)) {
      offenRef.current = offen
      horchen()
    } else sichern(offen)
  }, [nutzerId, horchen, sichern])

  const importieren = useCallback(
    async (datei: File) => {
      const gpx = spurAusGpx(await datei.text())
      if (!gpx) {
        setMeldung('In der Datei steht keine Spur mit Zeitstempeln. Ohne Zeiten gibt es nichts auszuwerten.')
        return
      }
      const f = await sichern({ beginn: gpx.beginn, spur: gpx.spur, vorschlag: null, quelle: 'gpx' })
      if (f) zeigen(f)
    },
    [sichern, zeigen]
  )

  const loeschen = useCallback(async (welche: 'alle' | string) => {
    const sb = await konto()
    // Ohne Bedingung löscht Supabase nichts; die Datenbank lässt ohnehin nur die eigenen Zeilen zu.
    const { error } = welche === 'alle' ? await sb.from(TABELLE).delete().not('id', 'is', null) : await sb.from(TABELLE).delete().eq('id', welche)
    if (error) {
      setMeldung(`Löschen hat nicht geklappt: ${error.message}`)
      return
    }
    setFahrten((alt) => (welche === 'alle' ? [] : alt.filter((f) => f.id !== welche)))
    setGezeigt((g) => (welche === 'alle' || g === welche ? null : g))
  }, [])

  const abmelden = useCallback(async () => {
    anhalten()
    const sb = await konto()
    await sb.auth.signOut()
  }, [anhalten])

  // --- Zuordnen und Lernen
  // Jede Fahrt wird einmal je Sitzung dem Netz zugeordnet, in kleinen
  // Portionen, damit die Oberfläche zwischendurch zum Zug kommt. Eine Fahrt
  // braucht rund 20 Millisekunden.
  const zuRef = useRef(new Map<string, Zuordnung | null>())
  const [stand, setStand] = useState<Lernstand | null>(null)
  /** Zählt hoch, wenn neue Zuordnungen da sind: Die Auswertung liest sie beim nächsten Anstrich. */
  const [, setZugeordnet] = useState(0)
  useEffect(() => {
    if (!graph) return
    let weg = false
    let uhr = 0
    const offen = fahrten.filter((f) => !zuRef.current.has(f.id))
    const schritt = () => {
      if (weg) return
      const t0 = performance.now()
      while (offen.length && performance.now() - t0 < 12) {
        const f = offen.shift()!
        zuRef.current.set(f.id, zuordnen(graph, f.spur))
      }
      if (offen.length) {
        uhr = window.setTimeout(schritt, 0)
        return
      }
      const alle = fahrten.map((f) => zuRef.current.get(f.id)).filter((z): z is Zuordnung => !!z)
      setStand(alle.length ? lerne(graph, alle) : null)
      setZugeordnet((n) => n + 1)
    }
    uhr = window.setTimeout(schritt, 0)
    return () => {
      weg = true
      window.clearTimeout(uhr)
    }
  }, [graph, fahrten])

  const gezeigteFahrt = useMemo(() => fahrten.find((f) => f.id === gezeigt) ?? null, [fahrten, gezeigt])

  /** Die Spur für die Karte: die laufende Aufzeichnung, sonst die angesehene Fahrt. */
  const linie = useMemo(
    () => (laufend ? offenRef.current.spur : (gezeigteFahrt?.spur ?? [])).map(([lon, lat]): [number, number] => [lon, lat]),
    [laufend, gezeigteFahrt]
  )

  return {
    moeglich: KONTO_MOEGLICH,
    nutzer, anbinden: () => setAngebunden(true), mit, perMail, abmelden,
    fahrten, gezeigteFahrt, zeigen, loeschen, importieren,
    zuordnung: (id: string) => zuRef.current.get(id) ?? null,
    aufzeichnen,
    setAufzeichnen: (v: boolean) => {
      setAufzeichnenRoh(v)
      schreib(SCHLUESSEL.aufzeichnen, v)
    },
    laufend, starten, beenden, verwerfen, linie,
    lernen,
    setLernen: (v: boolean) => {
      setLernenRoh(v)
      schreib(SCHLUESSEL.lernen, v)
    },
    stand,
    /** Was der Router bekommt: das Gelernte, solange der Schalter an ist. */
    gelernt: lernen ? stand : null,
    meldung, setMeldung,
  }
}

export type Fahrtenstand = ReturnType<typeof useFahrten>

// ---------------------------------------------------------------- Darstellung

function dauerText(s: number) {
  const sek = Math.round(s)
  if (sek < 60) return `${sek} s`
  if (sek < 3600) return `${Math.floor(sek / 60)} Min. ${String(sek % 60).padStart(2, '0')} s`
  return `${Math.floor(sek / 3600)} h ${String(Math.floor((sek % 3600) / 60)).padStart(2, '0')} Min.`
}

function datumText(iso: string) {
  const d = new Date(iso)
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

const prozent = (anteil: number) => `${Math.round(100 * anteil)}%`

type Routen = { schnell: Route | null; komfort: Route | null }

/**
 * Konto, Aufzeichnung und vergangene Fahrten im Bedienfeld des Velonavi.
 * `routen` sind die Vorschläge, die der Routenplaner gerade zeigt.
 */
export function Kontobereich({
  f, graph, start, ziel, routen,
}: {
  f: Fahrtenstand
  graph: Graph | null
  start: Ort | null
  ziel: Ort | null
  routen: Routen | null
}) {
  if (!f.moeglich) return null
  return (
    <section className="flex flex-col gap-2.5 border-t pt-3" style={{ borderColor: ui.border }}>
      {f.meldung && (
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <Hinweis>{f.meldung}</Hinweis>
          </div>
          <button onClick={() => f.setMeldung(null)} aria-label="Hinweis schliessen" className="px-1 text-[16px] leading-none" style={{ color: ui.muted }}>
            ×
          </button>
        </div>
      )}
      {f.nutzer ? (
        <Angemeldet f={f} graph={graph} start={start} ziel={ziel} routen={routen} />
      ) : (
        <Anmeldung f={f} />
      )}
    </section>
  )
}

/**
 * Losfahren und Anhalten stehen zuoberst im Bedienfeld: Unterwegs soll man
 * danach nicht unter Höhenprofil und Einstellungen suchen müssen.
 */
export function Fahrtknopf({ f, routen, wahl }: { f: Fahrtenstand; routen: Routen | null; wahl: string | null }) {
  if (!f.nutzer) return null
  if (f.laufend) return <Laufend f={f} />
  if (!f.aufzeichnen) return null
  const losfahren = () =>
    f.starten(
      routen && wahl
        ? {
            wahl,
            schnell: routen.schnell ? { zeit: routen.schnell.zeit, distanz: routen.schnell.distanz } : undefined,
            komfort: routen.komfort ? { zeit: routen.komfort.zeit, distanz: routen.komfort.distanz } : undefined,
          }
        : null
    )
  return (
    <button
      onClick={losfahren}
      className="rounded-full border px-3.5 py-2 text-[13px] font-medium"
      style={{ background: ui.fg, borderColor: ui.fg, color: ui.bg }}
    >
      Fahrt aufzeichnen
    </button>
  )
}

function Anmeldung({ f }: { f: Fahrtenstand }) {
  const [offen, setOffen] = useState(false)
  const [wege, setWege] = useState<{ anbieter: Anbieter[]; mail: boolean } | 'fehler' | null>(null)
  const [mail, setMail] = useState('')
  const [geschickt, setGeschickt] = useState(false)
  const [wartet, setWartet] = useState(false)

  const oeffnen = () => {
    setOffen(true)
    f.anbinden()
    anmeldewege().then(setWege, () => setWege('fehler'))
  }

  if (!offen)
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] leading-snug">
          Fahrten aufzeichnen
          <span className="block text-[11px]" style={{ color: ui.muted }}>
            Mit Konto: Fahrten auswerten, und der Velonavi lernt aus ihnen.
          </span>
        </p>
        <KleinKnopf onClick={oeffnen} titel="Im Velonavi anmelden">
          Anmelden
        </KleinKnopf>
      </div>
    )

  const feld = 'w-full rounded-full border px-3.5 py-2 text-[13px] outline-none'
  const knopf = 'w-full rounded-full border px-3.5 py-2 text-[13px] font-medium disabled:opacity-50'
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold">Anmelden</h3>
        <button onClick={() => setOffen(false)} className="text-[12px] underline underline-offset-2" style={{ color: ui.muted }}>
          Abbrechen
        </button>
      </div>
      {wege === null && (
        <p className="text-[12px]" style={{ color: ui.muted }}>
          Anmeldung wird geladen …
        </p>
      )}
      {wege === 'fehler' && <Hinweis>Die Anmeldung ist gerade nicht erreichbar.</Hinweis>}
      {wege && wege !== 'fehler' && (
        <>
          {wege.anbieter.map((a) => (
            <button key={a.id} onClick={() => f.mit(a.id)} className={knopf} style={{ borderColor: ui.fg, color: ui.fg }}>
              Mit {a.name} anmelden
            </button>
          ))}
          {wege.mail &&
            (geschickt ? (
              <p className="rounded-2xl px-3 py-2 text-[12px] leading-snug" style={{ background: ui.weich }}>
                Der Anmeldelink ist unterwegs an {mail}. Öffne ihn in diesem Browser.
              </p>
            ) : (
              <form
                className="flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setWartet(true)
                  setGeschickt(await f.perMail(mail.trim()))
                  setWartet(false)
                }}
              >
                <label className="flex flex-col gap-1 text-[12px]">
                  <span style={{ color: ui.muted }}>{wege.anbieter.length ? 'Oder per E-Mail, ohne Passwort' : 'E-Mail, ohne Passwort'}</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={mail}
                    onChange={(e) => setMail(e.target.value)}
                    placeholder="du@beispiel.ch"
                    className={feld}
                    style={{ background: ui.bg, borderColor: ui.border, color: ui.fg }}
                  />
                </label>
                <button type="submit" disabled={wartet} className={knopf} style={{ background: ui.fg, borderColor: ui.fg, color: ui.bg }}>
                  {wartet ? 'Wird verschickt …' : 'Anmeldelink schicken'}
                </button>
              </form>
            ))}
        </>
      )}
      <p className="text-[11px] leading-snug" style={{ color: ui.muted }}>
        Das Konto gibt es nur im Velonavi. Gespeichert werden die E-Mail-Adresse und, wenn du es einschaltest, die
        GPS-Spuren deiner Fahrten. Sie liegen bei Supabase und sind nur für dich lesbar. Ohne Anmeldung bleibt alles
        im Browser.
      </p>
    </div>
  )
}

function Angemeldet({
  f, graph, start, ziel, routen,
}: {
  f: Fahrtenstand
  graph: Graph | null
  start: Ort | null
  ziel: Ort | null
  routen: Routen | null
}) {
  const [alle, setAlle] = useState(false)
  const datei = useRef<HTMLInputElement>(null)
  const liste = alle ? f.fahrten : f.fahrten.slice(0, 5)

  return (
    <>
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="truncate" style={{ color: ui.muted }}>
          {f.nutzer?.email ?? 'Angemeldet'}
        </span>
        <button onClick={f.abmelden} className="shrink-0 underline underline-offset-2">
          Abmelden
        </button>
      </div>

      <Schalter
        an={f.aufzeichnen}
        setAn={f.setAufzeichnen}
        titel="Fahrten aufzeichnen"
        hilfe="Zeigt oben den Knopf zum Losfahren. Gespeichert werden Standort und Zeit, solange die Seite offen und der Bildschirm an ist"
      />

      <Schalter
        an={f.lernen}
        setAn={f.setLernen}
        titel="Aus meinen Fahrten lernen"
        hilfe={
          f.stand
            ? `${f.stand.fahrten} ${f.stand.fahrten === 1 ? 'Fahrt' : 'Fahrten'}, ${f.stand.abschnitte} Abschnitte, ${f.stand.ampeln} Ampeln. ${tempoText(f.stand.tempo)}`
            : 'Passt Fahrzeiten und Wartezeiten an Ampeln an das an, was du gefahren bist'
        }
      />

      {f.gezeigteFahrt && (
        <Auswertung
          f={f}
          fahrt={f.gezeigteFahrt}
          graph={graph}
          start={start}
          ziel={ziel}
          routen={routen}
        />
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[12px] font-medium">Vergangene Fahrten</h3>
          <button onClick={() => datei.current?.click()} className="text-[12px] underline underline-offset-2" style={{ color: ui.muted }} title="Eine Fahrt aus einem Velocomputer oder einer App übernehmen">
            GPX einlesen
          </button>
          <input
            ref={datei}
            type="file"
            accept=".gpx,application/gpx+xml"
            className="hidden"
            onChange={(e) => {
              const d = e.target.files?.[0]
              if (d) f.importieren(d)
              e.target.value = ''
            }}
          />
        </div>
        {f.fahrten.length === 0 && (
          <p className="text-[12px]" style={{ color: ui.muted }}>
            Noch keine.
          </p>
        )}
        <ul className="-mx-2 flex flex-col">
          {liste.map((x) => (
            <li key={x.id}>
              <button
                onClick={() => f.zeigen(f.gezeigteFahrt?.id === x.id ? null : x)}
                aria-pressed={f.gezeigteFahrt?.id === x.id}
                className="zeile flex w-full items-baseline justify-between gap-3 rounded-xl px-2 py-1.5 text-left text-[12px]"
                style={{ '--weich': ui.weich, background: f.gezeigteFahrt?.id === x.id ? ui.weich : undefined } as React.CSSProperties}
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {x.start.titel} → {x.ziel.titel}
                  </span>
                  <span className="block text-[11px]" style={{ color: ui.muted }}>
                    {datumText(x.begonnen)}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: ui.muted }}>
                  {minuten(x.dauer)} · {km(x.distanz)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {f.fahrten.length > 5 && (
          <button onClick={() => setAlle(!alle)} className="self-start text-[12px] underline underline-offset-2">
            {alle ? 'Weniger anzeigen' : `Alle ${f.fahrten.length} anzeigen`}
          </button>
        )}
        {f.fahrten.length > 0 && (
          <button
            onClick={() => window.confirm('Alle aufgezeichneten Fahrten endgültig löschen?') && f.loeschen('alle')}
            className="self-start text-[11px] underline underline-offset-2"
            style={{ color: ui.muted }}
          >
            Alle Fahrten löschen
          </button>
        )}
      </div>
    </>
  )
}

/** Das eigene Tempo im Vergleich zu den 23 km/h, mit denen das Modell in der Ebene rechnet. */
function tempoText(tempo: number) {
  const p = Math.round(100 * Math.abs(1 - tempo))
  if (p < 2) return 'Dein Tempo entspricht dem Modell.'
  return `Du brauchst ${p}% ${tempo < 1 ? 'weniger' : 'mehr'} Fahrzeit als das Modell.`
}

function Laufend({ f }: { f: Fahrtenstand }) {
  // Der Standort kommt nicht im Sekundentakt, die Uhr soll trotzdem laufen.
  const [jetzt, setJetzt] = useState(() => Date.now())
  useEffect(() => {
    const uhr = window.setInterval(() => setJetzt(Date.now()), 1000)
    return () => window.clearInterval(uhr)
  }, [])
  if (!f.laufend) return null
  return (
    <div className="flex flex-col gap-2 rounded-2xl px-3 py-2.5" style={{ background: ui.weich }}>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="font-medium">Aufzeichnung läuft</span>
        <span className="tabular-nums" style={{ color: ui.muted }}>
          {f.laufend.ort ? `${dauerText((jetzt - f.laufend.seit) / 1000)} · ${km(f.laufend.distanz)}` : 'Warte auf den Standort …'}
        </span>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={f.beenden}
          className="flex-1 rounded-full border px-3 py-1.5 text-[12px] font-medium"
          style={{ background: ui.fg, borderColor: ui.fg, color: ui.bg }}
        >
          Beenden und speichern
        </button>
        <KleinKnopf onClick={f.verwerfen} titel="Aufzeichnung abbrechen, ohne sie zu speichern">
          Verwerfen
        </KleinKnopf>
      </div>
      <p className="text-[11px] leading-snug" style={{ color: ui.muted }}>
        Am Ziel endet die Aufzeichnung von selbst. Der Bildschirm bleibt an, die Seite muss im Vordergrund sein.
      </p>
    </div>
  )
}

/** Eine Fahrt im Rückblick: was gemessen wurde, und wie sie zu den Vorschlägen steht. */
function Auswertung({
  f, fahrt, graph, start, ziel, routen,
}: {
  f: Fahrtenstand
  fahrt: Fahrt
  graph: Graph | null
  start: Ort | null
  ziel: Ort | null
  routen: Routen | null
}) {
  const z = f.zuordnung(fahrt.id)
  const dauer = z ? z.netto : fahrt.dauer
  const distanz = z ? z.distanz : fahrt.distanz
  // Die heutigen Vorschläge gelten nur, solange der Routenplaner noch die Strecke der Fahrt zeigt.
  const gleich = (a: Ort | null, b: Ort) => !!a && a.lon === b.lon && a.lat === b.lat
  const heute = gleich(start, fahrt.start) && gleich(ziel, fahrt.ziel) ? routen : null

  const zeilen: { titel: string; wert: string; hilfe?: string }[] = []
  if (z) {
    const halte = z.ampeln.filter((a) => a.gewartet > 0).length
    zeilen.push({
      titel: 'Gestanden an Ampeln',
      wert: halte ? dauerText(z.gewartet) : 'gar nicht',
      hilfe: `${halte} von ${z.ampeln.length} Ampeln rot`,
    })
    if (z.pausen > 0) zeilen.push({ titel: 'Pausen', wert: dauerText(z.pausen), hilfe: 'zählen nicht zur Fahrzeit' })
  }
  const damals = fahrt.vorschlag?.schnell
  if (damals)
    zeilen.push({
      titel: '«Schnell» beim Losfahren',
      wert: dauerText(damals.zeit),
      hilfe: unterschied(dauer, damals.zeit),
    })
  if (z) zeilen.push({ titel: 'Modell für deine Strecke', wert: dauerText(z.modell), hilfe: 'ohne Gelerntes, bei 23 km/h in der Ebene' })
  if (heute && graph && z)
    for (const [titel, r] of [['«Schnell» heute', heute.schnell], ['«Komfort» heute', heute.komfort]] as const)
      if (r) zeilen.push({ titel, wert: dauerText(r.zeit), hilfe: `folgt zu ${prozent(deckung(graph, z.stuecke, r))} deiner Strecke` })

  return (
    <div className="flex flex-col gap-2 rounded-2xl border px-3 py-2.5" style={{ borderColor: ui.border }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[12px]">
          <div className="truncate font-medium">
            {fahrt.start.titel} → {fahrt.ziel.titel}
          </div>
          <div className="text-[11px]" style={{ color: ui.muted }}>
            {datumText(fahrt.begonnen)}
            {fahrt.quelle === 'gpx' && ' · aus GPX'}
          </div>
        </div>
        <button onClick={() => f.zeigen(null)} aria-label="Auswertung schliessen" className="px-1 text-[16px] leading-none" style={{ color: ui.muted }}>
          ×
        </button>
      </div>
      <div>
        <div className="text-[22px] font-semibold leading-none tracking-tight tabular-nums">{dauerText(dauer)}</div>
        <div className="mt-1 text-[12px] tabular-nums" style={{ color: ui.muted }}>
          {km(distanz)} · {((distanz / Math.max(dauer, 1)) * 3.6).toFixed(1)} km/h
        </div>
      </div>
      {!z && (
        <p className="text-[11px] leading-snug" style={{ color: ui.muted }}>
          {graph ? 'Die Spur liess sich dem Velonetz nicht zuordnen. Sie liegt wohl ausserhalb der Stadt.' : 'Velonetz wird geladen …'}
        </p>
      )}
      {z && z.treffer < 0.7 && (
        <p className="text-[11px] leading-snug" style={{ color: ui.muted }}>
          Nur {prozent(z.treffer)} der Spur liegen auf dem Velonetz. Aus dieser Fahrt wird nichts gelernt.
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        {zeilen.map((x) => (
          <div key={x.titel} className="contents">
            <dt style={{ color: ui.muted }}>{x.titel}</dt>
            <dd className="text-right tabular-nums">
              {x.wert}
              {x.hilfe && (
                <span className="block text-[11px]" style={{ color: ui.muted }}>
                  {x.hilfe}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-2">
        {heute ? (
          <span className="text-[11px]" style={{ color: ui.muted }}>
            Violett auf der Karte: deine Spur.
          </span>
        ) : (
          <button onClick={() => f.zeigen(fahrt)} className="text-[12px] underline underline-offset-2">
            Mit heutigem Vorschlag vergleichen
          </button>
        )}
        <button
          onClick={() => window.confirm('Diese Fahrt endgültig löschen?') && f.loeschen(fahrt.id)}
          className="shrink-0 text-[12px] underline underline-offset-2"
          style={{ color: ui.muted }}
        >
          Löschen
        </button>
      </div>
    </div>
  )
}

/** «1 Min. 20 s schneller gefahren» oder «… langsamer», ab fünf Sekunden Unterschied. */
function unterschied(gefahren: number, vorschlag: number) {
  const d = Math.round(vorschlag - gefahren)
  if (Math.abs(d) < 5) return 'du warst gleich schnell'
  return `du warst ${dauerText(Math.abs(d))} ${d > 0 ? 'schneller' : 'langsamer'}`
}
