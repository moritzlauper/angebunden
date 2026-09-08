import Link from 'next/link'
import type { Meta } from './meta'
import type { Stadt } from './staedte'
import { SITE_NAME, SITE_URL, nf } from './site'

/**
 * Der crawlbare Teil einer Stadtseite. Die Karte selbst ist eine leere Fläche,
 * bis MapLibre lädt – Google, WhatsApp und Screenreader sähen sonst nichts.
 * Hier steht derselbe Inhalt in Worten: eine Überschrift, zwei Absätze, der
 * Verweis auf die Methode, dazu die JSON-LD-Auszeichnung.
 *
 * `sr-only` blendet den Block optisch aus, lässt ihn aber im DOM und im
 * Accessibility-Baum. Das `<noscript>` ist der sichtbare Ausweg, wenn kein
 * JavaScript läuft und die Karte gar nicht erst startet.
 */

const VERKEHR: Record<string, string> = {
  zuerich: 'Tram, Bus und S-Bahn',
  basel: 'Tram und Bus',
  bern: 'Tram und Bus',
}

// Eine Nachkommastelle, Dezimalpunkt (Schweizer Schreibweise).
const fmt = (n: number) => String(Math.round(n * 10) / 10)

export function SeoInhalt({ stadt, meta }: { stadt: Stadt; meta: Meta }) {
  const verkehr = VERKEHR[stadt.schluessel] ?? 'Tram, Bus und Bahn'

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: `${SITE_NAME} · Erreichbarkeit ${stadt.name}`,
    url: `${SITE_URL}${stadt.pfad}`,
    applicationCategory: 'TravelApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript',
    inLanguage: 'de-CH',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CHF' },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    description:
      `Interaktive Karte: Für jedes der ${nf(meta.buildings)} Häuser in ${stadt.name} ` +
      `die mittlere Reisezeit mit ${verkehr} zu einer beliebigen Adresse der Stadt.`,
  }

  return (
    <>
      <section className="sr-only">
        <h1>Erreichbarkeit für jedes Haus in {stadt.name}</h1>
        <p>
          Die Karte färbt jedes der {nf(meta.buildings)} Häuser in {stadt.name} danach ein, wie
          lange man von dort mit {verkehr} im Schnitt zu einer beliebigen Adresse der Stadt
          braucht. Türe zu Türe, mit Fussweg, Wartezeit und Umstiegen. Das bestangebundene Haus
          liegt bei {fmt(meta.minutes.best)} Minuten, der Median bei {fmt(meta.minutes.median)}, am
          Stadtrand sind es über 45.
        </p>
        <p>
          Ein zweiter Modus zeigt, wie es um die Kulturvielfalt in der Nähe steht: Cafés, Bars,
          Bühnen, Kinos, Museen, öffentliche Kunst, Bibliotheken, Badis, Quartiertreffs und
          Restaurants, erreichbar in {meta.kultur.budgets.fuss} Gehminuten oder wahlweise mit dem
          Velo. Gewertet wird nach Vielfalt, nicht nach Dichte; welche Sorten zählen, stellt man
          selbst ein. Jedes Haus bekommt einen Rang von 1 bis {nf(meta.buildings)}, und den eigenen
          Link teilt man mit einem Klick.
        </p>
        <p>
          <Link href="/methode">Wie das gerechnet ist</Link>: die Formeln, Parameter und
          Datenquellen hinter der Karte.
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
              angebunden · Erreichbarkeit {stadt.name}
            </p>
            <p style={{ marginTop: '0.75rem' }}>
              Die Karte zeigt für jedes der {nf(meta.buildings)} Häuser in {stadt.name}, wie lange
              man mit {verkehr} im Schnitt zu einer beliebigen Adresse der Stadt braucht. Dafür
              braucht der Browser JavaScript.
            </p>
            <p style={{ marginTop: '0.75rem' }}>
              <a href="/methode" style={{ color: '#2563eb' }}>
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
