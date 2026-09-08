/**
 * Holt Stadtgrenze, Gebäudegrundrisse und Adresspunkte von der Overpass-API.
 * Ergebnisse werden roh zwischengespeichert, damit spätere Läufe die API nicht erneut belasten.
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { aktiveStadt } from './staedte.ts'

const STADT = aktiveStadt()
const RAW = new URL(`../data/raw/osm/${STADT.schluessel}/`, import.meta.url).pathname
/**
 * Die Schweizer Instanz zuerst: sie hat nur Daten der Schweiz und beantwortet
 * Anfragen aus diesem Gebiet in unter einer Sekunde, während overpass-api.de
 * bei Gebäudeabfragen regelmässig in "server too busy" läuft.
 */
const ENDPOINTS = [
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

/** Grosszügige Box um die Stadt; die exakte Grenze schneidet später zu. */
const BBOX = STADT.osmBbox

async function overpass(name: string, query: string): Promise<any> {
  const file = RAW + name + '.json'
  if (existsSync(file)) {
    console.log(`  ${name}: aus Cache`)
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  let lastErr: unknown
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length]
    try {
      const t0 = Date.now()
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass antwortet ohne erkennbaren User-Agent mit 406.
          'User-Agent': 'zueri-oev-karte/1.0 (OSM-Auswertung, Kontakt via GitHub)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(900_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const json = JSON.parse(text)
      if (!json.elements) throw new Error('keine elements im Ergebnis')
      writeFileSync(file, text)
      console.log(
        `  ${name}: ${json.elements.length} Elemente, ${(text.length / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s`
      )
      await new Promise((r) => setTimeout(r, 1500)) // die Instanz ist klein, nicht hämmern
      return json
    } catch (err) {
      lastErr = err
      console.log(`  ${name}: Versuch ${attempt + 1} fehlgeschlagen (${err}) – warte`)
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)))
    }
  }
  throw new Error(`${name} endgültig fehlgeschlagen: ${lastErr}`)
}

/** Die Gebäudeabfrage wird gekachelt, sonst läuft Overpass in Timeouts. */
function tiles(rows: number, cols: number) {
  const out: { name: string; s: number; w: number; n: number; e: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        name: `r${r}c${c}`,
        s: BBOX.s + ((BBOX.n - BBOX.s) * r) / rows,
        n: BBOX.s + ((BBOX.n - BBOX.s) * (r + 1)) / rows,
        w: BBOX.w + ((BBOX.e - BBOX.w) * c) / cols,
        e: BBOX.w + ((BBOX.e - BBOX.w) * (c + 1)) / cols,
      })
    }
  }
  return out
}

async function main() {
  mkdirSync(RAW, { recursive: true })

  console.log(`Stadtgrenze (${STADT.grenzeName})`)
  await overpass(
    'boundary',
    `[out:json][timeout:180];
     relation["boundary"="administrative"]["admin_level"="8"]["name"="${STADT.grenzeName}"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
     out geom;`
  )

  console.log('Gebäudegrundrisse')
  for (const t of tiles(...STADT.kacheln.gebaeude)) {
    await overpass(
      `buildings_${t.name}`,
      `[out:json][timeout:600];
       (way["building"](${t.s},${t.w},${t.n},${t.e});
        relation["building"](${t.s},${t.w},${t.n},${t.e}););
       out geom;`
    )
  }

  console.log('Adresspunkte')
  for (const t of tiles(...STADT.kacheln.adressen)) {
    await overpass(
      `addresses_${t.name}`,
      `[out:json][timeout:600];
       nwr["addr:housenumber"](${t.s},${t.w},${t.n},${t.e});
       out center;`
    )
  }

  // See, Limmat und Sihl sind die Orientierungspunkte auf der sonst leeren Karte.
  console.log('Gewässer')
  await overpass(
    'water',
    `[out:json][timeout:600];
     (way["natural"="water"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      relation["natural"="water"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      way["waterway"="riverbank"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      way["waterway"~"^(river|canal)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}););
     out geom;`
  )

  // Strassen dienen nur der Orientierung und werden abstrakt gezeichnet:
  // zwei Strichstärken, keine Kategorien darüber hinaus.
  console.log('Strassen')
  for (const t of tiles(...STADT.kacheln.strassen)) {
    await overpass(
      `streets_${t.name}`,
      `[out:json][timeout:600];
       way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)$"]["area"!="yes"](${t.s},${t.w},${t.n},${t.e});
       out geom;`
    )
  }

  // Begehbare Wege für die echte Gehdistanz des Kultur-Scores und der ÖV-Zuwege.
  // Breiter als `streets`: auch Fusswege, Treppen, Pfade. `out geom` liefert
  // `nodes[]` und `geometry[]` index-gleich – daraus baut die Pipeline den Graphen.
  console.log('Wege')
  for (const t of tiles(...STADT.kacheln.strassen)) {
    await overpass(
      `wege_${t.name}`,
      `[out:json][timeout:600];
       way["highway"~"^(footway|path|steps|pedestrian|living_street|residential|unclassified|tertiary|secondary|primary|service|track|cycleway|road|corridor)$"]["area"!="yes"]["foot"!~"^(no|private)$"]["access"!~"^(no|private)$"](${t.s},${t.w},${t.n},${t.e});
       out geom;`
    )
  }

  console.log('Orts- und Platznamen')
  await overpass(
    'places',
    `[out:json][timeout:300];
     (node["place"~"^(city|town|suburb|quarter|neighbourhood|square)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      way["place"="square"]["name"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      node["railway"="station"]["name"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}););
     out center;`
  )

  // Kulturorte: was man aufsucht, um etwas zu erleben. Öffentliche Kunstwerke
  // (tourism=artwork) sind dabei, obwohl es in Zürich über 500 davon gibt und sie
  // die Zählung sonst dominieren würden – in der Karte lässt sich jede Sorte
  // einzeln abwählen, die Entscheidung fällt also nicht mehr hier. Restaurants
  // sind ebenfalls dabei, in der Karte aber standardmässig abgewählt, damit die
  // Vorgabe nicht vor allem Gastronomiedichte misst.
  // Frei- und Hallenbäder hängen meist an leisure=sports_centre + sport=swimming
  // (Freibad Letzigraben, Hallenbad City …), nicht an amenity=public_bath;
  // Schulschwimmanlagen tragen dieselben Tags und werden erst in Schritt 03 aussortiert.
  console.log('Kulturorte')
  await overpass(
    'kultur',
    `[out:json][timeout:300];
     (nwr["amenity"~"^(bar|pub|biergarten|nightclub|cafe|restaurant|cinema|theatre|arts_centre|events_venue|music_venue|library|public_bath|community_centre)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      nwr["tourism"~"^(museum|gallery|artwork)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      nwr["leisure"~"^(swimming_area|water_park|dance)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      nwr["leisure"="sports_centre"]["sport"~"swimming"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}););
     out center tags;`
  )

  console.log('fertig')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
