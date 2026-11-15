import { headers } from 'next/headers'
import { getDb } from '@/lib/db/index.ts'
import { chunkCounts } from '@/lib/generate.ts'
import { listSubjects, subjectOverview } from '@/lib/service.ts'
import { createSubject, generate, importBank, uploadNotes } from '../actions.ts'
import { SubmitButton } from '../submit-button.tsx'

export const dynamic = 'force-dynamic'
// Erzeugen ruft Claude auf und kann ein, zwei Minuten dauern.
export const maxDuration = 300

export default async function Verbinden({ searchParams }: PageProps<'/verbinden'>) {
  const sp = await searchParams
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const tokenSet = !!process.env.MCP_TOKEN
  const url = `${proto}://${host}/api/mcp/${tokenSet ? '<MCP_TOKEN>' : 'dev'}`
  const db = await getDb()
  const subjects = await listSubjects(db)
  const first = subjects[0]
  const units = first ? (await subjectOverview(db, first.id)).units : []
  const chunks = first ? await chunkCounts(db, first.id) : new Map<number, number>()
  const hasKey = !!process.env.ANTHROPIC_API_KEY

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Claude &amp; Import</h1>
      {typeof sp.ok === 'string' ? <p className="card p-3 text-sm text-ok">{sp.ok}</p> : null}
      {typeof sp.fehler === 'string' ? <p className="card p-3 text-sm text-bad">{sp.fehler}</p> : null}

      <section id="erzeugen" className="space-y-3">
        <h2 className="text-lg font-semibold">Neue Aussagen erzeugen</h2>
        <p className="text-sm">
          Claude schreibt Aussagen aus den hochgeladenen Notes, jede mit wörtlichem Zitat, und prüft sie danach blind gegen. Sie landen in der{' '}
          <a className="link" href="/inbox">Inbox</a>, du gibst sie frei.
        </p>
        {!hasKey ? (
          <p className="text-sm text-bad">
            Dafür braucht die App einen Anthropic-API-Key (ANTHROPIC_API_KEY in Vercel). Ohne Key geht dasselbe über den Claude-Connector unten.
          </p>
        ) : null}
        <form action={generate} className="card grid gap-3 p-4 text-sm sm:grid-cols-4">
          <label className="space-y-1 sm:col-span-4">
            <span>Fach</span>
            <select name="subjectId" defaultValue={first?.id}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span>Anzahl</span>
            <input type="number" name="count" min={1} max={40} defaultValue={15} />
          </label>
          <label className="space-y-1">
            <span>&nbsp;</span>
            <select name="mode" defaultValue="perUnit">
              <option value="perUnit">pro UE</option>
              <option value="total">insgesamt</option>
            </select>
          </label>
          <label className="space-y-1">
            <span>von UE</span>
            <input type="number" name="fromUnit" min={0} defaultValue={units[0]?.number ?? 1} />
          </label>
          <label className="space-y-1">
            <span>bis UE</span>
            <input type="number" name="toUnit" min={0} defaultValue={first?.ueLimit ?? 1} />
          </label>
          <label className="space-y-1 sm:col-span-4">
            <span>Hinweis an Claude (optional)</span>
            <input type="text" name="hint" placeholder="z. B. mehr zu Hormonen, mehr Zahlen und ICD-Codes, eher schwer" />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
            <SubmitButton pending="Claude schreibt … (1–2 Minuten)">Erzeugen</SubmitButton>
            {units.length ? (
              <span className="muted">
                Notes vorhanden für:{' '}
                {units
                  .filter((u) => (chunks.get(u.number) ?? 0) > 0)
                  .map((u) => `UE ${u.number}`)
                  .join(', ') || 'noch keine UE'}
              </span>
            ) : null}
          </div>
        </form>
      </section>

      <section id="notes" className="space-y-3">
        <h2 className="text-lg font-semibold">Notes hochladen</h2>
        <p className="text-sm">
          Notes.md aus dem Vault hochladen. Die App zerlegt sie nach <code># UE n</code>, merkt sich, welche Folien-PDF zu welcher Vorlesung gehört,
          und verarbeitet beim nächsten Hochladen nur geänderte UEs. Aussagen, deren Zitat danach nicht mehr vorkommt, kommen auf «neu prüfen».
        </p>
        <form action={uploadNotes} className="card space-y-3 p-4 text-sm">
          <select name="subjectId" defaultValue={first?.id}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input type="file" name="file" accept=".md,.txt,text/markdown,text/plain" />
          <details>
            <summary className="muted cursor-pointer">oder Text einfügen</summary>
            <textarea name="content" rows={6} className="mt-2" />
          </details>
          <SubmitButton pending="Wird eingespielt …">Hochladen</SubmitButton>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Claude verbinden</h2>
        <p className="text-sm">
          Die App ist ein MCP-Server. In claude.ai unter <b>Einstellungen → Connectors → Eigenen Connector hinzufügen</b> diese URL eintragen,
          dann kann Claude Fragen stellen, Antworten auswerten, Notes einspielen, neue Aussagen vorschlagen und die UE-Grenze setzen:
        </p>
        <pre className="card overflow-x-auto p-3 text-sm">{url}</pre>
        {!tokenSet ? (
          <p className="text-sm text-bad">
            MCP_TOKEN ist nicht gesetzt. Lokal gilt «dev», in Produktion ist der Endpunkt ohne Token abgeschaltet.
          </p>
        ) : (
          <p className="muted text-sm">&lt;MCP_TOKEN&gt; durch den Wert der Umgebungsvariable ersetzen. Wer die URL kennt, hat Zugriff.</p>
        )}
        <p className="text-sm">Für Claude Code:</p>
        <pre className="card overflow-x-auto p-3 text-sm">{`claude mcp add --transport http klicker ${proto}://${host}/api/mcp --header "Authorization: Bearer <MCP_TOKEN>"`}</pre>
        <p className="text-sm">Dann zum Beispiel:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>«Heute 5 Fragen KliBio»</li>
          <li>«Lies Notes.md von Klinische Biopsychologie aus dem Drive, spiel sie ein und schlag Aussagen für die geänderten UEs vor»</li>
          <li>«Mach die blinde Gegenprüfung für die Inbox»</li>
          <li>«Stell KliBio auf bis UE 5, Prüfung am 2027-01-20»</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Aussagenbank importieren</h2>
        {sp.importiert ? (
          <p className="text-sm text-ok">
            {sp.importiert} Aussagen übernommen, {sp.uebersprungen} Doppelte übersprungen.
          </p>
        ) : null}
        <form action={importBank} className="card space-y-3 p-4 text-sm">
          <p className="muted">
            Eine Exercises-Datei (<code>## Frage n (UE x: …)</code> mit Lösungsblock) oder Zeilen <code>[R]/[F] Text — Begründung (VLx p.y)</code> unter{' '}
            <code># UE n Titel</code>.
          </p>
          <select name="subjectId">
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <textarea name="markdown" rows={10} required />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="status" value="inbox" /> zuerst in die Inbox statt direkt in die Übungen
          </label>
          <button className="btn">Importieren</button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Fach anlegen</h2>
        <form action={createSubject} className="card grid gap-3 p-4 text-sm sm:grid-cols-2">
          <input type="text" name="name" placeholder="Name, z. B. Psychopathologie" required />
          <input type="text" name="shortName" placeholder="Kürzel" />
          <input type="text" name="dozent" placeholder="Dozent" />
          <input type="text" name="vaultPath" placeholder="Ordner im Vault" />
          <input type="number" name="ueLimit" min={0} defaultValue={1} />
          <button className="btn">Anlegen</button>
        </form>
      </section>
    </div>
  )
}
