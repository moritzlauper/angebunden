/**
 * Kopiert den MapLibre-Worker nach public/maplibre/.
 *
 * Warum das nötig ist: MapLibre leitet die Worker-URL aus `import.meta.url` ab
 * und gibt einen leeren String zurück, wenn das keine http-URL ist. Unter
 * Turbopack ist es keine – der Worker wird dann mit der URL der HTML-Seite
 * gestartet, lädt HTML als Modul und stirbt sofort. Die Karte bleibt weiss,
 * ohne dass ein Fehler auftaucht. Mit einer eigenen Kopie im public-Ordner und
 * `setWorkerUrl()` in app/karte.tsx ist die URL eindeutig.
 *
 * Läuft automatisch vor `dev` und `build`.
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const dist = path.dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'))
const ziel = path.join(process.cwd(), 'public/maplibre')

// Der Worker importiert die Shared-Datei relativ, beide müssen nebeneinander liegen.
const dateien = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

await mkdir(ziel, { recursive: true })
for (const f of dateien) await copyFile(path.join(dist, f), path.join(ziel, f))
console.log(`maplibre-worker -> public/maplibre/ (${dateien.join(', ')})`)
