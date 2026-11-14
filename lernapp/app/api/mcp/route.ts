import { isValidMcpToken } from '@/lib/auth.ts'
import { mcpMethodNotAllowed, mcpPost, unauthorized } from '@/lib/mcp/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** MCP mit «Authorization: Bearer <MCP_TOKEN>» (Claude Code, Agent SDK). */
export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!isValidMcpToken(token)) return unauthorized()
  return mcpPost(req)
}

export const GET = mcpMethodNotAllowed
export const DELETE = mcpMethodNotAllowed
