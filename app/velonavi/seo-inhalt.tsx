import Link from 'next/link'
import { SITE_NAME, SITE_URL, nf } from '../site'
import { VELO_BESCHREIBUNG } from './seo'
import type { VeloMeta } from './router'

/** Serverseitig gerenderte Erklärung im Bedienfeld, auf Handy und Desktop lesbar. */
export function SeoInhalt({ statistik }: { statistik: VeloMeta['statistik'] }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        inLanguage: 'de-CH',
        description:
          'Velonavi Zürich, Wohnungssuche in Zürich und ÖV-Erreichbarkeitskarten für Zürich, Basel und Bern.',
      },
      {
        '@type': 'WebPage',
        '@id': `${SITE_URL}/#webpage`,
        name: 'Velonavi Zürich – Veloroutenplaner',
        url: `${SITE_URL}/`,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        mainEntity: { '@id': `${SITE_URL}/#velonavi` },
        description: VELO_BESCHREIBUNG,
        inLanguage: 'de-CH',
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#velonavi`,
        name: 'Velonavi Zürich',
        url: `${SITE_URL}/`,
        applicationCategory: 'TravelApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires JavaScript',
        inLanguage: 'de-CH',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CHF' },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
        areaServed: { '@type': 'City', name: 'Zürich' },
        featureList: [
          'Veloroute zwischen Adressen in der Stadt Zürich planen',
          'Schnelle und komfortable Velorouten vergleichen',
          'Zwischenziele hinzufügen',
          'Route als GPX herunterladen oder als Link teilen',
          'Velokarte nach Fahrgefühl eingefärbt',
        ],
        description: VELO_BESCHREIBUNG,
      },
    ],
  }

  return (
    <section aria-labelledby="velonavi-titel" className="text-[12px] leading-relaxed">
      <h1 id="velonavi-titel" className="text-[14px] font-semibold">
        Velonavi Zürich – dein Veloroutenplaner
      </h1>
      <p className="mt-2">
        Plane deine Veloroute durch die Stadt Zürich: Start und Ziel eingeben, eine schnelle
        oder komfortable Strecke wählen und auf der Velokarte vergleichen. Der Velonavi von
        angebunden ist kostenlos und funktioniert direkt im Browser.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer font-medium">Mehr über das Velonavi Zürich</summary>
        <h2 className="mt-3 font-semibold">Schnell oder komfortabel mit dem Velo durch Zürich</h2>
        <p className="mt-1">
          «Schnell» gewichtet die Fahrzeit stärker. «Komfort» bevorzugt angenehmere Strecken
          und nimmt dafür Umwege in Kauf. In die Berechnung fliessen Verkehr, Velowege,
          Velostreifen, Tramgleise, Kopfsteinpflaster, Steigungen und Wartezeiten an Ampeln ein.
          Die Farben der Route zeigen das Fahrgefühl der einzelnen Abschnitte.
        </p>
        <h2 className="mt-3 font-semibold">Velorouten mit Zwischenzielen und GPX-Export</h2>
        <p className="mt-1">
          Ob Arbeitsweg, Fahrt zur Uni oder zum See: Füge Zwischenziele hinzu, teile die
          fertige Route als Link oder lade sie als GPX-Datei für dein Velonavi-Gerät oder
          eine andere App herunter. Adresssuche und Routenberechnung laufen auf deinem Gerät.
        </p>
        <h2 className="mt-3 font-semibold">Velokarte und Velonetz der Stadt Zürich</h2>
        <p className="mt-1">
          Grundlage sind {nf(statistik.veloKm)} km Fuss- und Velowegnetz, ergänzt um
          Daten der Stadt Zürich und OpenStreetMap. Berücksichtigt werden auch das Vorzugs-
          und Hauptnetz der städtischen Velonetzplanung, {nf(statistik.ampelKnoten)} Kreuzungen
          mit Ampeln und {nf(statistik.verbote)} Abbiegeverbote. Wie die Daten gewichtet werden,
          erklärt die <Link href="/methode#velonavi" className="underline underline-offset-2">
            Methode des Velonavi Zürich
          </Link>.
        </p>
        <h2 className="mt-3 font-semibold">Weitere Karten von angebunden</h2>
        <p className="mt-1">
          Die <Link href="/erreichbarkeitskarte" className="underline underline-offset-2">
            Erreichbarkeitskarte Zürich
          </Link> zeigt ÖV-Reisezeiten und Kulturangebote für jedes Haus. Sie gibt es auch
          für <Link href="/basel" className="underline underline-offset-2">Basel</Link> und{' '}
          <Link href="/bern" className="underline underline-offset-2">Bern</Link>.
          Unter <Link href="/wohnungen" className="underline underline-offset-2">
            Wohnungen Zürich
          </Link> findest du Mietwohnungen und WG-Zimmer auf einer Karte.
        </p>
      </details>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    </section>
  )
}

/** Liegt ausserhalb des Bedienfelds und bleibt auch ohne JavaScript sichtbar. */
export function OhneJavascript() {
  return (
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
              Tramgleise, Belag, Steigung und die Wartezeit an Ampeln mit. Die Route entsteht
              im Browser, dafür braucht er JavaScript.
            </p>
            <p style={{ marginTop: '0.75rem' }}>
              <a href="/methode#velonavi" style={{ color: '#18181b', textDecoration: 'underline' }}>
                Wie das gerechnet ist
              </a>{' '}
              steht auch ohne Karte zum Nachlesen bereit.
            </p>
          </div>
        </div>
      </noscript>
  )
}
