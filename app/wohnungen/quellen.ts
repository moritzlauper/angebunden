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

/** Die Portale, die der Sammler selbst abfragt. Der Link öffnet dieselbe Suche dort. */
export const GESAMMELT: Record<QuellenId, { name: string; suche: (s: Suche) => string }> = {
  flatfox: {
    name: 'Flatfox',
    suche: (s) =>
      'https://flatfox.ch/de/search/' +
      q([
        ['east', 8.63],
        ['west', 8.44],
        ['north', 47.44],
        ['south', 47.32],
        ['max_price', s.mieteMax],
        ['min_rooms', s.zimmerMin],
        ['max_rooms', s.zimmerMax],
      ]),
  },
  homegate: {
    name: 'Homegate',
    suche: (s) =>
      'https://www.homegate.ch/mieten/immobilien/ort-zuerich/trefferliste' +
      q([
        ['ac', s.zimmerMin],
        ['ad', s.zimmerMax],
        ['ah', s.mieteMax],
        ['ak', s.flaecheMin],
      ]),
  },
  immoscout24: {
    name: 'ImmoScout24',
    suche: (s) =>
      'https://www.immoscout24.ch/de/immobilien/mieten/ort-zuerich' +
      q([
        ['nrf', s.zimmerMin],
        ['nrt', s.zimmerMax],
        ['pt', s.mieteMax],
        ['slf', s.flaecheMin],
      ]),
  },
}

/**
 * Wo es in Zürich sonst noch Wohnungen gibt, die der Sammler nicht abfragt:
 * Portale, die automatische Abrufe nicht zulassen, Kleinanzeigen, Zimmer für
 * Studierende, die Stadt und die Genossenschaften. Viele der günstigen
 * Wohnungen kommen nie auf die grossen Portale.
 */
export const WEITERE: { gruppe: string; quellen: { name: string; url: string; was: string }[] }[] = [
  {
    gruppe: 'Weitere Portale',
    quellen: [
      { name: 'Newhome', url: 'https://www.newhome.ch/de/mieten/suchen/wohnung/ort-zuerich/liste', was: 'Portal der Kantonalbanken' },
      { name: 'Comparis', url: 'https://www.comparis.ch/immobilien/marktplatz/zuerich/mieten', was: 'Vergleicht mehrere Portale' },
      { name: 'Tutti', url: 'https://www.tutti.ch/de/li/zuerich/immobilien', was: 'Kleinanzeigen, oft privat' },
      { name: 'Anibis', url: 'https://www.anibis.ch/de/c/immobilien', was: 'Kleinanzeigen' },
      { name: 'Ron Orp', url: 'https://www.ronorp.net/zuerich/marktplatz/wohnen', was: 'Nachmieter und Untermiete' },
    ],
  },
  {
    gruppe: 'Zimmer und WG',
    quellen: [
      { name: 'wgzimmer.ch', url: 'https://www.wgzimmer.ch/wgzimmer/search/mate.html', was: 'Die grösste WG-Börse' },
      { name: 'WOKO', url: 'https://www.woko.ch/de/zimmer-in-zuerich', was: 'Studierende von UZH und ETH' },
      { name: 'students.ch', url: 'https://www.students.ch/wohnen', was: 'Zimmer und Studios' },
      { name: 'Marktplatz UZH/ETH', url: 'https://marktplatz.uzh.ch/de/wohnen', was: 'Untermiete von Studierenden' },
    ],
  },
  {
    gruppe: 'Gemeinnützig',
    quellen: [
      { name: 'Stadt Zürich', url: 'https://www.stadt-zuerich.ch/de/stadtleben/wohnen/wohnungssuche.html', was: 'Städtische Wohnungen' },
      { name: 'Wohnbaugenossenschaften', url: 'https://www.wbg-zh.ch/wohnungssuche/', was: 'Freie Genossenschaftswohnungen' },
      { name: 'ABZ', url: 'https://www.abz.ch/wohnen/freie-wohnungen/', was: 'Grösste Genossenschaft der Schweiz' },
      { name: 'Stiftung PWG', url: 'https://www.pwg.ch/vermietung/', was: 'Preisgünstige Wohn- und Gewerberäume' },
    ],
  },
]
