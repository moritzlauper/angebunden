/**
 * Paket 3 für Klinische Biopsychologie: mustert 19 Aussagen aus, die nur aus der Zusammenfassung
 * stammen und in den Vorlesungen nicht einmal annähernd vorkommen.
 *
 * Geprüft wurden alle 27 Aussagen aus Paket 2 mit Fundstelle «ZM» gegen die Folien VL1, VL3, VL4,
 * VL8 und VL9 und die Mitschrift zu UE 1 (Stand 24.11.2026). Bleiben dürfen die 8, deren Inhalt in
 * der Vorlesung vorkommt, auch wenn anders formuliert: WHO-Definition von Gesundheit, eigene
 * Handlungsfähigkeit, Komponenten der Krankheitswahrnehmung, ICF und biopsychosoziales Modell,
 * Biofeedback (VL8), Migräne psychologisch und medizinisch (Mitschrift UE 1), Brustschmerz im Alter
 * und Takotsubo (VL9). Aussagen mit Fundstelle «VL» sind aus der Vorlesung und bleiben alle.
 *
 * Wird beim Start einmal eingespielt (lib/seed.ts, applyPacks); ausgemusterte Aussagen gehen aus der
 * Rotation und tragen das Flag «nicht_relevant».
 */

import type { Pack } from "./types.ts"

export const PACK: Pack = {
  id: "klibio-nur-zusammenfassung-v3",
  subject: "klibio",
  unitTitles: {},
  statements: [],
  retire: [
    // UE 1: Engels Modell mit «gleich wichtigen» Ebenen kommt in VL1 und der Mitschrift nicht vor
    "Im biopsychosozialen Modell nach Engel gelten alle hierarchischen Ebenen der Einflüsse als gleich wichtig.",
    // UE 1: VL1 nennt Propriozeption und Viszerozeption, aber nicht, welche bewusster ist
    "Die Viszerozeption ist bewusster als die Propriozeption.",
    // UE 1: der IPQ ist in VL1, die Abhängigkeit von der Kultur nicht
    "Die Antworten im Illness Perception Questionnaire sind weitgehend unabhängig von der Kultur der befragten Person.",
    // UE 1: Wirkung abgeschwächt, wenn das Umfeld den Sinn nicht teilt: nicht in VL1 oder der Mitschrift
    "Teilt das soziale Umfeld den Sinn einer Intervention nicht, schwächt das deren Wirkung ab.",
    // UE 1: Befund zu Kontrollwahrnehmung und Anfallshäufigkeit bei Migräne: nicht in der Vorlesung
    "Verhaltensorientierte Verfahren bei Migräne senken vor allem die Häufigkeit der Anfälle, verbessern aber nicht die Kontrollwahrnehmung.",
    // UE 1: VL1 nennt die Gesundheitspsychologie nur als Fach, ohne diese Abgrenzung
    "Die Gesundheitspsychologie erforscht, wie psychologische Faktoren Gesundheit, Krankheit und Prävention beeinflussen, und kommt ohne medizinische Begriffe aus.",
    // UE 1: VL1 nennt die Psychosomatik nur als Fach, ohne diese Abgrenzung
    "Die Psychosomatik betrachtet das Wechselspiel von Psyche und körperlicher Erkrankung von der psychologischen statt von der medizinischen Seite her.",
    // UE 1: dass die Krankheitswahrnehmung automatisch einsetzt, steht nicht in VL1
    "Die Krankheitswahrnehmung setzt erst ein, wenn eine Person bewusst über ihre Gesundheit nachdenkt.",
    // UE 1: Migräne bei Kindern kommt in der Vorlesung nicht vor
    "Bei Kindern mit Migräne setzt man vor allem auf Medikamente, weil verhaltensorientierte Verfahren bei ihnen wenig bringen.",
    // UE 3: sozialer vs. nicht-sozialer Stress kommt in VL3 nicht vor
    "Bei sozialem Stress hält die Stressantwort weniger lange an als bei nicht-sozialem Stress.",
    // UE 3: Kontrollüberzeugungen und erlernte Hilflosigkeit kommen in VL3 nicht vor
    "Eine external fatalistische Kontrollüberzeugung kann zu erlernter Hilflosigkeit führen.",
    // UE 3: Selyes Allgemeines Adaptationssyndrom kommt in VL3 nicht vor
    "Im Allgemeinen Adaptationssyndrom nach Selye springt die HPA-Achse schon in der Alarmreaktion an, die SAM-Achse erst in der Widerstandsphase.",
    // UE 3: Yerkes-Dodson kommt in VL3 nicht vor
    "Nach Yerkes-Dodson besteht zwischen Erregungsniveau und Leistung eine umgekehrte U-Kurve mit dem Optimum im mittleren Bereich.",
    // UE 3: Cortisol bei PTBS stammt aus der Bio-2-Zusammenfassung, VL3 nennt die PTBS nur als Diagnose
    "Bei der PTBS ist die Cortisolfreisetzung typischerweise erhöht, und das Cortisol sinkt nicht ab.",
    // UE 3: Allostatic Load kommt in VL3 nicht vor
    "Allostatic Load bezeichnet den Preis, den man zahlt, wenn die Anpassungssysteme zu oft oder zu lange aktiviert werden.",
    // UE 4: VL4 zeigt Essstörungen nur als ICD-Verweis, nichts zur Therapie der Anorexie
    "Bei Anorexia nervosa ist vor allem KVT hilfreich, möglichst mit Einbezug und Schulung der Angehörigen.",
    // UE 4: VL4 zeigt Essstörungen nur als ICD-Verweis, nichts zum Gewicht bei Bulimie
    "Die Bulimia nervosa lässt sich gut über das Körpergewicht diagnostizieren, weil Betroffene meist untergewichtig sind.",
    // UE 9: VL9 definiert den Hirninfarkt, sagt aber nichts zu Schmerz oder Wahrnehmbarkeit
    "Ein Schlaganfall ist wie ein Herzinfarkt meist sofort an starken Schmerzen erkennbar, weil das Gehirn schmerzempfindlich ist.",
    // UE 9: VL9 listet Medikamente und Lebensstil, aber keine Reihenfolge «erste Wahl»
    "Bei Herz-Kreislauf-Erkrankungen ist der Lebensstil die erste Wahl, Medikamente wirken unterstützend.",
  ],
}
