import Link from 'next/link'
import { SITE_NAME, SITE_URL, nf } from '../site'
import type { VeloMeta } from './router'

/**
 * Der crawlbare Teil des Velonavi. Die Karte und das Bedienfeld liegen in einer
 * Client-Komponente, die beim Vorrendern in der Mobilvariante landet und dort
 * weder Überschrift noch Fliesstext enthält. Google, WhatsApp und Screenreader
 * sähen also nur die Legende. Hier steht dasselbe in Worten, dazu die
 * JSON-LD-Auszeichnung und der Ausweg für Browser ohne JavaScript.
 *
 * `sr-only` blendet den Block optisch aus, lässt ihn aber im DOM und im
 * Accessibility-Baum. Die einzige `<h1>` der Seite steht hier; das Bedienfeld
 * im Velonavi führt seinen Titel deshalb als `<h2>`.
 */
export function SeoInhalt({ statistik }: { statistik: VeloMeta['statistik'] }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: `${SITE_NAME} · Velonavi Zürich`,
    url: `${SITE_URL}/velonavi`,
    applicationCategory: 'TravelApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript',
    inLanguage: 'de-CH',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CHF' },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    featureList: [
      'Veloroute zwischen zwei Adressen in Zürich',
      'Variante Schnell und Variante Komfort',
      'Zwischenziele',
      'Route als GPX herunterladen',
      'Velonetz nach Fahrgefühl eingefärbt',
    ],
    description:
      `Veloroutenplaner für Zürich auf ${nf(statistik.veloKm)} km Velonetz. Rechnet Verkehr, ` +
      `Velostreifen, Tramgleise, Belag, Steigung und die Wartezeit an Lichtsignalen mit.`,
  }

  return (
    <>
      <section className="sr-only">
        <h1>Velonavi Zürich: Veloroutenplaner nach Fahrgefühl</h1>
        <p>
          Der Velonavi sucht die Veloroute zwischen zwei Adressen in Zürich und rechnet dabei mit,
          wie sich eine Strecke fährt. Grundlage sind {nf(statistik.veloKm)} km Fuss- und Velowegnetz
          der Stadt. Jedes Wegstück trägt das signalisierte Tempo, die Strassenklasse, den Belag,
          Tramgleise in der Fahrbahn, die Höhenmeter und die Zugehörigkeit zum Vorzugs- oder
          Hauptnetz der städtischen Velonetzplanung. Dazu kommen {nf(statistik.ampelKnoten)}{' '}
          Kreuzungen mit Lichtsignal und {nf(statistik.verbote)} Abbiegeverbote.
        </p>
        <p>
          Gerechnet werden immer zwei Varianten. «Schnell» achtet fast nur auf die Fahrzeit.
          «Komfort» meidet Verkehr, Tramgleise, Kopfsteinpflaster und Steigungen und nimmt dafür
          rund 7% mehr Fahrzeit in Kauf. Die Route wird nach Fahrgefühl eingefärbt, von einem
          abgetrennten Veloweg bis zum Mischverkehr auf Tempo 50. Zwischenziele lassen sich setzen,
          die fertige Route als GPX herunterladen oder als Link teilen.
        </p>
        <p>
          Gesucht wird im Browser, Start und Ziel verlassen das Gerät nicht. An Lichtsignalen zählt
          die Wartezeit danach, ob man geradeaus über die Kreuzung muss oder nur abbiegt; Poller,
          Tore und Drängelgitter kosten Sekunden.
        </p>
        <p>
          <Link href="/methode#velonavi">Wie das gerechnet ist</Link>: die Formeln, Parameter und
          Datenquellen hinter dem Velonavi.
        </p>
      </section>

      <noscript>
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            background: '#f7f7f5',
            color: '#18181b',
          }}
        >
          <div style={{ maxWidth: '32rem', lineHeight: 1.6 }}>
            <p style={{ fontSize: '1.3rem', fontWeight: 600, letterSpacing: '-0.01em' }}>
              angebunden · Velonavi Zürich
            </p>
            <p style={{ marginTop: '0.75rem' }}>
              Der Velonavi sucht die Veloroute zwischen zwei Adressen in Zürich und rechnet Verkehr,
              Tramgleise, Belag, Steigung und die Wartezeit an Lichtsignalen mit. Die Route entsteht
              im Browser, dafür braucht er JavaScript.
            </p>
            <p style={{ marginTop: '0.75rem' }}>
              <a href="/methode#velonavi" style={{ color: '#2563eb' }}>
                Wie das gerechnet ist
              </a>{' '}
              steht auch ohne Karte zum Nachlesen bereit.
            </p>
          </div>
        </div>
      </noscript>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    </>
  )
}
