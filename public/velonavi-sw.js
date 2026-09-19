/**
 * Zwischenspeicher für die Kartenbilder der Stadt Zürich.
 *
 * Der Kartendienst der Stadt rendert jedes Bild frisch und schickt keine
 * Cache-Angaben mit. Ohne diesen Service Worker lädt der Browser deshalb beim
 * Zoomen und Verschieben immer wieder dieselben Ausschnitte neu, was langsam
 * ist und den Dienst der Stadt unnötig belastet. Bis er die Verbindung
 * zurückweist: Dann bleibt die Karte weiss.
 *
 * Gespeichert werden nur Bilder von ogd.stadt-zuerich.ch, höchstens 600 Stück.
 * Alles andere läuft unverändert durch, der Service Worker fasst es nicht an.
 */
const CACHE = 'velonavi-karte-v1'
const MAX = 600

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

/** Ältestes Drittel wegwerfen, wenn der Speicher voll ist (die Reihenfolge ist die Einfügereihenfolge). */
async function begrenzen(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX) return
  await Promise.all(keys.slice(0, keys.length - MAX + 200).map((k) => cache.delete(k)))
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (url.hostname !== 'www.ogd.stadt-zuerich.ch' || e.request.method !== 'GET') return

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const treffer = await cache.match(e.request)
      if (treffer) return treffer

      // Der Dienst weist unter Last einzelne Verbindungen ab. Ein zweiter
      // Versuch nach kurzer Pause rettet die meisten davon.
      for (let versuch = 0; versuch < 2; versuch++) {
        try {
          const antwort = await fetch(e.request)
          if (antwort.ok) {
            cache.put(e.request, antwort.clone()).then(() => begrenzen(cache))
          }
          return antwort
        } catch (err) {
          if (versuch === 1) throw err
          await new Promise((r) => setTimeout(r, 500))
        }
      }
    })()
  )
})
