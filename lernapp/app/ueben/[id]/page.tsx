import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db/index.ts'
import { AppError, getSessionView, sessionSummary, type StatementResult } from '@/lib/service.ts'
import { answer, reportError } from '../../actions.ts'
import { PrimaryShortcut } from '../../shortcut.tsx'

export const dynamic = 'force-dynamic'

export default async function Ueben({ params, searchParams }: PageProps<'/ueben/[id]'>) {
  const { id } = await params
  const sp = await searchParams
  const db = await getDb()
  const view = await getSessionView(db, Number(id)).catch((e) => {
    if (e instanceof AppError) notFound()
    throw e
  })
  const shownId = Number(sp.q)
  const shown = view.questions.find((q) => q.id === shownId && q.answered)
  const next = view.questions.find((q) => !q.answered)
  const back = `/ueben/${id}${shown ? `?q=${shown.id}` : ''}`

  const header = (
    <p className="muted text-sm">
      {view.subject.name} · bis UE {view.session.ueLimit}
      {view.session.examMode ? ' · Prüfungsmodus' : ''} · {view.score.answered} von {view.score.total} beantwortet
    </p>
  )

  // Steht unten rechts fix am Bildschirmrand, damit man nie scrollen muss.
  const nextLink = next ? (
    <Link className="btn" href={`/ueben/${id}`} autoFocus data-shortcut="primary">
      Nächste Frage →
    </Link>
  ) : (
    <Link className="btn" href={`/ueben/${id}?ende=1`} autoFocus data-shortcut="primary">
      Zur Auswertung →
    </Link>
  )

  if (shown) {
    return (
      <div className="space-y-4">
        {header}
        <h1 className="text-lg font-bold">
          Frage {shown.position}
          {shown.unitNumber != null ? ` (UE ${shown.unitNumber}${shown.unitTitle ? `: ${shown.unitTitle}` : ''})` : ''}
        </h1>
        <p className="font-medium">{shown.stem}</p>
        <p className={`font-semibold ${shown.allCorrect ? 'text-ok' : 'text-bad'}`}>
          {shown.allCorrect ? 'Komplett richtig.' : 'Nicht ganz.'} Richtig:{' '}
          {shown.results!.filter((r) => r.truth === 'R').map((r) => r.letter).join(', ') || 'keine'}
          {shown.guessed ? ' · als geraten markiert' : ''}
        </p>
        <ul className="space-y-3">
          {shown.results!.map((r) => (
            <Result key={r.letter} r={r} back={back} />
          ))}
        </ul>
        <ActionBar align="end">{nextLink}</ActionBar>
        <PrimaryShortcut />
      </div>
    )
  }

  if (next) {
    return (
      <form action={answer} className="space-y-4">
        {header}
        <h1 className="text-lg font-bold">
          Frage {next.position}
          {next.unitNumber != null ? ` (UE ${next.unitNumber}${next.unitTitle ? `: ${next.unitTitle}` : ''})` : ''}
        </h1>
        <p className="font-medium">{next.stem}</p>
        <input type="hidden" name="questionId" value={next.id} />
        <ul className="space-y-2">
          {next.options.map((o) => (
            <li key={o.letter}>
              <label className="card flex cursor-pointer gap-3 p-3 has-[:checked]:border-[var(--accent)]">
                <input type="checkbox" name="marked" value={o.letter} className="mt-1 size-4 shrink-0" />
                <span>
                  <b>{o.letter})</b> {o.text}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <ActionBar align="start">
          <button className="btn" data-shortcut="primary" title="Cmd+Enter">
            Abgeben
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="guessed" value="1" /> war geraten
          </label>
        </ActionBar>
        <PrimaryShortcut />
      </form>
    )
  }

  const summary = await sessionSummary(db, Number(id))
  return (
    <div className="space-y-5">
      {header}
      <h1 className="text-2xl font-bold">
        {summary.score.fullyCorrect} von {summary.score.total} komplett richtig
      </h1>
      {summary.repeat.length ? (
        <section className="space-y-2">
          <h2 className="font-semibold">Zum Wiederholen</h2>
          <ul className="space-y-3">
            {summary.repeat.map((r) => (
              <Result key={r.statementId} r={r} back={`/ueben/${id}?ende=1`} />
            ))}
          </ul>
        </section>
      ) : (
        <p>Nichts falsch, nichts zu wiederholen.</p>
      )}
      <div className="flex flex-wrap gap-3">
        <Link className="btn" href="/">
          Fertig
        </Link>
        <a className="btn-quiet" href={`/api/export?subject=${view.subject.id}&session=${id}`} target="_blank">
          Als Markdown für Exercises
        </a>
      </div>
    </div>
  )
}

/** Knopfleiste, die beim Scrollen am unteren Bildschirmrand kleben bleibt. */
function ActionBar({ children, align }: { children: React.ReactNode; align: 'start' | 'end' }) {
  return (
    <div
      className={`sticky bottom-0 -mx-4 flex items-center gap-4 border-t px-4 py-3 ${align === 'end' ? 'justify-end' : ''}`}
      style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}
    >
      {children}
    </div>
  )
}

function Result({ r, back }: { r: StatementResult; back: string }) {
  return (
    <li className="card space-y-1 p-3" style={{ borderColor: r.correct ? 'var(--color-ok)' : 'var(--color-bad)' }}>
      <p>
        <b>{r.letter})</b> {r.text}
      </p>
      <p className={`text-sm font-semibold ${r.correct ? 'text-ok' : 'text-bad'}`}>
        {r.truth === 'R' ? 'richtig' : 'falsch'} · {r.marked ? 'angekreuzt' : 'nicht angekreuzt'} · {r.correct ? '✓' : '✗'}
      </p>
      {r.reason ? <p className="text-sm">{r.reason}</p> : null}
      {r.quote ? (
        <blockquote className="muted border-l-2 pl-3 text-sm" style={{ borderColor: 'var(--line)' }}>
          «{r.quote.replace(/\*\*|<\/?u>/g, '')}»
        </blockquote>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {r.links.map((l) =>
          l.url ? (
            <a key={l.label} className="link" href={l.url}>
              {l.label}
            </a>
          ) : (
            <span key={l.label} className="muted">
              {l.label}
            </span>
          ),
        )}
        <details className="ml-auto">
          <summary className="muted cursor-pointer">Fehler melden</summary>
          <form action={reportError} className="mt-2 flex gap-2">
            <input type="hidden" name="statementId" value={r.statementId} />
            <input type="hidden" name="back" value={back} />
            <input type="text" name="comment" placeholder="Was stimmt nicht?" />
            <button className="btn-quiet">Melden</button>
          </form>
        </details>
      </div>
    </li>
  )
}
