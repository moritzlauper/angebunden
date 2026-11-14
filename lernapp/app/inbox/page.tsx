import { getDb } from '@/lib/db/index.ts'
import { listInbox } from '@/lib/service.ts'
import { review } from '../actions.ts'

export const dynamic = 'force-dynamic'

const FLAG_TEXT: Record<string, string> = {
  pruefer_widerspricht: 'Prüfer kommt zu einem anderen Urteil',
  zitat_nicht_in_quelle: 'Zitat steht nicht im Textstück',
  quelle_geaendert: 'Quelle geändert, Zitat nicht mehr gefunden',
  gemeldet: 'als Fehler gemeldet',
  f_ohne_verfaelschungstyp: 'F-Aussage ohne Verfälschungstyp',
  import_ohne_zitat: 'Import ohne Zitat',
  variante_weicht_ab: 'Variante wird deutlich anders beantwortet als das Original',
}

function flagLabel(f: string) {
  const [k, v] = f.split(':')
  if (FLAG_TEXT[k]) return FLAG_TEXT[k]
  if (k === 'absolutwort') return `Absolutwort «${v}» nicht im Zitat`
  if (k === 'zahl_fehlt_im_zitat') return `Zahl ${v} nicht im Zitat`
  if (k === 'begriffe_nicht_in_quelle') return `Begriffe nicht in der Quelle: ${v}`
  return f
}

export default async function Inbox() {
  const items = await listInbox(await getDb(), null)
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Inbox</h1>
      <p className="muted text-sm">
        Neue Aussagen von Claude und geflaggte Aussagen. Erst nach deinem OK kommen sie in die Übungen. «bereit» heisst: die blinde Gegenprüfung
        stimmt zu und es gibt keine Hinweise.
      </p>
      {items.length === 0 ? <p>Leer.</p> : null}
      <ul className="space-y-4">
        {items.map((x) => (
          <li key={x.id} className="card space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded px-2 py-0.5 font-bold" style={{ background: 'var(--bg)' }}>
                UE {x.unitNumber}
              </span>
              <span className={`rounded px-2 py-0.5 font-bold ${x.truth === 'R' ? 'text-ok' : 'text-bad'}`} style={{ background: 'var(--bg)' }}>
                {x.truth === 'R' ? 'richtig' : 'falsch'}
                {x.manipulationType ? ` · ${x.manipulationType}` : ''}
              </span>
              <span className="muted">{x.status === 'flagged' ? 'zu prüfen' : x.ready ? 'bereit' : x.check ? 'zu prüfen' : 'Gegenprüfung offen'}</span>
            </div>
            <p className="font-medium">{x.text}</p>
            {x.reason ? <p className="text-sm">{x.reason}</p> : null}
            {x.quote ? (
              <blockquote className="border-l-2 pl-3 text-sm italic" style={{ borderColor: 'var(--line)' }}>
                «{x.quote}» {x.sourceRef ? <span className="muted not-italic">({x.sourceRef})</span> : null}
              </blockquote>
            ) : x.sourceRef ? (
              <p className="muted text-sm">{x.sourceRef}</p>
            ) : null}
            {x.check ? (
              <p className="text-sm">
                Prüfer: {x.check.truth === 'R' ? 'richtig' : 'falsch'} {x.check.agrees ? '✓ stimmt überein' : '✗ weicht ab'}
                {x.check.comment ? ` · ${x.check.comment}` : ''}
              </p>
            ) : null}
            {[...x.flags, ...(x.check?.flags ?? [])].length ? (
              <ul className="flex flex-wrap gap-2 text-xs">
                {[...new Set([...x.flags, ...(x.check?.flags ?? [])])].map((f) => (
                  <li key={f} className="rounded border px-2 py-0.5" style={{ borderColor: 'var(--color-bad)' }}>
                    {flagLabel(f)}
                  </li>
                ))}
              </ul>
            ) : null}
            {x.reports.length ? <p className="text-sm text-bad">Gemeldet: {x.reports.filter(Boolean).join(' · ') || 'ohne Kommentar'}</p> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <form action={review}>
                <input type="hidden" name="statementId" value={x.id} />
                <input type="hidden" name="action" value="approve" />
                <button className="btn">Freigeben</button>
              </form>
              <form action={review}>
                <input type="hidden" name="statementId" value={x.id} />
                <input type="hidden" name="action" value="reject" />
                <button className="btn-quiet">Verwerfen</button>
              </form>
              <details className="w-full">
                <summary className="muted cursor-pointer text-sm">Bearbeiten</summary>
                <form action={review} className="mt-2 space-y-2 text-sm">
                  <input type="hidden" name="statementId" value={x.id} />
                  <textarea name="text" defaultValue={x.text} rows={3} />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <select name="truth" defaultValue={x.truth}>
                      <option value="R">richtig</option>
                      <option value="F">falsch</option>
                    </select>
                    <input type="text" name="reason" defaultValue={x.reason ?? ''} placeholder="Begründung" />
                    <input type="text" name="sourceRef" defaultValue={x.sourceRef ?? ''} placeholder="Fundstelle" />
                  </div>
                  <div className="flex gap-2">
                    <button className="btn" name="action" value="approve">
                      Speichern und freigeben
                    </button>
                    <button className="btn-quiet" name="action" value="edit">
                      Nur speichern
                    </button>
                  </div>
                </form>
              </details>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
