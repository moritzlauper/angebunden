/**
 * Alles, was die Pipeline von Stadt zu Stadt unterscheidet, an einer Stelle.
 *
 * Ein Lauf rechnet genau eine Stadt: `STADT=basel node pipeline/03-build-targets.ts`.
 * Ohne die Variable ist es Zürich, damit die alten Aufrufe weiter stimmen.
 *
 * Die Datenpfade hängen am Schlüssel: Rohdaten unter `data/raw/osm/<stadt>/`,
 * Zwischenstände unter `data/derived/<stadt>/`, das Fertige unter
 * `public/data/<stadt>/`. Geteilt bleiben nur der GTFS-Fahrplan
 * (`data/raw/gtfs_ch.zip`) und die Höhenkacheln (`data/raw/dem/`).
 */

export type StadtSchluessel = 'zuerich' | 'basel' | 'bern'

export type StadtPipeline = {
  schluessel: StadtSchluessel
  /** Name der OSM-Relation `boundary=administrative` mit `admin_level=8`. */
  grenzeName: string
  /** Grosszügige Box um die Stadt; die exakte Grenze schneidet später zu. */
  osmBbox: { s: number; w: number; n: number; e: number }
  /**
   * Kachelung der Overpass-Abfragen als [Zeilen, Spalten]. Zu grosse Kacheln
   * laufen bei Gebäuden in Timeouts, zu kleine belasten die Instanz unnötig.
   */
  kacheln: {
    gebaeude: [number, number]
    adressen: [number, number]
    strassen: [number, number]
  }
  /** Routing-Netz: Stadt plus Umland, damit Linien über die Stadtgrenze stimmen. */
  networkBbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }
  /** Mittelpunkt der lokalen, äquidistanten Projektion (Meter um diesen Punkt). */
  projektion: { lat0: number; lon0: number }
  /** Bekannte Verbindungen für `pnpm verify`, Abfahrt 8 Uhr. */
  verify: [string, string][]
  /** Referenzhaltestelle, ab der `verify` die 30-Minuten-Reichweite zählt. */
  verifyHub: string
}

export const STAEDTE: Record<StadtSchluessel, StadtPipeline> = {
  zuerich: {
    schluessel: 'zuerich',
    grenzeName: 'Zürich',
    osmBbox: { s: 47.31, w: 8.43, n: 47.44, e: 8.64 },
    kacheln: { gebaeude: [4, 4], adressen: [2, 2], strassen: [2, 2] },
    networkBbox: { minLat: 47.25, maxLat: 47.51, minLon: 8.32, maxLon: 8.75 },
    projektion: { lat0: 47.38, lon0: 8.54 },
    verify: [
      ['Zürich HB', 'Zürich Oerlikon'],
      ['Zürich HB', 'Zürich Stadelhofen'],
      ['Zürich HB', 'Zürich Flughafen'],
      ['Zürich, Bellevue', 'Zürich, Bucheggplatz'],
      ['Zürich, Paradeplatz', 'Zürich, Milchbuck'],
      ['Zürich Altstetten', 'Zürich Tiefenbrunnen'],
      ['Zürich, Klusplatz', 'Zürich, Albisgütli'],
    ],
    verifyHub: 'Zürich HB',
  },

  basel: {
    schluessel: 'basel',
    grenzeName: 'Basel',
    // Stadtgrenze: 47.519–47.590 N, 7.555–7.634 E (OSM-Relation 1683619).
    osmBbox: { s: 47.51, w: 7.54, n: 47.60, e: 7.65 },
    kacheln: { gebaeude: [4, 4], adressen: [2, 2], strassen: [2, 2] },
    // Umland: Riehen, Allschwil, Muttenz, Pratteln und die grenznahen Linien.
    networkBbox: { minLat: 47.44, maxLat: 47.63, minLon: 7.45, maxLon: 7.80 },
    projektion: { lat0: 47.555, lon0: 7.593 },
    verify: [
      ['Basel SBB', 'Basel, Barfüsserplatz'],
      ['Basel SBB', 'Basel, Claraplatz'],
      ['Basel SBB', 'Basel, Badischer Bahnhof'],
      ['Basel, Aeschenplatz', 'Basel, Kannenfeldplatz'],
      ['Basel, Barfüsserplatz', 'Riehen, Dorf'],
      ['Basel, Markthalle', 'Basel, Bruderholz'],
    ],
    verifyHub: 'Basel SBB',
  },

  bern: {
    schluessel: 'bern',
    grenzeName: 'Bern',
    // Stadtgrenze: 46.919–46.990 N, 7.294–7.496 E (OSM-Relation 1682378).
    osmBbox: { s: 46.915, w: 7.29, n: 46.995, e: 7.50 },
    kacheln: { gebaeude: [4, 4], adressen: [2, 2], strassen: [2, 2] },
    // Umland: Köniz, Ostermundigen, Ittigen, Zollikofen, Muri.
    networkBbox: { minLat: 46.87, maxLat: 47.02, minLon: 7.28, maxLon: 7.57 },
    projektion: { lat0: 46.95, lon0: 7.43 },
    verify: [
      ['Bern', 'Bern Wankdorf'],
      ['Bern', 'Bern Bümpliz Nord'],
      ['Bern, Zytglogge', 'Bern, Helvetiaplatz'],
      ['Bern, Bärenplatz', 'Bern, Zentrum Paul Klee'],
      ['Bern, Guisanplatz Expo', 'Köniz, Zentrum'],
      ['Bern, Breitenrain', 'Wabern, Tram-Endstation'],
    ],
    verifyHub: 'Bern',
  },
}

/** Die Stadt des aktuellen Laufs, gesteuert über `process.env.STADT`. */
export function aktiveStadt(): StadtPipeline {
  const s = (process.env.STADT ?? 'zuerich') as StadtSchluessel
  const stadt = STAEDTE[s]
  if (!stadt) {
    throw new Error(
      `Unbekannte Stadt "${s}". Bekannt: ${Object.keys(STAEDTE).join(', ')}`
    )
  }
  return stadt
}
