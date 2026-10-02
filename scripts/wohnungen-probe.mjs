// Vorübergehend: ruft die Quellen der Wohnungssuche ab und legt die Antworten unter probe/ ab,
// damit sich die Sammler gegen echte Antworten schreiben lassen.
import { mkdirSync, writeFileSync } from 'node:fs'
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Accept-Language': 'de-CH,de;q=0.9,en;q=0.6',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
}
const ZIELE = {
  'flatfox-pin': 'https://flatfox.ch/api/v1/pin/?east=8.63&west=8.44&north=47.44&south=47.32&max_count=400',
  'flatfox-pin-ohne': 'https://flatfox.ch/api/v1/pin/?east=8.63&west=8.44&north=47.44&south=47.32',
  'flatfox-listing': 'https://flatfox.ch/api/v1/public-listing/?limit=3',
  'flatfox-listing-ort': 'https://flatfox.ch/api/v1/public-listing/?limit=3&offer_type=RENT&city=Z%C3%BCrich',
  'flatfox-suche': 'https://flatfox.ch/de/search/?east=8.63&west=8.44&north=47.44&south=47.32',
  'homegate': 'https://www.homegate.ch/mieten/immobilien/ort-zuerich/trefferliste',
  'homegate-api': 'https://api.homegate.ch/search/listings',
  'immoscout': 'https://www.immoscout24.ch/de/immobilien/mieten/ort-zuerich',
  'immoscout-rest': 'https://rest-api.immoscout24.ch/v4/de/properties?l=3000&s=1&t=1&pn=1',
  'newhome': 'https://www.newhome.ch/de/mieten/suchen/wohnung/ort-zuerich/liste',
  'comparis': 'https://www.comparis.ch/immobilien/marktplatz/zuerich/mieten',
  'tutti': 'https://www.tutti.ch/de/li/zuerich/immobilien',
  'anibis': 'https://www.anibis.ch/de/c/immobilien',
  'ronorp': 'https://www.ronorp.net/zuerich/marktplatz/wohnen',
  'wgzimmer': 'https://www.wgzimmer.ch/wgzimmer/search/mate.html',
  'wgzimmer-zh': 'https://www.wgzimmer.ch/de/wgzimmer/search/mate/ch/zurich-stadt.html',
  'woko': 'https://www.woko.ch/de/zimmer-in-zuerich',
  'students': 'https://www.students.ch/wohnen',
  'marktplatz-uzh': 'https://marktplatz.uzh.ch/de/wohnen',
  'stadt': 'https://www.stadt-zuerich.ch/de/stadtleben/wohnen/wohnungssuche.html',
  'stadt-alt': 'https://www.stadt-zuerich.ch/fd/de/index/liegenschaften/wohnungen.html',
  'wbg': 'https://www.wbg-zh.ch/wohnungssuche/',
  'abz': 'https://www.abz.ch/wohnen/freie-wohnungen/',
  'pwg': 'https://www.pwg.ch/vermietung/',
}
mkdirSync('probe', { recursive: true })
const zeilen = []
for (const [name, url] of Object.entries(ZIELE)) {
  try {
    const res = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    writeFileSync(`probe/${name}.txt`, `${res.status} ${res.url}\n${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${text}`)
    const merk = ['__NEXT_DATA__', '__INITIAL_STATE__', '__NUXT__', 'ld+json', 'datadome', 'cloudflare', 'captcha'].filter((m) => text.includes(m))
    zeilen.push(`${name}\t${res.status}\t${text.length}\t${res.url}\t${merk.join(',')}`)
  } catch (e) {
    zeilen.push(`${name}\tFEHLER\t${e}`)
  }
}
writeFileSync('probe/uebersicht.tsv', zeilen.join('\n') + '\n')
console.log(zeilen.join('\n'))
