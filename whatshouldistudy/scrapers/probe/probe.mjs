// Fetches each request in probe-requests.json and prints what came back:
// status, type, size, and a peek inside (JSON keys, CSV header + rows, ZIP/XLSX entries).
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'

const reqs = JSON.parse(readFileSync(new URL('./probe-requests.json', import.meta.url), 'utf8'))
const UA = 'whatshouldistudy-data/1.0 (+https://github.com/moritzlauper/angebunden; open data aggregation)'

function peekJson(v, depth = 0) {
  if (Array.isArray(v)) return `array(${v.length}) ` + (v.length ? peekJson(v[0], depth + 1) : '')
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    if (depth > 2) return `{${keys.slice(0, 25).join(',')}}`
    return '{' + keys.slice(0, 30).map((k) => `${k}: ${typeof v[k] === 'object' && v[k] ? peekJson(v[k], depth + 1) : JSON.stringify(v[k])?.slice(0, 80)}`).join(', ') + '}'
  }
  return JSON.stringify(v)?.slice(0, 120)
}

for (const r of reqs) {
  console.log(`\n===== ${r.name ?? r.url}`)
  try {
    const res = await fetch(r.url, { method: r.method ?? 'GET', headers: { 'User-Agent': UA, Accept: '*/*', ...(r.headers ?? {}) }, body: r.body ? JSON.stringify(r.body) : undefined, redirect: 'follow', signal: AbortSignal.timeout(r.timeout ?? 40000) })
    const buf = new Uint8Array(await res.arrayBuffer())
    const type = res.headers.get('content-type') ?? ''
    console.log(`status ${res.status} · ${type} · ${buf.length} bytes · final ${res.url}`)
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const files = unzipSync(buf)
      const names = Object.keys(files)
      console.log(`zip: ${names.length} entries: ${names.slice(0, 40).join(' | ')}`)
      const shared = files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : ''
      if (shared) {
        const strings = [...shared.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1])
        console.log(`xlsx sheets: ${strFromU8(files['xl/workbook.xml']).match(/name="[^"]+"/g)?.join(' ')}`)
        console.log(`first strings: ${strings.slice(0, 120).join(' | ')}`)
      }
      for (const n of names.filter((n) => /\.(csv|txt|json)$/i.test(n)).slice(0, 6)) {
        const t = strFromU8(files[n]).split(/\r?\n/)
        console.log(`--- ${n}: ${t.length} lines\n${t.slice(0, r.lines ?? 4).join('\n').slice(0, 2500)}`)
      }
      continue
    }
    const text = new TextDecoder().decode(buf)
    if (/json/.test(type) || /^\s*[[{]/.test(text)) {
      try {
        const j = JSON.parse(text)
        if (r.expr) {
          console.log('expr:', JSON.stringify(new Function('j', `return ${r.expr}`)(j), null, 0).slice(0, r.dump ?? 6000))
          continue
        }
        console.log('json:', peekJson(j).slice(0, 3000))
        if (r.dump) console.log(text.slice(0, r.dump))
        continue
      } catch {}
    }
    const lines = text.split(/\r?\n/)
    console.log(`${lines.length} lines`)
    console.log(text.slice(0, r.dump ?? 1500))
    if (r.grep) for (const m of text.matchAll(new RegExp(r.grep, 'gi'))) console.log('match:', m[0].slice(0, 300))
  } catch (e) {
    console.log('ERROR', e.message, e.cause?.code ?? '')
  }
}
