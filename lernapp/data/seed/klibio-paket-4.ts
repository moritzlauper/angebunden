/**
 * Paket 4 für Klinische Biopsychologie (Stand 25.11.2026):
 *
 * 1. Mustert die Themen von Paket 3 aus, nicht nur dessen 19 Originaltexte. Paket 3 traf nur den
 *    exakten Wortlaut; Varianten, die die App zu diesen Aussagen erzeugt hat («Nach Yerkes-Dodson
 *    steigt die Leistung linear …», «In der Alarmreaktion nach Selye springt vor allem die HPA-Achse
 *    an.»), standen weiter in den Übungen. Jedes Muster unten gehört zu einer der 19 Aussagen und ist
 *    so eng gefasst, dass es keine der Vorlesungs-Aussagen aus Paket 2 und keine Klickerfrage trifft
 *    (geprüft per Skript und im Test). Varianten (parentId) getroffener Aussagen gehen mit.
 * 2. Trägt die Folienlinks nach: Vault «obsidian» und die echten Dateinamen der Foliensätze statt des
 *    Vorgabemusters «Slides/VL{n}.pdf», damit «VL3 p.5» direkt auf Folie 5 öffnet.
 */

import { KLIBIO_SLIDES } from "./klinische-biopsychologie.ts"
import type { Pack } from "./types.ts"

export const PACK: Pack = {
  id: "klibio-themen-nur-zusammenfassung-v4",
  subject: "klibio",
  unitTitles: {},
  statements: [],
  retire: [],
  retireMatching: [
    // UE 3: Yerkes-Dodson, Selyes Allgemeines Adaptationssyndrom, Allostatic Load
    "Yerkes|Dodson",
    "Selye|Adaptationssyndrom|Widerstandsphase|Erschöpfungsphase",
    "Allostati",
    // UE 3: erlernte Hilflosigkeit, external fatalistische Kontrollüberzeugung
    "erlernte\\w* Hilflosigkeit|fatalistisch",
    // UE 3: wie lange die Stressantwort bei sozialem Stress anhält
    "^(?=.*sozial)(?=.*Stress)(?=.*(lange|länger|anhält|anhalten))",
    // UE 3: Cortisol bei PTBS (dass eine PTBS innerhalb eines Monats einsetzt, ist Vorlesung und bleibt)
    "^(?=.*(PTBS|posttraumatisch))(?=.*Cortisol)",
    // UE 4: Behandlung der Anorexie, Diagnose der Bulimie über das Gewicht
    "^(?=.*Anorexi)(?=.*(KVT|kognitive Verhaltenstherapie|Angehörig))",
    "^(?=.*Bulimi)(?=.*(diagnostizier|untergewicht))",
    // UE 1: Engels Ebenen, Viszerozeption vs. Propriozeption, IPQ und Kultur, Sinn im Umfeld
    "^(?=.*Engel)(?=.*Ebene)",
    "^(?=.*(Viszerozeption|Propriozeption))(?=.*bewusst)",
    "^(?=.*(Illness Perception|IPQ))(?=.*Kultur)",
    "^(?=.*(Umfeld|Umgebung))(?=.*Sinn)",
    // UE 1: Abgrenzung Gesundheitspsychologie und Psychosomatik, bewusste Krankheitswahrnehmung
    "^(?=.*Gesundheitspsychologie)(?=.*medizinische\\w* Begriff)",
    "^(?=.*Psychosomatik)(?=.*Seite)",
    "^(?=.*Krankheitswahrnehmung)(?=.*bewusst)",
    // UE 1: Migräne bei Kindern, Kontrollwahrnehmung und Anfallshäufigkeit
    "^(?=.*Migräne)(?=.*(Kontrollwahrnehmung|Kinder|Häufigkeit der Anfälle))",
    // UE 9: Schmerz beim Schlaganfall, Lebensstil als erste Wahl
    "^(?=.*Schlaganfall)(?=.*Schmerz)",
    "^(?=.*erste Wahl)(?=.*(Lebensstil|Medikament))",
  ],
  subjectLinks: {
    vaultName: "obsidian",
    vaultPath: "Klinische Biopsychologie",
    slidesPattern: KLIBIO_SLIDES,
    zmPath: "Zusammenfassungen/ZM_Klinische Biopsychologie.pdf",
    replace: { slidesPattern: "Slides/VL{n}.pdf" },
  },
}
