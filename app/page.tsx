import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import { SITE_NAME } from './site'
import Velonavi from './velonavi/velonavi'
import { SeoInhalt, OhneJavascript } from './velonavi/seo-inhalt'
import { VELO_TITEL, VELO_BESCHREIBUNG } from './velonavi/seo'
import type { VeloMeta } from './velonavi/router'

const SOZIAL = `${VELO_TITEL} · ${SITE_NAME}`

export const metadata: Metadata = {
  title: { absolute: SOZIAL },
  description: VELO_BESCHREIBUNG,
  keywords: [
    'Velonavi',
    'Velonavi Zürich',
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
    description: VELO_BESCHREIBUNG,
  },
  twitter: {
    card: 'summary_large_image',
    title: SOZIAL,
    description: VELO_BESCHREIBUNG,
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
      <OhneJavascript />
      <Velonavi>
        <SeoInhalt statistik={meta.statistik} />
      </Velonavi>
    </>
  )
}
