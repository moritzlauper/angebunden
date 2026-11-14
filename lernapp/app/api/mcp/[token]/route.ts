import { isValidMcpToken } from '@/lib/auth.ts'
import { mcpMethodNotAllowed, mcpPost, unauthorized } from '@/lib/mcp/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** MCP mit Token im Pfad, so lässt er sich in claude.ai als eigener Connector eintragen. */
export async function POST(req: Request, ctx: RouteContext<'/api/mcp/[token]'>) {
  const { token } = await ctx.params
  if (!isValidMcpToken(token)) return unauthorized()
  return mcpPost(req)
}

export const GET = mcpMethodNotAllowed
export const DELETE = mcpMethodNotAllowed
