import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import { SITE_NAME } from '../site'
import Velonavi from './velonavi'
import { SeoInhalt } from './seo-inhalt'
import type { VeloMeta } from './router'

const BESCHREIBUNG =
  'Veloroutenplaner für Zürich in zwei Varianten, schnell oder komfortabel. Rechnet Verkehr, ' +
  'Velostreifen, Tramgleise, Kopfsteinpflaster, Steigung und die Wartezeit an Lichtsignalen mit, ' +
  'je nach Abbiegerichtung. Mit Zwischenzielen, GPX-Export und teilbarem Link.'

const SOZIAL = `Velonavi Zürich · ${SITE_NAME}`

export const metadata: Metadata = {
  title: 'Velonavi Zürich',
  description: BESCHREIBUNG,
  keywords: [
    'Velonavi',
    'Veloroutenplaner',
    'Velorouten Zürich',
    'Velokarte Zürich',
    'Fahrradroutenplaner',
    'Velonetz Zürich',
    'Velostreifen',
    'Veloweg',
    'GPX',
    'Zürich',
  ],
  alternates: { canonical: '/velonavi' },
  openGraph: {
    type: 'website',
    locale: 'de_CH',
    siteName: SITE_NAME,
    url: '/velonavi',
    title: SOZIAL,
    description: BESCHREIBUNG,
  },
  twitter: {
    card: 'summary_large_image',
    title: SOZIAL,
    description: BESCHREIBUNG,
  },
}

/** Die Kennzahlen des Velonetzes, dieselbe Datei, die der Router im Browser liest. */
async function ladeVeloMeta(): Promise<VeloMeta> {
  return JSON.parse(
    await readFile(path.join(process.cwd(), 'public', 'data', 'zuerich', 'velo.json'), 'utf8')
  )
}

export default async function Page() {
  const meta = await ladeVeloMeta()
  return (
    <>
      <SeoInhalt statistik={meta.statistik} />
      <Velonavi />
    </>
  )
}
