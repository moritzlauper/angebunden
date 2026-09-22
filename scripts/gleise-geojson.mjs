import { mkdirSync, writeFileSync } from 'node:fs'

const boxen = {
  zuerich: '47.25,8.31,47.50,8.78',
  basel: '47.44,7.45,47.63,7.80',
  bern: '46.87,7.28,47.02,7.57',
}
const stadt = process.argv[2] ?? 'zuerich'
const bbox = boxen[stadt]
if (!bbox) throw new Error(`Unbekannte Stadt: ${stadt}`)
const query = `[out:json][timeout:180];
way["railway"~"^(rail|tram|light_rail|subway|narrow_gauge|preserved|monorail)$"](${bbox});
out geom;`
const endpoints = ['https://overpass.osm.ch/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
let data
for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'angebunden/1.0 (OSM-Auswertung)' },
      body: `data=${encodeURIComponent(query)}`,
    })
    const text = await response.text()
    if (!response.ok || text.trimStart().startsWith('<')) throw new Error(`HTTP ${response.status}`)
    data = JSON.parse(text)
    break
  } catch (error) {
    console.log(`${endpoint}: ${error.message}`)
  }
}
if (!data) throw new Error('Keine Overpass-Instanz hat geantwortet')
const features = data.elements
  .filter((way) => way.geometry?.length > 1)
  .map((way) => ({
    type: 'Feature',
    properties: { art: way.tags?.railway ?? 'rail' },
    geometry: { type: 'LineString', coordinates: way.geometry.map(({ lon, lat }) => [lon, lat]) },
  }))
mkdirSync(`public/data/${stadt}`, { recursive: true })
writeFileSync(`public/data/${stadt}/gleise.geojson`, JSON.stringify({ type: 'FeatureCollection', features }))
console.log(`${stadt}: ${features.length} Gleise geschrieben`)
