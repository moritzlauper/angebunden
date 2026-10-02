import type { QuellenId } from './typen'

/** Was in den Filtern steht und sich in eine Suche auf einem Portal übersetzen lässt. */
export type Suche = {
  mieteMax: number | null
  zimmerMin: number | null
  zimmerMax: number | null
  flaecheMin: number | null
}

const q = (teile: [string, number | null][]) => {
  const s = teile.filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('&')
  return s ? `?${s}` : ''
}

/** Die Quellen, die der Sammler selbst abfragt (`pipeline/20-wohnungen.ts`). */
export const GESAMMELT: Record<QuellenId, { name: string; url: string }> = {
  flatfox: { name: 'Flatfox', url: 'https://flatfox.ch/de/search/?east=8.63&west=8.44&north=47.44&south=47.32' },
  ronorp: { name: 'Ron Orp', url: 'https://ronorp.net/zurich/market/housing' },
  woko: { name: 'WOKO', url: 'https://www.woko.ch/unser-angebot/freie-objekte' },
  pwg: { name: 'Stiftung PWG', url: 'https://www.pwg.ch/liegenschaften/zu-vermieten' },
  abz: { name: 'ABZ', url: 'https://www.abz.ch/wohnen/mieten/' },
}

type Verweis = { name: string; was: string; url: (s: Suche) => string }
const fest = (url: string) => () => url

/**
 * Wo es in Zürich sonst noch Wohnungen gibt. Diese Seiten sperren automatische
 * Abrufe (Cloudflare, auch gegen einen echten Browser), verlangen ein Captcha
 * oder eine Anmeldung; der Sammler kommt nicht an ihre Inserate. Wo es geht,
 * öffnet der Link dieselbe Suche mit den Filtern von hier.
 */
export const WEITERE: { gruppe: string; quellen: Verweis[] }[] = [
  {
    gruppe: 'Grosse Portale',
    quellen: [
      {
        name: 'Homegate',
        was: 'Grösstes Portal, ein Teil steht über Flatfox oben',
        url: (s) =>
          'https://www.homegate.ch/mieten/immobilien/ort-zuerich/trefferliste' +
          q([['ac', s.zimmerMin], ['ad', s.zimmerMax], ['ah', s.mieteMax], ['ak', s.flaecheMin]]),
      },
      {
        name: 'ImmoScout24',
        was: 'Gleiche Firma wie Homegate',
        url: (s) =>
          'https://www.immoscout24.ch/de/immobilien/mieten/ort-zuerich' +
          q([['nrf', s.zimmerMin], ['nrt', s.zimmerMax], ['pt', s.mieteMax], ['slf', s.flaecheMin]]),
      },
      { name: 'Newhome', was: 'Portal der Kantonalbanken', url: fest('https://www.newhome.ch/de/mieten/suchen/wohnung/ort-zuerich/liste') },
      { name: 'Comparis', was: 'Vergleicht mehrere Portale', url: fest('https://www.comparis.ch/immobilien/marktplatz/zuerich/mieten') },
    ],
  },
  {
    gruppe: 'Kleinanzeigen, Zimmer und WG',
    quellen: [
      { name: 'Tutti', was: 'Kleinanzeigen, oft privat', url: fest('https://www.tutti.ch/de/li/zuerich/immobilien') },
      { name: 'Anibis', was: 'Kleinanzeigen', url: fest('https://www.anibis.ch/de/c/immobilien') },
      { name: 'wgzimmer.ch', was: 'Die grösste WG-Börse', url: fest('https://www.wgzimmer.ch/de/wgzimmer/search/mate/ch/zurich-stadt.html') },
      { name: 'students.ch', was: 'Zimmer und Studios', url: fest('https://www.students.ch/wohnen') },
    ],
  },
  {
    gruppe: 'Gemeinnützig',
    quellen: [
      { name: 'Stadt Zürich', was: 'Städtische Wohnungen, mit Anmeldung', url: fest('https://www.stadt-zuerich.ch/de/lebenslagen/wohnen/freie-wohnungen.html') },
      { name: 'Wohnbaugenossenschaften', was: 'Tipps und Liste aller Genossenschaften', url: fest('https://www.wbg-zh.ch/verband-page/plattform-wohnungssuche/') },
    ],
  },
]
