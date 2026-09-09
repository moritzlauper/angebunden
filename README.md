# Erreichbarkeitskarte

Eine Karte, auf der jedes Haus einer Stadt eingefärbt ist. Grundlage sind zwei
Kennzahlen, zwischen denen man umschaltet:

* **ÖV-Erreichbarkeit**: Wie gut das Haus an Tram, Bus und S-Bahn angeschlossen ist.
* **Kulturvielfalt**: Wie breit das Kulturangebot in Velo- oder Gehweite ist. Gezählt
  werden Bars, Cafés, Bühnen, Kinos, Museen, öffentliche Kunst, Bibliotheken, Badis und
  Quartiertreffs.

Drei Städte, je eine Route: Zürich auf `/` (47'085 Häuser), Basel auf `/basel` (23'308),
Bern auf `/bern` (20'540). Im Bedienfeld ganz unten wechselt man zwischen ihnen. Alle drei
laufen durch dieselbe Pipeline. Die Zahlen und Beispiele weiter unten sind die von Zürich.

Die Karte ist schwarzweiss. Dunkel heisst gut angeschlossen, hell schlecht. Farbe kommt
dazu, wenn man die Bestplatzierten hervorhebt: Ein Verlauf von kräftigem Dunkelrot bei
Rang 1 nach Hellrot am eingestellten Ende. Beim Öffnen sind die Top 1000 hervorgehoben, der
Regler geht von dort in beide Richtungen.

Eingefärbt wird nach Rang, nicht nach Wert. Beim ÖV liegen zwei Drittel aller Häuser
zwischen 26 und 34 Minuten. Nach Absolutwert wäre die Karte fast einfarbig.

## ÖV-Erreichbarkeit

Die Kennzahl je Haus ist **die mittlere Reisezeit zu einer beliebigen Adresse der Stadt**,
Türe zu Türe. Man zieht eine zufällige Zürcher Adresse und misst, wie lange man von diesem
Haus im Schnitt dorthin braucht. Für das bestangeschlossene Haus sind es 20,5 Minuten, im
Median 30,7, am Stadtrand über 45.

Es sind nicht summierte Minuten, sondern der Durchschnitt. Die Zahl bleibt eine Zeitangabe,
die man ohne Umrechnung lesen kann.

## Die Formel

```
score(haus) = Σ_zelle  gewicht(zelle) · reisezeit(haus, zelle)  /  Σ_zelle gewicht(zelle)
```

* **Zellen**: Die Stadt ist in ein 300-Meter-Raster zerlegt, 830 Zellen enthalten
  Adressen. Der Zielpunkt einer Zelle ist der Schwerpunkt ihrer Adressen, nicht die
  geometrische Mitte.
* **Gewicht**: Die Anzahl Adressen in der Zelle. Damit ist der Wert der Erwartungswert
  über eine zufällig gezogene Adresse. Dicht bebaute Ziele zählen entsprechend mehr. Der
  Wald am Uetliberg, wo kaum jemand wohnt, zieht den Schnitt nicht nach unten.
* **Reisezeit**: Das Minimum aus direktem Fussweg und der besten ÖV-Verbindung.

  ```
  reisezeit = min( fussweg_direkt,
                   min über nahe Haltestellen a von  fussweg(haus, a) + öv_zeit(a, zelle) )
  ```

  `öv_zeit` enthält Wartezeit, Fahrzeit, Umsteigen samt Zuschlag und den Fussweg von der
  Ausstiegshaltestelle zum Ziel.

* **Taktdichte**: Gesucht wird nicht zu einer Uhrzeit, sondern zu 24 Abfahrtszeiten im
  Fünfminutenraster zwischen 7 und 9 Uhr, gemittelt über alle. Wer alle sieben Minuten eine
  Verbindung hat, wartet im Schnitt kürzer als jemand mit Halbstundentakt. Dieser
  Unterschied landet in der Zahl.

Dass sich benachbarte Häuser leicht unterscheiden, kommt von den Fusswegen. Jedes Haus hat
eigene Distanzen zu den bis zu acht nächsten Haltestellen. Das ergibt einen stufenlosen
Verlauf statt Flächen mit Sprüngen an den Haltestellenkanten.

### Fusswege

Die kurzen Wege (Haus zur Haltestelle, Haltestelle zum Ziel, und für die Kulturvielfalt
Haus zum Kulturort) laufen über ein Fusswegnetz aus OpenStreetMap, rund 420'000 Knoten in
Zürich, alle begehbaren Wegtypen samt Treppen, Brücken und Unterführungen. Ab jedem Anker
(Haltestelle oder Kulturort) rechnet ein gekappter Dijkstra die Gehzeit zu allen Häusern im
Budget. Ein Haus hinter der Limmat nimmt so den Umweg über die Brücke statt einer geraden
Linie. Steigung zählt Segment für Segment, das Auf und Ab bremst mehr als ein über die
ganze Strecke gemittelter Wert. Gegenüber der früheren Näherung `Luftlinie · 1.35` werden
die Reisezeiten dadurch im Median rund anderthalb Minuten länger. Nur der lange „alles zu
Fuss"-Vergleichswert der ÖV-Kennzahl bleibt bei der Luftlinie.

### Steigung

Grundlage für die Fusswege ist Toblers Wanderfunktion, die die Steigung einrechnet. Die
Gehgeschwindigkeit fällt exponentiell mit der Steigung, am schnellsten geht es bei rund
fünf Prozent Gefälle statt in der Ebene:

```
v(s) = v0 · exp(-3.5 · |s + 0.05|) / exp(-3.5 · 0.05)
```

Der zweite Faktor normiert so, dass in der Ebene die konfigurierte Gehgeschwindigkeit
herauskommt. Toblers Originalkonstante von 6 km/h gilt für Wanderer im Gelände und wäre für
den Weg zur Tramhaltestelle zu hoch. Gerechnet wird der Mittelwert aus Hin- und Rückweg.
Ein Haus am Zürichberg stünde sonst zu gut da, weil der Weg zur Haltestelle hinunter
schnell geht.

Der Effekt ist deutlich: Häuser im Talboden (400–450 m ü. M.) kommen im Schnitt auf
29,0 Minuten, Häuser in Hanglage auf 600–650 m auf 42,1.

Das Höhenmodell stammt aus den frei nutzbaren Terrain-Kacheln von AWS, in denen die Höhe in
den Farbkanälen eines PNG steckt (`h = R·256 + G + B/256 − 32768`). Für die Schweiz kommen
die Daten aus dem swisstopo-Modell mit rund 25 m Rasterweite. Stichprobe gegen bekannte
Punkte: Zürich HB 411 m (real 408), Uetliberg 852 m (real 869). Für die Steigung entlang
eines Fussweges reicht das. Für einzelne Treppen nicht, und das ist auch nicht das Ziel.

## Kulturvielfalt

Für jede der zehn Sorten (Cafés, Bars und Clubs, Bühnen, Kinos, Museen und Galerien,
öffentliche Kunst, Bibliotheken, Badis, Quartiertreffs, Restaurants) wird gezählt, was von
einem Haus aus in Reichweite liegt, mit der Reisezeit abklingend gewichtet (`Σ exp(−t/τ)`).
Standardmässig zählen 15 Gehminuten, in der Karte lässt sich auf Velo (10 Minuten)
umschalten. Vorgabe sind alle zehn Sorten, jede einzelne lässt sich abwählen.

Das Velo-Modell ist wie beim Gehen steigungsabhängig, aber monoton:
`v(s) = min(6.5, 4.4 · exp(−10·s))` m/s. Bergauf ist das Tempo stark gebremst, bergab bis zu
einem Stadttempo-Deckel höher. Gemittelt wird über Hin- und Rückweg.

Rang und Farbe kommen nicht aus der Summe der Sorten, sondern aus der **Summe der Wurzeln**:

```
vielfalt(Haus) = Σ_Sorte √( index_Sorte )
```

Die Wurzel bremst jede einzelne Sorte. Die zwölfte Bar zählt kaum noch, das erste Museum
viel. Ein Haus mit einem Angebot aus jeder Sorte schlägt eines mit dreissig Cafés und sonst
nichts. So misst die Karte Vielfalt statt Dichte, und die Quartierzentren heben sich vom
Zentrum ab, statt in einem Verlauf unterzugehen. Angezeigt wird weiterhin die blosse Anzahl
Orte, weil man sie unmittelbar versteht.

## Warum das in Sekunden statt Tagen rechnet

Der naive Weg wäre, für jedes Gebäudepaar eine Verbindung abzufragen. Bei 47'085 Häusern
sind das 2,2 Milliarden Paare. Mit einer Routing-API pro Anfrage ist das undenkbar, und bei
den Preisen kommerzieller Distanzmatrizen nicht bezahlbar.

Drei Entscheidungen bringen das auf sieben Sekunden:

1. **Eigener Router statt API.** RAPTOR arbeitet direkt auf dem GTFS-Fahrplan, rundenweise
   statt mit Prioritätswarteschlange. Ein Lauf über das Zürcher Netz (1'893 Haltestellen,
   30'583 Fahrten) dauert rund 3 Millisekunden und liefert die Ankunftszeit an *allen*
   Haltestellen gleichzeitig, nicht nur an einer.
2. **Die Matrix hängt an den Haltestellen, nicht an den Häusern.** Gerechnet wird
   `haltestelle × zielzelle`, 564 × 830 statt 47'085 × 47'085. Das sind 13'536
   Routing-Läufe (564 Starthaltestellen × 24 Abfahrtszeiten), nicht Milliarden.
3. **Häuser kommen erst danach dazu.** Jedes Haus erbt die Zeiten seiner
   Zustiegshaltestellen und addiert nur seinen eigenen Fussweg. Das ist eine
   Minimumbildung über typisierte Arrays, kein Routing mehr.

Gesamtlaufzeit auf einem Laptop: GTFS-Aufbereitung 17 Sekunden (dabei werden 28,8 Millionen
Zeilen `stop_times.txt` gelesen), Reisezeitmatrix 7 Sekunden, Gebäudewerte 1 Sekunde.

## Datenquellen

Alles offen und kostenlos, nichts davon braucht einen API-Schlüssel.

| Was | Quelle | Umfang |
| --- | --- | --- |
| Fahrplan | [opentransportdata.swiss](https://opentransportdata.swiss), GTFS Fahrplanjahr 2026 | 197 MB gepackt, 3,2 GB entpackt |
| Gebäudegrundrisse, Adressen, Strassen, Gewässer, Ortsnamen | OpenStreetMap über [overpass.osm.ch](https://overpass.osm.ch) | 47'099 Gebäude, 57'507 Adressen |
| Stadtgrenze | OpenStreetMap, Relation `admin_level=8` | |

Zur Overpass-Instanz: `overpass-api.de` antwortet auf Gebäudeabfragen dieser Grösse
regelmässig mit „server too busy". Die Schweizer Instanz hält nur Schweizer Daten und
liefert dieselbe Abfrage in unter einer Sekunde.

Google Maps wäre für diesen Zweck der falsche Weg. Die Distance-Matrix-API rechnet pro
Element ab, und schon eine grob vereinfachte Variante läge im sechsstelligen Frankenbereich,
bei Daten, die als GTFS ohnehin frei verfügbar sind.

## Genauigkeit

Stichprobe gegen den echten Fahrplan (`pnpm verify`, Abfahrt 8 Uhr):

```
  8 min   Zürich HB          →  Zürich Oerlikon
  2 min   Zürich HB          →  Zürich Stadelhofen
 11 min   Zürich HB          →  Zürich Flughafen
 18 min   Zürich, Bellevue   →  Zürich, Bucheggplatz
 17 min   Zürich, Paradeplatz→  Zürich, Milchbuck
 21 min   Zürich Altstetten  →  Zürich Tiefenbrunnen
 33 min   Zürich, Klusplatz  →  Zürich, Albisgütli
```

Bewusste Vereinfachungen:

* Die kurzen Fusswege (zum Kulturort, zur Haltestelle, von der Haltestelle ans Ziel) laufen
  über das OSM-Fusswegnetz mit Brücken und Treppen. Das Velonetz lässt nur die Treppen weg,
  Radwege und Einbahnen sind nicht fein modelliert. Der lange „alles zu Fuss"-Vergleichswert
  der ÖV-Kennzahl bleibt Luftlinie mal 1.35.
* Perrons einer Haltestelle sind zu einem Knoten zusammengefasst. Der Umstieg innerhalb des
  Hauptbahnhofs ist damit etwas zu günstig, der Umsteigezuschlag von zwei Minuten federt das
  teilweise ab.
* Gerechnet wird ein Dienstagmorgen. Abend-, Nacht- und Wochenendfahrplan sehen anders aus.
* Verspätungen und Anschlussbrüche kommen nicht vor, es ist der Sollfahrplan.

## Bedienung

* **Rang** spreizt die Unterschiede über die ganze Stadt und macht auch kleine Abstände
  sichtbar. **Minuten** legt eine feste Skala von 20 bis 50 Minuten an, damit Zahlen
  zwischen Ansichten vergleichbar bleiben.
* Über ein Haus fahren zeigt Adresse, Gebäudename und Wert. Ein Klick hält die Karte fest.
* **Bestplatzierte hervorheben** blendet die vordersten Ränge rot ein, kräftig bei Rang 1,
  ausbleichend bis zum eingestellten Ende. Der Regler startet bei Top 1000 und lässt sich
  bis auf „aus" zurückdrehen. Der Verlauf spannt sich über genau den gewählten Bereich, bei
  „Top 500" also von Rang 1 bis 500. Gezeichnet wird als Grundriss beim Hineinzoomen und als
  Punkt auf Stadtansicht, wo ein einzelnes Haus kleiner als ein Pixel wäre. Der Regler läuft
  logarithmisch über alle 47'099 Ränge, bei linearer Teilung müsste er 174 Ränge pro Pixel
  abdecken.
* Die beiden Enden der Rangliste sind dauerhaft eingezeichnet und wechseln mit der Kennzahl.
  Beim ÖV ist Rang 1 das **Hotel Schweizerhof an der Bahnhofstrasse 93** mit 20,5 Minuten,
  direkt gegenüber dem Hauptbahnhof. Das Schlusslicht heisst **Säntisblick** und steht am
  Uetlibergrand, 86,3 Minuten, ohne Haltestelle im Umkreis von 800 Metern.
* **Haltestellen** beziehungsweise **Kulturorte** blendet die zugrunde liegenden Punkte ein,
  **Dunkel** dreht die Karte um.

## Aufbau

```
pipeline/
  config.ts              die stadtunabhängigen Parameter an einer Stelle
  staedte.ts             Bounding-Box, Projektion und verify-Paare je Stadt
  lib/csv.ts             streamender CSV-Leser für die 2,5-GB-Fahrplandatei
  lib/geo.ts             lokale Projektion, Punkt-in-Polygon
  lib/raptor.ts          der Router
  01-fetch-osm.ts        OpenStreetMap über Overpass, mit Zwischenspeicher
  01b-fetch-dem.ts       Höhenkacheln von AWS
  02-build-network.ts    GTFS -> Haltestellen, Linienmuster, Fusswege
  03-build-targets.ts    Gebäude, Adressen, Zielraster, Kartengrundlage
  04-compute-scores.ts   Reisezeitmatrix und Gebäudewerte
  verify.ts              Stichprobe gegen bekannte Verbindungen
app/
  page.tsx               Route /, lädt die Zürcher Kennzahlen
  basel/, bern/          Routen /basel und /bern
  methode/               Route /methode mit Text, Formeln, Open Source, Kontakt
  karte.tsx              MapLibre, Ebenen, Bedienfeld
  suche.tsx              Adresssuche im Browser
  staedte.ts             Name, Route, Startsicht je Stadt
  meta.ts, site.ts, seo.ts   geteilte Metadaten und SEO
  besucher-zaehler.tsx   GoatCounter-Einbindung
  og/                    Vorschaubilder je Stadt, beim Bauen gerendert
scripts/                 MapLibre-Worker und Schriftglyphen ins public-Verzeichnis
analytics/               Besuche pro Tag, siehe analytics/README.md
```

Jede Stadt liest ihre Kennzahl `STADT` aus der Umgebung (`STADT=basel node …`), schreibt
nach `data/derived/<stadt>/` und `public/data/<stadt>/` und teilt sich mit den anderen nur
den Fahrplan `data/raw/gtfs_ch.zip` und die Höhenkacheln `data/raw/dem/`. Eine neue Stadt
braucht einen Eintrag in `pipeline/staedte.ts` und `app/staedte.ts` plus eine
`app/<stadt>/page.tsx`.

## Loslegen

```bash
pnpm install
pnpm daten        # nur Zürich, lädt rund 330 MB und rechnet alles durch
pnpm daten:alle   # Zürich, Basel und Bern nacheinander
pnpm dev
```

`pnpm daten:basel` und `pnpm daten:bern` rechnen je eine Stadt. Basel und Bern sind
kompakt, ihr OSM-Anteil ist klein, und der Fahrplan liegt nach dem ersten Lauf schon da.
Beide zusammen brauchen ein paar Minuten. Einzelne Schritte gehen mit
`STADT=basel pnpm daten:osm` und so weiter. Die Rohdaten unter `data/raw/` werden nicht neu
geladen, solange sie da sind. Wer einen neuen Fahrplan will, löscht `data/raw/gtfs_ch.zip`.

Der Analysetag, das Abfahrtsfenster, die Rasterweite, das Gehminuten-Budget für die Kultur
und die Fusswegparameter stehen in `pipeline/config.ts`. Alles Stadtspezifische steht in
`pipeline/staedte.ts`: Bounding-Box, Projektionsmittelpunkt und die Haltestellen für
`pnpm verify`.

## Ins Netz stellen

Die Seite hat keinen Serveranteil. Alle Daten liegen als Dateien in `public/`, die vier
Routen (`/`, `/basel`, `/bern`, `/methode`) werden beim Bauen vorgerendert. `pnpm export`
schreibt einen Ordner `out/` mit reinen statischen Dateien, den jeder Gratis-Hoster
ausliefert. Mit allen drei Städten sind das gegen 65 MB, das meiste davon die
Gebäudegrundrisse.

```bash
pnpm export
```

Drei Wege, vom bequemsten zum dauerhaftesten:

* **Netlify Drop**: [app.netlify.com/drop](https://app.netlify.com/drop) öffnen und den
  Ordner `out` ins Fenster ziehen. Ohne Konto, in ein paar Sekunden eine Adresse zum
  Weitergeben.
* **Cloudflare Pages**: `npx wrangler pages deploy out --project-name zueri-karte`.
  Kostenlos ohne Bandbreitenlimite, was bei 15 MB Gebäudedaten pro Aufruf angenehm ist.
  Ergibt `zueri-karte.pages.dev`.
* **Vercel**: `npx vercel --prod` im Projektordner. Erkennt Next.js von selbst, dafür
  braucht es kein `pnpm export`.

Eine eigene Domain hängt man bei allen dreien in den Projekteinstellungen an. Für GitHub
Pages muss zusätzlich `basePath` in `next.config.ts` auf den Repository-Namen zeigen, sonst
finden die Seiten ihre Dateien nicht.

## Besucherzahlen

Wie viele Leute pro Tag da waren, zählt ein cookieloses Script von
[GoatCounter](https://www.goatcounter.com), ohne eigene Datenbank und ohne Consent-Banner.
Die GitHub-Action `besucher-zahlen.yml` holt die Tageszahlen einmal täglich über die API
und committet sie als `analytics/besucher.csv` und `analytics/besucher.json` auf den Zweig
`besucherzahlen`. Auf `main` liegen die beiden Dateien nicht, sonst käme dort jeden Tag ein
Bot-Commit an. Einrichtung und was die Zahl genau misst, steht in
[`analytics/README.md`](analytics/README.md).

## Lizenz

Medien, Redaktionen und alle anderen dürfen die Karte, Screenshots davon und die
Zahlen verwenden. Als Quellenangabe reicht angebunden.ch.

Der Code steht unter der MIT-Lizenz (`LICENSE`).

Die abgeleiteten Kartendaten unter `public/data/` stammen aus OpenStreetMap und stehen
unter der Open Database License (ODbL). Wer sie weiterverwendet, nennt OpenStreetMap und
stellt abgeleitete Datenbanken wieder unter die ODbL. Der Fahrplan kommt von
opentransportdata.swiss, die Höhen von swisstopo. Beide sind offen nutzbar mit
Quellenangabe. Die Rohdaten liegen nicht im Repository, die Pipeline lädt sie.
