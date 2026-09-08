/**
 * Die drei Städte, für die es eine Karte gibt. Rein deklarativ, keine
 * Server-Importe – das File wird auch im Client-Bundle von `karte.tsx` gezogen.
 *
 * `daten` ist der Präfix, unter dem im `public/`-Ordner die GeoJSON-Dateien der
 * Stadt liegen; `center`/`zoom`/`maxBounds` sind die Startsicht der MapLibre-Karte.
 */

export type StadtSchluessel = 'zuerich' | 'basel' | 'bern'

export type Stadt = {
  schluessel: StadtSchluessel
  /** So heisst die Stadt im Text: «… in Basel», «Erreichbarkeitskarte Bern». */
  name: string
  /** Route der Stadt. Zürich liegt auf «/», die anderen auf «/basel», «/bern». */
  pfad: string
  /** Präfix der Datendateien, z. B. «/data/basel». */
  daten: string
  center: [number, number]
  zoom: number
  maxBounds: [[number, number], [number, number]]
}

export const STAEDTE: Record<StadtSchluessel, Stadt> = {
  zuerich: {
    schluessel: 'zuerich',
    name: 'Zürich',
    pfad: '/',
    daten: '/data/zuerich',
    center: [8.5405, 47.3775],
    zoom: 13.4,
    maxBounds: [
      [8.31, 47.25],
      [8.78, 47.5],
    ],
  },
  basel: {
    schluessel: 'basel',
    name: 'Basel',
    pfad: '/basel',
    daten: '/data/basel',
    center: [7.589, 47.5565],
    zoom: 13.4,
    maxBounds: [
      [7.52, 47.5],
      [7.7, 47.61],
    ],
  },
  bern: {
    schluessel: 'bern',
    name: 'Bern',
    pfad: '/bern',
    daten: '/data/bern',
    center: [7.444, 46.948],
    zoom: 13.4,
    // Westrand weit genug, dass die Aussenquartiere (Bümpliz, Riedbach) nicht
    // an der Panngrenze abgeschnitten werden.
    maxBounds: [
      [7.28, 46.9],
      [7.53, 47.0],
    ],
  },
}

/** Reihenfolge für den Städte-Umschalter im Bedienfeld. */
export const STADT_LISTE: Stadt[] = [STAEDTE.zuerich, STAEDTE.basel, STAEDTE.bern]
