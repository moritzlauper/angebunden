import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import { SITE_NAME } from './site'
import Velonavi from './velonavi/velonavi'
import { SeoInhalt } from './velonavi/seo-inhalt'
import type { VeloMeta } from './velonavi/router'

const BESCHREIBUNG =
  'Veloroutenplaner für Zürich in zwei Varianten, schnell oder komfortabel. Rechnet Verkehr, ' +
  'Velostreifen, Tramgleise, Kopfsteinpflaster, Steigung und die Wartezeit an Ampeln mit, ' +
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
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'de_CH',
    siteName: SITE_NAME,
    url: '/',
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

/**
 * Setzt das Thema, bevor das erste Bild steht. Ohne dieses Skript käme die
 * Seite hell aus dem Server, und der Wechsel auf dunkel würde nach dem
 * Hydrieren sichtbar aufblitzen. Die Regel muss zu `themaAuto` in
 * `velonavi/velonavi.tsx` passen: ab 20 Uhr dunkel, tagsüber wie das Betriebssystem.
 * Dazu `data-konto`, wenn dieses Gerät eine Sitzung hat: Dann bleiben die Wegweiser
 * zur Erreichbarkeitskarte schon vor dem Hydrieren weg (`useKontoVorhanden`).
 */
const THEMA_SKRIPT = `try{
var w=localStorage.getItem('velonavi.thema'),v=w?JSON.parse(w):'auto',h=new Date().getHours();
document.documentElement.dataset.thema=
  v==='dunkel'||(v==='auto'&&(h>=20||h<7||matchMedia('(prefers-color-scheme: dark)').matches))?'dunkel':'hell';
if(localStorage.getItem('velonavi.konto')!==null)document.documentElement.dataset.konto='';
}catch(e){}`

export default async function Page() {
  const meta = await ladeVeloMeta()
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEMA_SKRIPT }} />
      <SeoInhalt statistik={meta.statistik} />
      <Velonavi />
    </>
  )
}
