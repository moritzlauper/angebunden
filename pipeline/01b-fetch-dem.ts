/**
 * Baut ein Höhenraster für den Kartenausschnitt.
 *
 * Quelle sind die frei nutzbaren Terrain-Kacheln von AWS (Terrarium-Kodierung):
 * ein PNG, in dem die Höhe in den Farbkanälen steckt, `h = R*256 + G + B/256 - 32768`.
 * Für die Schweiz stammen die Daten aus dem swisstopo-Höhenmodell mit rund 25 m
 * Rasterweite; auf Zoomstufe 13 liegen die Bildpunkte etwa 19 m auseinander.
 *
 * Das reicht für die Steigung entlang eines Fussweges von einigen hundert Metern.
 * Für einzelne Treppen oder Unterführungen reicht es nicht, und das soll es auch
 * nicht: gebraucht wird, ob es den Zürichberg hinauf oder hinunter geht.
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { CONFIG } from './config.ts'
import { aktiveStadt } from './staedte.ts'

const STADT = aktiveStadt()
// Die Höhenkacheln sind global (XYZ) und werden über alle Städte geteilt.
const RAW = new URL('../data/raw/dem/', import.meta.url).pathname
const OUT = new URL(`../data/derived/${STADT.schluessel}/`, import.meta.url).pathname
const Z = CONFIG.demZoom
const N = 2 ** Z

const tileX = (lon: number) => ((lon + 180) / 360) * N
const tileY = (lat: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N
}

const b = STADT.networkBbox
const x0 = Math.floor(tileX(b.minLon))
const x1 = Math.floor(tileX(b.maxLon))
const y0 = Math.floor(tileY(b.maxLat)) // Norden hat die kleinere Kachelnummer
const y1 = Math.floor(tileY(b.minLat))
const spalten = x1 - x0 + 1
const zeilen = y1 - y0 + 1
const breite = spalten * 256
const hoehe = zeilen * 256

console.log(`Höhenraster Zoom ${Z}: ${spalten}×${zeilen} Kacheln = ${breite}×${hoehe} Punkte`)

mkdirSync(RAW, { recursive: true })
mkdirSync(OUT, { recursive: true })

async function kachel(tx: number, ty: number): Promise<Buffer> {
  const datei = `${RAW}${Z}_${tx}_${ty}.png`
  if (existsSync(datei)) return readFileSync(datei)
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`
  for (let versuch = 0; versuch < 4; versuch++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (res.status === 404) return Buffer.alloc(0) // ausserhalb der Abdeckung
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(datei, buf)
      return buf
    } catch (err) {
      if (versuch === 3) throw err
      await new Promise((r) => setTimeout(r, 2000 * (versuch + 1)))
    }
  }
  return Buffer.alloc(0)
}

/** Höhen in Dezimetern als Int16 – spart die Hälfte und ist zehnmal genauer als nötig. */
const raster = new Int16Array(breite * hoehe)
let geholt = 0
const gleichzeitig = 8
const auftraege: { tx: number; ty: number }[] = []
for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) auftraege.push({ tx, ty })

await Promise.all(
  Array.from({ length: gleichzeitig }, async () => {
    for (;;) {
      const a = auftraege.shift()
      if (!a) return
      const buf = await kachel(a.tx, a.ty)
      geholt++
      if (geholt % 10 === 0) process.stdout.write(`\r  ${geholt} Kacheln`)
      if (buf.length === 0) continue
      const png = PNG.sync.read(buf)
      const ox = (a.tx - x0) * 256
      const oy = (a.ty - y0) * 256
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const i = (py * png.width + px) * 4
          const m = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768
          raster[(oy + py) * breite + ox + px] = Math.round(m * 10)
        }
      }
    }
  })
)
process.stdout.write('\r')

writeFileSync(OUT + 'dem.bin', Buffer.from(raster.buffer))
writeFileSync(
  OUT + 'dem.json',
  JSON.stringify({ zoom: Z, x0, y0, spalten, zeilen, breite, hoehe, einheit: 'dm' })
)
console.log(`  ${geholt} Kacheln, geschrieben: data/derived/dem.bin (${(raster.byteLength / 1e6).toFixed(1)} MB)`)
