import { headers } from 'next/headers'
import { getDb } from '@/lib/db/index.ts'
import { listSubjects } from '@/lib/service.ts'
import { createSubject, importBank } from '../actions.ts'

export const dynamic = 'force-dynamic'

export default async function Verbinden({ searchParams }: PageProps<'/verbinden'>) {
  const sp = await searchParams
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const tokenSet = !!process.env.MCP_TOKEN
  const url = `${proto}://${host}/api/mcp/${tokenSet ? '<MCP_TOKEN>' : 'dev'}`
  const subjects = await listSubjects(await getDb())

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Claude &amp; Import</h1>

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
