# Daten anpassen

Diese Anleitung ist für Leute, die das Velonetz, den ÖV oder das Kulturangebot in Zürich
besser kennen als die Datensätze, und das in die Karte bringen wollen. Programmieren muss
man dafür meist nicht. Die häufigsten Korrekturen stehen in einer JSON-Datei, die sich
direkt auf GitHub im Browser bearbeiten lässt.

Übersicht, was wo steht:

| Was ändern | Datei | Programmierkenntnisse |
| --- | --- | --- |
| Einzelne Strassen im Velonetz (gesperrt, Einbahn, Stressstufe, Vorzugsroute) | `pipeline/velo-korrekturen.json` | keine |
| Fehlende Verbindungen im Velonetz, Abbiegeverbote, die fürs Velo nicht gelten | `pipeline/velo-korrekturen.json` | keine |
| Wie der Velonavi abwägt (Wartezeit an Ampeln, Gewicht von Verkehr, Belag, Velonetz) | `app/velonavi/router.ts` | Zahlen ändern |
| Wie die Stressstufe einer Strecke entsteht | `pipeline/11-velo-netz.ts`, Abschnitt «Stress» | TypeScript lesen |
| Analysetag, Abfahrtsfenster, Gehtempo, Fussweg-Budgets, Rasterweite | `pipeline/config.ts` | Zahlen ändern |
| Welche OSM-Objekte als Kulturort zählen | `pipeline/03-build-targets.ts`, Funktion `kulturArt` | TypeScript lesen |
| Stadtgrenze, Kartenausschnitt, Stichproben für `pnpm verify` | `pipeline/staedte.ts`, `app/staedte.ts` | Zahlen ändern |

## Velonetz korrigieren

Der Velonavi baut sein Netz aus dem Fuss- und Velowegnetz der Stadt Zürich und ergänzt es
mit Tempo, Lichtsignalen, Velonetzplanung, Unfällen und OpenStreetMap. Was in keiner dieser
Quellen stimmt, etwa ein Umbau, der noch nicht nachgeführt ist, gehört in
`pipeline/velo-korrekturen.json`. Die Datei hat drei Abschnitte.

### `regeln`: Eigenschaften einer Strasse ändern

Eine Regel trifft alle Kanten mit genau diesem Strassennamen. Mit `bbox` lässt sie sich auf
einen Ausschnitt begrenzen, sonst gilt sie für die ganze Strasse.

```json
{
  "strasse": "Badenerstrasse",
  "bbox": [8.51, 47.372, 8.54, 47.379],
  "nurFahrbahn": true,
  "stressMin": 3,
  "grund": "Zwischen Lochergut und Stauffacher liegt die Badenerstrasse im Tramtrassee, ohne abgetrennten Weg, mit Bussen und viel Autoverkehr. Westlich davon gibt es einen abgetrennten Veloweg, deshalb die Begrenzung auf den inneren Abschnitt."
}
```

| Feld | Wirkung |
| --- | --- |
| `strasse` | Pflicht. Name exakt wie im Datensatz der Stadt, mit «strasse» ausgeschrieben. |
| `grund` | Pflicht. Warum und woher das Wissen stammt. Ohne Grund weiss später niemand, ob die Regel noch nötig ist. |
| `bbox` | Ausschnitt als `[minLon, minLat, maxLon, maxLat]`. Koordinaten liefert ein Rechtsklick in OpenStreetMap oder map.geo.admin.ch (dort WGS84 wählen). |
| `nurFahrbahn` | Nur die Stücke, die man sich mit dem Auto teilt. Trottoirs und abgetrennte Velowege mit demselben Namen bleiben unverändert. |
| `stress` | Stufe fest setzen: 1 abgetrennt oder ruhig, 2 spürbar (etwa Velostreifen an einer Hauptachse), 3 unangenehm, 4 Mischverkehr ab Tempo 50. |
| `stressMin`, `stressMax` | Die berechnete Stufe bleibt, wird aber nach unten oder oben begrenzt. Meist die bessere Wahl als `stress`. |
| `gesperrt` | Fürs Velo sperren, zum Beispiel eine Baustelle oder ein noch nicht eröffneter Abschnitt. Gilt am Schluss, auch gegen automatische Lückenschliesser. |
| `offen` | Fürs Velo öffnen, wo der Datensatz nur einen Fussweg führt. |
| `beideRichtungen` | Einbahn fürs Velo aufheben (Gegenverkehr erlaubt). |
| `veloweg`, `velostreifen` | Abgetrennter Veloweg oder Velostreifen in beiden Richtungen. |
| `netz` | Zugehörigkeit zur Velonetzplanung: `keins`, `basis`, `haupt` oder `vorzug`. Vorzugsrouten sind immer fürs Velo offen. |
| `fussgaenger` | Fussgängerbereich, Velo nur im Schritttempo. |

### `verbindungen`: fehlende Kanten ergänzen

An manchen Kreuzungen sind Fahrbahn- und Fusswegnetz im Datensatz nicht verbunden. Zwei
Knoten liegen wenige Meter auseinander, und der Router fährt einen Bogen. Eine Verbindung
legt beide Enden auf den nächsten Knoten im Umkreis von 20 m.

```json
{
  "von": [8.54589, 47.37467],
  "nach": [8.54580, 47.37506],
  "name": "Hirschengraben",
  "grund": "Am Lichtsignal Mühlegasse/Seilergraben fährt man geradeaus auf den Hirschengraben. Im Datensatz liegen die beiden Knoten 44 m auseinander, ohne Kante dazwischen."
}
```

### `abbiegeverbotAusnahmen`: Verbote, die fürs Velo nicht gelten

Die Abbiegeverbote der Stadt gelten fürs Auto. Wo die Tafel «ausgenommen Velo» hängt, der
Datensatz das aber nicht weiss, hebt ein Eintrag das Verbot auf. Verbote zwischen zwei
Quartierstrassen hebt die Pipeline bereits von selbst auf.

```json
{
  "von": "Seilergraben",
  "nach": "Hirschengraben",
  "bbox": [8.5445, 47.3742, 8.5462, 47.3748],
  "grund": "Das Abbiegeverbot der Stadt gilt hier nur fürs Auto. Ohne Ausnahme fährt der Router den Umweg über das Central."
}
```

### Prüfen und ausprobieren

In VS Code und im GitHub-Editor schlägt `velo-korrekturen.schema.json` die Feldnamen vor und
markiert Tippfehler direkt. Vor dem Commit prüft

```bash
pnpm korrekturen:pruefen
```

die Datei ohne die Pipeline: unbekannte Felder, vertauschte Koordinaten, fehlende Gründe
und Strassennamen, die im aktuellen Netz nicht vorkommen. Dieselbe Prüfung läuft bei jedem
Pull Request auf GitHub.

Wirksam wird die Korrektur erst, wenn das Netz neu gebaut ist:

```bash
pnpm daten:velo   # lädt beim ersten Mal rund 125 MB nach data/raw/velo/, danach aus dem Cache
pnpm dev          # dann http://localhost:3000/velonavi
```

`daten:velo` gibt für jede Regel aus, wie viele Kanten sie getroffen hat. Steht dort
`ACHTUNG, keine Kante getroffen`, stimmt der Strassenname nicht oder die `bbox` liegt
daneben.

Wer die Pipeline nicht lokal laufen lassen will, stellt einen Pull Request mit der Änderung
an der JSON-Datei. Nach dem Merge baut die GitHub-Action «Velodaten» das Netz am 3. jedes
Monats neu, oder sofort, wenn man sie unter «Actions» von Hand startet.

## Wie der Velonavi abwägt

Das Routing läuft vollständig im Browser, die Gewichte stehen als Konstanten in
`app/velonavi/router.ts`, jede mit Begründung. Die wichtigsten:

| Konstante | Bedeutung | Wert |
| --- | --- | --- |
| `WARTEN` | Erwartete Wartezeit an Lichtsignalen in Sekunden, je nach Manöver | geradeaus 24, links 34, rechts 1 |
| `STRESS_KOSTEN` | Zusätzliche gefühlte Zeit je Stressstufe, als Anteil der Fahrzeit | Stufe 3: 1.5, Stufe 4: 3.2 |
| `STRESS_EINSTIEG` | Fester Aufschlag in Sekunden fürs Einbiegen auf eine harte Strecke | Stufe 3: 25, Stufe 4: 60 |
| `NETZ_RABATT` | Rabatt auf Basis-, Haupt- und Vorzugsnetz der Velonetzplanung | 0.85, 0.68, 0.58 |
| `BELAG_KOSTEN` | Aufschlag für Platten, Kopfstein, Kies, Naturweg | Kopfstein 1.3 |
| `VOREINSTELLUNGEN` | Die Profile «Schnell» und «Komfort» | |

Eine Änderung hier braucht keinen Neubau der Daten, `pnpm dev` zeigt sie sofort.

## ÖV-Erreichbarkeit und Kulturvielfalt

Die Parameter der Erreichbarkeitskarte stehen gesammelt in `pipeline/config.ts`:
Analysetag und Abfahrtsfenster (heute Dienstag, 7–9 Uhr), Gehtempo, maximale Fusswege zur
Haltestelle, Umsteigezuschlag, Zeitbudgets für die Kulturvielfalt. Die Methode erklärt das
[README](../README.md#öv-erreichbarkeit).

Welche OSM-Objekte als Kulturort zählen, entscheidet `kulturArt` in
`pipeline/03-build-targets.ts`. Oft ist es besser, fehlende oder falsch getaggte Orte direkt
in OpenStreetMap zu korrigieren. Dann profitieren alle, die OSM nutzen, und der nächste Lauf
übernimmt es.

Nach einer Änderung:

```bash
pnpm daten        # Zürich komplett, beim ersten Mal rund 330 MB Download
pnpm verify       # Stichprobe gegen bekannte Verbindungen
pnpm dev
```

## Änderungen einbringen

1. Einen Branch anlegen und die Änderung machen.
2. `pnpm korrekturen:pruefen` und `pnpm typecheck` laufen lassen.
3. Bei geänderten Daten die neu erzeugten Dateien unter `public/data/zuerich/` mitcommitten.
4. Pull Request stellen und in der Beschreibung sagen, woher das Wissen stammt.
