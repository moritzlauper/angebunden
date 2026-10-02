// Vorübergehend: ruft die Quellen der Wohnungssuche ab und legt die Antworten unter probe/ ab,
// damit sich die Sammler gegen echte Antworten schreiben lassen.
import { mkdirSync, writeFileSync } from 'node:fs'
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Accept-Language': 'de-CH,de;q=0.9,en;q=0.6',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
}
mkdirSync('probe', { recursive: true })
const zeilen = []
// Weiterleitungen von Hand folgen und Cookies mitnehmen.
async function mitKeksen(url, keks = new Map(), tiefe = 0) {
  const res = await fetch(url, {
    headers: { ...H, Cookie: [...keks].map(([k, v]) => `${k}=${v}`).join('; ') },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(';'); const i = kv.indexOf('=')
    keks.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim())
  }
  const ziel = res.headers.get('location')
  zeilen.push(`  ${res.status} ${url} -> ${ziel ?? ''} [${[...keks.keys()].join(',')}]`)
  if (ziel && tiefe < 8) return mitKeksen(new URL(ziel, url).href, keks, tiefe + 1)
  return { res, text: await res.text(), url }
}
for (const [name, url] of Object.entries({
  'stadt-portal': 'https://vermietungen.stadt-zuerich.ch/publication/apartment/',
})) {
  try {
    const { res, text, url: end } = await mitKeksen(url)
    writeFileSync(`probe/${name}.txt`, `${res.status} ${end}\n\n${text}`)
    zeilen.push(`${name}\t${res.status}\t${text.length}\t${end}`)
  } catch (e) {
    zeilen.push(`${name}\tFEHLER\t${e} ${e?.cause ?? ''}`)
  }
}
writeFileSync('probe/uebersicht.tsv', zeilen.join('\n') + '\n')
console.log(zeilen.join('\n'))
