/**
 * Holt die Schriftglyphen für die Kartenbeschriftung nach public/fonts/.
 *
 * MapLibre rendert Text aus vorgerechneten Glyph-Kacheln (SDF), nicht aus
 * Webfonts. Fehlt ein Bereich, holt MapLibre ihn trotzdem und handelt sich
 * einen 404 ein - der Text bleibt dann lückenhaft.
 *
 * Läuft automatisch vor `dev` und `build` und überspringt vorhandene Dateien.
 */
import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'

const QUELLE = 'https://demotiles.maplibre.org/font'
const SCHRIFTEN = ['Noto Sans Regular', 'Noto Sans Bold']
// 0-255 Latin, 256-511 Umlaute und Akzente, 8192-8447 Interpunktion –
// darin liegt das Schweizer Tausenderhochkomma U+2019, das in "47'099" steckt.
const BEREICHE = ['0-255', '256-511', '8192-8447']

for (const schrift of SCHRIFTEN) {
  const ordner = path.join(process.cwd(), 'public/fonts', schrift)
  await mkdir(ordner, { recursive: true })
  for (const bereich of BEREICHE) {
    const ziel = path.join(ordner, `${bereich}.pbf`)
    try {
      await access(ziel)
      continue
    } catch {
      // noch nicht da, also holen
    }
    const url = `${QUELLE}/${encodeURIComponent(schrift)}/${bereich}.pbf`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    await writeFile(ziel, Buffer.from(await res.arrayBuffer()))
    console.log(`  ${schrift}/${bereich}.pbf`)
  }
}
console.log('Glyphen bereit')
