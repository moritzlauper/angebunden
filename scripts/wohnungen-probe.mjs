// Vorübergehend: ruft die Quellen der Wohnungssuche ab und legt die Antworten unter probe/ ab,
// damit sich die Sammler gegen echte Antworten schreiben lassen.
import { mkdirSync, writeFileSync } from 'node:fs'
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Accept-Language': 'de-CH,de;q=0.9,en;q=0.6',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
}
const ZIELE = {
  'woko-frei': 'https://www.woko.ch/unser-angebot/freie-objekte',
  'abz-mieten': 'https://www.abz.ch/wohnen/mieten/',
  'pwg-frei': 'https://www.pwg.ch/liegenschaften/zu-vermieten',
  'wbg-plattform': 'https://www.wbg-zh.ch/plattform-wohnungssuche',
  'ronorp-housing': 'https://ronorp.net/zurich/market/housing',
  'stadt-home': 'https://www.stadt-zuerich.ch/de.html',
  'stadt-suche': 'https://www.stadt-zuerich.ch/de/suche.html?q=freie%20wohnungen',
  'stadt-lsz2': 'https://www.stadt-zuerich.ch/de/planen-und-bauen/liegenschaften.html',
}
mkdirSync('probe', { recursive: true })
const zeilen = []
for (const [name, url] of Object.entries(ZIELE)) {
  try {
    const res = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    writeFileSync(`probe/${name}.txt`, `${res.status} ${res.url}\n${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${text}`)
    // Links, die nach Wohnungen aussehen
    const links = [...new Set([...text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /wohn|vermiet|zimmer|frei|miet|room|housing|immobil|marktplatz|liegensch|objekt|inserat|listing|api/i.test(h)))].slice(0, 120)
    writeFileSync(`probe/${name}.links`, links.join('\n'))
    zeilen.push(`${name}\t${res.status}\t${text.length}\t${res.url}`)
  } catch (e) {
    zeilen.push(`${name}\tFEHLER\t${e}`)
  }
}

writeFileSync('probe/uebersicht.tsv', zeilen.join('\n') + '\n')
console.log(zeilen.join('\n'))
