/**
 * Was der Velonavi und sein Kontobereich gemeinsam brauchen: die Farben der
 * Oberfläche, den Zugriff auf den localStorage, zwei Formatierungen und die
 * kleinen Bedienelemente.
 */

/**
 * Die Oberfläche liest ihre Farben als CSS-Variablen (definiert in
 * `globals.css`), nicht als feste Werte. So wechselt das Thema, indem am
 * <html> ein Attribut umgesetzt wird - ohne die Farben durch jede Komponente
 * durchzureichen und ohne dass ein einziges `style` hier davon weiss. Es sind
 * dieselben Variablen wie in der Vergleichskarte.
 *
 * Einen Akzent gibt es nicht mehr: Was man drückt, zieht oder wählt, ist
 * Tinte (`fg`). Karmin bleibt der Marke vorbehalten, das Ziel ist blau.
 */
export const ui = {
  bg: 'var(--ab-papier)',
  fg: 'var(--ab-tinte)',
  panel: 'var(--ab-blatt)',
  border: 'var(--ab-linie)',
  muted: 'var(--ab-leise)',
  weich: 'var(--ab-weich)',
  aktiv: 'var(--ab-aktiv)',
  ring: 'var(--ab-ring)',
  /** Schiene der Schalter. */
  spur: 'var(--ab-spur)',
  /** Die Scheibe des Reglers. */
  knopf: 'var(--ab-knopf)',
  /** Nur für das Ziel. */
  ziel: 'var(--ab-ziel)',
  schatten: 'var(--ab-schatten)',
}

/** Liest einen Wert aus dem localStorage. Ohne Speicher (privates Fenster) gilt die Vorgabe. */
export function lies<T>(schluessel: string, vorgabe: T): T {
  try {
    const roh = window.localStorage.getItem(schluessel)
    return roh ? (JSON.parse(roh) as T) : vorgabe
  } catch {
    return vorgabe
  }
}

/** Schreibt einen Wert in den localStorage, `null` entfernt ihn. */
export function schreib(schluessel: string, wert: unknown) {
  try {
    if (wert === null) window.localStorage.removeItem(schluessel)
    else window.localStorage.setItem(schluessel, JSON.stringify(wert))
  } catch {
    /* privates Fenster oder voller Speicher */
  }
}

export function minuten(s: number) {
  const m = Math.max(1, Math.round(s / 60))
  return m < 60 ? `${m} Min.` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

export function km(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

export function Schalter({ an, setAn, titel, hilfe }: { an: boolean; setAn: (v: boolean) => void; titel: string; hilfe?: string }) {
  return (
    <button onClick={() => setAn(!an)} className="flex items-center justify-between gap-3 text-left text-[12px]" role="switch" aria-checked={an}>
      <span>
        {titel}
        {hilfe && (
          <span className="block text-[11px]" style={{ color: ui.muted }}>
            {hilfe}
          </span>
        )}
      </span>
      <span className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ background: an ? ui.fg : ui.spur }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full shadow transition-all" style={{ left: an ? 18 : 2, background: ui.bg }} />
      </span>
    </button>
  )
}

export function Hinweis({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border px-3 py-2.5 text-[12px]" style={{ background: ui.panel, borderColor: ui.fg, color: ui.fg }}>
      {children}
    </p>
  )
}

export function KleinKnopf({ onClick, titel, children }: { onClick: () => void; titel: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={titel}
      className="rounded-full border px-3 py-1.5 text-[12px] font-medium"
      style={{ borderColor: ui.border, color: ui.fg }}
    >
      {children}
    </button>
  )
}
