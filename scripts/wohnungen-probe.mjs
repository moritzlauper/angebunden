// Vorübergehend: ruft die Quellen der Wohnungssuche ab und legt die Antworten unter probe/ ab,
// damit sich die Sammler gegen echte Antworten schreiben lassen.
import { mkdirSync, writeFileSync } from 'node:fs'
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Accept-Language': 'de-CH,de;q=0.9,en;q=0.6',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
}
const ZIELE = {
  'flatfox-multi': 'https://flatfox.ch/api/v1/public-listing/?pk=86415856&pk=86415377&expand=cover_image',
  'flatfox-eins': 'https://flatfox.ch/api/v1/public-listing/86415377/?expand=cover_image',
  'flatfox-pin-klein': 'https://flatfox.ch/api/v1/pin/?east=8.55&west=8.50&north=47.39&south=47.36&max_count=400',
  'flatfox-pin-1000': 'https://flatfox.ch/api/v1/pin/?east=8.55&west=8.50&north=47.39&south=47.36&max_count=1000',
  'woko-start': 'https://www.woko.ch/',
  'ronorp-start': 'https://www.ronorp.net/',
  'stadt-start': 'https://www.stadt-zuerich.ch/de/stadtleben/wohnen.html',
  'stadt-lsz': 'https://www.stadt-zuerich.ch/de/stadtverwaltung/finanzdepartement/liegenschaften-stadt-zuerich.html',
  'wbg-start': 'https://www.wbg-zh.ch/',
  'abz-start': 'https://www.abz.ch/',
  'pwg-start': 'https://www.pwg.ch/',
  'students-api': 'https://www.students.ch/api/rooms',
  'marktplatz-uzh': 'https://www.marktplatz.uzh.ch/',
}
mkdirSync('probe', { recursive: true })
const zeilen = []
for (const [name, url] of Object.entries(ZIELE)) {
  try {
    const res = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    writeFileSync(`probe/${name}.txt`, `${res.status} ${res.url}\n${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${text}`)
    // Links, die nach Wohnungen aussehen
    const links = [...new Set([...text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /wohn|vermiet|zimmer|frei|miet|room|housing|immobil|marktplatz/i.test(h)))].slice(0, 60)
    writeFileSync(`probe/${name}.links`, links.join('\n'))
    zeilen.push(`${name}\t${res.status}\t${text.length}\t${res.url}`)
  } catch (e) {
    zeilen.push(`${name}\tFEHLER\t${e}`)
  }
}

// Mit echtem Browser: kommen die gesperrten Portale so durch?
try {
  const { chromium } = await import('playwright')
  const b = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] })
  const ctx = await b.newContext({ userAgent: H['User-Agent'], locale: 'de-CH', viewport: { width: 1280, height: 900 } })
  for (const [name, url] of Object.entries({
    'pw-homegate': 'https://www.homegate.ch/mieten/immobilien/ort-zuerich/trefferliste',
    'pw-immoscout': 'https://www.immoscout24.ch/de/immobilien/mieten/ort-zuerich',
    'pw-newhome': 'https://www.newhome.ch/de/mieten/suchen/wohnung/ort-zuerich/liste',
    'pw-comparis': 'https://www.comparis.ch/immobilien/marktplatz/zuerich/mieten',
    'pw-tutti': 'https://www.tutti.ch/de/li/zuerich/immobilien',
    'pw-anibis': 'https://www.anibis.ch/de/c/immobilien',
    'pw-students': 'https://www.students.ch/wohnen',
  })) {
    const p = await ctx.newPage()
    try {
      const res = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await p.waitForTimeout(12000)
      const html = await p.content()
      writeFileSync(`probe/${name}.txt`, `${res?.status()} ${p.url()}\n\n${html}`)
      zeilen.push(`${name}\t${res?.status()}\t${html.length}\t${await p.title()}`)
    } catch (e) {
      zeilen.push(`${name}\tFEHLER\t${e}`)
    }
    await p.close()
  }
  await b.close()
} catch (e) {
  zeilen.push(`playwright\tFEHLER\t${e}`)
}
writeFileSync('probe/uebersicht.tsv', zeilen.join('\n') + '\n')
console.log(zeilen.join('\n'))
