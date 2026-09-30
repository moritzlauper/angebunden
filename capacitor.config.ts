import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Die Android-App ist ein Rahmen um die Seite. Sie lädt angebunden.ch und
 * bringt ein eigenes Plugin für den Standort im Hintergrund mit
 * (`android/app/src/main/java/ch/angebunden/velonavi`). Zum Ausprobieren gegen
 * den lokalen Entwicklungsserver: `VELONAVI_URL=http://10.0.2.2:3000`, die
 * Adresse, unter der der Android-Emulator den Rechner erreicht.
 */
const url = process.env.VELONAVI_URL ?? 'https://angebunden.ch'

const config: CapacitorConfig = {
  appId: 'ch.angebunden.velonavi',
  appName: 'Velonavi',
  // Nur die Ausweichseite ohne Verbindung, alles andere kommt von `url`.
  webDir: 'android-web',
  server: {
    url,
    cleartext: url.startsWith('http://'),
    errorPath: 'offline.html',
  },
  android: {
    // Nur Debug-Fassungen lassen sich mit Chrome (chrome://inspect) untersuchen.
    webContentsDebuggingEnabled: process.env.VELONAVI_DEBUG === '1',
  },
}

export default config
