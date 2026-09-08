/** Zentrale Parameter der Pipeline. Alle Zeiten in Sekunden, Distanzen in Metern. */

export const CONFIG = {
  /** Analysetag: Dienstag, 08.09.2026 (normaler Schultag, keine Feiertage). */
  serviceDate: '20260908',
  serviceWeekday: 'tuesday' as const,

  /**
   * Abfahrtsfenster. Aus jedem Startpunkt wird zu mehreren Zeitpunkten
   * gesucht und über alle Zeitpunkte gemittelt. Dadurch fliesst die
   * Taktdichte automatisch ein: wer alle 7 Minuten fährt, hat im Schnitt
   * kürzere Wartezeit als wer alle 30 Minuten fährt.
   */
  window: { startSec: 7 * 3600, endSec: 9 * 3600, stepSec: 5 * 60 },

  /**
   * Routing-Netz und Kartenausschnitt hängen an der Stadt und stehen deshalb
   * in `pipeline/staedte.ts` (Bounding-Box, Projektionsmittelpunkt, verify).
   */

  /** Höhenmodell: Zoomstufe der Terrain-Kacheln (13 entspricht rund 19 m Rasterweite). */
  demZoom: 13,

  /** Fussweg-Modell. */
  walkSpeedMs: 1.3,           // 4.7 km/h in der Ebene
  walkDetourFactor: 1.35,     // Luftlinie -> reale Wegstrecke
  maxAccessWalkM: 800,        // Haus -> Haltestelle
  maxEgressWalkM: 800,        // Haltestelle -> Zielzelle
  maxTransferWalkM: 400,      // Umsteigeweg zwischen Haltestellen
  maxAccessStops: 8,          // pro Haus die 8 nächsten Haltestellen

  /**
   * Velo-Modell für die Kulturvielfalt. Anders als beim Gehen ist das Tempo
   * monoton in der Steigung: bergauf exponentiell gebremst, bergab bis zu einem
   * Stadttempo-Deckel schneller.  v(s) = min(veloMaxMs, veloSpeedMs · e^(−veloSteigung·s))
   */
  veloSpeedMs: 4.4,          // ~16 km/h in der Ebene, Stadtverkehr mit Halten
  veloDetourFactor: 1.3,     // Luftlinie -> reale Wegstrecke, etwas direkter als zu Fuss
  veloSteigung: 10,          // 5 % Steigung -> rund 40 % weniger Tempo
  veloMaxMs: 6.5,            // ~23 km/h, Deckel für Abfahrten

  /** Umsteigen ist unbequem: Zuschlag pro Umstieg (nicht die Wartezeit, die ist real gerechnet). */
  transferPenaltySec: 120,
  maxRounds: 5,               // max. 4 Umstiege

  /** Obergrenze: alles darüber wird gekappt, damit einzelne unerreichbare Zellen nicht dominieren. */
  maxTravelTimeSec: 90 * 60,

  /**
   * Kulturvielfalt: je Wegart ein Zeitbudget (Minuten), in dem Orte gezählt
   * werden, eine Abkling-Konstante für den nach Zeit gewichteten Index und die
  * Zeit, bis zu der überhaupt gesucht wird. Fuss ist die Vorgabe, Velo lässt
  * sich in der Karte umschalten.
   */
  kultur: {
    velo: { minuten: 10, zerfallSek: 400, sucheSek: 1080 },
    fuss: { minuten: 15, zerfallSek: 480, sucheSek: 1500 },
  },

  /**
   * Fussweggraph: maximaler Abstand, in dem ein Gebäude, ein Kulturort oder eine
   * Haltestelle an eine Kante gesnappt wird. Weiter weg → Luftlinien-Fallback.
   */
  walk: { maxSnapM: 120 },

  /** Zielraster in Metern (Kantenlänge der Zellen). */
  gridSizeM: 300,

  /** Ausgabe */
  coordPrecision: 6,
} as const

export type Config = typeof CONFIG
