'use client'

/**
 * Anmeldung auf /wohnungen. Dasselbe Konto wie im Velonavi (`velonavi/konto.ts`):
 * dieselbe Sitzung im Browser, dieselben Anmeldewege. Im Konto liegt die
 * Merkliste (Tabelle `wohnungen_merkliste`), damit gemerkte und ausgeblendete
 * Inserate und die Filter auf jedem Gerät gelten.
 *
 * Ohne Supabase-Projekt (`KONTO_MOEGLICH`) gibt es keinen Knopf, und alles
 * bleibt wie bisher im Browser.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  KONTO_MOEGLICH,
  KONTO_WECHSEL,
  anmeldeFehler,
  anmeldewege,
  konto,
  kontoAngefangen,
  PROJEKT,
  type Anbieter,
} from '../velonavi/konto'

export { KONTO_MOEGLICH }

const TABELLE = 'wohnungen_merkliste'

/**
 * Supabase schickt nach der Anmeldung hierher zurück. Die Adresse muss im
 * Dashboard unter Redirect URLs erlaubt sein (`https://angebunden.ch/**` deckt
 * alle Seiten ab), sonst landet man auf der Startseite und ist dort angemeldet.
 */
const zurueck = () => `${window.location.origin}/wohnungen`

export type Merkliste = { gemerkt: string[]; weg: string[]; filter: Record<string, unknown> | null }

/** Sitzung und Anmeldung. Die Bibliothek lädt erst, wenn jemand angemeldet ist oder sich anmelden will. */
export function useKonto() {
  const [aktiv, setAktiv] = useState(false)
  const [nutzer, setNutzer] = useState<User | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)

  useEffect(() => {
    if (!KONTO_MOEGLICH) return
    const fehler = anmeldeFehler()
    if (fehler) setMeldung(fehler)
    if (kontoAngefangen()) setAktiv(true)
  }, [])

  useEffect(() => {
    if (!aktiv) return
    let weg = false
    let abbestellen: (() => void) | undefined
    konto()
      .then(async (sb) => {
        if (weg) return
        const { data } = sb.auth.onAuthStateChange((_e, sitzung) => {
          setNutzer(sitzung?.user ?? null)
          window.dispatchEvent(new Event(KONTO_WECHSEL))
        })
        abbestellen = () => data.subscription.unsubscribe()
        const { error } = await sb.auth.initialize()
        if (error && !weg) setMeldung(`Die Anmeldung hat nicht geklappt: ${error.message}`)
      })
      .catch(() => !weg && setMeldung('Die Anmeldung liess sich nicht laden.'))
    return () => {
      weg = true
      abbestellen?.()
    }
  }, [aktiv])

  const mit = useCallback(async (anbieter: Anbieter['id']) => {
    const sb = await konto()
    const { error } = await sb.auth.signInWithOAuth({ provider: anbieter, options: { redirectTo: zurueck() } })
    if (error) setMeldung(`Die Anmeldung hat nicht geklappt: ${error.message}`)
  }, [])

  const perMail = useCallback(async (mail: string) => {
    const sb = await konto()
    const { error } = await sb.auth.signInWithOtp({ email: mail, options: { emailRedirectTo: zurueck() } })
    if (error) setMeldung(`Der Anmeldelink liess sich nicht verschicken: ${error.message}`)
    return !error
  }, [])

  const abmelden = useCallback(async () => {
    const sb = await konto()
    await sb.auth.signOut()
    setNutzer(null)
  }, [])

  return { moeglich: KONTO_MOEGLICH, nutzer, meldung, setMeldung, starten: () => setAktiv(true), mit, perMail, abmelden }
}

/**
 * Gleicht die Merkliste mit dem Konto ab. Beim Anmelden werden die gemerkten
 * und ausgeblendeten Inserate von Gerät und Konto vereinigt, damit nichts
 * verloren geht; bei den Filtern gilt die Fassung im Konto, sofern es eine gibt.
 * Danach geht jede Änderung nach einer Sekunde Ruhe ins Konto.
 */
export function useMerklisteImKonto(
  nutzer: User | null,
  lokal: Merkliste,
  uebernehmen: (m: Merkliste) => void
) {
  const [bereit, setBereit] = useState(false)
  const lokalRef = useRef(lokal)
  lokalRef.current = lokal

  // Beim Anmelden einmal zusammenführen.
  useEffect(() => {
    setBereit(false)
    if (!nutzer) return
    let weg = false
    ;(async () => {
      const sb = await konto()
      const { data, error } = await sb.from(TABELLE).select('daten').maybeSingle()
      if (weg || error) return
      const entfernt = (data?.daten ?? null) as Partial<Merkliste> | null
      const l = lokalRef.current
      const vereint: Merkliste = {
        gemerkt: [...new Set([...(entfernt?.gemerkt ?? []), ...l.gemerkt])],
        weg: [...new Set([...(entfernt?.weg ?? []), ...l.weg])],
        filter: entfernt?.filter ?? l.filter,
      }
      uebernehmen(vereint)
      await sb.from(TABELLE).upsert({ user_id: nutzer.id, daten: vereint, geaendert: new Date().toISOString() })
      if (!weg) setBereit(true)
    })().catch(() => {})
    return () => {
      weg = true
    }
    // `uebernehmen` ändert sich mit jedem Bild; massgeblich ist nur der Wechsel des Kontos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nutzer?.id])

  // Danach jede Änderung ablegen.
  const schluessel = JSON.stringify(lokal)
  useEffect(() => {
    if (!nutzer || !bereit) return
    const t = setTimeout(async () => {
      const sb = await konto()
      await sb.from(TABELLE).upsert({ user_id: nutzer.id, daten: lokalRef.current, geaendert: new Date().toISOString() })
    }, 1000)
    return () => clearTimeout(t)
  }, [schluessel, nutzer, bereit])
}

/** Die Anmeldewege: Anbieter-Knöpfe und Link per Mail. Im Kopf und im Suchabo-Dialog. */
export function AnmeldeFormular({ k }: { k: ReturnType<typeof useKonto> }) {
  const [wege, setWege] = useState<{ anbieter: Anbieter[]; mail: boolean } | null>(null)
  const [mail, setMail] = useState('')
  const [verschickt, setVerschickt] = useState(false)

  useEffect(() => {
    k.starten()
    anmeldewege().then(setWege, () => setWege({ anbieter: [], mail: true }))
    // Nur beim Öffnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {!wege && <p className="mt-3 text-[var(--ab-leise)]">Lade …</p>}
      {wege && (
        <div className="mt-3 flex flex-col gap-1.5">
          {wege.anbieter.map((a) => (
            <button key={a.id} type="button" className="rounded-lg border border-[var(--ab-linie)] py-1.5 font-medium hover:bg-[var(--ab-weich)]" onClick={() => k.mit(a.id)}>
              Mit {a.name} anmelden
            </button>
          ))}
          {wege.mail &&
            (verschickt ? (
              <p className="leading-snug text-[var(--ab-leise)]">Der Anmeldelink ist unterwegs. Schau in dein Postfach.</p>
            ) : (
              <form
                className="flex gap-1.5"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (mail.includes('@') && (await k.perMail(mail.trim()))) setVerschickt(true)
                }}
              >
                <input
                  type="email"
                  required
                  value={mail}
                  onChange={(e) => setMail(e.target.value)}
                  placeholder="E-Mail"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--ab-linie)] bg-[var(--ab-aktiv)] px-2.5 py-1.5 outline-none focus:border-[var(--ab-leise)]"
                />
                <button type="submit" className="rounded-lg bg-[var(--ab-tinte)] px-3 font-medium text-[var(--ab-papier)]">
                  Link
                </button>
              </form>
            ))}
        </div>
      )}
      {k.meldung && <p className="mt-2 text-[var(--ab-karmin)]">{k.meldung}</p>}
    </>
  )
}

/** Der Knopf oben rechts und das kleine Fenster für die Anmeldung. */
export function Anmeldung({ k }: { k: ReturnType<typeof useKonto> }) {
  const [offen, setOffen] = useState(false)
  if (!k.moeglich) return null

  const knopf = 'shrink-0 rounded-full border border-[var(--ab-linie)] px-3 py-1 text-[12px] font-medium hover:bg-[var(--ab-weich)]'
  const fenster =
    'absolute top-full right-0 z-30 mt-2 w-72 rounded-2xl border border-[var(--ab-linie)] bg-[var(--ab-papier)] p-3.5 text-[12.5px] shadow-[var(--ab-schatten)]'

  if (k.nutzer) {
    return (
      <div className="relative shrink-0">
        <button type="button" className={knopf} onClick={() => setOffen((o) => !o)} aria-expanded={offen}>
          Konto
        </button>
        {offen && (
          <div className={fenster}>
            <p className="text-[var(--ab-leise)]">Angemeldet als</p>
            <p className="truncate font-medium">{k.nutzer.email ?? 'Konto'}</p>
            <p className="mt-2 leading-snug text-[var(--ab-leise)]">
              Gemerkte und ausgeblendete Wohnungen, Filter und Suchabos liegen im Konto und gelten auf jedem Gerät.
            </p>
            <button
              type="button"
              className="mt-3 text-[12px] underline underline-offset-2"
              onClick={() => {
                k.abmelden()
                setOffen(false)
              }}
            >
              Abmelden
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative shrink-0">
      <button type="button" className={knopf} onClick={() => setOffen((o) => !o)} aria-expanded={offen}>
        Anmelden
      </button>
      {offen && (
        <div className={fenster}>
          <p className="leading-snug">
            Mit einem Konto bleiben gemerkte Wohnungen, Ausgeblendetes und die Filter auf jedem Gerät, und du kannst
            Suchabos per Mail anlegen. Dasselbe Konto wie im Velonavi.
          </p>
          <AnmeldeFormular k={k} />
        </div>
      )}
    </div>
  )
}

// ─── Suchabos ─────────────────────────────────────────────────────────────

export type Suchabo = { id: string; name: string; email: string; filter: Record<string, unknown>; aktiv: boolean; erstellt: string }

/** Die eigenen Suchabos lesen, anlegen und löschen. Verschickt werden sie von `pipeline/21-suchabos.ts`. */
export function useSuchabos(nutzer: User | null) {
  const [abos, setAbos] = useState<Suchabo[]>([])

  const laden = useCallback(async () => {
    if (!nutzer) return setAbos([])
    const sb = await konto()
    const { data } = await sb.from('wohnungen_suchabos').select('id, name, email, filter, aktiv, erstellt').order('erstellt', { ascending: false })
    setAbos((data ?? []) as Suchabo[])
  }, [nutzer])

  useEffect(() => {
    laden().catch(() => {})
  }, [laden])

  const anlegen = useCallback(
    async (name: string, filter: Record<string, unknown>) => {
      if (!nutzer?.email) throw new Error('Das Konto hat keine E-Mail-Adresse.')
      const sb = await konto()
      const { error } = await sb.from('wohnungen_suchabos').insert({ name, filter, email: nutzer.email })
      if (error) throw new Error(error.message)
      await laden()
    },
    [nutzer, laden]
  )

  const loeschen = useCallback(
    async (id: string) => {
      const sb = await konto()
      await sb.from('wohnungen_suchabos').delete().eq('id', id)
      await laden()
    },
    [laden]
  )

  const umschalten = useCallback(
    async (id: string, aktiv: boolean) => {
      const sb = await konto()
      await sb.from('wohnungen_suchabos').update({ aktiv }).eq('id', id)
      await laden()
    },
    [laden]
  )

  return { abos, anlegen, loeschen, umschalten }
}

/**
 * Abmelden über den Link in der Mail (`/wohnungen?abmelden=<token>`), ohne
 * Anmeldung. Gibt eine Meldung zurück und räumt die Adresse auf.
 */
export function useAbmeldelink() {
  const [meldung, setMeldung] = useState<string | null>(null)
  useEffect(() => {
    const suche = new URLSearchParams(window.location.search)
    const token = suche.get('abmelden')
    if (!token || !PROJEKT.adresse || !PROJEKT.schluessel) return
    suche.delete('abmelden')
    window.history.replaceState(null, '', window.location.pathname + (suche.size ? `?${suche}` : '') + window.location.hash)
    fetch(`${PROJEKT.adresse}/rest/v1/rpc/wohnungen_suchabo_abmelden`, {
      method: 'POST',
      headers: { apikey: PROJEKT.schluessel, Authorization: `Bearer ${PROJEKT.schluessel}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const name = r.ok ? ((await r.json()) as string | null) : null
        setMeldung(name ? `Das Suchabo «${name}» ist abgemeldet. Du bekommst dazu keine Mails mehr.` : 'Dieses Suchabo gibt es nicht mehr.')
      })
      .catch(() => setMeldung('Das Abmelden hat nicht geklappt. Versuch es später noch einmal.'))
  }, [])
  return [meldung, setMeldung] as const
}
