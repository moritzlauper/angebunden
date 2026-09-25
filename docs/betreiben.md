# Selbst betreiben und einbinden

angebunden ist eine statische Website. Es gibt keinen Server, keine Datenbank und keine
Konten. Die Pipeline rechnet alles vorher aus und legt es als Dateien unter `public/data/`
ab, das Velorouting läuft im Browser. Wer die Seite selbst betreiben will, braucht deshalb
nur einen Webserver, der Dateien ausliefert.

## Eigenes Deployment

```bash
pnpm install
cp .env.example .env.local   # Domain und Besucherzählung eintragen
pnpm export                  # schreibt den Ordner out/
```

`out/` ist rund 100 MB gross, fast alles davon Daten unter `data/`. Der Ordner läuft auf jedem Webserver
(nginx, Apache, ein S3-Bucket, Netlify, Cloudflare Pages). Auf Vercel reicht
`npx vercel --prod` ohne `pnpm export`.

Zwei Bedingungen gelten:

1. Die Seite muss auf der obersten Ebene einer Domain liegen, also
   `https://velo.stadt-zuerich.ch/` und nicht `https://www.stadt-zuerich.ch/velo/`. Datenpfade
   (`/data/zuerich/…`) und der Service Worker (`/velonavi-sw.js`) sind absolut. Eine
   Subdomain ist die einfachste Lösung.
2. `NEXT_PUBLIC_SITE_URL` muss auf diese Domain zeigen. Sonst verweisen canonical-Links,
   Sitemap und Vorschaubilder weiter auf angebunden.ch.

Die Umgebungsvariablen sind in [`.env.example`](../.env.example) beschrieben. Ohne
`NEXT_PUBLIC_GOATCOUNTER` zählt ein fremdes Deployment keine Besuche. Wer eigene Zahlen will,
legt ein Konto bei [GoatCounter](https://www.goatcounter.com) an oder ersetzt
`app/besucher-zaehler.tsx` durch das eigene Webanalyse-Werkzeug.

## Externe Dienste

Die Seite lädt zur Laufzeit von diesen Adressen:

| Dienst | Wozu | Wo im Code |
| --- | --- | --- |
| `www.ogd.stadt-zuerich.ch/wms/geoportal/` | Hintergrundkarte (WMS der Stadt Zürich) | `app/karte.tsx`, `app/velonavi/velonavi.tsx` |
| `gc.zgo.at`, `*.goatcounter.com` | Besucherzählung, nur wenn eingerichtet | `app/besucher-zaehler.tsx` |

Schriften, MapLibre und alle Daten liefert die Seite selbst aus. Der Service Worker
`public/velonavi-sw.js` hält die Kartenbilder der Stadt im Browser, weil der WMS keine
Cache-Header mitschickt.

## Einbetten

Die Karten lassen sich per `<iframe>` in eine andere Seite einbinden:

```html
<iframe src="https://angebunden.ch/velonavi" style="width:100%;height:640px;border:0" loading="lazy"
        title="Velonavi Zürich"></iframe>
```

Der Zustand steht im URL-Fragment, ein Link zeigt also genau eine Ansicht. Beim Velonavi
sind das `#von=lon,lat&nach=lon,lat`, optional mit `vn` und `nn` für die angezeigten Namen
und `wahl=schnell`. Bei der Erreichbarkeitskarte kopiert man den Link nach einem Klick auf
ein Haus aus der Adresszeile.

Für eine Einbindung in eine bestehende Next.js-Anwendung sind `app/karte.tsx` und
`app/velonavi/velonavi.tsx` die Einstiegspunkte. Beide sind Client-Komponenten ohne
Serveranteil, sie brauchen nur die Dateien aus `public/data/` und `maplibre-gl`.

## Eigenes Erscheinungsbild

| Was | Wo |
| --- | --- |
| Name, Slogan, Domain | `app/site.ts` |
| Wortmarke und Signet | `app/marke.tsx` |
| Vorschaubilder für geteilte Links | `app/og/vorschaubild.tsx` |
| Methodentext, Kontakt, Impressum | `app/methode/page.tsx` |
| Städte im Umschalter | `app/staedte.ts` |

Wer nur Zürich zeigen will, entfernt Basel und Bern aus `STADT_LISTE` in `app/staedte.ts`
und löscht `app/basel/` und `app/bern/`.

## Daten aktuell halten

| Daten | Wie oft | Wie |
| --- | --- | --- |
| Velonetz (Stadt Zürich und OSM) | monatlich | GitHub-Action `velodaten.yml`, automatisch am 3. des Monats |
| Velonetz-Korrekturen | bei Bedarf | [Daten anpassen](daten-anpassen.md) |
| ÖV-Fahrplan und Kulturorte | einmal pro Fahrplanjahr, im Dezember | von Hand, siehe unten |

Beim Fahrplanwechsel `data/raw/gtfs_ch.zip` löschen und in `pipeline/config.ts` einen
`serviceDate` wählen, der im neuen Fahrplanjahr liegt (ein gewöhnlicher Dienstag ohne
Feiertag). Liegt das Datum ausserhalb des Fahrplans, findet der Router keine Fahrten. Danach
`pnpm daten:alle`, `pnpm verify` und die neuen Dateien unter `public/data/` committen.
