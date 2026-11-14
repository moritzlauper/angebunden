import { callTool, toolList } from './tools.ts'

/**
 * Schlanker MCP-Server (Streamable HTTP, zustandslos): jede Anfrage ist ein
 * JSON-RPC-POST, die Antwort kommt als application/json zurück. Das genügt für
 * Werkzeuge; Streams, Ressourcen und Prompts braucht die App nicht.
 */

export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'lernapp', title: 'Lern-Webapp (Klickerfragen)', version: '0.1.0' }

export const INSTRUCTIONS = `Diese App fragt Klickerfragen im OLAT-Format ab (je 5 Aussagen A–E, 0–5 richtig) und plant Wiederholungen pro Aussage mit FSRS. Du steuerst sie.

Grundsatz: Erfinde nichts. Jede neue Aussage braucht ein wörtliches Zitat aus den eingespielten Quellen.

Üben («Heute 5 Fragen», Morgen-Routine):
1. get_due(subject) startet eine Session. Stelle die Fragen einzeln: Stamm, dann A) bis E). Keine Lösung verraten.
2. Nach jeder Antwort report_answer(question_id, marked, guessed). Zeige pro Aussage richtig/falsch mit Begründung und Fundstelle.
3. Am Ende get_session_summary: x von n komplett richtig und die zwei Aussagen zum Wiederholen. Auf Wunsch export_markdown und an die Exercises-Datei anhängen.
Meldet die Person einen Fehler in einer Aussage: report_error.

Neue Notes oder Folien (Bank wachsen lassen):
1. Notes.md bzw. Folientexte aus dem Vault lesen (z. B. Google Drive) und mit sync_source einspielen. Die Antwort sagt, welche UEs sich geändert haben.
2. Für jede geänderte UE get_unit_material lesen und Aussagen nur aus diesen Chunks schreiben:
   – Stil wie die Stilvorlagen (Länge, Fachbegriffe, typische Fallen), deutsch, Schweizer Schreibweise (ss statt ß).
   – Jede Aussage eindeutig richtig oder falsch; keine Absolutwörter («immer», «nie», «ausschliesslich»), wenn die Quelle sie nicht selbst so sagt.
   – F-Aussagen: genau eine Verfälschung, Typ angeben (vertauschung, negation, zahl, zuordnung). «doppelt» nur bewusst.
   – Verfälschungstypen abwechseln (manipulationCounts beachten), etwa gleich viele R und F, keine Doppelten zu bestehenden Aussagen.
   – quote wörtlich aus dem Chunk, chunk_id und source_ref (z. B. «VL4 p.5») angeben, topic mit Präposition («zu Hunger- und Sättigungssignalen»).
3. add_statements speichert sie in der Inbox.
4. Blinde Gegenprüfung: get_check_queue liefert nur Aussage und Zitat. Urteile R/F allein aus dem Zitat, ohne auf deine Generierung zurückzugreifen (am besten in einem Subagenten), und melde mit submit_checks.
5. Die Person gibt in der Inbox frei. review_statement(approve) nur auf ihren ausdrücklichen Wunsch.

UE-Grenze («bis UE n»), Prüfungsdatum und Prüfungsmodus stellst du mit update_subject ein.`

type JsonRpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }
type JsonRpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } }

async function handleOne(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const isNotification = msg.id === undefined
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: msg.id ?? null, result })
  const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } })

  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid Request')

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '')
      return reply({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: toolList() })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      return reply(await callTool(name, msg.params?.arguments ?? {}))
    }
    case 'resources/list':
      return reply({ resources: [] })
    case 'prompts/list':
      return reply({ prompts: [] })
    default:
      if (isNotification || msg.method.startsWith('notifications/')) return null
      return fail(-32601, `Method not found: ${msg.method}`)
  }
}

/** Verarbeitet eine einzelne Nachricht oder einen Batch. null = nur Benachrichtigungen (HTTP 202). */
export async function handleJsonRpc(body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(m as JsonRpcRequest)))).filter((r): r is JsonRpcResponse => r !== null)
    return out.length ? out : null
  }
  const msg = body as JsonRpcRequest
  const res = await handleOne(msg)
  if (msg && msg.id === undefined) return null
  return res
}
