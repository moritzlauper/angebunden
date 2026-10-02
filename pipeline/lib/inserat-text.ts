/**
 * Liest aus Titel und Beschreibung eines Inserats, was die Felder der Portale
 * oft verschweigen: ob die Wohnung befristet ist und ob es eigentlich ein
 * WG-Zimmer ist. Auf Flatfox stehen viele Zimmer als «Wohnung» drin, und
 * Zwischenmieten erkennt man meist nur am Text («December only», «Untermiete
 * bis Ende März»). Deutsch und Englisch, weil in Zürich beides vorkommt.
 */

const MONAT =
  '(?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|' +
  'january|february|march|may|june|july|october|december|jan|feb|mär|mar|apr|jun|jul|aug|sept?|okt|oct|nov|dez|dec)'

const BEFRISTET = new RegExp(
  [
    '\\bbefristet', '\\btemporär', '\\btemporaer', '\\btemporary\\b', '\\btemporarily\\b',
    '\\bzwischenmiet', '\\buntermiet', '\\bsub-?let', '\\bsublease', '\\bsub-?rent',
    '\\bshort[- ]term\\b', '\\bkurzzeit', '\\bkurzfristig', '\\bferienwohnung',
    // «für 3 Monate», «for 6 months», «max. 12 Monate», «3-month»
    '\\b(?:für|for|während|during|max(?:imal|\\.)?|ca\\.?)\\s*\\d{1,2}\\s*(?:monate?n?|months?|wochen|weeks)\\b',
    '\\b\\d{1,2}[- ](?:monate?|months?)\\b',
    // «December only», «nur im Dezember», «only for January»
    `\\b${MONAT}\\s+only\\b`, `\\bonly\\s+(?:in|for|during)?\\s*${MONAT}\\b`, `\\bnur\\s+(?:im|für|fuer|von)?\\s*${MONAT}\\b`,
    // «bis Ende März», «bis 31.01.2027», «until end of June»
    `\\bbis\\s+(?:ende|mitte|anfang)\\s+${MONAT}`, '\\bbis\\s+(?:zum\\s+)?\\d{1,2}\\.\\s*\\d{1,2}\\.\\s*\\d{2,4}',
    `\\buntil\\s+(?:the\\s+)?(?:end|mid(?:dle)?|beginning)\\s+of\\s+${MONAT}`, `\\buntil\\s+${MONAT}`,
    `\\bvon\\s+(?:anfang\\s+|mitte\\s+|ende\\s+)?${MONAT}\\s+bis\\s+(?:anfang\\s+|mitte\\s+|ende\\s+)?${MONAT}`,
    `\\bfrom\\s+${MONAT}\\s+(?:to|until|till)\\s+${MONAT}`,
  ].join('|'),
  'i'
)

/** Sagt ausdrücklich, dass es nicht befristet ist. Hebt einen Treffer oben auf. */
const UNBEFRISTET = /\bunbefristet|\bnicht befristet|\bkeine befristung|\bnot temporary\b|\bpermanent(?:ly)?\b|\blong[- ]term\b|\blangfristig/i

const WG = new RegExp(
  [
    '\\bwg\\b(?![- ]?(?:tauglich|geeignet|freundlich|fähig|faehig))', '\\bwg-?zimmer', '\\bwgzimmer',
    '\\bmitbewohner', '\\bmitbewohnerin', '\\bzimmer in (?:einer|unserer|meiner|der|einer schönen|einer netten)',
    '\\b(?:ein|1)\\s+zimmer in\\b', '\\bzimmer frei\\b', '\\bfreies zimmer\\b',
    '\\broom in (?:a|an|our|my|the|shared)\\b', '\\bshared (?:flat|apartment|house)\\b', '\\bflat ?share\\b',
    '\\bflat-?mates?\\b', '\\broom-?mates?\\b', '\\bhouse-?mates?\\b', '\\bprivate room\\b', '\\bco-?living\\b',
    '\\bfurnished room\\b', '\\bmöbliertes zimmer\\b', '\\broom (?:available|for rent)\\b',
  ].join('|'),
  'i'
)

/** «WG-tauglich», «geeignet für eine WG»: eine ganze Wohnung, die sich für eine WG eignet. */
const WG_TAUGLICH = /\bwg[- ]?(?:tauglich|geeignet|freundlich)|\bgeeignet (?:für|fuer) (?:eine )?wg|\bsuitable for (?:a )?(?:flat ?share|shared)/i

export function istBefristet(text: string): boolean {
  return BEFRISTET.test(text) && !UNBEFRISTET.test(text)
}

/** Deutliche Zeichen für ein Zimmer, die auch «WG-tauglich» im selben Text nicht aufhebt. */
const WG_SICHER = /\bwg-?zimmer|\bmitbewohner|\broom in (?:a|an|our|my|the|shared)\b|\bflat-?mates?\b|\b\d(?:er)?[- ]?wg\b/i

export function istWgZimmer(text: string): boolean {
  if (!WG.test(text)) return false
  return !WG_TAUGLICH.test(text) || WG_SICHER.test(text)
}
