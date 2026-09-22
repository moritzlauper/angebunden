import { mkdirSync, writeFileSync } from 'node:fs'

const boxen = {
  zuerich: '47.30,8.40,47.45,8.67',
  basel: '47.50,7.52,47.61,7.68',
  bern: '46.90,7.25,47.01,7.55',
}
const stadt = process.argv[2] ?? 'zuerich'
const bbox = boxen[stadt]
if (!bbox) throw new Error(`Unbekannte Stadt: ${stadt}`)
const query = `[out:json][timeout:300];
(
  way["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"](${bbox});
  way["landuse"~"^(cemetery|forest|grass|meadow|recreation_ground)$"](${bbox});
  way["natural"~"^(wood|heath|scrub)$"](${bbox});
  relation["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"](${bbox});
  relation["landuse"~"^(cemetery|forest|grass|meadow|recreation_ground)$"](${bbox});
  relation["natural"~"^(wood|heath|scrub)$"](${bbox});
);
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

function ring(points) {
  const coordinates = points.filter(Boolean).map(({ lon, lat }) => [lon, lat])
  if (coordinates.length < 4) return null
  const first = coordinates[0]
  const last = coordinates.at(-1)
  return first[0] === last[0] && first[1] === last[1] ? coordinates : null
}
function relationRings(members) {
  const segments = members.filter((m) => m.role !== 'inner' && m.geometry?.length > 1).map((m) => m.geometry.filter(Boolean))
  const rings = []
  while (segments.length) {
    let current = segments.pop()
    let changed = true
    while (changed && (current[0].lon !== current.at(-1).lon || current[0].lat !== current.at(-1).lat)) {
      changed = false
      const same = (a, b) => a && b && a.lon === b.lon && a.lat === b.lat
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        const start = current[0]
        const end = current.at(-1)
        if (same(segment[0], end)) current.push(...segment.slice(1))
        else if (same(segment.at(-1), end)) current.push(...segment.slice(0, -1).reverse())
        else if (same(segment.at(-1), start)) current.unshift(...segment.slice(0, -1).reverse())
        else if (same(segment[0], start)) current.unshift(...segment.slice(1))
        else continue
        segments.splice(i, 1)
        changed = true
        break
      }
    }
    const coordinates = ring(current)
    if (coordinates) rings.push(coordinates)
  }
  return rings
}
const features = data.elements.flatMap((element) => {
  const rings = element.type === 'relation' ? relationRings(element.members ?? []) : [ring(element.geometry ?? [])]
  return rings.filter(Boolean).map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } }))
})
mkdirSync(`public/data/${stadt}`, { recursive: true })
writeFileSync(`public/data/${stadt}/gruen.geojson`, JSON.stringify({ type: 'FeatureCollection', features }))
console.log(`${stadt}: ${features.length} Grünflächen geschrieben`)
