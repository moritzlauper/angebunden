import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Die Android-App ist ein Rahmen um die Seite. Sie lädt angebunden.ch und
 * bringt ein eigenes Plugin für den Standort im Hintergrund mit
 * (`android/app/src/main/java/ch/angebunden/velonavi`). Zum Ausprobieren gegen
 * den lokalen Entwicklungsserver: `VELONAVI_URL=http://10.0.2.2:3000`, die
 * Adresse, unter der der Android-Emulator den Rechner erreicht.
 */
// angebunden.ch leitet auf www.angebunden.ch weiter. Die App startet gleich dort: Eine Weiterleitung auf
// einen anderen Host würde sie als externen Link in den Browser schicken, ohne das Plugin.
const url = process.env.VELONAVI_URL ?? 'https://www.angebunden.ch'

const config: CapacitorConfig = {
  appId: 'ch.angebunden.velonavi',
  appName: 'Velonavi',
  // Nur die Ausweichseite ohne Verbindung, alles andere kommt von `url`.
  webDir: 'android-web',
  server: {
    url,
    cleartext: url.startsWith('http://'),
    errorPath: 'offline.html',
    allowNavigation: ['angebunden.ch', 'www.angebunden.ch'],
  },
  android: {
    // Nur Debug-Fassungen lassen sich mit Chrome (chrome://inspect) untersuchen.
    webContentsDebuggingEnabled: process.env.VELONAVI_DEBUG === '1',
  },
}

export default config
