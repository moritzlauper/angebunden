import { handleJsonRpc } from './server.ts'

export async function mcpPost(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }
  const res = await handleJsonRpc(body)
  if (res === null) return new Response(null, { status: 202 })
  return Response.json(res, { headers: { 'Cache-Control': 'no-store' } })
}

export function mcpMethodNotAllowed(): Response {
  // Zustandslos: kein SSE-Stream über GET, keine Sessions zum Löschen.
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}

export function unauthorized(): Response {
  return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, { status: 401 })
}
