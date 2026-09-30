# Android-App

Die App ist ein Rahmen um die Seite ([Capacitor](https://capacitorjs.com)) mit einem eigenen
Plugin für den Standort. Sie lädt `www.angebunden.ch` (die kanonische Adresse: `angebunden.ch` leitet dorthin weiter, und eine Weiterleitung auf einen anderen Host würde die App in den Browser schicken), alles andere bleibt die Web-App. Was sie
zusätzlich kann, schafft ein Browser nicht: im Hintergrund aufzeichnen, bei ausgeschaltetem
Bildschirm, und Velofahrten von selbst erkennen.

## Installieren

Auf GitHub unter [Releases](https://github.com/moritzlauper/angebunden/releases) die neueste
`velonavi.apk` laden und öffnen. Android fragt einmal, ob der Browser Apps installieren darf
(«Unbekannte Apps installieren»). Die App braucht Android 7 oder neuer.

Die Fassung entsteht bei jeder Änderung am Android-Teil von selbst
(`.github/workflows/android.yml`) und lässt sich unter «Actions» von Hand starten.

## Aufzeichnen

- **Auf Knopfdruck:** im Velonavi bei einer Route «Aufzeichnen». Die App braucht den Standort.
  Ein Dienst im Vordergrund sammelt im Sekundentakt Punkte, eine Benachrichtigung zeigt es an
  und hat einen Knopf zum Beenden.
- **Von selbst:** im Menü «Konto und Fahrten» den Schalter «Von selbst aufzeichnen». Mit der Option «Auch Gehen, Joggen, Tram und Auto» erkennt die App jede Art der Bewegung und trennt die Wege in Abschnitte, etwa Gehen, Tram, Velo. Die Seite bestimmt die Art aus Tempo und Halten (`app/velonavi/modus.ts`), Haltestellen unterscheiden Tram und Bus vom Auto. Gelernt wird nur aus Velofahrten, die Art lässt sich in der Auswertung korrigieren. Dafür
  braucht die App den Standort «Immer zulassen» und die Bewegungserkennung («Körperliche
  Aktivität»). Die Bewegungserkennung von Android meldet, wenn man aufs Velo steigt, das kostet
  kaum Akku. Erst dann schaltet die App den Standort ein. Die Aufzeichnung endet, wenn man
  sich fünf Minuten nicht mehr bewegt.
- Fahrten unter 300 Metern oder zwei Minuten und solche, die für die erkannte Art zu schnell sind
  (Velo über 43 km/h im Mittel), verwirft die App bei der automatischen Aufzeichnung.
- Beim ersten Start fragt die App einmal nach Standort und Mitteilungen. Den Standort «Immer» und
  die Bewegungserkennung fragt sie erst, wenn du das automatische Aufzeichnen einschaltest.

Die fertigen Fahrten liegen im privaten Ordner der App und warten dort, bis die Seite sie
beim nächsten Öffnen abholt. Sie landen in der Datenbank der Seite, dort werten Velonavi die
Fahrten aus, vergleichen sie und lernen daraus. Nichts verlässt das Gerät, ausser man schaltet
die Sicherung im Konto oder das Beitragen von Messwerten ein.

Android-Hersteller mit scharfem Energiesparen (Xiaomi, Huawei, Samsung) beenden Hintergrunddienste
gern. Hilft nichts, die App in den Einstellungen von der Akkuoptimierung ausnehmen.

## Signieren

Ohne eigenen Schlüssel signiert der Lauf mit einem Debug-Schlüssel, den er zwischen den Läufen
im Cache hält. Die APK lässt sich installieren, ein Update über die alte Fassung klappt aber
nur, solange der Cache besteht. Dauerhaft braucht es einen eigenen Schlüssel, einmal:

```bash
scripts/android-schluessel.sh --los
```

Das Skript erzeugt `~/.velonavi/velonavi.jks` und legt vier Secrets im Repository ab
(`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`). Den Schlüssel und das Passwort sichern: Wer sie verliert, kann die App
nicht mehr über eine bestehende Installation aktualisieren. Wer den Schlüssel ersetzt, muss die
App deinstallieren und neu laden.

## Selbst bauen und ausprobieren

Gebraucht werden JDK 21 und das Android SDK (Android Studio bringt beides mit).

```bash
pnpm install
pnpm exec cap sync android            # kopiert die Konfiguration ins Android-Projekt
cd android && ./gradlew assembleDebug # app/build/outputs/apk/debug/app-debug.apk
```

Gegen den lokalen Entwicklungsserver, etwa im Android-Emulator (er erreicht den Rechner unter
`10.0.2.2`):

```bash
pnpm dev
VELONAVI_URL=http://10.0.2.2:3000 VELONAVI_DEBUG=1 pnpm exec cap sync android
cd android && ./gradlew installDebug
```

`VELONAVI_DEBUG=1` macht die Seite der App mit `chrome://inspect` untersuchbar. Standorte
im Emulator liefert `adb emu geo fix <lon> <lat>`. Die Erkennung von Velofahrten lässt sich im
Emulator nicht auslösen, dafür braucht es ein echtes Gerät.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `capacitor.config.ts` | Adresse der Seite, App-Name |
| `android-web/offline.html` | Seite ohne Verbindung |
| `android/app/src/main/java/ch/angebunden/velonavi/TrackerService.java` | zeichnet auf, Dienst im Vordergrund |
| `…/AktivitaetReceiver.java` | hört auf die Bewegungserkennung von Android |
| `…/VelotrackerPlugin.java` | die Brücke zur Seite (`Capacitor.Plugins.Velotracker`) |
| `app/velonavi/native.ts` | die Gegenseite in der Web-App |
