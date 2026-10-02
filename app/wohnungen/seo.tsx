import Link from 'next/link'
import type { Metadata } from 'next'
import { SITE_NAME, SITE_URL } from '../site'
import { KREISE, type Kreis } from './kreise'

/**
 * Was Suchmaschinen über /wohnungen und die Kreisseiten lesen: Titel,
 * Beschreibung, strukturierte Daten und ein sichtbarer Text unter der Liste.
 * Die Inserate selbst lädt der Browser nach, sie stehen nicht im HTML; der
 * Text erklärt deshalb in Worten, was die Seite kann, und verlinkt jeden Kreis.
 */

const ort = (k?: Kreis) => (k ? `Zürich Kreis ${k.nummer}` : 'Zürich')
const pfad = (k?: Kreis) => (k ? `/wohnungen/${k.slug}` : '/wohnungen')

export function wohnungenMetadata(k?: Kreis): Metadata {
  const titel = k
    ? `Wohnung mieten Zürich Kreis ${k.nummer} (${k.quartiere.split(', ').slice(0, 2).join(', ')})`
    : 'Wohnung mieten in Zürich: alle Inserate auf einer Karte'
  const beschreibung = k
    ? `Freie Mietwohnungen und WG-Zimmer im Kreis ${k.nummer} (${k.quartiere}): Inserate von Flatfox, ` +
      `Homegate, ImmoScout24, Ron Orp, WOKO und Genossenschaften auf einer Karte, alle 5 Minuten neu.`
    : 'Alle Mietwohnungen und WG-Zimmer in der Stadt Zürich auf einer Karte: Flatfox, Homegate, ' +
      'ImmoScout24, Ron Orp, WOKO und Genossenschaften, alle 5 Minuten neu. Befristet oder nicht, ' +
      'Gebiet auf der Karte zeichnen, Wohnungen merken.'
  const sozial = `Wohnungen ${ort(k)} · ${SITE_NAME}`
  return {
    title: { absolute: `${titel} · ${SITE_NAME}` },
    description: beschreibung,
    keywords: [
      `Wohnung mieten ${ort(k)}`,
      `Wohnungen ${ort(k)}`,
      `Mietwohnung ${ort(k)}`,
      `WG-Zimmer ${ort(k)}`,
      'Wohnungssuche Zürich',
      'Wohnung Zürich',
      'Zwischenmiete Zürich',
      'Genossenschaftswohnung Zürich',
      ...(k ? k.quartiere.split(', ').map((q) => `Wohnung ${q}`) : []),
    ],
    alternates: { canonical: pfad(k) },
    openGraph: { type: 'website', locale: 'de_CH', siteName: SITE_NAME, url: pfad(k), title: sozial, description: beschreibung },
    twitter: { card: 'summary_large_image', title: sozial, description: beschreibung },
  }
}

const FRAGEN = (k?: Kreis): [string, string][] => [
  [
    `Woher kommen die Wohnungen in ${ort(k)}?`,
    'Ein Sammler fragt alle fünf Minuten Flatfox ab (dort steht auch ein Teil der Inserate von Homegate ' +
      'und ImmoScout24), dazu den Wohnungsmarkt von Ron Orp, die freien Zimmer der WOKO und die freien ' +
      'Wohnungen der Stiftung PWG und der ABZ. Steht dieselbe Wohnung auf mehreren Portalen, erscheint sie ' +
      'einmal, mit allen Links.',
  ],
  [
    'Wie finde ich unbefristete Wohnungen und keine Zwischenmiete?',
    'Unter «Dauer» auf «Unbefristet» stellen. Ob ein Inserat befristet ist, steht selten in einem Feld; ' +
      'die Seite liest es aus Titel und Beschreibung («Untermiete», «bis Ende März», «December only»). ' +
      'Genauso erkennt sie WG-Zimmer, die als Wohnung inseriert sind.',
  ],
  [
    'Kann ich nur in bestimmten Quartieren suchen?',
    'Ja. Auf der Karte «Gebiet zeichnen» wählen und einen Kreis aufziehen, auch mehrere. Die Liste zeigt ' +
      'dann nur, was darin liegt. Für jeden Stadtkreis gibt es ausserdem eine eigene Seite.',
  ],
  [
    'Wie gut ist eine Wohnung angebunden?',
    'Zu jedem Inserat steht die mittlere Reisezeit mit Tram, Bus und S-Bahn zu einer beliebigen Adresse ' +
      'der Stadt und wie viele Cafés, Bars, Kinos und andere Kulturorte in Velodistanz liegen. Die Werte ' +
      'stammen aus der Erreichbarkeitskarte von angebunden.',
  ],
  [
    'Was ist mit Homegate, Newhome, Tutti und wgzimmer.ch?',
    'Diese Portale sperren automatische Abrufe. Unter «Weitere Quellen» führt ein Link direkt dorthin, ' +
      'bei Homegate und ImmoScout24 gleich mit Miete, Zimmern und Fläche aus den Filtern.',
  ],
  [
    'Kostet das etwas, brauche ich ein Konto?',
    'Nein. Gemerkte Wohnungen und Filter bleiben im Browser. Mit einem kostenlosen Konto gelten sie auf ' +
      'jedem Gerät.',
  ],
]

export function WohnungenText({ kreis }: { kreis?: Kreis }) {
  const fragen = FRAGEN(kreis)
  const url = `${SITE_URL}${pfad(kreis)}`
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: `Wohnungen ${ort(kreis)} · ${SITE_NAME}`,
      url,
      applicationCategory: 'LifestyleApplication',
      operatingSystem: 'Web',
      inLanguage: 'de-CH',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'CHF' },
      areaServed: { '@type': 'City', name: 'Zürich' },
      description: `Mietwohnungen und WG-Zimmer in ${ort(kreis)} aus mehreren Portalen auf einer Karte.`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: fragen.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Wohnungen Zürich', item: `${SITE_URL}/wohnungen` },
        ...(kreis ? [{ '@type': 'ListItem', position: 3, name: `Kreis ${kreis.nummer}`, item: url }] : []),
      ],
    },
  ]

  return (
    <section className="mt-10 px-1 pb-4 text-[12.5px] leading-relaxed text-[var(--ab-leise)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h2 className="text-[13px] font-semibold text-[var(--ab-tinte)]">
        {kreis ? `Wohnung mieten im Kreis ${kreis.nummer}: ${kreis.quartiere}` : 'Wohnung mieten in Zürich'}
      </h2>
      <p className="mt-1">
        {kreis
          ? `Hier stehen die freien Mietwohnungen und WG-Zimmer im Kreis ${kreis.nummer} (Postleitzahl ` +
            `${kreis.plz.join(', ')}), aus allen Quellen, die sich einsammeln lassen.`
          : 'Wer in Zürich eine Wohnung sucht, klappert sonst ein Dutzend Portale ab. Hier steht alles auf ' +
            'einer Liste und einer Karte, vom WG-Zimmer bis zur Genossenschaftswohnung.'}{' '}
        Neue Inserate sind markiert, sobald du wiederkommst.
      </p>
      {fragen.map(([q, a]) => (
        <div key={q} className="mt-3">
          <h3 className="font-medium text-[var(--ab-tinte)]">{q}</h3>
          <p>{a}</p>
        </div>
      ))}
      <h3 className="mt-5 font-medium text-[var(--ab-tinte)]">Wohnungen nach Stadtkreis</h3>
      <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
        {!kreis ? null : (
          <li>
            <Link href="/wohnungen" className="underline underline-offset-2">
              Ganze Stadt
            </Link>
          </li>
        )}
        {KREISE.filter((k) => k.slug !== kreis?.slug).map((k) => (
          <li key={k.slug}>
            <Link href={`/wohnungen/${k.slug}`} className="underline underline-offset-2" title={k.quartiere}>
              Kreis {k.nummer}
            </Link>{' '}
            <span className="text-[11px]">{k.quartiere.split(', ')[0]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4">
        <Link href="/erreichbarkeitskarte" className="underline underline-offset-2">
          Erreichbarkeitskarte
        </Link>{' '}
        · <Link href="/" className="underline underline-offset-2">Velonavi Zürich</Link>
      </p>
    </section>
  )
}
