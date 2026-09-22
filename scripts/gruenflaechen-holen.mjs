import { mkdirSync, writeFileSync } from 'node:fs'

const bbox = '47.25,8.31,47.50,8.78'
const query = `[out:json][timeout:180];
way["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"](${bbox});
way["landuse"~"^(cemetery|forest|grass|meadow|recreation_ground)$"](${bbox});
way["natural"~"^(wood|heath|scrub)$"](${bbox});
out geom;`

const response = await fetch('https://overpass.osm.ch/api/interpreter', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'angebunden/1.0 (OSM-Auswertung, Kontakt via GitHub)',
  },
  body: `data=${encodeURIComponent(query)}`,
})
if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`)

const data = await response.json()
const features = data.elements.flatMap((element) => {
  const coordinates = (element.geometry ?? []).map(({ lon, lat }) => [lon, lat])
  if (coordinates.length < 4) return []
  const first = coordinates[0]
  const last = coordinates.at(-1)
  if (first[0] !== last[0] || first[1] !== last[1]) return []
  return [{
    type: 'Feature',
    properties: { name: element.tags?.name ?? null },
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  }]
})

mkdirSync('public/data/zuerich', { recursive: true })
writeFileSync('public/data/zuerich/gruen.geojson', JSON.stringify({ type: 'FeatureCollection', features }))
console.log(`Zürich: ${features.length} Grünflächen geschrieben`)
