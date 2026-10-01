'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  anmeldeFehler, codeOhnePruefwert, konto, kontoAngefangen, KONTO_WECHSEL, rueckkehr, KONTO_MOEGLICH, TABELLE, type Anbieter,
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
import { erkenne, type Hinweis, type Modus } from './modus.ts'
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
  nativGefragt: 'velonavi.nativ.gefragt',
  ortZeigen: 'velonavi.ortzeigen',
  laufend: 'velonavi.laufend',
  geloescht: 'velonavi.geloescht',
  /** Ob die Fahrten im Konto vollständig sind. Bis Oktober 2026 gingen sie ohne die ersten und letzten 150 Meter hinein. */
  voll: 'velonavi.sicherung.voll',
}

/**
 * Gelöschte Fahrten, deren Kopie im Konto noch nicht sicher weg ist (kein Netz, nicht angemeldet).
 * Der nächste Abgleich löscht sie dort und holt sie nicht zurück.
 */
const GRABSTEINE_MAX = 2000
const grabsteine = () => lies<string[]>(SCHLUESSEL.geloescht, [])
const setGrabsteine = (ids: string[]) => schreib(SCHLUESSEL.geloescht, ids.length ? ids.slice(-GRABSTEINE_MAX) : null)

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
/**
 * So viele Fahrten gehen in einer Anfrage ins Konto. Eine Spur wiegt schnell 50 KB, und eine
 * einzelne Zeile, die die Datenbank ablehnt, soll nicht alle anderen mitreissen.
 */
const PAKET = 10
/** Frühestens nach so vielen Millisekunden gleicht die Seite bei der Rückkehr in die App erneut ab. */
const ABGLEICH_PAUSE = 60_000
/** So oft gleicht die offene Seite mit dem Konto ab. */
const ABGLEICH_TAKT = 5 * 60_000
const KEIN_NETZ = 'Gerade keine Verbindung zum Konto. Die Fahrten gehen hinein, sobald das Netz zurück ist.'
const FREMDER_BROWSER =
  'Die Anmeldung hat nicht geklappt. Den Link aus der E-Mail im selben Browser öffnen, in dem du ihn angefordert hast.'

const MY = 111133
const mx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)
const abstand = (lon0: number, lat0: number, lon1: number, lat1: number) =>
  Math.hypot((lon1 - lon0) * mx(lat0), (lat1 - lat0) * MY)

type Offen = { beginn: number; spur: Spurpunkt[]; vorschlag: Vorschlag | null; quelle?: Fahrt['quelle']; hinweis?: Hinweis }

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
 * Es holt Fahrten von anderen Geräten und nimmt Kopien (`sicherung.ts`).
 *
 * Der Haken sitzt im Velonavi selbst und nicht im Menü. Dieses wird je nach
 * Fensterbreite an anderer Stelle gezeichnet und neu aufgebaut; eine laufende
 * Aufzeichnung darf das nicht beenden.
 */
export function useFahrten({
  graph, start, ziel, benenne, zeigeStrecke, haltestellen,
}: {
  graph: import('./router').Graph | null
  start: Ort | null
  ziel: Ort | null
  /** Der nächste bekannte Ort zu einer Koordinate. */
  benenne: (lon: number, lat: number) => Ort
  /** Start und Ziel einer Fahrt in den Routenplaner übernehmen. */
  zeigeStrecke: (f: Fahrt) => void
  /** Die ÖV-Haltestellen der Stadt, damit sich Tram und Bus vom Auto unterscheiden lassen. */
  haltestellen: [number, number][] | null
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
  const haltestellenRef = useRef(haltestellen)
  haltestellenRef.current = haltestellen

  const [fahrten, setFahrten] = useState<Gespeichert[]>([])
  const fahrtenRef = useRef(fahrten)
  fahrtenRef.current = fahrten
  const [geladen, setGeladen] = useState(false)
  const [angebunden, setAngebunden] = useState(false)
  const [nutzer, setNutzer] = useState<User | null>(null)
  const [aufzeichnen, setAufzeichnenRoh] = useState(true)
  const [lernen, setLernenRoh] = useState(true)
  // Das Konto ist zum Sichern da: Wer sich anmeldet, will die Fahrten dort haben. Ausschalten lässt es sich.
  const [sicherung, setSicherungRoh] = useState(true)
  const [vonAnderen, setVonAnderenRoh] = useState(true)
  const [beitragen, setBeitragenRoh] = useState(true)
  const [gemeinschaft, setGemeinschaft] = useState<Gemeinschaft | null>(null)
  const [laufend, setLaufend] = useState<Aufzeichnung | null>(null)
  const [gezeigt, setGezeigt] = useState<string | null>(null)
  const [teilGezeigt, setTeilGezeigt] = useState<Teilstrecke | null>(null)
  const [anzeige, setAnzeige] = useState<Linie[]>([])
  const [ansicht, setAnsicht] = useState(0)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [nativ, setNativ] = useState<Tracker | null>(null)
  const [autoAn, setAutoAn] = useState(false)
  const [autoAlle, setAutoAlle] = useState(false)
  /** Der Stand der Erkennung in der App: bereit, zuletzt gemeldete Bewegung, Fehler. */
  const [erkennung, setErkennung] = useState<NativStatus | null>(null)
  /** Der eigene Standort als Punkt auf der Karte, auch ohne Aufzeichnung. */
  const [ich, setIch] = useState<[number, number] | null>(null)
  const [ortZeigen, setOrtZeigenRoh] = useState(false)
  const nutzerId = nutzer?.id
  const nutzerIdRef = useRef(nutzerId)
  nutzerIdRef.current = nutzerId
  /** Nur Velofahrten werden dem Netz zugeordnet, verglichen und fürs Lernen genutzt. */
  const istVelo = (f: { modus?: Modus }) => (f.modus ?? 'velo') === 'velo'

  // --- Start: Schalter, Fahrten vom Gerät, Rückkehr von der Anmeldung
  useEffect(() => {
    setAufzeichnenRoh(lies(SCHLUESSEL.aufzeichnen, true))
    setLernenRoh(lies(SCHLUESSEL.lernen, true))
    setSicherungRoh(lies(SCHLUESSEL.sicherung, true))
    setVonAnderenRoh(lies(SCHLUESSEL.vonAnderen, true))
    setBeitragenRoh(lies(SCHLUESSEL.beitragen, true))
    const t = tracker()
    setNativ(t)
    // In der App gehört der Standort dazu, im Browser erst, wenn man ihn einmal freigegeben hat.
    setOrtZeigenRoh(lies(SCHLUESSEL.ortZeigen, !!t))
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
        const { data } = sb.auth.onAuthStateChange((_ereignis, sitzung) => {
          setNutzer(sitzung?.user ?? null)
          window.dispatchEvent(new Event(KONTO_WECHSEL))
        })
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

  /** Löst den Code aus der Anmelde-E-Mail ein. Anders als der Link braucht er keinen bestimmten Browser. */
  const perCode = useCallback(async (mail: string, code: string) => {
    const sb = await konto()
    const { error } = await sb.auth.verifyOtp({ email: mail, token: code.replace(/\s/g, ''), type: 'email' })
    if (error) setMeldung(`Der Code stimmt nicht oder ist abgelaufen: ${error.message}`)
    return !error
  }, [])

  // --- Ablegen: erst auf dem Gerät, dann, wenn gewünscht, im Konto
  const sichernImKonto = useRef(false)
  sichernImKonto.current = !!nutzerId && sicherung

  /** Hält fest, dass diese Fahrten im Konto liegen, in der Liste und auf dem Gerät. */
  const alsGesichert = useCallback(async (liste: Gespeichert[]) => {
    if (!liste.length) return
    const ids = new Set(liste.map((f) => f.id))
    setFahrten((alt) => alt.map((f) => (ids.has(f.id) ? { ...f, gesichert: true } : f)))
    await Promise.all(liste.map((f) => speichern({ ...f, gesichert: true }).catch(() => {})))
  }, [])

  /**
   * Lädt Fahrten ins Konto. Scheitert ein Paket, weil die Datenbank eine Zeile ablehnt, geht
   * der Rest einzeln; fehlt das Netz, bleibt alles für den nächsten Abgleich liegen. `still` schweigt
   * zu einem fehlenden Netz, etwa beim Nachholen im Hintergrund.
   */
  const hochladen = useCallback(
    async (liste: Gespeichert[], still = false): Promise<boolean> => {
      // Nur Velofahrten gehen in die Sicherung: Der Rest bleibt auf dem Gerät.
      const zeilen = liste.filter((f) => (f.modus ?? 'velo') === 'velo').map((f) => ({ f, z: fuerKonto(f) }))
      const brauchbar = zeilen.filter((x): x is { f: Gespeichert; z: Zeile } => !!x.z)
      if (!brauchbar.length) return true
      let sb: Awaited<ReturnType<typeof konto>>
      try {
        sb = await konto()
      } catch {
        if (!still) setMeldung(KEIN_NETZ)
        return false
      }
      const ok: Gespeichert[] = []
      let abgelehnt: string | null = null
      let keinNetz = false
      for (let i = 0; i < brauchbar.length && !keinNetz; i += PAKET) {
        const teil = brauchbar.slice(i, i + PAKET)
        const { error } = await sb.from(TABELLE).upsert(teil.map((x) => x.z))
        if (!error) {
          ok.push(...teil.map((x) => x.f))
          continue
        }
        // Ohne Code kam die Anfrage gar nicht an: kein Netz. Dann nicht Zeile für Zeile weiterversuchen.
        if (!error.code) {
          keinNetz = true
          break
        }
        for (const x of teil) {
          const r = await sb.from(TABELLE).upsert(x.z)
          if (!r.error) ok.push(x.f)
          else abgelehnt ??= r.error.message
        }
      }
      await alsGesichert(ok)
      if (abgelehnt) setMeldung(`${brauchbar.length - ok.length} Fahrten liessen sich nicht im Konto sichern: ${abgelehnt}`)
      else if (keinNetz && !still) setMeldung(KEIN_NETZ)
      return ok.length === brauchbar.length
    },
    [alsGesichert]
  )

  const ablegen = useCallback(
    async (offen: Offen, id?: string, still = false): Promise<Fahrt | null> => {
      const spur = verdichten(offen.spur)
      const distanz = spur.length ? spurDistanz(spur) : 0
      if (spur.length < 10 || distanz < 150) {
        schreib(SCHLUESSEL.laufend, null)
        if (!still) setMeldung('Die Aufzeichnung war zu kurz (unter 150 Metern) und wurde nicht gespeichert.')
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
        // Wer per Knopf im Routenplaner aufzeichnet, fährt Velo. Alles andere erkennt die Seite aus dem Tempo und den Halten.
        modus: offen.quelle === 'aufzeichnung' || (!offen.quelle && !offen.hinweis) ? 'velo' : erkenne(spur, haltestellenRef.current, offen.hinweis),
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
  const holeNativJetzt = useCallback(
    async (t: Tracker): Promise<Fahrt | null> => {
      let letzte: Fahrt | null = null
      try {
        const { fahrten: neu } = await t.abholen()
        const bekannt = new Set(fahrtenRef.current.map((f) => f.id))
        for (const x of neu as NativeFahrt[]) {
          if (bekannt.has(x.id)) continue
          const f = await ablegen(
            { beginn: x.beginn, spur: x.spur, vorschlag: x.vorschlag ? (JSON.parse(x.vorschlag) as Vorschlag) : null, quelle: x.quelle, hinweis: x.hinweis },
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

  // Nacheinander, nie zweimal gleichzeitig: Sonst legten Uhr und Beenden dieselbe Datei doppelt ab.
  const holKette = useRef<Promise<unknown>>(Promise.resolve())
  const holeNativ = useCallback(
    (t: Tracker): Promise<Fahrt | null> => {
      const lauf = holKette.current.then(() => holeNativJetzt(t))
      holKette.current = lauf.catch(() => {})
      return lauf
    },
    [holeNativJetzt]
  )

  /**
   * Solange die Seite selbst startet, beendet oder verwirft, fasst die Uhr den Stand der App nicht an:
   * Sie sähe den Dienst kurz vor dem Anlaufen oder beim Ablegen und würde dazwischenfunken.
   */
  const nativBeschaeftigt = useRef(false)

  /**
   * Wartet, bis der Dienst läuft (`an`) oder die Fahrt abgelegt hat. `stop` und `start` kehren sofort
   * zurück, der Dienst arbeitet danach: Ohne Warten fand das Beenden die Fahrt noch nicht, sie tauchte
   * erst später still auf, und das Verwerfen erwischte sie gar nicht.
   */
  const warteAufDienst = useCallback(async (t: Tracker, an: boolean) => {
    const bis = Date.now() + 5000
    for (;;) {
      const s = await t.status()
      if (s.laeuft === an || Date.now() > bis) return s
      await new Promise((r) => setTimeout(r, 150))
    }
  }, [])

  const nativStand = useCallback((s: NativStatus) => {
    setAutoAn(s.auto)
    setAutoAlle(!!s.alle)
    setErkennung(s)
    setLaufend(s.laeuft ? { seit: s.beginn, distanz: s.distanz, ort: Number.isFinite(s.lon) && Number.isFinite(s.lat) ? [s.lon as number, s.lat as number] : null } : null)
  }, [])

  // Den eigenen Standort zeigen, solange die Seite sichtbar ist. Das braucht keine Aufzeichnung: Es ist
  // der blaue Punkt, an dem man sieht, dass der Standort ankommt.
  useEffect(() => {
    if (!ortZeigen || typeof navigator === 'undefined' || !navigator.geolocation) return
    let id: number | null = null
    const starten = () => {
      if (id !== null) return
      id = navigator.geolocation.watchPosition(
        (p) => setIch([p.coords.longitude, p.coords.latitude]),
        (e) => {
          // Ohne Freigabe bleibt der Punkt weg und die Einstellung wird zurückgesetzt, statt bei jedem Start zu fragen.
          if (e.code === e.PERMISSION_DENIED) {
            setOrtZeigenRoh(false)
            setIch(null)
          }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 }
      )
    }
    const anhalten = () => {
      if (id !== null) navigator.geolocation.clearWatch(id)
      id = null
    }
    const sichtbar = () => (document.visibilityState === 'visible' ? starten() : anhalten())
    sichtbar()
    document.addEventListener('visibilitychange', sichtbar)
    return () => {
      document.removeEventListener('visibilitychange', sichtbar)
      anhalten()
    }
  }, [ortZeigen])

  // Beim ersten Start in der App alle Freigaben für die automatische Aufzeichnung anfragen.
  // Wer ablehnt, wird erst wieder gefragt, wenn er die Erkennung selbst einschaltet.
  useEffect(() => {
    if (!nativ || !geladen || lies(SCHLUESSEL.nativGefragt, false)) return
    schreib(SCHLUESSEL.nativGefragt, true)
    nativ.berechtigen({ auto: true }).then(async ({ fehlt }) => {
      if (fehlt.length) {
        setMeldung(freigaben(fehlt))
        return
      }
      nativStand(await nativ.auto({ aktiv: true, alle: true }))
    }).catch(() => setMeldung('Die automatische Erkennung liess sich nicht einschalten.'))
  }, [nativ, geladen, nativStand])

  // Beim Öffnen und bei jeder Rückkehr in die App nachsehen, was im Hintergrund entstanden ist.
  useEffect(() => {
    if (!nativ || !geladen) return
    let weg = false
    const nachsehen = async () => {
      if (nativBeschaeftigt.current) return
      try {
        const s = await nativ.status()
        if (weg || nativBeschaeftigt.current) return
        nativStand(s)
        if (!s.laeuft) await holeNativ(nativ)
      } catch {
        /* Die App antwortet nicht: Es bleibt beim Browserverhalten. */
      }
    }
    nachsehen()
    // Was beim letzten Mal schiefging, etwa ein Absturz: einmal sagen, sonst bleibt es ein Rätsel.
    nativ
      .panne?.()
      .then((p) => {
        if (!weg && p.text) setMeldung(`Beim letzten Mal ging in der App etwas schief: ${p.text}`)
      })
      .catch(() => {})
    const sichtbar = () => document.visibilityState === 'visible' && nachsehen()
    document.addEventListener('visibilitychange', sichtbar)
    // Läuft eine Aufzeichnung, den Stand der App regelmässig nachziehen.
    // Endet die Aufzeichnung ausserhalb der Seite (Knopf in der Benachrichtigung, Leerlauf), holt die Seite die Fahrt gleich ab.
    const uhr = window.setInterval(
      () =>
        document.visibilityState === 'visible' &&
        !nativBeschaeftigt.current &&
        nativ.status().then(
          (s) => {
            if (weg || nativBeschaeftigt.current) return
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
        nativBeschaeftigt.current = true
        try {
          const r = await nativ.berechtigen({ auto: false })
          if (r.fehlt.includes('standort')) return setMeldung(freigaben(r.fehlt))
          await nativ.start({ vorschlag: vorschlag ? JSON.stringify(vorschlag) : undefined })
          const s = await warteAufDienst(nativ, true)
          nativStand(s)
          if (!s.laeuft) {
            const p = await nativ.panne?.().catch(() => null)
            setMeldung(p?.text || 'Die Aufzeichnung ist nicht angelaufen. Ist der Standort für die App freigegeben?')
          }
        } catch (e) {
          setMeldung(e instanceof Error && e.message ? e.message : 'Die Aufzeichnung liess sich nicht starten.')
        } finally {
          nativBeschaeftigt.current = false
        }
        return
      }
      offenRef.current = { beginn: Date.now(), spur: [], vorschlag }
      horchen()
    },
    [nativ, nativStand, horchen, warteAufDienst]
  )

  const beenden = useCallback(async () => {
    if (nativ) {
      nativBeschaeftigt.current = true
      try {
        await nativ.stop()
        await warteAufDienst(nativ, false)
        setLaufend(null)
        const f = await holeNativ(nativ)
        // Unter zehn Punkten oder 150 Metern legt der Dienst nichts ab. Ohne Hinweis sah das aus, als sei nichts passiert.
        if (f) zeigen(f)
        else setMeldung('Die Aufzeichnung war zu kurz (unter 150 Metern) und wurde nicht gespeichert.')
      } catch {
        setMeldung('Die Aufzeichnung liess sich nicht beenden.')
      } finally {
        nativBeschaeftigt.current = false
      }
      return
    }
    if (watchRef.current === null) return
    anhalten()
    const f = await ablegen(offenRef.current)
    if (f) zeigen(f)
  }, [nativ, holeNativ, warteAufDienst, anhalten, ablegen, zeigen])
  beendenRef.current = beenden

  const verwerfen = useCallback(async () => {
    if (nativ) {
      nativBeschaeftigt.current = true
      try {
        // Was vorher fertig wurde (etwa der Weg zum Velo), bleibt: erst abholen, dann beenden.
        await holeNativ(nativ)
        // Der Dienst legt beim Beenden die Fahrt ab. Nur sie wird abgeholt und gleich gelöscht.
        await nativ.stop()
        await warteAufDienst(nativ, false)
        setLaufend(null)
        const { fahrten: neu } = await nativ.abholen().catch(() => ({ fahrten: [] as NativeFahrt[] }))
        if (neu.length) await nativ.quittieren({ ids: neu.map((x) => x.id) })
      } catch {
        setMeldung('Die Aufzeichnung liess sich nicht verwerfen.')
      } finally {
        nativBeschaeftigt.current = false
      }
      return
    }
    anhalten()
    schreib(SCHLUESSEL.laufend, null)
  }, [nativ, anhalten, holeNativ, warteAufDienst])

  /** Auch Gehen, Joggen, Tram und Auto von selbst aufzeichnen, nicht nur Velofahrten. */
  const setAutoAlleWert = useCallback(
    async (alle: boolean) => {
      if (!nativ) return
      try {
        nativStand(await nativ.auto({ aktiv: autoAn, alle }))
      } catch {
        setMeldung('Die Einstellung liess sich nicht übernehmen.')
      }
    },
    [nativ, autoAn, nativStand]
  )

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
        nativStand(await nativ.auto({ aktiv: an, alle: autoAlle }))
      } catch {
        setMeldung('Die automatische Erkennung liess sich nicht umschalten.')
      }
    },
    [nativ, nativStand, autoAlle]
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
      const weg = welche === 'alle' ? fahrtenRef.current.map((f) => f.id) : [welche]
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
      // Die Kopie im Konto verschwindet mit. Klappt das jetzt nicht, merkt sich das Gerät die Fahrt,
      // und der nächste Abgleich holt das Löschen nach, statt sie zurückzuholen.
      setGrabsteine([...new Set([...grabsteine(), ...weg])])
      if (nutzerId) {
        try {
          const sb = await konto()
          const { error } = welche === 'alle' ? await sb.from(TABELLE).delete().not('id', 'is', null) : await sb.from(TABELLE).delete().eq('id', welche)
          if (error) {
            if (error.code) setMeldung(`Die Kopie im Konto liess sich nicht löschen: ${error.message}`)
          } else {
            const erledigt = new Set(weg)
            setGrabsteine(grabsteine().filter((id) => !erledigt.has(id)))
          }
        } catch {
          /* Kein Netz: Der nächste Abgleich holt es nach. */
        }
      }
    },
    [nutzerId]
  )

  /** Die Art der Fahrt von Hand korrigieren. Velo zählt fürs Lernen, alles andere nicht. */
  const setModus = useCallback(async (id: string, modus: Modus) => {
    const alt = fahrtenRef.current.find((f) => f.id === id)
    if (!alt || (alt.modus ?? 'velo') === modus) return
    const neu: Gespeichert = { ...alt, modus, geteilt: false }
    // Ins Konto gehören nur Velofahrten: Wird eine zu Tram oder Gehen, geht sie dort weg, und umgekehrt hinein.
    const warVelo = (alt.modus ?? 'velo') === 'velo'
    if (warVelo && alt.gesichert) neu.gesichert = false
    setFahrten((liste) => liste.map((f) => (f.id === id ? neu : f)))
    await speichern(neu).catch(() => setMeldung('Die Änderung liess sich nicht speichern.'))
    if (!nutzerIdRef.current) return
    if (modus === 'velo') {
      if (sichernImKonto.current) await hochladen([neu], true)
    } else if (warVelo) {
      try {
        const sb = await konto()
        const { error } = await sb.from(TABELLE).delete().eq('id', id)
        if (error) throw error
      } catch {
        // Bleibt sie im Konto, holt der nächste Abgleich sie nicht als Velofahrt zurück: Sie liegt ja noch hier.
      }
    }
  }, [hochladen])

  const abmelden = useCallback(async () => {
    const sb = await konto()
    await sb.auth.signOut()
  }, [])

  // --- Sicherung: Fahrten von anderen Geräten holen, eigene hochladen
  const gleichtAb = useRef(false)
  /** Holt, was im Konto liegt und hier fehlt, und lädt hoch, was dort fehlt. `still` schweigt zu fehlendem Netz. */
  const abgleichen = useCallback(
    async (still = false) => {
      const fuer = nutzerIdRef.current
      if (!fuer || gleichtAb.current) return
      gleichtAb.current = true
      try {
        const sb = await konto()
        // Erst nachholen, was auf diesem Gerät gelöscht wurde, als es nicht ging.
        const offenWeg = grabsteine()
        for (let i = 0; i < offenWeg.length; i += 100) {
          const teil = offenWeg.slice(i, i + 100)
          const { error } = await sb.from(TABELLE).delete().in('id', teil)
          if (error) break
          const erledigt = new Set(teil)
          setGrabsteine(grabsteine().filter((id) => !erledigt.has(id)))
        }
        const begraben = new Set(grabsteine())
        const { data, error } = await sb.from(TABELLE).select('*').order('begonnen', { ascending: false }).limit(FAHRTEN_MAX)
        if (error) throw error
        // Inzwischen ab- oder umgemeldet: nichts mehr anfassen.
        if (nutzerIdRef.current !== fuer) return
        const zeilen = (data as Zeile[]).filter((z) => !begraben.has(z.id))
        const lokal = new Set(fahrtenRef.current.map((f) => f.id))
        const daId = new Set(zeilen.map((z) => z.id))
        const neu = zeilen.filter((z) => !lokal.has(z.id)).map((z): Gespeichert => ({ ...ausKonto(z, benenneRef.current), gesichert: true }))
        if (neu.length) {
          await Promise.all(neu.map((f) => speichern(f).catch(() => {})))
          setFahrten((alt) => [...alt, ...neu.filter((n) => !alt.some((a) => a.id === n.id))].sort((a, b) => (a.begonnen < b.begonnen ? 1 : -1)))
        }
        // Was schon im Konto liegt, ist gesichert, auch wenn ein anderes Gerät es hochgeladen hat.
        await alsGesichert(fahrtenRef.current.filter((f) => daId.has(f.id) && !f.gesichert))
        // Was fehlt, geht hoch, wenn die Sicherung an ist.
        // Einmal auch alles, was schon drin ist: Bis Oktober 2026 lag es dort nur gekürzt, jetzt vollständig.
        if (sichernImKonto.current) {
          const nachholen = !lies(SCHLUESSEL.voll, false)
          const fehlt = fahrtenRef.current.filter((f) => !daId.has(f.id) || nachholen)
          if ((await hochladen(fehlt, still)) && nachholen) schreib(SCHLUESSEL.voll, true)
        }
      } catch (e) {
        if (!still) setMeldung(`Die Sicherung im Konto hat nicht geklappt: ${(e as Error).message}`)
      } finally {
        gleichtAb.current = false
      }
    },
    [hochladen, alsGesichert]
  )
  useEffect(() => {
    if (!nutzerId || !geladen) return
    abgleichen()
    // In der App bleibt die Seite oft tagelang offen. Was ohne Netz aufgenommen wurde, geht hoch,
    // sobald die Verbindung zurück ist oder die App wieder in den Vordergrund kommt.
    let zuletzt = Date.now()
    const nochmal = () => {
      if (document.visibilityState !== 'visible' || Date.now() - zuletzt < ABGLEICH_PAUSE) return
      zuletzt = Date.now()
      abgleichen(true)
    }
    const online = () => {
      zuletzt = Date.now()
      abgleichen(true)
    }
    // Und regelmässig, solange die Seite offen ist: Fahrten von anderen Geräten erscheinen von selbst.
    const uhr = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      zuletzt = Date.now()
      abgleichen(true)
    }, ABGLEICH_TAKT)
    document.addEventListener('visibilitychange', nochmal)
    window.addEventListener('online', online)
    return () => {
      window.clearInterval(uhr)
      document.removeEventListener('visibilitychange', nochmal)
      window.removeEventListener('online', online)
    }
  }, [nutzerId, geladen, sicherung, abgleichen])

  /** Wie viele Velofahrten im Konto liegen, noch fehlen oder für die Sicherung zu kurz sind. */
  const sicherungsStand = useMemo(() => {
    let gesichert = 0
    let offen = 0
    let zuKurz = 0
    for (const f of fahrten) {
      if ((f.modus ?? 'velo') !== 'velo') continue
      if (f.gesichert) gesichert++
      else if (!fuerKonto(f)) zuKurz++
      else offen++
    }
    return { gesichert, offen, zuKurz }
  }, [fahrten])

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
    const offen = fahrten.filter((f) => istVelo(f) && !zuRef.current.has(f.id))
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
    const alle = fahrtenRef.current.filter(istVelo).map((f) => zuRef.current.get(f.id)).filter((z): z is Zuordnung => !!z)
    setStand(lerne(graph, alle, vonAnderen ? gemeinschaft : null))
  }, [graph, zugeordnet, gemeinschaft, vonAnderen])

  // Messwerte beitragen: jede Fahrt einmal, nachdem sie dem Netz zugeordnet ist.
  const teilt = useRef(false)
  useEffect(() => {
    if (!KONTO_MOEGLICH || !beitragen || !graph || !stand || teilt.current) return
    const offen = fahrtenRef.current.filter((f) => istVelo(f) && !f.geteilt && (zuRef.current.get(f.id)?.treffer ?? 0) >= 0.7)
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
        const zuordnung = istVelo(fahrt) ? zuRef.current.get(fahrt.id) : null
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
    nutzer, anbinden, mit, perMail, perCode, abmelden, kontoMoeglich: KONTO_MOEGLICH,
    fahrten, geladen, gezeigteFahrt, teilGezeigt, zeigen, zeigenMit, zeigenTeil, loeschen, importieren,
    zuordnung: (id: string) => zuRef.current.get(id) ?? null, laeufe,
    aufzeichnen,
    setAufzeichnen: (v: boolean) => {
      setAufzeichnenRoh(v)
      schreib(SCHLUESSEL.aufzeichnen, v)
    },
    /** Die Android-App, sonst null. Nur sie zeichnet im Hintergrund und von selbst auf. */
    nativ, autoAn, setAuto, autoAlle, setAutoAlle: setAutoAlleWert, erkennung,
    ich, ortZeigen,
    /** Den Standort als Punkt zeigen; im Browser wird dabei zum ersten Mal nach der Freigabe gefragt. */
    setOrtZeigen: (v: boolean) => {
      setOrtZeigenRoh(v)
      schreib(SCHLUESSEL.ortZeigen, v)
    },
    setModus,
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
    sicherung, sicherungsStand,
    /** Den Abgleich mit dem Konto sofort anstossen, etwa nach einem Fehler. */
    jetztSichern: () => abgleichen(),
    setSicherung: (v: boolean) => {
      setSicherungRoh(v)
      schreib(SCHLUESSEL.sicherung, v)
    },
    meldung, setMeldung,
  }
}

export type Fahrtenstand = ReturnType<typeof useFahrten>
