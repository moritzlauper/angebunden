/**
 * Farben der Vorschaubilder. Sie weichen bewusst von der Seite ab: Das Bild
 * muss im Chatverlauf zwischen Fotos auffallen, deshalb dunkler Grund und
 * kräftige Farben statt Papier und Tinte.
 *
 * Die Rampe der Stadtbilder läuft von Gelb (gut angebunden) über Koralle und
 * Karmin nach Violett. Auf dunklem Grund leuchtet das helle Ende, also liegt
 * «gut» dort, wo das Auge zuerst hinschaut.
 */
export const OG = {
  grund: '#15121c',
  wasser: '#1f2740',
  strasse: 'rgba(255,255,255,0.07)',
  rampe: ['#ffe45e', '#ffc145', '#ff9a3c', '#ff6b4a', '#f0435f', '#cc2f78', '#9a2c84', '#6a2a84', '#47286e'],
  text: '#ffffff',
  leise: 'rgba(255,255,255,0.72)',
  sehrLeise: 'rgba(255,255,255,0.5)',

  /** Velonavi: Karte bei Nacht. */
  nacht: '#0d1522',
  nachtGruen: '#12241f',
  nachtWasser: '#16304f',
  nachtStrasse: 'rgba(255,255,255,0.10)',
  nachtHaupt: 'rgba(255,255,255,0.18)',
  vorzug: 'rgba(125,211,252,0.55)',
  /** Stufe 0 bis 4 wie im Velonavi, für dunklen Grund aufgehellt. */
  stufen: ['#9aa3ad', '#3ddc84', '#ffd23f', '#ff8a4c', '#ff4d4d'],
  ziel: '#3b82f6',
} as const
