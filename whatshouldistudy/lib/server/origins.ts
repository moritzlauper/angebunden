import 'server-only'
import { SITE_URL } from '../site.ts'
import { LOCAL_SITES, SITES } from '../site/config.ts'

export const originOf = (u: string) => {
  try {
    return u ? new URL(u).origin : ''
  } catch {
    return ''
  }
}

/** Our own addresses: this deployment, the main site, the country domains and any extra ones. */
export function ownOrigins(req: Request): Set<string> {
  const allowed = new Set([
    new URL(req.url).origin,
    originOf(SITE_URL),
    ...LOCAL_SITES.map((s) => originOf(SITES[s].domainUrl)),
    ...(process.env.WSIS_ALLOWED_ORIGINS ?? '').split(',').map((o) => originOf(o.trim())),
  ])
  allowed.delete('')
  return allowed
}
