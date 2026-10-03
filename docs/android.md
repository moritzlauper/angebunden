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
- **Von selbst:** im Menü «Konto und Fahrten» den Schalter «Von selbst aufzeichnen». Der Velonavi ist nur fürs Velo, die App startet aber bei jeder Meldung der Bewegungserkennung (Velo, Fahrzeug, Gehen, Joggen): Android hält eine Velofahrt oft für ein Fahrzeug oder für Gehen, besonders mit dem Handy in der Tasche. Wechselt die Meldung unterwegs, bleibt es eine Fahrt. Ob es eine Velofahrt war, entscheidet die Seite am Tempo und an den Halten (`app/velonavi/modus.ts`); Tram, Auto und Fusswege speichert sie nicht. Weil die Bewegungserkennung Velofahrten oft spät oder gar nicht meldet, gibt es einen zweiten Auslöser (`Ortswechsel.java`): Die App legt einen Kreis von 120 Metern um den Ort, an dem man zuletzt war, und startet die Aufzeichnung zur Probe, wenn man ihn verlässt. Erreicht sie in vier Minuten nie Velotempo (11 km/h), endet sie; nach einer solchen Probe zu Fuss misst der nächste Kreis 300 Meter, damit ein Spaziergang nicht alle paar Minuten eine neue auslöst. Im Menü steht unter «Von selbst aufzeichnen» ein Protokoll: was Android meldete, wann eine Aufzeichnung startete und warum eine Fahrt gespeichert oder verworfen wurde, dazu eine Warnung, wenn eine Freigabe fehlt. Eine Pause unterwegs, in der man mindestens vier Minuten nicht mit Velotempo vorankommt (stehen, herumgehen), trennt die Aufzeichnung in zwei Fahrten (`abschnitte` in `app/velonavi/fahrten.ts`). Wege zu Fuss, im Tram oder Auto aus früheren Fassungen bleiben auf dem Gerät, erscheinen aber nicht mehr. Dafür
  braucht die App den Standort «Immer zulassen» und die Bewegungserkennung («Körperliche
  Aktivität»). Die Bewegungserkennung von Android meldet, wenn man aufs Velo steigt, das kostet
  kaum Akku. Erst dann schaltet die App den Standort ein. Die Aufzeichnung endet, wenn man
  sich fünf Minuten nicht mehr bewegt.
- Fahrten unter 300 Metern oder zwei Minuten und solche, die für die erkannte Art zu schnell sind
  (Velo über 43 km/h im Mittel), verwirft die App bei der automatischen Aufzeichnung.
- Beim ersten Start fragt die App nach Standort, Mitteilungen und Bewegungserkennung. Für den
  Hintergrundstandort führt sie ab Android 11 in die App-Einstellungen: Unter «Standort» muss
  «Immer zulassen» gewählt werden. Sind alle Freigaben erteilt, schaltet die App das automatische
  Aufzeichnen von Velofahrten ein. Wer eine Freigabe ablehnt, kann
  sie später in den Einstellungen nachholen und den Schalter im Menü einschalten.

Die fertigen Fahrten liegen im privaten Ordner der App und warten dort, bis die Seite sie
beim nächsten Öffnen abholt. Sie landen in der Datenbank der Seite, dort werten Velonavi die
Fahrten aus, vergleichen sie und lernen daraus. Die Spur verlässt das Gerät nur als
Kopie im eigenen Konto, wenn man angemeldet ist (die Sicherung im Konto ist dann an, im Menü abschaltbar).
Ein Deinstallieren löscht die Fahrten auf dem Gerät; was im Konto liegt, kommt nach dem Anmelden
zurück. Standardmässig gehen ausserdem anonyme Messwerte
weg (Beitragen, im Menü abschaltbar).

Geht etwas schief, merkt sich die App die Ursache und die Seite zeigt sie beim nächsten Öffnen
einmal an: ein Absturz der App (Art des Fehlers und Stelle im Code), ein Dienst im Vordergrund, den
Android ablehnt, oder eine Seite, die abgestürzt ist oder die Android wegen Speicher beendet hat. In
diesem Fall lädt die App die Seite neu, statt mit einer Fehlerseite stehenzubleiben; eine laufende
Aufzeichnung läuft im Dienst weiter. Ebenso, wenn die Seite selbst nicht lädt (`Seitenwaechter.java`):
Die App merkt sich Adresse und Fehlercode und versucht es noch zweimal, erst dann kommt die Seite
«Keine Verbindung».

Android-Hersteller mit scharfem Energiesparen (Xiaomi, Huawei, Samsung) beenden Hintergrunddienste
gern. Hilft nichts, die App in den Einstellungen von der Akkuoptimierung ausnehmen.

## Geführt fahren

Bei einer Route den Knopf «Geführt fahren». Das Handy sagt per Vibration, wo du abbiegen sollst:
einmal lang für rechts, zweimal kurz für links, dreimal kurz für wenden, ein langes Signal am Ziel,
vier kurze Stösse, wenn du von der Route abkommst (dann rechnet der Velonavi von deiner Position aus
neu). Der Hinweis kommt etwa sechs Sekunden vor der Kreuzung, bei höherem Tempo früher. Beim ersten
Start zeigt eine Einführung die Muster zum Ausprobieren. Ist «Aufzeichnen» eingeschaltet, zeichnet
die Führung die Fahrt mit auf.

Die Führung läuft in der Seite und braucht deshalb einen Bildschirm, der an bleibt; die Seite hält
ihn an. Bei ausgeschaltetem Bildschirm gibt es noch keine Hinweise. Geführt fahren und Aufzeichnen
gibt es nur in der App, im Browser fehlen die Knöpfe. Die Vibration läuft über Android selbst
(`vibrieren` im Plugin, `VIBRATE` im Manifest) und als Alarm: Das Vibrieren der Seite kam im WebView
nicht an, und so spürt man es auch, wenn das Handy auf lautlos steht. Die Berechnung der Abbiegehinweise steht in `app/velonavi/fuehrung.ts`.

## GPX

Die Route lässt sich als GPX-Datei für Navi-Geräte und Apps exportieren (Link ganz unten im
Bedienfeld). Im WebView der App gibt es kein Herunterladen, deshalb öffnet die App das Teilen-Menü von
Android. Das braucht eine App ab der Fassung mit `gpxTeilen`, in älteren fällt es auf den Browser
zurück und funktioniert dort nicht.

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
