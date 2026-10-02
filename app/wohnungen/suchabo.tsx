'use client'

import { useState } from 'react'
import type { Filter } from './filter'
import type { Kreis } from './kreise'
import { AnmeldeFormular, useSuchabos, type useKonto } from './konto'

/** Ein Name aus den Filtern, damit man das Abo in der Mail und in der Liste wiedererkennt. */
export function aboName(f: Filter, kreis?: Kreis) {
  const teile = [
    kreis ? `Kreis ${kreis.nummer}` : null,
    f.zimmerMin != null ? `ab ${String(f.zimmerMin).replace('.5', '½')} Zi.` : null,
    f.mieteMax != null ? `bis CHF ${f.mieteMax}` : null,
    f.flaecheMin != null ? `ab ${f.flaecheMin} m²` : null,
    f.dauer === 'unbefristet' ? 'unbefristet' : f.dauer === 'befristet' ? 'befristet' : null,
    f.gebiete.length ? `${f.gebiete.length} ${f.gebiete.length === 1 ? 'Gebiet' : 'Gebiete'}` : null,
    f.text.trim() ? `«${f.text.trim()}»` : null,
  ].filter(Boolean)
  return teile.length ? teile.join(', ') : 'Alle Wohnungen in Zürich'
}

/** Was ins Abo gehört: der Filter ohne das, was nur auf der Seite gilt. */
function aboFilter(f: Filter, kreis?: Kreis): Record<string, unknown> {
  const { nurAusschnitt: _a, nurGemerkt: _g, nurNeu: _n, sorte: _s, ...rest } = f
  // Auf einer Kreisseite gilt das Abo nur für die Postleitzahlen dieses Kreises.
  return kreis ? { ...rest, plz: kreis.plz } : rest
}

/**
 * Das Fenster «Suchabo»: die aktuelle Suche als Abo speichern und die
 * bestehenden verwalten. Ohne Konto zuerst die Anmeldung, denn die Mails
 * gehen an die Adresse des Kontos.
 */
export function SuchaboDialog({
  k, filter, kreis, schliessen,
}: {
  k: ReturnType<typeof useKonto>
  filter: Filter
  kreis?: Kreis
  schliessen: () => void
}) {
  const { abos, anlegen, loeschen, umschalten } = useSuchabos(k.nutzer)
  const [name, setName] = useState(() => aboName(filter, kreis))
  const [status, setStatus] = useState<'bereit' | 'speichert' | 'fertig'>('bereit')
  const [fehler, setFehler] = useState<string | null>(null)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center" onClick={schliessen}>
      <div
        role="dialog"
        aria-label="Suchabo"
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-[var(--ab-linie)] bg-[var(--ab-papier)] p-5 text-[13px] shadow-[var(--ab-schatten)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-tight">Suchabo per E-Mail</h2>
          <button type="button" onClick={schliessen} aria-label="Schliessen" className="rounded-full px-2 text-[15px] text-[var(--ab-leise)] hover:bg-[var(--ab-weich)]">
            ✕
          </button>
        </div>
        <p className="mt-1 leading-relaxed text-[var(--ab-leise)]">
          Sobald eine neue Wohnung zu deiner Suche passt, bekommst du eine Mail. Der Sammler schaut alle fünf Minuten
          nach. Gute Wohnungen sind oft nach einer Stunde weg.
        </p>

        {!k.moeglich && <p className="mt-4">Auf dieser Installation gibt es keine Konten, deshalb auch keine Suchabos.</p>}

        {k.moeglich && !k.nutzer && (
          <div className="mt-4 rounded-2xl border border-[var(--ab-linie)] p-3.5">
            <p className="font-medium">Zuerst anmelden</p>
            <p className="mt-0.5 text-[var(--ab-leise)]">Die Mails gehen an die Adresse deines Kontos. Deine Filter bleiben erhalten.</p>
            <AnmeldeFormular k={k} />
          </div>
        )}

        {k.nutzer && (
          <>
            {status === 'fertig' ? (
              <div className="mt-4 rounded-2xl bg-[var(--ab-weich)] p-3.5">
                <p className="font-medium">Gespeichert.</p>
                <p className="mt-0.5 text-[var(--ab-leise)]">
                  In den nächsten Minuten kommt eine Bestätigung an {k.nutzer.email}, danach eine Mail zu jeder neuen passenden
                  Wohnung.
                </p>
              </div>
            ) : (
              <form
                className="mt-4 flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setStatus('speichert')
                  setFehler(null)
                  try {
                    await anlegen(name.trim() || aboName(filter, kreis), aboFilter(filter, kreis))
                    setStatus('fertig')
                  } catch (err) {
                    setFehler(err instanceof Error ? err.message : String(err))
                    setStatus('bereit')
                  }
                }}
              >
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium tracking-wide text-[var(--ab-leise)] uppercase">Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    className="rounded-xl border border-[var(--ab-linie)] bg-[var(--ab-aktiv)] px-3 py-2 text-[14px] outline-none focus:border-[var(--ab-leise)]"
                  />
                </label>
                <p className="text-[12px] text-[var(--ab-leise)]">
                  Mit den Filtern, die gerade gesetzt sind{filter.gebiete.length ? ', samt gezeichneten Gebieten' : ''}. Mails an{' '}
                  {k.nutzer.email}.
                </p>
                <button
                  type="submit"
                  disabled={status === 'speichert'}
                  className="mt-1 rounded-full bg-[var(--ab-tinte)] py-2.5 text-[14px] font-medium text-[var(--ab-papier)] disabled:opacity-60"
                >
                  {status === 'speichert' ? 'Speichert …' : 'Suchabo speichern'}
                </button>
                {fehler && <p className="text-[var(--ab-karmin)]">{fehler}</p>}
              </form>
            )}

            {abos.length > 0 && (
              <div className="mt-6">
                <h3 className="text-[12px] font-medium tracking-wide text-[var(--ab-leise)] uppercase">Deine Suchabos</h3>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {abos.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 rounded-xl border border-[var(--ab-linie)] px-3 py-2">
                      <span className={`min-w-0 flex-1 truncate ${a.aktiv ? '' : 'text-[var(--ab-leise)] line-through'}`}>{a.name}</span>
                      <button type="button" onClick={() => umschalten(a.id, !a.aktiv)} className="shrink-0 text-[12px] underline underline-offset-2">
                        {a.aktiv ? 'Pausieren' : 'Fortsetzen'}
                      </button>
                      <button type="button" onClick={() => loeschen(a.id)} aria-label={`${a.name} löschen`} className="shrink-0 px-1 text-[var(--ab-leise)]">
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
