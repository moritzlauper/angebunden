import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE, isValidSession } from './lib/auth.ts'

/** Schützt die Oberfläche. Der MCP-Endpunkt prüft sein eigenes Token. */
export async function proxy(req: NextRequest) {
  if (await isValidSession(req.cookies.get(COOKIE)?.value)) return NextResponse.next()
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', req.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!login|api/mcp|_next/|favicon|icon|.*\\..*).*)'],
}
