/**
 * Die zwölf Stadtkreise für die Unterseiten `/wohnungen/kreis-1` bis
 * `/wohnungen/kreis-12`. Jede ist eine eigene Landingpage für Suchen wie
 * «Wohnung Kreis 4 Zürich». Zugeordnet wird über die Postleitzahl; die
 * Grenzen der Postkreise decken sich nicht ganz mit den Stadtkreisen, für eine
 * Wohnungssuche ist das nah genug.
 */
export type Kreis = { nummer: number; slug: string; quartiere: string; plz: string[] }

export const KREISE: Kreis[] = [
  { nummer: 1, quartiere: 'Altstadt, Rathaus, Lindenhof, City', plz: ['8001'] },
  { nummer: 2, quartiere: 'Enge, Wollishofen, Leimbach', plz: ['8002', '8038', '8041'] },
  { nummer: 3, quartiere: 'Wiedikon, Sihlfeld, Friesenberg', plz: ['8003', '8045', '8055'] },
  { nummer: 4, quartiere: 'Aussersihl, Langstrasse, Werd, Hard', plz: ['8004'] },
  { nummer: 5, quartiere: 'Industriequartier, Escher Wyss, Gewerbeschule', plz: ['8005'] },
  { nummer: 6, quartiere: 'Unterstrass, Oberstrass', plz: ['8006', '8057'] },
  { nummer: 7, quartiere: 'Fluntern, Hottingen, Hirslanden, Witikon', plz: ['8032', '8044', '8053'] },
  { nummer: 8, quartiere: 'Riesbach, Seefeld, Mühlebach', plz: ['8008'] },
  { nummer: 9, quartiere: 'Altstetten, Albisrieden', plz: ['8047', '8048'] },
  { nummer: 10, quartiere: 'Wipkingen, Höngg', plz: ['8037', '8049'] },
  { nummer: 11, quartiere: 'Oerlikon, Affoltern, Seebach', plz: ['8046', '8050', '8052'] },
  { nummer: 12, quartiere: 'Schwamendingen, Saatlen, Hirzenbach', plz: ['8051'] },
].map((k) => ({ ...k, slug: `kreis-${k.nummer}` }))

export const kreisVon = (slug: string) => KREISE.find((k) => k.slug === slug)
