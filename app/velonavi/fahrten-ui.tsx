'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { GEFAHREN, GRAU } from '../farben'
import { anmeldewege, type Anbieter } from './konto'
import { deckung, type Fahrt, type Ort } from './fahrten.ts'
import { aehnliche, teilstrecken, type Teilstrecke } from './vergleich.ts'
import { MODI, modusName } from './modus.ts'
import type { Graph, Route } from './router'
import type { Fahrtenstand } from './fahrten-zustand'
import { ui, km, minuten, Hinweis, KleinKnopf, Schalter } from './teile'

export { useFahrten } from './fahrten-zustand'
export type { Fahrtenstand } from './fahrten-zustand'

// ---------------------------------------------------------------- Formatierung

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

const ART_NAMEN: Record<string, string> = { velo: 'Velo', gehen: 'Gehen', laufen: 'Joggen', fahrzeug: 'Fahrzeug' }

/** «gerade eben», «vor 3 Min.», «vor 2 h», «vor 4 Tagen». */
function vorText(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'gerade eben'
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`
  const t = Math.round(s / 86400)
  return `vor ${t} ${t === 1 ? 'Tag' : 'Tagen'}`
}

/** «1 Min. 20 s schneller» oder «… langsamer», ab fünf Sekunden Unterschied. */
function unterschied(gefahren: number, vergleich: number, wort: [string, string]) {
  const d = Math.round(vergleich - gefahren)
  if (Math.abs(d) < 5) return 'gleich schnell'
  return `${dauerText(Math.abs(d))} ${d > 0 ? wort[0] : wort[1]}`
}

type Routen = { schnell: Route | null; komfort: Route | null }

// ---------------------------------------------------------------- Knopf und Menü

function Symbol() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20.5c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" />
    </svg>
  )
}

/**
 * Der Knopf, der das Fahrtenmenü öffnet. In der Seitenleiste ist er ein
 * rundes Symbol neben dem Titel, auf dem Handy eine Pille wie «Tauschen»
 * daneben. Läuft eine Aufzeichnung, trägt er einen violetten Punkt.
 */
export function Fahrtenknopf({ f, offen, onClick, pille }: { f: Fahrtenstand; offen: boolean; onClick: () => void; pille?: boolean }) {
  // Violett: Es wird gerade aufgezeichnet. Grün: Die Erkennung ist bereit und wartet auf die nächste Fahrt.
  const bereit = !!f.nativ && f.autoAn && !!f.erkennung?.bereitSeit
  const punkt = (f.laufend || bereit) && (
    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full" style={{ background: f.laufend ? GEFAHREN : '#16a34a', boxShadow: `0 0 0 2px ${ui.bg}` }} />
  )
  if (pille)
    return (
      <button
        onClick={onClick}
        aria-haspopup="dialog"
        aria-expanded={offen}
        className="relative flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] backdrop-blur-md"
        style={{ background: ui.panel, borderColor: ui.border, color: ui.fg, boxShadow: ui.schatten }}
      >
        <Symbol />
        Konto
        {punkt}
      </button>
    )
  return (
    <button
      onClick={onClick}
      aria-label="Konto und Fahrten"
      title="Konto und Fahrten"
      aria-haspopup="dialog"
      aria-expanded={offen}
      className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full border"
      style={{ borderColor: offen ? ui.fg : ui.border, color: ui.fg }}
    >
      <Symbol />
      {punkt}
    </button>
  )
}

function Abschnitt({ titel, zusatz, offen: anfang = false, children }: { titel: string; zusatz?: string; offen?: boolean; children: ReactNode }) {
  const [offen, setOffen] = useState(anfang)
  return (
    <section className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: ui.border }}>
      <button onClick={() => setOffen(!offen)} aria-expanded={offen} className="flex w-full items-center justify-between gap-2 text-left text-[13px] font-medium">
        <span>
          {titel}
          {zusatz && (
            <span className="ml-1.5 text-[12px] font-normal" style={{ color: ui.muted }}>
              {zusatz}
            </span>
          )}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: ui.muted, transform: offen ? 'rotate(180deg)' : undefined }} aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {offen && children}
    </section>
  )
}

function Meldung({ f }: { f: Fahrtenstand }) {
  if (!f.meldung) return null
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1">
        <Hinweis>{f.meldung}</Hinweis>
      </div>
      <button onClick={() => f.setMeldung(null)} aria-label="Hinweis schliessen" className="px-1 text-[16px] leading-none" style={{ color: ui.muted }}>
        ×
      </button>
    </div>
  )
}

/**
 * Das Fahrtenmenü. Es schwebt als eigenes Feld über der Karte, neben der
 * Seitenleiste oder auf dem Handy über den Suchfeldern. Ein Klick daneben
 * oder Escape schliesst es. Wer eine Fahrt oder einen Vergleich wählt, sieht
 * das Ergebnis im Bedienfeld und auf der Karte, das Menü macht dafür Platz.
 */
export function Fahrtenmenue({ f, graph, mobil, onSchliessen }: { f: Fahrtenstand; graph: Graph | null; mobil: boolean; onSchliessen: () => void }) {
  useEffect(() => {
    const taste = (e: KeyboardEvent) => e.key === 'Escape' && onSchliessen()
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [onSchliessen])

  const [alle, setAlle] = useState(false)
  const datei = useRef<HTMLInputElement>(null)
  const liste = alle ? f.fahrten : f.fahrten.slice(0, 8)

  // Die Teilstrecken rechnen sich in wenigen Millisekunden, aber erst, wenn Fahrten zugeordnet sind.
  const teil = useMemo(() => (graph && f.laeufe.length > 1 ? teilstrecken(graph, f.laeufe.slice(0, 60)) : []), [graph, f.laeufe])

  return (
    <>
      <div className="absolute inset-0 z-40" style={{ background: mobil ? 'rgba(0, 0, 0, 0.25)' : undefined }} onClick={onSchliessen} />
      <div
        role="dialog"
        data-menue="fahrten"
        aria-label="Konto und Fahrten"
        className={
          'absolute z-50 flex flex-col gap-3 overflow-y-auto overscroll-contain rounded-2xl border p-4 backdrop-blur-md ' +
          (mobil ? 'inset-x-3' : 'left-[25.5rem] top-3 w-[22rem]')
        }
        style={{
          background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten, color: ui.fg,
          top: mobil ? 'max(0.75rem, env(safe-area-inset-top))' : undefined,
          maxHeight: 'calc(100% - 1.5rem)',
        }}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Konto und Fahrten</h2>
          <button onClick={onSchliessen} aria-label="Menü schliessen" className="-mr-1 px-1 text-[18px] leading-none" style={{ color: ui.muted }}>
            ×
          </button>
        </div>
        <Meldung f={f} />

        <div className="flex flex-col gap-2.5">
          <Schalter
            an={f.aufzeichnen}
            setAn={f.setAufzeichnen}
            titel="Knopf «Aufzeichnen» zeigen"
            hilfe={
              f.nativ
                ? 'Bei jeder Route. Die App zeichnet auch bei ausgeschaltetem Bildschirm auf'
                : 'Bei jeder Route. Im Browser zeichnet die Seite nur auf, solange sie offen und der Bildschirm an ist'
            }
          />
          {f.nativ ? (
            <>
              <Schalter
                an={f.autoAn}
                setAn={f.setAuto}
                titel="Von selbst aufzeichnen"
                hilfe="Erkennt Velofahrten und zeichnet sie im Hintergrund auf. Braucht Standort «Immer» und Bewegungserkennung"
              />
              <Erkennung f={f} gross />
            </>
          ) : (
            <p className="text-[11px] leading-snug" style={{ color: ui.muted }}>
              Von selbst im Hintergrund aufzeichnen geht nur mit der Android-App.
            </p>
          )}
          {f.nativ && f.autoAn && (
            <div className="flex flex-col gap-2.5 border-l-2 pl-3" style={{ borderColor: ui.border }}>
              <Schalter
                an={f.autoAlle}
                setAn={f.setAutoAlle}
                titel="Auch Gehen, Joggen, Tram und Auto"
                hilfe="Zeichnet jeden Weg auf und erkennt, womit du unterwegs warst. Gelernt wird nur aus Velofahrten, der Rest bleibt auf dem Gerät. Kostet mehr Akku"
              />
            </div>
          )}
          <Schalter
            an={f.ortZeigen}
            setAn={f.setOrtZeigen}
            titel="Meinen Standort zeigen"
            hilfe="Ein blauer Punkt auf der Karte, auch ohne Aufzeichnung. Er wird nirgends gespeichert. Im Browser fragt der Schalter einmal nach der Freigabe"
          />
          <Schalter
            an={f.lernen}
            setAn={f.setLernen}
            titel="Aus Fahrten lernen"
            hilfe={
              f.stand && (f.stand.fahrten || f.stand.vonAnderen.abschnitte)
                ? `${f.stand.fahrten} eigene ${f.stand.fahrten === 1 ? 'Fahrt' : 'Fahrten'}, ${f.stand.abschnitte} Abschnitte, ${f.stand.ampeln} Ampeln. ${f.stand.fahrten ? tempoText(f.stand.tempo) : ''}`
                : 'Passt Fahrzeiten und Wartezeiten an Ampeln an das an, was gefahren wurde'
            }
          />
          {f.lernen && f.kontoMoeglich && (
            <div className="flex flex-col gap-2.5 border-l-2 pl-3" style={{ borderColor: ui.border }}>
              <Schalter
                an={f.vonAnderen}
                setAn={f.setVonAnderen}
                titel="Von den Fahrten anderer lernen"
                hilfe={
                  f.stand && f.stand.vonAnderen.abschnitte + f.stand.vonAnderen.ampeln
                    ? `${f.stand.vonAnderen.abschnitte} Abschnitte und ${f.stand.vonAnderen.ampeln} Ampeln zusätzlich aus Messungen anderer`
                    : 'Nutzt die Durchschnitte aller, die ihre Messwerte beitragen. Es wird nur etwas gezeigt, was mindestens fünf gemessen haben'
                }
              />
              <Schalter
                an={f.beitragen}
                setAn={f.setBeitragen}
                titel="Meine Messwerte anonym beitragen"
                hilfe="Standardmässig an. Es gehen einzelne Werte je Abschnitt und Ampel weg, ohne Zeit, Reihenfolge und Kennung und ohne die ersten und letzten 150 Meter. Nie eine Spur, nie ein Weg zu Fuss oder im Fahrzeug"
              />
            </div>
          )}
          <p className="text-[11px] leading-snug" style={{ color: ui.muted }}>
            Die Fahrten bleiben auf diesem Gerät{f.sicherung && f.nutzer ? ', eine gekürzte Kopie liegt im Konto' : ''}.
          </p>
        </div>

        <Abschnitt titel="Fahrten" zusatz={String(f.fahrten.length)} offen>
          {f.fahrten.length === 0 && (
            <p className="text-[12px]" style={{ color: ui.muted }}>
              {f.geladen ? 'Noch keine.' : 'Wird geladen …'}
            </p>
          )}
          <ul className="-mx-2 flex flex-col">
            {liste.map((x) => (
              <li key={x.id}>
                <button
                  onClick={() => {
                    f.zeigen(x)
                    onSchliessen()
                  }}
                  aria-current={f.gezeigteFahrt?.id === x.id}
                  className="zeile flex w-full items-baseline justify-between gap-3 rounded-xl px-2 py-1.5 text-left text-[12px]"
                  style={{ '--weich': ui.weich, background: f.gezeigteFahrt?.id === x.id ? ui.weich : undefined } as React.CSSProperties}
                >
                  <span className="min-w-0">
                    <span className="block truncate">
                      {x.start.titel} → {x.ziel.titel}
                    </span>
                    <span className="block text-[11px]" style={{ color: ui.muted }}>
                      {datumText(x.begonnen)}
                      {x.modus && x.modus !== 'velo' && ` · ${modusName(x.modus)}`}
                      {x.quelle === 'auto' && ' · von selbst'}
                      {x.quelle === 'gpx' && ' · GPX'}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: ui.muted }}>
                    {minuten(x.dauer)} · {km(x.distanz)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {f.fahrten.length > 8 && (
            <button onClick={() => setAlle(!alle)} className="self-start text-[12px] underline underline-offset-2">
              {alle ? 'Weniger anzeigen' : `Alle ${f.fahrten.length} anzeigen`}
            </button>
          )}
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <button onClick={() => datei.current?.click()} className="underline underline-offset-2" title="Eine Fahrt aus einem Velocomputer oder einer App übernehmen">
              GPX einlesen
            </button>
            {f.fahrten.length > 0 && (
              <button
                onClick={() => window.confirm('Alle Fahrten endgültig löschen?') && f.loeschen('alle')}
                className="underline underline-offset-2"
                style={{ color: ui.muted }}
              >
                Alle löschen
              </button>
            )}
          </div>
          <input
            ref={datei}
            type="file"
            accept=".gpx,application/gpx+xml"
            className="hidden"
            onChange={(e) => {
              const d = e.target.files?.[0]
              e.target.value = ''
              if (!d) return
              f.importieren(d)
              onSchliessen()
            }}
          />
        </Abschnitt>

        <Abschnitt titel="Vergleich" zusatz={teil.length ? String(teil.length) : undefined}>
          {teil.length === 0 ? (
            <p className="text-[12px] leading-snug" style={{ color: ui.muted }}>
              Sobald du ein Stück Strecke auf verschiedenen Wegen gefahren bist, steht hier, welcher schneller war. Start und Ziel müssen dafür nicht dieselben sein.
            </p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {teil.map((t) => (
                <li key={`${t.von}>${t.nach}`}>
                  <button
                    onClick={() => {
                      f.zeigenTeil(t)
                      onSchliessen()
                    }}
                    className="zeile flex w-full flex-col rounded-xl px-2 py-1.5 text-left text-[12px]"
                    style={{ '--weich': ui.weich } as React.CSSProperties}
                  >
                    <span className="truncate">{teilTitel(t)}</span>
                    <span className="text-[11px]" style={{ color: ui.muted }}>
                      {dauerText(t.vorsprung)} schneller · {km(t.meter)} · {t.fahrten} Fahrten
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Abschnitt>

        {f.kontoMoeglich && (
          <Abschnitt titel="Sicherung im Konto" zusatz={f.nutzer && f.sicherung ? 'an' : undefined}>
            {f.nutzer ? <Konto f={f} /> : <Anmeldung f={f} />}
          </Abschnitt>
        )}
      </div>
    </>
  )
}

/** «Weinbergstrasse statt Bahnhofquai», sonst ein allgemeiner Titel. */
function teilTitel(t: Teilstrecke) {
  const schnell = t.wege[0].strasse
  const langsam = t.wege[t.wege.length - 1].strasse
  return schnell && langsam && schnell !== langsam ? `${schnell} statt ${langsam}` : 'Anderer Weg'
}

/** Das eigene Tempo im Vergleich zu den 23 km/h, mit denen das Modell in der Ebene rechnet. */
function tempoText(tempo: number) {
  const p = Math.round(100 * Math.abs(1 - tempo))
  if (p < 2) return 'Dein Tempo entspricht dem Modell.'
  return `Du brauchst ${p}% ${tempo < 1 ? 'weniger' : 'mehr'} Fahrzeit als das Modell.`
}

// ---------------------------------------------------------------- Sicherung

function Konto({ f }: { f: Fahrtenstand }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="truncate" style={{ color: ui.muted }}>
          {f.nutzer?.email ?? 'Angemeldet'}
        </span>
        <button onClick={f.abmelden} className="shrink-0 underline underline-offset-2">
          Abmelden
        </button>
      </div>
      <Schalter
        an={f.sicherung}
        setAn={f.setSicherung}
        titel="Fahrten im Konto sichern"
        hilfe="Damit sie auf einem neuen Gerät wieder da sind. Es geht eine gekürzte Kopie: ohne die ersten und letzten 150 Meter, ohne Adressen, mit dem Beginn auf die Stunde gerundet"
      />
      <p className="text-[11px] leading-snug" style={{ color: ui.muted }}>
        Gelöschte Fahrten verschwinden auch aus dem Konto.
      </p>
    </div>
  )
}

function Anmeldung({ f }: { f: Fahrtenstand }) {
  const [wege, setWege] = useState<{ anbieter: Anbieter[]; mail: boolean } | 'fehler' | null>(null)
  const [mail, setMail] = useState('')
  const [geschickt, setGeschickt] = useState(false)
  const [wartet, setWartet] = useState(false)

  // Erst mit dem Öffnen des Abschnitts wird Supabase geladen und gefragt, welche Anmeldewege es gibt.
  const { anbinden } = f
  useEffect(() => {
    let weg = false
    anbinden()
    anmeldewege().then(
      (w) => !weg && setWege(w),
      () => !weg && setWege('fehler')
    )
    return () => {
      weg = true
    }
  }, [anbinden])

  const feld = 'w-full rounded-full border px-3.5 py-2 text-[13px] outline-none'
  const knopf = 'w-full rounded-full border px-3.5 py-2 text-[13px] font-medium disabled:opacity-50'
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12px] leading-snug" style={{ color: ui.muted }}>
        Ohne Konto bleibt alles auf diesem Gerät. Mit Konto liegt zusätzlich eine gekürzte Kopie bei Supabase in Zürich, sie ist nur für dich lesbar.
      </p>
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
    </div>
  )
}

// ---------------------------------------------------------------- Im Bedienfeld

/**
 * Was zuoberst im Bedienfeld steht: Meldungen, laufende Aufzeichnung, die
 * Auswertung der Fahrt und der Vergleich, die gerade auf der Karte liegen.
 * `routen` sind die Vorschläge, die der Routenplaner gerade zeigt.
 */
export function Fahrtbereich({
  f, graph, start, ziel, routen, wahl,
}: {
  f: Fahrtenstand
  graph: Graph | null
  start: Ort | null
  ziel: Ort | null
  routen: Routen | null
  wahl: string | null
}) {
  return (
    <>
      <Meldung f={f} />
      {f.laufend && <Laufend f={f} />}
      {!f.laufend && <Erkennung f={f} />}
      {/* Steht keine Route da, hängt der Knopf nicht an ihr: Man kann auch ohne Plan losfahren. */}
      {!routen && !f.laufend && <AufzeichnenKnopf f={f} routen={routen} wahl={wahl} gross />}
      {f.gezeigteFahrt && <Auswertung f={f} fahrt={f.gezeigteFahrt} graph={graph} start={start} ziel={ziel} routen={routen} />}
      {f.teilGezeigt && <Teilvergleich f={f} t={f.teilGezeigt} />}
    </>
  )
}

/** Der Knopf zum Losfahren, klein neben GPX und Teilen, gross ohne Route. */
export function AufzeichnenKnopf({ f, routen, wahl, gross }: { f: Fahrtenstand; routen: Routen | null; wahl: string | null; gross?: boolean }) {
  if (!f.aufzeichnen || f.laufend) return null
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
  if (!gross)
    return (
      <KleinKnopf onClick={losfahren} titel="Die Fahrt aufzeichnen, auswerten und mit anderen vergleichen">
        Aufzeichnen
      </KleinKnopf>
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

/**
 * Bestätigt, dass die automatische Erkennung läuft: bereit seit wann, und was
 * Android zuletzt gemeldet hat, auch wenn daraus keine Aufzeichnung wurde.
 * Ohne diese Zeile sähe man der App nicht an, ob sie noch lebt.
 */
function Erkennung({ f, gross }: { f: Fahrtenstand; gross?: boolean }) {
  // Die Zeit «vor …» soll weiterlaufen, auch wenn sich sonst nichts ändert.
  const [, setTakt] = useState(0)
  useEffect(() => {
    const uhr = window.setInterval(() => setTakt((n) => n + 1), 30_000)
    return () => window.clearInterval(uhr)
  }, [])
  const e = f.erkennung
  if (!f.nativ || !f.autoAn || !e) return null
  const bereit = e.bereitSeit > 0
  const letzte = e.letzteZeit > 0 && e.letzteArt ? `${ART_NAMEN[e.letzteArt] ?? e.letzteArt} ${e.letzteBeginn ? 'begonnen' : 'beendet'}, ${vorText(e.letzteZeit)}` : null
  return (
    <div className={gross ? 'flex flex-col gap-1 text-[12px]' : 'flex items-start gap-2 text-[11px] leading-snug'} style={{ color: ui.muted }}>
      <span className="mt-[3px] inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: bereit ? '#16a34a' : '#d03b3b' }} aria-hidden />
      <span>
        {bereit ? (
          <>
            <span style={{ color: ui.fg }}>Erkennung aktiv</span>
            {' · '}
            {letzte ? `zuletzt: ${letzte}` : 'noch keine Bewegung gemeldet'}
            {gross && <span className="block">Bereit seit {vorText(e.bereitSeit).replace('vor ', '')}. Zeichnet von selbst auf, sobald Android eine Bewegung erkennt.</span>}
          </>
        ) : (
          <>
            <span style={{ color: ui.fg }}>Erkennung nicht aktiv</span>
            {e.bereitFehler ? `: ${e.bereitFehler}` : '. Schalter aus- und wieder einschalten.'}
          </>
        )}
      </span>
    </div>
  )
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
        {f.nativ
          ? 'Die App zeichnet weiter, auch wenn der Bildschirm aus ist. Am Ziel endet die Fahrt, wenn du dich einige Minuten nicht mehr bewegst.'
          : 'Am Ziel endet die Aufzeichnung von selbst. Der Bildschirm bleibt an, die Seite muss im Vordergrund sein.'}
      </p>
    </div>
  )
}

/** Eine Fahrt im Rückblick: was gemessen wurde, wie sie zu den Vorschlägen steht und welche Fahrten ähnlich waren. */
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
  const velo = (fahrt.modus ?? 'velo') === 'velo'
  const z = velo ? f.zuordnung(fahrt.id) : null
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
  if (damals) zeilen.push({ titel: '«Schnell» beim Losfahren', wert: dauerText(damals.zeit), hilfe: `du warst ${unterschied(dauer, damals.zeit, ['schneller', 'langsamer'])}` })
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
            {fahrt.quelle === 'auto' && ' · von selbst aufgezeichnet'}
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
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Art der Fahrt">
          {MODI.map((m) => {
            const an = (fahrt.modus ?? 'velo') === m.id
            return (
              <button
                key={m.id}
                onClick={() => f.setModus(fahrt.id, m.id)}
                aria-pressed={an}
                className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                style={{ borderColor: an ? ui.fg : ui.border, background: an ? ui.weich : 'transparent', color: an ? ui.fg : ui.muted }}
              >
                {m.name}
              </button>
            )
          })}
        </div>
        {!velo && (
          <p className="text-[11px] leading-snug" style={{ color: ui.muted }}>
            Keine Velofahrt: Sie zählt nicht fürs Lernen und wird nicht verglichen. Stimmt die Art nicht, oben ändern.
          </p>
        )}
      </div>
      {velo && !z && (
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
      <Aehnliche f={f} fahrt={fahrt} graph={graph} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: ui.muted }}>
          <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: GEFAHREN }} />
          deine Spur
        </span>
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

/**
 * Fahrten, die ungefähr dieselbe Strecke waren, nach Fahrzeit geordnet. Es
 * zählt nicht die genaue Adresse: Ähnlich ist, was in der Nähe beginnt und
 * endet oder zu grossen Teilen auf denselben Wegen lag.
 */
function Aehnliche({ f, fahrt, graph }: { f: Fahrtenstand; fahrt: Fahrt; graph: Graph | null }) {
  const [mit, setMit] = useState<string | null>(null)
  const lauf = f.laeufe.find((l) => l.fahrt.id === fahrt.id)
  const treffer = useMemo(() => (graph && lauf ? aehnliche(graph, lauf, f.laeufe) : []), [graph, lauf, f.laeufe])
  if (!lauf || !treffer.length) return null

  const zeilen = [
    { id: fahrt.id, fahrt, netto: lauf.zuordnung.netto, distanz: lauf.zuordnung.distanz, gemeinsam: 1 },
    ...treffer.map((t) => ({ id: t.fahrt.id, fahrt: t.fahrt, netto: t.zuordnung.netto, distanz: t.zuordnung.distanz, gemeinsam: t.gemeinsam })),
  ].sort((a, b) => a.netto - b.netto)

  return (
    <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: ui.border }}>
      <h4 className="text-[12px] font-medium">Ähnliche Fahrten</h4>
      <ul className="-mx-2 flex flex-col">
        {zeilen.map((z, i) => {
          const diese = z.id === fahrt.id
          return (
            <li key={z.id}>
              <button
                disabled={diese}
                onClick={() => {
                  const neu = mit === z.id ? null : z.id
                  setMit(neu)
                  f.zeigenMit(fahrt, neu ? z.fahrt : null)
                }}
                className="zeile flex w-full items-baseline justify-between gap-3 rounded-xl px-2 py-1 text-left text-[12px]"
                style={{ '--weich': ui.weich, background: mit === z.id ? ui.weich : undefined } as React.CSSProperties}
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {diese ? 'Diese Fahrt' : datumText(z.fahrt.begonnen)}
                    {i === 0 && <span style={{ color: ui.muted }}> · schnellste</span>}
                  </span>
                  <span className="block text-[11px]" style={{ color: ui.muted }}>
                    {diese ? datumText(fahrt.begonnen) : `folgt zu ${prozent(z.gemeinsam)} derselben Strecke · ${unterschied(lauf.zuordnung.netto, z.netto, ['langsamer', 'schneller'])}`}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: ui.muted }}>
                  {dauerText(z.netto)} · {km(z.distanz)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Die Wege einer Teilstrecke im Vergleich, der schnellste zuerst. */
function Teilvergleich({ f, t }: { f: Fahrtenstand; t: Teilstrecke }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border px-3 py-2.5" style={{ borderColor: ui.border }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[12px]">
          <div className="truncate font-medium">{teilTitel(t)}</div>
          <div className="text-[11px]" style={{ color: ui.muted }}>
            {dauerText(t.vorsprung)} schneller, auf {t.fahrten} Fahrten
          </div>
        </div>
        <button onClick={() => f.zeigenTeil(null)} aria-label="Vergleich schliessen" className="px-1 text-[16px] leading-none" style={{ color: ui.muted }}>
          ×
        </button>
      </div>
      <ul className="flex flex-col gap-1.5 text-[12px]">
        {t.wege.map((w, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="inline-block h-[3px] w-4 shrink-0 self-center rounded-full" style={{ background: i === 0 ? GEFAHREN : GRAU }} />
              <span className="truncate">
                {w.strasse ? `über ${w.strasse}` : 'anderer Weg'}
                <span style={{ color: ui.muted }}> · {km(w.meter)} · {w.zeiten.length}×</span>
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              {dauerText(w.median)}
              {w.zeiten.length > 1 && <span style={{ color: ui.muted }}> Ø</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
