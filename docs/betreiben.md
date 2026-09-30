# Selbst betreiben und einbinden

angebunden ist eine statische Website. Die Pipeline rechnet alles vorher aus und legt es als
Dateien unter `public/data/` ab, das Velorouting läuft im Browser. Wer die Seite selbst
betreiben will, braucht deshalb nur einen Webserver, der Dateien ausliefert. Eine Datenbank
braucht einzig das Konto im Velonavi. Es ist freiwillig und weiter unten beschrieben.

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
| `*.supabase.co` | Konto im Velonavi, nur wenn eingerichtet | `app/velonavi/konto.ts` |

Schriften, MapLibre und alle Daten liefert die Seite selbst aus. Der Service Worker
`public/velonavi-sw.js` hält die Kartenbilder der Stadt im Browser, weil der WMS keine
Cache-Header mitschickt.

## Konto im Velonavi

Mit einem Konto zeichnet der Velonavi Fahrten auf, wertet sie aus und passt Fahrzeiten und
Ampelwartezeiten an die Messungen an. Anmeldung und Ablage übernimmt ein
[Supabase](https://supabase.com)-Projekt. Der Browser spricht direkt mit Supabase, die Seite
bleibt statisch und `pnpm export` funktioniert wie zuvor. Ohne die beiden Variablen unten
erscheint im Velonavi kein Kontobereich.

1. Bei Supabase ein Projekt anlegen. Für Nutzerinnen und Nutzer in der Schweiz liegt die
   Region Zürich (`eu-central-2`) am nächsten. Der Text unter «Was gespeichert wird» in
   `app/methode/page.tsx` nennt Zürich als Speicherort und ist bei einer anderen Region
   anzupassen.
2. Die Tabellen legt der Build an: `scripts/datenbank.mjs` spielt bei jedem Build für die
   Produktion auf Vercel die Dateien aus `supabase/migrations/` ein, die noch fehlen, und
   vermerkt sie in `supabase_migrations.schema_migrations` (wie `supabase db push`). Die Adresse
   der Datenbank liefert die Supabase-Integration von Vercel (`POSTGRES_URL_NON_POOLING`, auch mit
   Präfix wie `STORAGE_`), oder man setzt `SUPABASE_DB_URL` selbst. Ohne Vercel übernimmt das der
   Workflow `.github/workflows/datenbank.yml` mit dem Secret `SUPABASE_DB_URL`; im Dashboard
   unter «Connect» die Adresse «Session pooler» nehmen, die direkte erreicht GitHub nur über
   IPv6 nicht. Von Hand: `SUPABASE_DB_URL=… pnpm datenbank`. Die Migrationen sind wiederholbar
   geschrieben (`if not exists`, `drop policy if exists`), eine früher von Hand im SQL-Editor
   eingerichtete Datenbank nimmt sie ohne Fehler. Neue Migrationen bitte ebenso schreiben. Sie
   schalten Row Level Security ein, jedes Konto sieht nur die eigenen Fahrten.
3. `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` setzen, lokal in
   `.env.local` und beim Hoster, danach neu bauen. Beide Werte sind öffentlich. Der geheime
   Schlüssel (`service_role`, `sb_secret_…`) gehört nicht in die Seite. Wer das Projekt über
   die Supabase-Integration von Vercel anlegt, muss nichts setzen: Die Seite liest auch deren
   Namen (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, mit oder ohne Präfix `STORAGE`).
4. Im Dashboard unter Authentication, URL Configuration die eigene Adresse eintragen: als
   Site URL `https://deine-domain`, als Redirect URLs dieselbe Adresse und für die Entwicklung
   `http://localhost:3000`. Der Velonavi liegt auf der Startseite, die Anmeldung kehrt dorthin zurück.
5. Für die Anmeldung mit Google unter Authentication, Providers Google einschalten. Client-ID
   und Secret stammen aus einem OAuth-Client in der Google Cloud Console, dessen Redirect-URI
   `https://<projekt>.supabase.co/auth/v1/callback` lautet. Der Knopf erscheint im Velonavi
   von selbst, sobald der Anbieter eingeschaltet ist. Dasselbe gilt für Apple, GitHub und
   Microsoft.
6. Für die Anmeldung per E-Mail einen eigenen SMTP-Server eintragen. Der eingebaute Versand
   von Supabase schickt nur wenige Mails pro Stunde und nur an Adressen des Projektteams.

Aufgezeichnet wird mit dem Standortdienst des Browsers. Er liefert nur, solange die Seite im
Vordergrund und der Bildschirm an ist. Wer das Handy in der Tasche hat, zeichnet mit einer
anderen App auf und liest die GPX-Datei im Velonavi ein.

Ohne Konto bleiben die Spuren auf dem Gerät. Die Tabellen `velonavi_messungen_*` nehmen die Messwerte
auf, die Nutzer freiwillig beitragen (`app/velonavi/gemeinschaft.ts`). Einfügen darf jeder mit dem
öffentlichen Schlüssel, lesen niemand, die Funktion `velonavi_gemeinschaft()` gibt Durchschnitte erst
ab fünf Messungen heraus. Sie brauchen kein Login.

Die Tabelle `velonavi_einstellungen` hält je Konto die Gewichte für «Komfort», ob Schieben erlaubt
ist und die Darstellung, damit sie auf jedem Gerät für künftige Routen gelten. Lokal bleiben sie ohnehin
erhalten, das Konto gleicht nur zwischen Geräten ab; die jüngere Fassung gewinnt.

Gespeichert wird die rohe Spur. Welche Kanten befahren wurden und was daraus gelernt wird,
rechnet `app/velonavi/fahrten.ts` bei jedem Laden neu, weil sich die Nummern der Kanten mit
jeder neuen Fassung des Velonetzes ändern.

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
