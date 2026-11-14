/** Kleine Bausteine, die Startseite und Fachseite teilen. */

/** Ein Semester hat selten mehr als 14 UEs. Noch nicht angelegte UEs lassen sich trotzdem als Grenze wählen. */
const MIN_UE_CHOICES = 14

export function UeOptions({ units, ueLimit }: { units: { number: number; title: string; total: number }[]; ueLimit: number }) {
  const max = Math.max(MIN_UE_CHOICES, ueLimit, ...units.map((u) => u.number))
  const byNumber = new Map(units.map((u) => [u.number, u]))
  return Array.from({ length: max }, (_, i) => i + 1).map((n) => {
    const u = byNumber.get(n)
    const title = u && u.title !== `UE ${n}` ? ` ${u.title}` : ''
    const empty = !u || u.total === 0 ? ' (noch keine Aussagen)' : ''
    return (
      <option key={n} value={n}>
        UE {n}
        {title}
        {empty}
      </option>
    )
  })
}

/**
 * Stand als Balken: dunkel = sicher (hält über drei Wochen), hell = schon gesehen, Rest = neu.
 */
export function Progress({ safe, seen, total, label }: { safe: number; seen: number; total: number; label?: string }) {
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  const safePct = pct(safe)
  const seenPct = Math.max(0, pct(seen) - safePct)
  return (
    <div className="space-y-1">
      <div
        className="bar"
        role="img"
        aria-label={`${safe} von ${total} sicher, ${seen} gesehen`}
        title={`${safe} von ${total} sicher · ${seen} von ${total} schon gesehen`}
      >
        <span style={{ width: `${safePct}%` }} />
        <span className="seen" style={{ width: `${seenPct}%` }} />
      </div>
      <p className="muted flex justify-between text-xs">
        <span>{label}</span>
        <span>
          <b style={{ color: 'var(--fg)' }}>{safePct}% sicher</b> · {pct(seen)}% gesehen
        </span>
      </p>
    </div>
  )
}
