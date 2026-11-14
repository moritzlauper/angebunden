/**
 * Fundstellen: «VL3 p.15» → Folie 15 der dritten Vorlesung, «ZM S.69» → Seite 69
 * der Zusammenfassung. Mit Vault-Namen wird daraus ein obsidian://-Link, der mit
 * PDF++ direkt auf der Seite öffnet.
 */

export type ParsedRef =
  | { kind: 'slides'; lecture: number; page: number | null; label: string }
  | { kind: 'zm'; page: number | null; label: string }
  | { kind: 'other'; label: string }

export function parseSourceRefs(ref: string | null | undefined): ParsedRef[] {
  if (!ref) return []
  return ref
    .split(/\s*[;]\s*|\s*,\s*(?=VL|ZM)/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((label): ParsedRef => {
      const vl = label.match(/VL\s*(\d+)(?:\s*(?:p\.|S\.|Folie)\s*(\d+))?/i)
      if (vl) return { kind: 'slides', lecture: Number(vl[1]), page: vl[2] ? Number(vl[2]) : null, label }
      const zm = label.match(/ZM(?:\s*(?:S\.|p\.)\s*(\d+))?/i)
      if (zm) return { kind: 'zm', page: zm[1] ? Number(zm[1]) : null, label }
      return { kind: 'other', label }
    })
}

export type LinkConfig = {
  vaultName?: string | null
  vaultPath?: string | null
  slidesPattern?: string | null
  zmPath?: string | null
}

function joinPath(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

export function refToUrl(ref: ParsedRef, cfg: LinkConfig): string | null {
  if (!cfg.vaultName) return null
  let file: string | null = null
  let page: number | null = null
  if (ref.kind === 'slides' && cfg.slidesPattern) {
    file = joinPath(cfg.vaultPath, cfg.slidesPattern.replace('{n}', String(ref.lecture)))
    page = ref.page
  } else if (ref.kind === 'zm' && cfg.zmPath) {
    file = joinPath(cfg.vaultPath, cfg.zmPath)
    page = ref.page
  }
  if (!file) return null
  const target = page ? `${file}#page=${page}` : file
  return `obsidian://open?vault=${encodeURIComponent(cfg.vaultName)}&file=${encodeURIComponent(target)}`
}

export function sourceLinks(ref: string | null | undefined, cfg: LinkConfig): { label: string; url: string | null }[] {
  return parseSourceRefs(ref).map((r) => ({ label: r.label, url: refToUrl(r, cfg) }))
}
