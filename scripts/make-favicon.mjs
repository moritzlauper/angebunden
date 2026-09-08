/**
 * Schreibt app/favicon.ico aus demselben Zeichen wie app/icon.svg: dunkles
 * Quadrat, helle Spur, roter Punkt. Einmalig von Hand ausgeführt, wenn sich das
 * Zeichen ändert – nicht Teil von `dev` oder `build`.
 *
 *   node scripts/make-favicon.mjs
 *
 * Die .ico enthält je ein eingebettetes PNG in 16, 32 und 48 Pixeln (vom ICO-
 * Format seit Windows Vista erlaubt und von allen aktuellen Browsern gelesen).
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'

const HG = [24, 24, 27] // #18181b
const SPUR = [231, 231, 229] // #e7e7e5
const PUNKT = [220, 38, 38] // #dc2626

/** Deckung eines Punktes in einer Strecke der Halbbreite r, weich an der Kante. */
function strecke(px, py, ax, ay, bx, by, r) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy) - r
}

function kreis(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r
}

/** Weiche Kante: aus einem Vorzeichenabstand eine Deckung 0..1 über ~1 px. */
function deckung(d) {
  return Math.max(0, Math.min(1, 0.5 - d))
}

function mische(unten, oben, alpha) {
  return [
    unten[0] + (oben[0] - unten[0]) * alpha,
    unten[1] + (oben[1] - unten[1]) * alpha,
    unten[2] + (oben[2] - unten[2]) * alpha,
  ]
}

function zeichne(n) {
  const png = new PNG({ width: n, height: n })
  const s = n / 32 // die Geometrie ist in einem 32er-Raster gedacht
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = (x + 0.5) / s
      const py = (y + 0.5) / s

      // Abgerundetes Quadrat 1..31, Radius 7
      const qx = Math.abs(px - 16) - 15
      const qy = Math.abs(py - 16) - 15
      const aussen = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 7
      let aQuadrat = deckung(aussen)

      let rgb = [0, 0, 0]
      let a = aQuadrat
      if (a > 0) rgb = HG

      const aSpur = deckung(strecke(px, py, 8, 17, 18.5, 17, 1.5)) * aQuadrat
      rgb = mische(rgb, SPUR, aSpur)

      const aPunkt = deckung(kreis(px, py, 22, 17, 4.5)) * aQuadrat
      rgb = mische(rgb, PUNKT, aPunkt)

      a = Math.max(aQuadrat, 0)
      const i = (y * n + x) * 4
      png.data[i] = Math.round(rgb[0])
      png.data[i + 1] = Math.round(rgb[1])
      png.data[i + 2] = Math.round(rgb[2])
      png.data[i + 3] = Math.round(a * 255)
    }
  }
  return PNG.sync.write(png)
}

function ico(bilder) {
  const kopf = Buffer.alloc(6)
  kopf.writeUInt16LE(0, 0)
  kopf.writeUInt16LE(1, 2)
  kopf.writeUInt16LE(bilder.length, 4)

  const eintraege = Buffer.alloc(16 * bilder.length)
  let offset = 6 + eintraege.length
  bilder.forEach((b, k) => {
    const o = k * 16
    eintraege.writeUInt8(b.n >= 256 ? 0 : b.n, o)
    eintraege.writeUInt8(b.n >= 256 ? 0 : b.n, o + 1)
    eintraege.writeUInt8(0, o + 2)
    eintraege.writeUInt8(0, o + 3)
    eintraege.writeUInt16LE(1, o + 4)
    eintraege.writeUInt16LE(32, o + 6)
    eintraege.writeUInt32LE(b.png.length, o + 8)
    eintraege.writeUInt32LE(offset, o + 12)
    offset += b.png.length
  })

  return Buffer.concat([kopf, eintraege, ...bilder.map((b) => b.png)])
}

const bilder = [16, 32, 48].map((n) => ({ n, png: zeichne(n) }))
const ziel = path.join(process.cwd(), 'app/favicon.ico')
await writeFile(ziel, ico(bilder))
console.log(`app/favicon.ico geschrieben (${[16, 32, 48].join(', ')} px)`)
