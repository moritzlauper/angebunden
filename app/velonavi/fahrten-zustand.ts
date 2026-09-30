'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  anmeldeFehler, codeOhnePruefwert, konto, kontoAngefangen, rueckkehr, KONTO_MOEGLICH, TABELLE, type Anbieter,
} from './konto'
import {
  lerne, spurAusGpx, spurDistanz, verdichten, zuordnen, DISTANZ_SCHRITT,
  type Fahrt, type Lernstand, type Ort, type Spurpunkt, type Vorschlag, type Zuordnung,
} from './fahrten.ts'
import type { Lauf, Teilstrecke } from './vergleich.ts'
import { alleEntfernen, alleFahrten, entfernen, speichern, type Gespeichert } from './ablage.ts'
import { tracker, type NativeFahrt, type NativStatus, type Tracker } from './native.ts'
import { ausKonto, fuerKonto, type Zeile } from './sicherung.ts'
import { beitrag, type Gemeinschaft } from './gemeinschaft.ts'
import { ladeGemeinschaft, sendeBeitrag } from './gemeinschaft-netz'
import { lies, schreib } from './teile'

/**
 * Was der Kontobereich im Browser ablegt. Die Fahrten selbst liegen in
 * IndexedDB (`ablage.ts`); hier stehen nur die Schalter und eine Aufzeichnung,
 * die noch läuft oder sich nicht speichern liess.
 */
const SCHLUESSEL = {
  aufzeichnen: 'velonavi.aufzeichnen',
  lernen: 'velonavi.lernen',
  sicherung: 'velonavi.sicherung',
  vonAnderen: 'velonavi.vonanderen',
  beitragen: 'velonavi.beitragen',
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

type Offen = { beginn: number; spur: Spurpunkt[]; vorschlag: Vorschlag | null; quelle?: Fahrt['quelle'] }

/** Stand der laufenden Aufzeichnung, für die Anzeige. */
export type Aufzeichnung = {
  /** Beginn in Millisekunden seit 1970. */
  seit: number
  distanz: number
  ort: [number, number] | null
}

/** Eine Linie auf der Karte: die Hauptfahrt in Violett, Vergleichswege grau. */
export type Linie = { koord: [number, number][]; rolle: 'haupt' | 'daneben' }

const alsLinie = (spur: Spurpunkt[], rolle: Linie['rolle']): Linie => ({ koord: spur.map(([lon, lat]) => [lon, lat]), rolle })

/**
 * Zustand und Handlungen rund um Fahrten: Aufzeichnen, Ablegen, Auswerten,
 * Lernen, Vergleichen und die freiwillige Sicherung im Konto.
 *
 * Alles funktioniert ohne Konto und ohne Server. Das Konto ist eine Sicherung:
 * Es holt Fahrten von anderen Geräten und nimmt gekürzte Kopien (`sicherung.ts`).
 *
 * Der Haken sitzt im Velonavi selbst und nicht im Menü. Dieses wird je nach
 * Fensterbreite an anderer Stelle gezeichnet und neu aufgebaut; eine laufende
 * Aufzeichnung darf das nicht beenden.
 */
export function useFahrten({
  graph, start, ziel, benenne, zeigeStrecke,
}: {
  graph: import('./router').Graph | null
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

  const [fahrten, setFahrten] = useState<Gespeichert[]>([])
  const fahrtenRef = useRef(fahrten)
  fahrtenRef.current = fahrten
  const [geladen, setGeladen] = useState(false)
  const [angebunden, setAngebunden] = useState(false)
  const [nutzer, setNutzer] = useState<User | null>(null)
  const [aufzeichnen, setAufzeichnenRoh] = useState(true)
  const [lernen, setLernenRoh] = useState(true)
  const [sicherung, setSicherungRoh] = useState(false)
  const [vonAnderen, setVonAnderenRoh] = useState(true)
  const [beitragen, setBeitragenRoh] = useState(false)
  const [gemeinschaft, setGemeinschaft] = useState<Gemeinschaft | null>(null)
  const [laufend, setLaufend] = useState<Aufzeichnung | null>(null)
  const [gezeigt, setGezeigt] = useState<string | null>(null)
  const [teilGezeigt, setTeilGezeigt] = useState<Teilstrecke | null>(null)
  const [anzeige, setAnzeige] = useState<Linie[]>([])
  const [ansicht, setAnsicht] = useState(0)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [nativ, setNativ] = useState<Tracker | null>(null)
  const [autoAn, setAutoAn] = useState(false)
  const nutzerId = nutzer?.id

  // --- Start: Schalter, Fahrten vom Gerät, Rückkehr von der Anmeldung
  useEffect(() => {
    setAufzeichnenRoh(lies(SCHLUESSEL.aufzeichnen, true))
    setLernenRoh(lies(SCHLUESSEL.lernen, true))
    setSicherungRoh(lies(SCHLUESSEL.sicherung, false))
    setVonAnderenRoh(lies(SCHLUESSEL.vonAnderen, true))
    setBeitragenRoh(lies(SCHLUESSEL.beitragen, false))
    setNativ(tracker())
    alleFahrten()
      .then((f) => setFahrten(f.slice(0, FAHRTEN_MAX)))
      .catch(() => setMeldung('Der Speicher dieses Browsers ist nicht verfügbar. Fahrten gehen beim Schliessen der Seite verloren.'))
      .finally(() => setGeladen(true))
    if (!KONTO_MOEGLICH) return
    const fehler = anmeldeFehler()
    if (fehler) setMeldung(fehler)
    else if (codeOhnePruefwert()) setMeldung(FREMDER_BROWSER)
    if (kontoAngefangen()) setAngebunden(true)
  }, [])

  // --- Anmeldung, nur für die Sicherung
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

  const anbinden = useCallback(() => setAngebunden(true), [])

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

  // --- Ablegen: erst auf dem Gerät, dann, wenn gewünscht, gekürzt im Konto
  const sichernImKonto = useRef(false)
  sichernImKonto.current = !!nutzerId && sicherung

  const hochladen = useCallback(async (liste: Gespeichert[]) => {
    const zeilen = liste.map((f) => ({ f, z: fuerKonto(f) }))
    const brauchbar = zeilen.filter((x): x is { f: Gespeichert; z: Zeile } => !!x.z)
    if (!brauchbar.length) return
    const sb = await konto()
    const { error } = await sb.from(TABELLE).upsert(brauchbar.map((x) => x.z))
    if (error) {
      setMeldung(`Die Sicherung im Konto hat nicht geklappt: ${error.message}`)
      return
    }
    const gesichert = brauchbar.map((x) => ({ ...x.f, gesichert: true }))
    const ids = new Set(gesichert.map((x) => x.id))
    setFahrten((alt) => alt.map((f) => (ids.has(f.id) ? { ...f, gesichert: true } : f)))
    await Promise.all(gesichert.map((f) => speichern(f).catch(() => {})))
  }, [])

  const ablegen = useCallback(
    async (offen: Offen, id?: string, still = false): Promise<Fahrt | null> => {
      const spur = verdichten(offen.spur)
      const distanz = spur.length ? spurDistanz(spur) : 0
      if (spur.length < 10 || distanz < 150) {
        schreib(SCHLUESSEL.laufend, null)
        if (!still) setMeldung('Die Aufzeichnung war zu kurz und wurde nicht gespeichert.')
        return null
      }
      const erster = spur[0]
      const letzter = spur[spur.length - 1]
      // Der Vorschlag vom Losfahren lässt sich nur mit einer Fahrt vergleichen,
      // die am geplanten Start begann und am geplanten Ziel ankam.
      const nah = (geplant: Ort | null, [lon, lat]: Spurpunkt) => !!geplant && abstand(geplant.lon, geplant.lat, lon, lat) < ORT_NAH
      const wieGeplant = nah(startRef.current, erster) && nah(zielRef.current, letzter)
      /** Der geplante Ort, wenn die Spur dort beginnt oder endet, sonst die nächste Adresse. */
      const ortFuer = (geplant: Ort | null, [lon, lat]: Spurpunkt): Ort =>
        geplant && geplant.titel !== 'Mein Standort' && abstand(geplant.lon, geplant.lat, lon, lat) < ORT_NAH
          ? { lon: geplant.lon, lat: geplant.lat, titel: geplant.titel }
          : benenneRef.current(lon, lat)
      const f: Gespeichert = {
        id: id ?? crypto.randomUUID(),
        begonnen: new Date(offen.beginn + erster[2] * 1000).toISOString(),
        dauer: letzter[2] - erster[2],
        distanz,
        start: ortFuer(startRef.current, erster),
        ziel: ortFuer(zielRef.current, letzter),
        spur,
        vorschlag: wieGeplant ? offen.vorschlag : null,
        quelle: offen.quelle ?? 'aufzeichnung',
      }
      try {
        await speichern(f)
        schreib(SCHLUESSEL.laufend, null)
      } catch {
        // Die Spur bleibt in dieser Sitzung sichtbar. Der Rohstand liegt noch im localStorage.
        schreib(SCHLUESSEL.laufend, offen)
        setMeldung('Die Fahrt liess sich nicht auf dem Gerät speichern. Sie bleibt nur bis zum Schliessen der Seite.')
      }
      setFahrten((alt) => [f, ...alt.filter((x) => x.id !== f.id)].sort((a, b) => (a.begonnen < b.begonnen ? 1 : -1)))
      if (sichernImKonto.current) hochladen([f])
      return f
    },
    [hochladen]
  )

  const zeigen = useCallback((f: Fahrt | null, mitStrecke = true) => {
    setGezeigt(f?.id ?? null)
    setTeilGezeigt(null)
    setAnzeige(f ? [alsLinie(f.spur, 'haupt')] : [])
    setAnsicht((n) => n + 1)
    if (f && mitStrecke) zeigeStreckeRef.current(f)
  }, [])

  /** Die gezeigte Fahrt zusammen mit einer ähnlichen in Grau. */
  const zeigenMit = useCallback((f: Fahrt, andere: Fahrt | null) => {
    setGezeigt(f.id)
    setTeilGezeigt(null)
    setAnzeige([alsLinie(f.spur, 'haupt'), ...(andere ? [alsLinie(andere.spur, 'daneben')] : [])])
    setAnsicht((n) => n + 1)
  }, [])

  const zeigenTeil = useCallback((t: Teilstrecke | null) => {
    setGezeigt(null)
    setTeilGezeigt(t)
    setAnzeige(t ? t.wege.map((w, i): Linie => ({ koord: w.koordinaten, rolle: i === 0 ? 'haupt' : 'daneben' })) : [])
    setAnsicht((n) => n + 1)
  }, [])

  // --- Aufzeichnung im Browser
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

  // --- Aufzeichnung in der Android-App
  /** Fahrten, die der Dienst der App fertig hat, aufs Gerät übernehmen. */
  const holeNativ = useCallback(
    async (t: Tracker): Promise<Fahrt | null> => {
      let letzte: Fahrt | null = null
      try {
        const { fahrten: neu } = await t.abholen()
        const bekannt = new Set(fahrtenRef.current.map((f) => f.id))
        for (const x of neu as NativeFahrt[]) {
          if (bekannt.has(x.id)) continue
          const f = await ablegen(
            { beginn: x.beginn, spur: x.spur, vorschlag: x.vorschlag ? (JSON.parse(x.vorschlag) as Vorschlag) : null, quelle: x.quelle },
            x.id,
            x.quelle === 'auto'
          )
          if (f) letzte = f
        }
        if (neu.length) await t.quittieren({ ids: (neu as NativeFahrt[]).map((x) => x.id) })
      } catch {
        setMeldung('Die Fahrten der App liessen sich nicht abholen.')
      }
      return letzte
    },
    [ablegen]
  )

  const nativStand = useCallback((s: NativStatus) => {
    setAutoAn(s.auto)
    setLaufend(s.laeuft ? { seit: s.beginn, distanz: s.distanz, ort: s.lon !== null && s.lat !== null ? [s.lon, s.lat] : null } : null)
  }, [])

  // Beim Öffnen und bei jeder Rückkehr in die App nachsehen, was im Hintergrund entstanden ist.
  useEffect(() => {
    if (!nativ || !geladen) return
    let weg = false
    const nachsehen = async () => {
      try {
        const s = await nativ.status()
        if (weg) return
        nativStand(s)
        if (!s.laeuft) await holeNativ(nativ)
      } catch {
        /* Die App antwortet nicht: Es bleibt beim Browserverhalten. */
      }
    }
    nachsehen()
    const sichtbar = () => document.visibilityState === 'visible' && nachsehen()
    document.addEventListener('visibilitychange', sichtbar)
    // Läuft eine Aufzeichnung, den Stand der App regelmässig nachziehen.
    // Endet die Aufzeichnung ausserhalb der Seite (Knopf in der Benachrichtigung, Leerlauf), holt die Seite die Fahrt gleich ab.
    const uhr = window.setInterval(
      () =>
        document.visibilityState === 'visible' &&
        nativ.status().then(
          (s) => {
            if (weg) return
            nativStand(s)
            if (!s.laeuft) holeNativ(nativ)
          },
          () => {}
        ),
      3000
    )
    return () => {
      weg = true
      document.removeEventListener('visibilitychange', sichtbar)
      window.clearInterval(uhr)
    }
  }, [nativ, geladen, holeNativ, nativStand])

  const freigaben = (fehlt: string[]) =>
    `Freigabe fehlt: ${fehlt
      .map((f) => ({ standort: 'Standort', hintergrund: 'Standort «Immer»', bewegung: 'Körperliche Aktivität', mitteilung: 'Mitteilungen' })[f] ?? f)
      .join(', ')}. Sie lässt sich in den Einstellungen der App vergeben.`

  const starten = useCallback(
    async (vorschlag: Vorschlag | null) => {
      setGezeigt(null)
      setMeldung(null)
      if (nativ) {
        const r = await nativ.berechtigen({ auto: false })
        if (r.fehlt.includes('standort')) return setMeldung(freigaben(r.fehlt))
        await nativ.start({ vorschlag: vorschlag ? JSON.stringify(vorschlag) : undefined })
        nativStand(await nativ.status())
        return
      }
      offenRef.current = { beginn: Date.now(), spur: [], vorschlag }
      horchen()
    },
    [nativ, nativStand, horchen]
  )

  const beenden = useCallback(async () => {
    if (nativ) {
      await nativ.stop()
      setLaufend(null)
      const f = await holeNativ(nativ)
      if (f) zeigen(f)
      return
    }
    if (watchRef.current === null) return
    anhalten()
    const f = await ablegen(offenRef.current)
    if (f) zeigen(f)
  }, [nativ, holeNativ, anhalten, ablegen, zeigen])
  beendenRef.current = beenden

  const verwerfen = useCallback(async () => {
    if (nativ) {
      // Der Dienst legt beim Beenden die Fahrt ab; sie wird abgeholt und gleich gelöscht.
      await nativ.stop()
      setLaufend(null)
      const { fahrten: neu } = await nativ.abholen().catch(() => ({ fahrten: [] as NativeFahrt[] }))
      if (neu.length) await nativ.quittieren({ ids: neu.map((x) => x.id) })
      return
    }
    anhalten()
    schreib(SCHLUESSEL.laufend, null)
  }, [nativ, anhalten])

  const setAuto = useCallback(
    async (an: boolean) => {
      if (!nativ) return
      if (an) {
        const r = await nativ.berechtigen({ auto: true })
        if (r.fehlt.length) {
          setMeldung(freigaben(r.fehlt))
          if (r.fehlt.includes('standort') || r.fehlt.includes('bewegung')) return
        }
      }
      try {
        nativStand(await nativ.auto({ aktiv: an }))
      } catch {
        setMeldung('Die automatische Erkennung liess sich nicht umschalten.')
      }
    },
    [nativ, nativStand]
  )

  // Die Bildschirmsperre fällt weg, sobald die Seite in den Hintergrund geht.
  const laeuftImBrowser = !!laufend && !nativ
  useEffect(() => {
    if (!laeuftImBrowser) return
    const sichtbar = () => document.visibilityState === 'visible' && wachhalten()
    document.addEventListener('visibilitychange', sichtbar)
    return () => document.removeEventListener('visibilitychange', sichtbar)
  }, [laeuftImBrowser, wachhalten])

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
    if (!geladen || aufgenommen.current || nativ) return
    aufgenommen.current = true
    const offen = lies<Offen | null>(SCHLUESSEL.laufend, null)
    const letzter = offen?.spur?.[offen.spur.length - 1]
    if (!offen || !letzter) return
    const frisch = Date.now() - (offen.beginn + letzter[2] * 1000) < WEITER_BIS
    if (frisch && offen.quelle !== 'gpx' && lies(SCHLUESSEL.aufzeichnen, true)) {
      offenRef.current = offen
      horchen()
    } else ablegen(offen)
  }, [geladen, nativ, horchen, ablegen])

  const importieren = useCallback(
    async (datei: File) => {
      const gpx = spurAusGpx(await datei.text())
      if (!gpx) {
        setMeldung('In der Datei steht keine Spur mit Zeitstempeln. Ohne Zeiten gibt es nichts auszuwerten.')
        return
      }
      const f = await ablegen({ beginn: gpx.beginn, spur: gpx.spur, vorschlag: null, quelle: 'gpx' })
      if (f) zeigen(f)
    },
    [ablegen, zeigen]
  )

  const loeschen = useCallback(
    async (welche: 'alle' | string) => {
      try {
        if (welche === 'alle') await alleEntfernen()
        else await entfernen(welche)
      } catch {
        setMeldung('Löschen hat nicht geklappt.')
        return
      }
      setFahrten((alt) => (welche === 'alle' ? [] : alt.filter((f) => f.id !== welche)))
      setGezeigt((g) => (welche === 'alle' || g === welche ? null : g))
      setAnzeige([])
      setTeilGezeigt(null)
      // Die Kopie im Konto verschwindet mit.
      if (nutzerId) {
        const sb = await konto()
        const { error } = welche === 'alle' ? await sb.from(TABELLE).delete().not('id', 'is', null) : await sb.from(TABELLE).delete().eq('id', welche)
        if (error) setMeldung(`Die Kopie im Konto liess sich nicht löschen: ${error.message}`)
      }
    },
    [nutzerId]
  )

  const abmelden = useCallback(async () => {
    const sb = await konto()
    await sb.auth.signOut()
  }, [])

  // --- Sicherung: Fahrten von anderen Geräten holen, eigene gekürzt hochladen
  useEffect(() => {
    if (!nutzerId || !geladen) return
    let weg = false
    ;(async () => {
      try {
        const sb = await konto()
        const { data, error } = await sb.from(TABELLE).select('*').order('begonnen', { ascending: false }).limit(FAHRTEN_MAX)
        if (error) throw error
        if (weg) return
        const lokal = new Set(fahrtenRef.current.map((f) => f.id))
        const daId = new Set((data as Zeile[]).map((z) => z.id))
        const neu = (data as Zeile[]).filter((z) => !lokal.has(z.id)).map((z): Gespeichert => ({ ...ausKonto(z, benenneRef.current), gesichert: true }))
        if (neu.length) {
          await Promise.all(neu.map((f) => speichern(f).catch(() => {})))
          if (!weg) setFahrten((alt) => [...alt, ...neu].sort((a, b) => (a.begonnen < b.begonnen ? 1 : -1)))
        }
        // Was schon im Konto liegt, ist gesichert; was fehlt, geht hoch, wenn die Sicherung an ist.
        if (sichernImKonto.current) {
          const fehlt = fahrtenRef.current.filter((f) => !daId.has(f.id))
          if (fehlt.length) await hochladen(fehlt)
        }
      } catch (e) {
        if (!weg) setMeldung(`Die Sicherung im Konto hat nicht geklappt: ${(e as Error).message}`)
      }
    })()
    return () => {
      weg = true
    }
  }, [nutzerId, geladen, sicherung, hochladen])

  // --- Zuordnen und Lernen
  // Jede Fahrt wird einmal je Sitzung dem Netz zugeordnet, in kleinen
  // Portionen, damit die Oberfläche zwischendurch zum Zug kommt. Eine Fahrt
  // braucht rund 20 Millisekunden.
  const zuRef = useRef(new Map<string, Zuordnung | null>())
  const [stand, setStand] = useState<Lernstand | null>(null)
  /** Zählt hoch, wenn neue Zuordnungen da sind: Auswertung und Vergleich lesen sie beim nächsten Anstrich. */
  const [zugeordnet, setZugeordnet] = useState(0)
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
      setZugeordnet((n) => n + 1)
    }
    uhr = window.setTimeout(schritt, 0)
    return () => {
      weg = true
      window.clearTimeout(uhr)
    }
  }, [graph, fahrten])

  // Die Durchschnitte der Gemeinschaft, nur wenn man von anderen lernen will.
  useEffect(() => {
    if (!KONTO_MOEGLICH || !vonAnderen || !geladen) return
    let weg = false
    ladeGemeinschaft().then(
      (g) => !weg && setGemeinschaft(g),
      () => {
        /* Ohne Verbindung lernt der Velonavi aus den eigenen Fahrten. */
      }
    )
    return () => {
      weg = true
    }
  }, [vonAnderen, geladen])

  // Das Gelernte: die eigenen Fahrten, dazu wenn gewünscht die Durchschnitte der anderen.
  useEffect(() => {
    if (!graph) return
    const alle = fahrtenRef.current.map((f) => zuRef.current.get(f.id)).filter((z): z is Zuordnung => !!z)
    setStand(lerne(graph, alle, vonAnderen ? gemeinschaft : null))
  }, [graph, zugeordnet, gemeinschaft, vonAnderen])

  // Messwerte beitragen: jede Fahrt einmal, nachdem sie dem Netz zugeordnet ist.
  const teilt = useRef(false)
  useEffect(() => {
    if (!KONTO_MOEGLICH || !beitragen || !graph || !stand || teilt.current) return
    const offen = fahrtenRef.current.filter((f) => !f.geteilt && (zuRef.current.get(f.id)?.treffer ?? 0) >= 0.7)
    if (!offen.length) return
    teilt.current = true
    ;(async () => {
      try {
        for (const f of offen) {
          const z = zuRef.current.get(f.id)!
          const b = beitrag(graph, z, stand.tempo)
          if (b.kanten.length || b.ampeln.length) await sendeBeitrag(b)
          const geteilt = { ...f, geteilt: true }
          setFahrten((alt) => alt.map((x) => (x.id === f.id ? geteilt : x)))
          await speichern(geteilt).catch(() => {})
        }
      } catch (e) {
        setMeldung(`Die Messwerte liessen sich nicht beitragen: ${(e as Error).message}`)
      } finally {
        teilt.current = false
      }
    })()
  }, [beitragen, graph, stand, zugeordnet])

  const gezeigteFahrt = useMemo(() => fahrten.find((f) => f.id === gezeigt) ?? null, [fahrten, gezeigt])

  /** Alle Fahrten, die sich dem Netz zuordnen liessen, für den Vergleich. */
  const laeufe = useMemo(
    (): Lauf[] =>
      fahrten.flatMap((fahrt) => {
        const zuordnung = zuRef.current.get(fahrt.id)
        return zuordnung ? [{ fahrt, zuordnung }] : []
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fahrten, zugeordnet]
  )

  /** Die Linien für die Karte: die laufende Aufzeichnung, sonst was gerade angesehen wird. */
  const linien = useMemo(
    (): Linie[] => (laufend && !nativ ? [alsLinie(offenRef.current.spur, 'haupt')] : anzeige),
    // `laufend` ändert sich mit jedem Punkt, so zieht die Spur auf der Karte nach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [laufend, nativ, anzeige]
  )

  return {
    nutzer, anbinden, mit, perMail, abmelden, kontoMoeglich: KONTO_MOEGLICH,
    fahrten, geladen, gezeigteFahrt, teilGezeigt, zeigen, zeigenMit, zeigenTeil, loeschen, importieren,
    zuordnung: (id: string) => zuRef.current.get(id) ?? null, laeufe,
    aufzeichnen,
    setAufzeichnen: (v: boolean) => {
      setAufzeichnenRoh(v)
      schreib(SCHLUESSEL.aufzeichnen, v)
    },
    /** Die Android-App, sonst null. Nur sie zeichnet im Hintergrund und von selbst auf. */
    nativ, autoAn, setAuto,
    laufend, starten, beenden, verwerfen, linien, ansicht,
    lernen,
    setLernen: (v: boolean) => {
      setLernenRoh(v)
      schreib(SCHLUESSEL.lernen, v)
    },
    stand,
    /** Was der Router bekommt: das Gelernte, solange der Schalter an ist. */
    gelernt: lernen ? stand : null,
    /** Die Durchschnitte anderer nutzen und die eigenen Messwerte anonym beitragen. */
    vonAnderen,
    setVonAnderen: (v: boolean) => {
      setVonAnderenRoh(v)
      schreib(SCHLUESSEL.vonAnderen, v)
    },
    beitragen,
    setBeitragen: (v: boolean) => {
      setBeitragenRoh(v)
      schreib(SCHLUESSEL.beitragen, v)
    },
    sicherung,
    setSicherung: (v: boolean) => {
      setSicherungRoh(v)
      schreib(SCHLUESSEL.sicherung, v)
    },
    meldung, setMeldung,
  }
}

export type Fahrtenstand = ReturnType<typeof useFahrten>
