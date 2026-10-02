// Vorübergehend: ruft die Quellen der Wohnungssuche ab und legt die Antworten unter probe/ ab,
// damit sich die Sammler gegen echte Antworten schreiben lassen.
import { mkdirSync, writeFileSync } from 'node:fs'
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Accept-Language': 'de-CH,de;q=0.9,en;q=0.6',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
}
const ZIELE = {
  'stadt-portal': 'https://www.vermietungen.stadt-zuerich.ch/publication/apartment/',
  'stadt-portal-ohne': 'https://vermietungen.stadt-zuerich.ch/publication/apartment/',
  'stadt-portal-http': 'http://www.vermietungen.stadt-zuerich.ch/publication/apartment/',
  'abz-wohnung-alle': 'https://www.abz.ch/wp-json/wp/v2/wohnung?per_page=50&status=publish&_fields=id,link,title',
}
mkdirSync('probe', { recursive: true })
const zeilen = []
for (const [name, url] of Object.entries(ZIELE)) {
  try {
    const res = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    writeFileSync(`probe/${name}.txt`, `${res.status} ${res.url}\n${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${text}`)
    // Links, die nach Wohnungen aussehen
    const links = [...new Set([...text.matchAll(/(?:href="|<loc>|Sitemap: )([^"<\s]+)/g)].map((m) => m[1]).filter((h) => /wohn|vermiet|liegensch|objekt|inserat|flatfox|homegate|melon|api|iframe/i.test(h)))].slice(0, 300)
    writeFileSync(`probe/${name}.links`, links.join('\n'))
    zeilen.push(`${name}\t${res.status}\t${text.length}\t${res.url}`)
  } catch (e) {
    zeilen.push(`${name}\tFEHLER\t${e} ${e?.cause ?? ''} ${e?.cause?.code ?? ''}`)
  }
}

writeFileSync('probe/uebersicht.tsv', zeilen.join('\n') + '\n')
console.log(zeilen.join('\n'))
