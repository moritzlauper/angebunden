import Link from 'next/link'
import type { Metadata } from 'next'
import { ladeMeta } from '../meta'
import { Wortmarke } from '../marke'

export const metadata: Metadata = {
  title: 'Wie das gerechnet ist',
  description:
    'Die Formeln, Parameter und Datenquellen hinter der Erreichbarkeitskarte: RAPTOR auf dem GTFS-Fahrplan, steigungsabhängige Fuss- und Velowege, Kulturvielfalt als wurzel-gewichteter Index.',
  alternates: { canonical: '/methode' },
  openGraph: {
    type: 'article',
    title: 'Wie das gerechnet ist · angebunden',
    description:
      'Die Formeln, Parameter und Datenquellen hinter der Erreichbarkeitskarte.',
    url: '/methode',
  },
}

// Auf der Karte ist die Pinch-Geste für MapLibre gesperrt. Eine Textseite soll
// sich normal zoomen lassen, deshalb hier die Sperre aus dem Layout aufheben.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover' as const,
}

/** Wochentag und Datum aus «JJJJMMTT», gleich wie in der Karte. */
function datum(yyyymmdd: string) {
  const t = yyyymmdd.slice(6, 8)
  const m = yyyymmdd.slice(4, 6)
  const j = yyyymmdd.slice(0, 4)
  const tage = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
  const wt = tage[new Date(+j, +m - 1, +t).getDay()]
  return `${wt}, ${t}.${m}.${j}`
}

/** Tausendertrennung mit Hochkomma, wie im Rest der Seite. */
function nf(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '’')
}

function Formel({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-black/[0.035] px-4 py-3.5 text-[12.5px] leading-relaxed dark:border-white/10 dark:bg-white/[0.04]">
      <code>{children}</code>
    </pre>
  )
}

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mt-14 scroll-mt-8 text-[17px] font-semibold tracking-tight">
      {children}
    </h2>
  )
}

/** Link im Fliesstext, gleicher Unterstrich wie in der Datenquellen-Tabelle. */
function Aus({ href, children }: { href: string; children: React.ReactNode }) {
  const extern = href.startsWith('http')
  return (
    <a
      href={href}
      {...(extern ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="underline underline-offset-2 decoration-black/25 hover:decoration-black/60 dark:decoration-white/25 dark:hover:decoration-white/60"
    >
      {children}
    </a>
  )
}

export default async function Methode() {
  // Die Methodenseite bleibt bei Zürich: die Formeln sind für alle Städte gleich,
  // die Zahlen im Text stehen exemplarisch.
  const meta = await ladeMeta('zuerich')
  const kunst = meta.kultur.proArt[meta.kultur.arten.indexOf('kunst')]
  const restaurants = meta.kultur.proArt[meta.kultur.arten.indexOf('restaurant')]
  const laeufe = meta.originStations * meta.departures
  const paare = meta.buildings * meta.buildings

  return (
    <div className="min-h-dvh bg-[#f7f7f5] text-[#18181b] dark:bg-[#0b0b0c] dark:text-[#f4f4f5]">
      <main className="mx-auto max-w-[44rem] px-5 py-12 sm:px-8 sm:py-16 text-[15px] leading-relaxed">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label="angebunden · zur Karte" className="hover:opacity-70">
            <Wortmarke size={16} />
          </Link>
          <Link
            href="/"
            className="text-[13px] text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Zurück zur Karte
          </Link>
        </div>

        <p className="mt-8">
          angebunden färbt jedes Haus in Zürich, Basel und Bern nach zwei Kennzahlen ein: Wie gut
          es an Tram, Bus und Bahn angebunden ist, und wie breit das Kulturangebot in Geh- oder
          Veloweite liegt.
        </p>

        <p className="mt-4">
          Angefangen hat es als Idee an einem Samstagabend, die mein Mitbewohner Leo und ich dann
          gleich durchgeplant haben. <Aus href="#kontakt">Kontakt</Aus>.
        </p>

        <h1 className="mt-10 text-[23px] font-semibold tracking-tight">Wie das gerechnet ist</h1>

        <p className="mt-4">
          Alle Zahlen kommen aus offenen Daten und einem Rechengang, der auf einem Laptop in
          wenigen Sekunden durchläuft. Hier steht, was dabei passiert.
        </p>

        <p className="mt-4">
          Das ganze Projekt ist <Aus href="#open-source">Open Source</Aus>.
        </p>

        <H2>Erreichbarkeit</H2>
        <p className="mt-4">
          Die Kennzahl ist die mittlere Reisezeit von diesem Haus zu einer beliebigen Adresse der
          Stadt, Türe zu Türe. Man zieht gedanklich eine zufällige Zürcher Adresse und fragt, wie
          lange man mit Tram, Bus und S-Bahn im Schnitt dorthin braucht. Für das
          bestangeschlossene Haus sind es {meta.minutes.best} Minuten, im
          Median {meta.minutes.median}, am Stadtrand über 45.
        </p>
        <p className="mt-4">
          Als Ziele dient nicht jede einzelne Adresse, sondern ein Raster aus 300-Meter-Zellen.{' '}
          {nf(meta.cells)} davon enthalten Adressen. Der Zielpunkt einer Zelle ist der Schwerpunkt
          ihrer {nf(meta.addresses)} Adressen, nicht die Zellmitte. Jede Zelle wiegt so schwer, wie
          viele Adressen in ihr liegen.
        </p>
        <Formel>{`score(Haus) =  Σ  w(Zelle) · t(Haus, Zelle)
              ────────────────────────────
                     Σ  w(Zelle)`}</Formel>
        <p className="mt-4">
          w ist die Anzahl Adressen in der Zelle, t die Reisezeit dorthin. Weil durch die Summe der
          Gewichte geteilt wird, bleibt der Wert eine Zeit und keine aufsummierte Grösse. 30 Minuten
          heisst: eine zufällig gezogene Adresse liegt im Schnitt 30 Fahrminuten weg. Der dicht
          bebaute Kreis 4 zieht den Schnitt stärker als der Wald am Uetliberg, wo kaum jemand
          wohnt.
        </p>
        <p className="mt-4">
          Für jede Zelle nimmt der Rechengang den schnelleren von zwei Wegen: zu Fuss direkt, oder
          zu Fuss zur Haltestelle, dann ÖV, dann zu Fuss zum Ziel.
        </p>
        <Formel>{`t(Haus, Zelle) = min( Fussweg direkt,
                      Fussweg zur Haltestelle + ÖV + Fussweg ans Ziel )`}</Formel>
        <p className="mt-4">
          Pro Haus kommen die acht nächsten Haltestellen infrage, bis 800 Meter Fussweg. Die
          ÖV-Zeit enthält Wartezeit, Fahrt und Umstiege. Jeder Umstieg kostet zwei Minuten
          Zuschlag, zusätzlich zur echten Wartezeit, und mehr als vier Umstiege probiert der Router
          nicht. Reisezeiten über 90 Minuten werden gekappt. Sonst würde eine einzelne kaum
          erreichbare Ecke den ganzen Schnitt eines Hauses verzerren.
        </p>
        <p className="mt-4">
          Eine feste Abfahrtszeit gibt es nicht. Der Rechengang nimmt {meta.departures} Abfahrten im
          Fünfminutentakt zwischen {meta.window} Uhr an einem{' '}
          {datum(meta.serviceDate).split(',')[0]} und mittelt über alle. So landet die Taktdichte in
          der Zahl: wer alle sieben Minuten eine Verbindung hat, wartet im Schnitt kürzer als jemand
          mit Halbstundentakt. Der Analysetag ist der {datum(meta.serviceDate)}, ein normaler
          Schultag.
        </p>

        <H2>Wege mit Steigung</H2>
        <p className="mt-4">
          Fusswege sind nicht flach gerechnet. Grundlage ist Toblers Wanderfunktion. Die
          Gehgeschwindigkeit fällt exponentiell mit der Steigung, am schnellsten geht es bei rund
          fünf Prozent Gefälle. Nicht in der Ebene.
        </p>
        <Formel>{`v(s) = v₀ · exp(−3,5 · |s + 0,05|) / exp(−3,5 · 0,05)`}</Formel>
        <p className="mt-4">
          v₀ ist 1,3 m/s, also 4,7 km/h in der Ebene. Der zweite Faktor normiert die Funktion
          auf genau diesen Wert. Toblers Originalkonstante von 6 km/h gilt für Wanderer im Gelände
          und wäre für den Weg zur Tramhaltestelle zu schnell.
        </p>
        <p className="mt-4">
          Gerechnet wird das Mittel aus Hin- und Rückweg. Ein Haus am Zürichberg stünde sonst zu
          gut da, weil der Weg zur Haltestelle hinunter schnell geht. Wer dort wohnt, geht beide
          Richtungen.
        </p>
        <Formel>{`Fusszeit = Σ_Segment ½ · ( d / v(s) + d / v(−s) )

d = Segmentlänge        s = Höhendifferenz / d`}</Formel>
        <p className="mt-4">
          Die kurzen Wege zum Kulturort, zur Haltestelle und von der Haltestelle ans Ziel laufen
          über das Fusswegnetz aus OpenStreetMap. Brücken, Treppen und Unterführungen zählen; ein
          Haus hinter dem Fluss nimmt den Umweg über die Brücke. Steigung wird Segment für Segment
          gerechnet, das Auf und Ab bremst mehr als ein Mittelwert. Nur der lange „alles zu
          Fuss"-Vergleichswert der ÖV-Kennzahl bleibt Luftlinie mal Umwegfaktor 1.35. Ihn zu
          routen brächte für eine Zahl, die der ÖV fast immer schlägt, wenig.
        </p>
        <p className="mt-4">
          Für die Kulturvielfalt zählen standardmässig 15 Gehminuten. Velo bleibt als Umschalter
          verfügbar und folgt demselben Muster mit einer anderen Kurve: Das Velotempo fällt
          monoton mit der Steigung, bergauf stark gebremst und bergab auf ein Stadttempo gedeckelt.
        </p>
        <Formel>{`v(s) = min( 6,5 ,  4,4 · exp(−10 · s) )      in m/s`}</Formel>
        <p className="mt-4">
          4,4 m/s sind rund 16 km/h in der Ebene, Stadtverkehr mit Halten. Fünf Prozent Steigung
          drücken das Tempo um etwa 40 Prozent; der Deckel bei 6,5 m/s (23 km/h) verhindert, dass
          eine lange Abfahrt die Zahl schönrechnet. Auch hier wird aus Hin- und Rückweg gemittelt.
        </p>
        <p className="mt-4">
          Die Höhen stammen aus den frei nutzbaren Terrain-Kacheln von AWS. Die Höhe steckt dort in
          den Farbkanälen eines PNG:
        </p>
        <Formel>{`h = R · 256 + G + B / 256 − 32768      (Meter über Meer)`}</Formel>
        <p className="mt-4">
          Für die Schweiz kommen die Daten aus dem swisstopo-Höhenmodell. Auf Zoomstufe 13 liegen
          die Rasterpunkte etwa 19 Meter auseinander. Das reicht, um zu wissen, ob ein Weg bergauf
          oder bergab führt. Für einzelne Treppen reicht es nicht, und das ist auch nicht das Ziel.
        </p>

        <H2>Kulturvielfalt</H2>
        <p className="mt-4">
          Die zweite Zahl misst, wie <em>vielfältig</em> das Kulturangebot in der Nähe ist.
          Grundlage sind {nf(meta.kultur.orte)} Orte aus OpenStreetMap in zehn Sorten: Cafés,
          Bars und Clubs, Bühnen, Kinos, Museen und Galerien, öffentliche Kunst, Bibliotheken, Badis,
          Quartiertreffs und Restaurants. Standardmässig zählt die Karte Orte in{' '}
          {meta.kultur.budgets.fuss} Gehminuten; in der Karte lässt sich auf{' '}
          {meta.kultur.budgets.velo} Velominuten umstellen.
        </p>
        <p className="mt-4">
          Vorgabe sind alle zehn Sorten. Abwählen lohnt sich bei den zahlreichsten, Restaurants
          und öffentliche Kunst: sonst misst die Karte in der Innenstadt vor allem deren Dichte.
          Welche Sorten zählen, stellt man in der Karte selbst ein.
        </p>
        <p className="mt-4">
          Angezeigt wird die blosse Anzahl, weil man sie sofort versteht. Sortiert und eingefärbt
          wird nach einem Index: je Sorte werden die erreichbaren Orte mit der Reisezeit abklingend
          gezählt, dann werden die Sorten nicht addiert, sondern mit der Wurzel zusammengefasst.
        </p>
        <Formel>{`n(Sorte)       =  Σ  exp(−t / τ)     über die Orte der Sorte mit t ≤ t_max

vielfalt(Haus) =  Σ  √( n(Sorte) )   über die gewählten Sorten`}</Formel>
        <p className="mt-4">
          Die Wurzel bremst jede einzelne Sorte: die zwölfte Bar zählt kaum noch, das erste Museum
          viel. Ein Haus mit einem Angebot aus jeder Sorte schlägt so eines mit dreissig Cafés und
          sonst nichts. Ohne diesen Kniff zählt am Ende, wovon es zufällig am meisten gibt. In
          Zürich sind das die {nf(restaurants)} Restaurants und die {nf(kunst)} Einträge «Öffentliche
          Kunst», und die Karte zeigt bloss noch, wie nah die Altstadt liegt. Mit der Wurzel
          treten die Quartierzentren hervor.
        </p>

        <H2>Warum das in Sekunden rechnet</H2>
        <p className="mt-4">
          Der naive Weg wäre, für jedes Häuserpaar eine Verbindung abzufragen. Bei{' '}
          {nf(meta.buildings)} Häusern sind das{' '}
          {(paare / 1e9).toFixed(1)} Milliarden Paare. Mit einer Routing-API ist
          das weder zeitlich noch preislich machbar. Drei Sachen bringen es auf wenige Sekunden.
        </p>
        <p className="mt-4">
          Erstens ein eigener Router statt einer API. RAPTOR arbeitet direkt auf dem Fahrplan,
          rundenweise nach Anzahl Umstiegen statt mit einer Prioritätswarteschlange. Ein Lauf über
          das Zürcher Netz mit {nf(meta.stations)} Haltestellen und {nf(meta.trips)} Fahrten pro Tag
          dauert wenige Millisekunden und liefert die Ankunftszeit an allen Haltestellen auf einmal.
        </p>
        <p className="mt-4">
          Zweitens hängt die Reisezeitmatrix an den Haltestellen, nicht an den Häusern. Gerechnet
          wird {nf(meta.originStations)} Starthaltestellen mal {nf(meta.cells)} Zielzellen, über{' '}
          {meta.departures} Abfahrtszeiten. Das sind rund {nf(Math.round(laeufe / 1000) * 1000)}{' '}
          Routing-Läufe statt Milliarden.
        </p>
        <p className="mt-4">
          Drittens erben die Häuser diese Zeiten. Jedes Haus nimmt die Werte seiner
          Zustiegshaltestellen und addiert nur den eigenen Fussweg. Das ist eine Minimumbildung über
          Zahlenreihen, kein Routing mehr.
        </p>

        <H2>Datenquellen</H2>
        <table className="mt-4 w-full border-collapse text-[14px]">
          <tbody>
            {[
              [
                'Fahrplan',
                'opentransportdata.swiss, GTFS Fahrplanjahr 2026',
                'https://opentransportdata.swiss',
              ],
              [
                'Gebäude, Adressen, Strassen, Fusswege, Gewässer, Kulturorte',
                'OpenStreetMap über overpass.osm.ch',
                'https://www.openstreetmap.org/copyright',
              ],
              [
                'Höhen',
                'AWS Terrain Tiles, für die Schweiz aus dem swisstopo-Höhenmodell',
                'https://registry.opendata.aws/terrain-tiles/',
              ],
            ].map(([was, quelle, url]) => (
              <tr key={was} className="border-t border-black/10 align-top dark:border-white/10">
                <th scope="row" className="py-2.5 pr-4 text-left font-medium">
                  {was}
                </th>
                <td className="py-2.5 text-zinc-600 dark:text-zinc-300">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 decoration-black/25 hover:decoration-black/60 dark:decoration-white/25 dark:hover:decoration-white/60"
                  >
                    {quelle}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4">
          Alles offen und kostenlos, nichts davon braucht einen API-Schlüssel. Die Google-Distance-Matrix-API
          rechnet pro Element ab und läge schon für eine grob vereinfachte Variante im sechsstelligen
          Frankenbereich, bei Daten, die als GTFS ohnehin frei verfügbar sind.
        </p>

        <H2>Was vereinfacht ist</H2>
        <ul className="mt-4 space-y-2">
          {[
            'Die kurzen Fuss- und Velowege laufen über das OSM-Wegnetz; das Velonetz lässt nur die Treppen weg, Radwege und Einbahnen sind nicht fein modelliert. Der lange „alles zu Fuss"-Vergleichswert bleibt Luftlinie mal 1,35.',
            'Die Perrons einer Haltestelle sind zu einem Knoten zusammengefasst. Der Umstieg im Hauptbahnhof fällt dadurch etwas zu günstig aus; der Zwei-Minuten-Zuschlag federt das teilweise ab.',
            'Gerechnet ist ein Dienstagmorgen. Abend, Nacht und Wochenende sehen anders aus.',
            'Es ist der Sollfahrplan. Verspätungen und verpasste Anschlüsse kommen nicht vor.',
          ].map((s) => (
            <li key={s} className="relative pl-4 before:absolute before:left-0 before:content-['–']">
              {s}
            </li>
          ))}
        </ul>

        <H2>Was gespeichert wird</H2>
        <p className="mt-4">
          Kein Konto, keine Cookies. Die Adresssuche rechnet im Browser, und welches Haus du dir
          ansiehst, bleibt dort. Es steht im Link hinter dem <code>#</code> und wird nie an einen
          Server geschickt.
        </p>
        <p className="mt-4">
          Eine Zahl wird doch gezählt: wie viele Leute pro Tag da sind. Das übernimmt{' '}
          <a
            href="https://www.goatcounter.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 decoration-black/25 hover:decoration-black/60 dark:decoration-white/25 dark:hover:decoration-white/60"
          >
            GoatCounter
          </a>
          , cookielos. Die Kennung ist ein täglich wechselnder Hash aus IP und Browser, den niemand
          dauerhaft speichert; kein Profil über mehrere Seiten, keine Weitergabe. Die Tageszahlen
          liegen offen auf GitHub im Zweig{' '}
          <Aus href="https://github.com/moritzlauper/angebunden/blob/besucherzahlen/analytics/besucher.csv">
            besucherzahlen
          </Aus>
          .
        </p>
        <p className="mt-4">
          Die Seite selbst ist ein Ordner statischer Dateien. Beim Hoster bleiben ausserdem die
          Zugriffslogs mit IP und Zeitpunkt, wie bei jeder Website.
        </p>

        <H2 id="open-source">Open Source</H2>
        <p className="mt-4">
          Der ganze Code liegt auf GitHub:{' '}
          <Aus href="https://github.com/moritzlauper/angebunden">
            github.com/moritzlauper/angebunden
          </Aus>
          .
        </p>
        <p className="mt-4">
          Rasterweite, Abfahrtsfenster, Geh- und Velotempo, Umsteigezuschlag: Alle Parameter stehen
          in einer einzigen Datei, <code>pipeline/config.ts</code>. Wer andere Annahmen für sinnvoll
          hält, ändert dort eine Zeile und lässt den Rechengang neu laufen.
        </p>
        <p className="mt-4">
          Medien, Redaktionen und alle anderen dürfen die Karte, Screenshots davon und die Zahlen
          verwenden. Als Quellenangabe reicht angebunden.ch.
        </p>
        <p className="mt-4">
          Der Code steht unter der MIT-Lizenz. Die Kartendaten unter <code>public/data/</code>{' '}
          stammen aus OpenStreetMap und bleiben unter der Open Database License: Wer sie
          weiterverwendet, nennt OpenStreetMap und stellt abgeleitete Datenbanken wieder unter die
          ODbL.
        </p>

        <p
          id="kontakt"
          className="mt-14 scroll-mt-8 border-t border-black/10 pt-6 text-zinc-600 dark:border-white/10 dark:text-zinc-300"
        >
          <strong className="font-semibold text-[#18181b] dark:text-[#f4f4f5]">Kontakt:</strong>{' '}
          Moritz Lauper, <Aus href="mailto:moritz.lauper@hispeed.ch">moritz.lauper@hispeed.ch</Aus>{' '}
          oder <Aus href="https://ch.linkedin.com/in/moritz-lauper">LinkedIn</Aus>.
        </p>
      </main>
    </div>
  )
}
