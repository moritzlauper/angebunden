# Besucherzahlen

Wie viele Leute pro Tag auf der Seite waren – ohne eigene Datenbank.

## Woher die Zahlen kommen

Ein Script von [GoatCounter](https://www.goatcounter.com) auf jeder Seite
(`app/besucher-zaehler.tsx`) meldet jeden Aufruf. GoatCounter zählt cookielos: die
Besucher-Kennung ist ein Hash aus IP, Browser und einem täglich wechselnden Salt,
den GoatCounter nur im Arbeitsspeicher hält. GoatCounter speichert nichts
Personenbezogenes, ein Consent-Banner braucht es nicht.

Die GitHub-Action `.github/workflows/besucher-zahlen.yml` läuft täglich um 04:17 UTC,
holt über die GoatCounter-API die Zahlen der abgeschlossenen Tage und committet sie
hierher:

* `besucher.csv` – eine Zeile pro Tag, `datum,besucher`. Zum schnellen Reinschauen.
* `besucher.json` – dieselben Zahlen als `{ "tage": { "2026-09-06": 42 } }`, plus
  Zeitstempel des letzten Laufs.

`node scripts/besucher-holen.mjs` macht dasselbe von Hand (`GOATCOUNTER_TOKEN`
gesetzt vorausgesetzt).

## Was «besucher» genau heisst

Eine Sitzung hält acht Stunden und wird pro Seite einmal gezählt. Wer erst die
Karte und dann `/methode` ansieht, zählt an dem Tag also zweimal; wer morgens und
abends kommt, ebenfalls. Für «wie viele verschiedene Leute waren heute da» ist die
Zahl damit eine Näherung nach oben, kein exakter Wert. Sie deckt sich mit dem
Balkendiagramm im GoatCounter-Dashboard.

## Einrichten

1. Auf [goatcounter.com](https://www.goatcounter.com) ein Konto mit dem Code
   `angebunden` anlegen (ein anderer Code geht auch, dann die Variable
   `GOATCOUNTER_CODE` im Repo und `NEXT_PUBLIC_GOATCOUNTER` beim Deploy setzen).
2. In den GoatCounter-Einstellungen die Zeitzone auf `Europe/Zurich` stellen, sonst
   laufen die Tagesgrenzen in UTC.
3. Unter *Menü → API* ein Token mit dem Recht «Read statistics» erzeugen und im
   GitHub-Repo als Secret `GOATCOUNTER_TOKEN` hinterlegen
   (*Settings → Secrets and variables → Actions*).
4. Deployen, damit das Zähl-Script live ist. Danach läuft die Action von selbst;
   der erste Lauf lässt sich unter *Actions → Besucherzahlen → Run workflow*
   auslösen.

Die eigenen Besuche hält man aus der Statistik, indem man einmal
`https://angebunden.ch/#toggle-goatcounter` aufruft – das setzt ein Flag im
Browser.
