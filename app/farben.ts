/**
 * Ein Satz Farben für beide Karten. Die Regel dahinter: Tinte bedient, Karmin
 * zeigt.
 *
 * Alles, was man drückt, zieht oder wählt, ist Tinte auf Papier – Knöpfe,
 * Schalter, Häkchen, Fokusring, Links. Karmin gibt es nur für Daten und für
 * den Punkt der Marke. Kräftiges Karmin heisst in beiden Ansichten dasselbe:
 * gut angebunden.
 *
 * Die Oberfläche greift auf die Papier- und Tinte-Töne über die
 * CSS-Variablen `--ab-*` aus `globals.css` zu, damit ein Themenwechsel ohne
 * Durchreichen durch jede Komponente auskommt. Hier stehen nur die Werte, die
 * MapLibre und `next/og` brauchen: Beide kennen keine CSS-Variablen.
 */

/**
 * Die Rang-Rampe, von Rang 1 bis zum eingestellten Ende. Nach Helligkeit
 * gleichmässig gestuft (oklch L 0.36 → 0.77), damit die Ränge auf dem grauen
 * Kartengrund gleich weit auseinander wirken.
 *
 * Die Sättigung liegt dicht am Rand dessen, was sRGB kann (C 0.13 bis 0.19).
 * Eine gedämpftere Rampe war zwar ruhiger, aber der Kartengrund ist sehr hell
 * (die Gebäude liegen bei L 0.86): Ein blasses Ende ging dort als angegrautes
 * Rosa unter, und man sah nicht mehr, was besser ist als das gewählte Haus und
 * was schlechter. Das helle Ende bleibt deshalb unter L 0.8.
 */
export const KARMIN = ['#721313', '#a1201e', '#cc3934', '#f15c52', '#f7958b'] as const

/** Der Punkt der Marke und das Ziel im Velonavi: die Mitte der Rampe. */
export const PUNKT = KARMIN[2]

/** Bedienung, Marker und Umrisse auf der Karte. */
export const TINTE = '#18181b'

/** Was nebenherläuft: Alternativroute, Vorzugsroute, geschobene Meter. */
export const GRAU = '#a1a1a0'

/**
 * Der Kartengrund, eine Stufe leiser als die Vorlagen ihn liefern. Wasser und
 * Grün verlieren etwa ein Drittel Sättigung und sind wie die Gebäude warmgrau
 * getönt: Die Karte liest sich als Papier, Karmin liegt klar obenauf.
 */
export const GRUND = {
  wasser: '#d5dfe4',
  gruen: '#e2e8da',
  gebaeude: '#d1d1ce',
  gebaeudeKante: '#b7b7b7',
  strasseHaupt: '#c4c4be',
  strasseNeben: '#d2d2cd',
  stadtRand: '#c9c9c4',
} as const
