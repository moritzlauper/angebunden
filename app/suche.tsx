'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

type Ui = { fg: string; muted: string; panel: string; border: string; weich: string; schatten: string }

/** Ein durchsuchbarer Eintrag: Hausadresse, Kulturort oder Haltestelle. */
export type Eintrag = {
  art: 'adresse' | 'ort' | 'halt'
  titel: string
  unter?: string
  x: number
  y: number
  /** Hausnummer, für die Reihenfolge innerhalb einer Strasse. */
  nr: number
  norm: string
  /** Nur bei Adressen: der Index in der Gebäude-Quelle, zugleich die MapLibre-Feature-Id. */
  haus?: number
}

type Merkmale = Record<string, unknown>
type Punkt = { properties: Merkmale; geometry: { coordinates: number[] } }

/**
 * Kleinschreibung ohne Akzente: damit "zurich" auch "Zürich" findet und
 * "cafe" das "Café". Umlaute werden entkoppelt, nicht ausgeschrieben – wer
 * "muehlegasse" tippt, findet die Mühlegasse also nicht, wer "muhlegasse"
 * tippt hingegen schon.
 */
function normalisiere(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Der Suchindex entsteht aus dem, was ohnehin schon geladen ist – die Karte
 * kennt jedes Haus samt Adresse. Gebaut wird er erst nach dem ersten
 * Kartenaufbau: 47'000 Einträge kosten sonst eine Zehntelsekunde beim Start,
 * für ein Feld, das viele nie anfassen.
 */
export function bauIndex(
  gebaeude: Punkt[],
  kultur: Punkt[],
  halte: Punkt[],
  artenNamen: Record<string, string>,
  stadtName: string
): Eintrag[] {
  // Haltestellennamen tragen die Stadt oft doppelt vorangestellt
  // ("Zürich, Bahnhofplatz/HB", "Basel, Barfüsserplatz") – das schneiden wir weg.
  const stadtPrefix = new RegExp(`^${stadtName}, `)
  const index: Eintrag[] = []

  gebaeude.forEach((p, i) => {
    const adresse = p.properties.s as string | undefined
    const name = p.properties.n as string | undefined
    if (!adresse && !name) return
    const titel = adresse ?? name!
    const unter = adresse && name ? name : undefined
    index.push({
      art: 'adresse',
      titel,
      unter,
      x: p.properties.x as number,
      y: p.properties.y as number,
      nr: hausnummer(adresse),
      norm: normalisiere(unter ? `${titel} ${unter}` : titel),
      haus: i,
    })
  })

  for (const f of kultur) {
    const name = f.properties.name as string | undefined
    if (!name) continue
    const art = f.properties.art as string
    index.push({
      art: 'ort',
      titel: name,
      unter: artenNamen[art] ?? art,
      x: f.geometry.coordinates[0],
      y: f.geometry.coordinates[1],
      nr: 0,
      norm: normalisiere(name),
    })
  }

  for (const f of halte) {
    const name = f.properties.name as string | undefined
    if (!name) continue
    const kurz = name.replace(stadtPrefix, '')
    index.push({
      art: 'halt',
      titel: kurz,
      unter: 'Haltestelle',
      x: f.geometry.coordinates[0],
      y: f.geometry.coordinates[1],
      nr: 0,
      norm: normalisiere(kurz),
    })
  }

  return index
}

const ART_RANG = { adresse: 1, ort: 0, halt: 0 }

/**
 * Gesucht wird als Teilzeichenkette, gewichtet nach der Fundstelle: am Anfang
 * des Namens vor dem Wortanfang vor irgendwo mittendrin. Innerhalb einer
 * Strasse ordnet die Hausnummer, damit nach der 9 die 10 kommt und nicht die 100.
 */
export function suchen(index: Eintrag[], frage: string, max = 7): Eintrag[] {
  const q = normalisiere(frage)
  if (q.length < 2) return []

  const funde: { e: Eintrag; rang: number }[] = []
  for (const e of index) {
    const i = e.norm.indexOf(q)
    if (i < 0) continue
    funde.push({ e, rang: i === 0 ? 0 : e.norm[i - 1] === ' ' ? 1 : 2 })
    // Wer "strasse" tippt, trifft zehntausende Häuser. Für sieben Zeilen
    // reicht ein Ausschnitt – die Reihenfolge darin bleibt dieselbe.
    if (funde.length >= 4000) break
  }

  funde.sort(
    (a, b) =>
      a.rang - b.rang ||
      ART_RANG[a.e.art] - ART_RANG[b.e.art] ||
      a.e.nr - b.e.nr ||
      a.e.titel.length - b.e.titel.length ||
      (a.e.titel < b.e.titel ? -1 : 1)
  )

  const gesehen = new Set<string>()
  const treffer: Eintrag[] = []
  for (const { e } of funde) {
    const schluessel = `${e.art}:${e.titel}`
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    treffer.push(e)
    if (treffer.length >= max) break
  }
  return treffer
}

function hausnummer(adresse?: string) {
  const m = adresse?.match(/(\d+)\s*[a-zA-Z]?$/)
  return m ? Number(m[1]) : 0
}

// ---------------------------------------------------------------- Suchleiste

export function Suchleiste({
  ui, wert, setWert, treffer, offen, setOffen, onWaehlen, rechts,
}: {
  ui: Ui
  wert: string
  setWert: (v: string) => void
  treffer: Eintrag[]
  offen: boolean
  setOffen: (o: boolean) => void
  onWaehlen: (e: Eintrag) => void
  rechts?: ReactNode
}) {
  const feldRef = useRef<HTMLInputElement>(null)
  const [aktiv, setAktiv] = useState(0)

  useEffect(() => setAktiv(0), [wert])

  const waehlen = (e: Eintrag) => {
    setWert(e.titel)
    setOffen(false)
    feldRef.current?.blur()
    onWaehlen(e)
  }

  const taste = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Escape') {
      setOffen(false)
      feldRef.current?.blur()
    } else if (ev.key === 'ArrowDown' && treffer.length) {
      ev.preventDefault()
      setAktiv((a) => (a + 1) % treffer.length)
    } else if (ev.key === 'ArrowUp' && treffer.length) {
      ev.preventDefault()
      setAktiv((a) => (a - 1 + treffer.length) % treffer.length)
    } else if (ev.key === 'Enter' && treffer[aktiv]) {
      ev.preventDefault()
      waehlen(treffer[aktiv])
    }
  }

  const zeigeListe = offen && treffer.length > 0

  return (
    <div className="pointer-events-auto relative z-40">
      <div className="flex items-center gap-2">
        <div
          className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full border pl-4 pr-2 backdrop-blur-md"
          style={{ background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten }}
        >
          <Lupe farbe={ui.muted} />
          <input
            ref={feldRef}
            value={wert}
            onChange={(e) => {
              setWert(e.target.value)
              setOffen(true)
            }}
            onFocus={() => setOffen(true)}
            onKeyDown={taste}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Adresse, Ort oder Haltestelle"
            aria-label="Adresse suchen"
            // 16 px, sonst zoomt iOS beim Antippen in die Seite hinein.
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none [&::-webkit-search-cancel-button]:appearance-none"
            style={{ color: ui.fg }}
          />
          {wert && (
            <button
              onClick={() => {
                setWert('')
                setOffen(false)
                feldRef.current?.focus()
              }}
              aria-label="Suche leeren"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
              style={{ color: ui.muted }}
            >
              <Kreuz />
            </button>
          )}
        </div>
        {rechts}
      </div>

      {zeigeListe && (
        <ul
          // Ohne das nimmt der Klick dem Feld erst den Fokus und die Liste
          // verschwindet, bevor die Auswahl ankommt.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-14 max-h-[58dvh] overflow-y-auto overscroll-contain rounded-2xl border py-1.5 backdrop-blur-md"
          style={{ background: ui.panel, borderColor: ui.border, boxShadow: ui.schatten }}
        >
          {treffer.map((e, i) => (
            <li key={`${e.art}-${e.titel}-${e.x}`}>
              <button
                onClick={() => waehlen(e)}
                onMouseEnter={() => setAktiv(i)}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
                style={{ background: i === aktiv ? ui.weich : undefined }}
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                  style={{ background: ui.weich, color: ui.muted }}
                >
                  {e.art === 'adresse' ? <Haussymbol /> : e.art === 'halt' ? <Haltsymbol /> : <Ortsymbol />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]" style={{ color: ui.fg }}>
                    {e.titel}
                  </span>
                  {e.unter && (
                    <span className="block truncate text-[12px]" style={{ color: ui.muted }}>
                      {e.unter}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Zeichen

function Lupe({ farbe }: { farbe: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={farbe} strokeWidth="2" className="shrink-0">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

function Kreuz() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

function Haussymbol() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10.5 12 4l8 6.5V20H4z" strokeLinejoin="round" />
    </svg>
  )
}

function Ortsymbol() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  )
}

function Haltsymbol() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="6" y="3.5" width="12" height="13" rx="2.5" />
      <path d="M6 11h12M9 20l1.5-3.5M15 20l-1.5-3.5" strokeLinecap="round" />
    </svg>
  )
}
