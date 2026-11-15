/**
 * Paket 1 für Klinische Biopsychologie: je 15 neue Aussagen zu UE 1–4 (8 richtig, 7 falsch),
 * geschrieben aus Notes.md. Jede Aussage hat ein wörtliches Zitat aus den Notes; geprüft
 * per Skript, dass das Zitat dort vorkommt. flags sind die Hinweise der automatischen Prüfung.
 *
 * Wird beim Start einmal in die Inbox gespielt (lib/seed.ts, applyPacks). Die blinde
 * Gegenprüfung steht noch aus.
 */

import type { PackStatement } from "./types.ts"

export const PACK_ID = "klibio-ue1-4-v1"
export const PACK_SUBJECT = "klibio"

export const STATEMENTS: PackStatement[] = [
  {
    "unit": 1,
    "text": "Im biopsychosozialen Modell nach Engel gelten alle hierarchischen Ebenen der Einflüsse als gleich wichtig.",
    "truth": "R",
    "reason": null,
    "quote": "Einflüsse auf hierarchischen Ebenen, alle gleich wichtig",
    "sourceRef": "ZM S.7",
    "topic": "zum biopsychosozialen Modell und zur Krankheitswahrnehmung",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 1,
    "text": "Laut biopsychosozialem Modell sind die Psychoseraten auf dem Land höher als in der Stadt.",
    "truth": "F",
    "reason": "umgekehrt: in der Stadt höher als auf dem Land",
    "quote": "höhere Psychoseraten in der Stadt als auf dem Land",
    "sourceRef": "ZM S.7",
    "topic": "zum biopsychosozialen Modell und zur Krankheitswahrnehmung",
    "manipulationType": "vertauschung",
    "flags": []
  },
  {
    "unit": 1,
    "text": "Die WHO-Definition ist eine Definition von Gesundheit, nicht von Krankheit.",
    "truth": "R",
    "reason": null,
    "quote": "Die WHO-Definition ist eine Definition von Gesundheit, nicht von Krankheit",
    "sourceRef": "ZM S.8",
    "topic": "zu Gesundheitsbegriff und Klassifikationssystemen",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 1,
    "text": "Für die WHO-Definition von Gesundheit gibt es etablierte biopsychologische Marker.",
    "truth": "F",
    "reason": "es gibt keine Marker, sie beruht allein auf der subjektiven Einschätzung",
    "quote": "Es gibt derzeit keine biopsychologischen Marker dafür, sie beruht allein auf der subjektiven Einschätzung der Beschwerden.",
    "sourceRef": "VL2 p.1",
    "topic": "zu Gesundheitsbegriff und Klassifikationssystemen",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 1,
    "text": "In Behandlung kommt eine Person, wenn sie ihre eigene Handlungsfähigkeit als defizitär erlebt.",
    "truth": "R",
    "reason": null,
    "quote": "In Behandlung kommt eine Person, wenn sie ihre eigene Handlungsfähigkeit als defizitär erlebt",
    "sourceRef": "ZM S.8",
    "topic": "zum biopsychosozialen Modell und zur Krankheitswahrnehmung",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 1,
    "text": "Die Viszerozeption ist bewusster als die Propriozeption.",
    "truth": "F",
    "reason": "umgekehrt: die Propriozeption ist bewusster; die Viszerozeption spürt man vor allem, wenn etwas nicht gut läuft",
    "quote": "Die Propriozeption (Lage, Bewegung, Kraft, Geschwindigkeit) ist bewusster als die Viszerozeption",
    "sourceRef": "ZM S.8",
    "topic": "zum biopsychosozialen Modell und zur Krankheitswahrnehmung",
    "manipulationType": "vertauschung",
    "flags": []
  },
  {
    "unit": 1,
    "text": "Hat eine Person ein stark somatisches und wenig psychisches Konzept ihrer Krankheit, ist Therapie weniger hilfreich.",
    "truth": "R",
    "reason": null,
    "quote": "Wenn eine Person ein stark somatisches und wenig psychisches Konzept der Krankheit hat, ist Therapie weniger hilfreich.",
    "sourceRef": "VL1 p.13",
    "topic": "zum biopsychosozialen Modell und zur Krankheitswahrnehmung",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 1,
    "text": "Zu den Komponenten der Krankheitswahrnehmung gehören Identität, Dauer, Ursache, Konsequenzen und Kontrollierbarkeit.",
    "truth": "R",
    "reason": null,
    "quote": "Identität (was habe ich), Dauer (seit wann, wie lange noch), Ursache (woher), Konsequenzen (was bedeutet das, z. B. Medikamente nehmen, zu Hause bleiben) und Kontrollierbarkeit",
    "sourceRef": "ZM S.9",
    "topic": "zum biopsychosozialen Modell und zur Krankheitswahrnehmung",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 1,
    "text": "Die Antworten im Illness Perception Questionnaire sind weitgehend unabhängig von der Kultur der befragten Person.",
    "truth": "F",
    "reason": "die Antworten variieren je nach Kultur stark",
    "quote": "Er liegt nahe an der Kulturpsychologie, weil die Antworten je nach Kultur stark variieren.",
    "sourceRef": "ZM S.9",
    "topic": "zum biopsychosozialen Modell und zur Krankheitswahrnehmung",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 1,
    "text": "Teilt das soziale Umfeld den Sinn einer Intervention nicht, schwächt das deren Wirkung ab.",
    "truth": "R",
    "reason": null,
    "quote": "Teilt das Umfeld den Sinn einer Intervention nicht, schwächt das ihre Wirkung ab.",
    "sourceRef": "ZM S.9",
    "topic": "zum biopsychosozialen Modell und zur Krankheitswahrnehmung",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 1,
    "text": "Die ICF ist im Gegensatz zur ICD kostenpflichtig.",
    "truth": "F",
    "reason": "ICD und ICF sind beide kostenlos von der WHO; kostenpflichtig ist das DSM",
    "quote": "ICD und ICF sind kostenlos von der WHO, das DSM stammt von der APA und kostet rund 250 Franken.",
    "sourceRef": "ZM S.9",
    "topic": "zu Gesundheitsbegriff und Klassifikationssystemen",
    "manipulationType": "zuordnung",
    "flags": []
  },
  {
    "unit": 1,
    "text": "Die ICF basiert auf dem biopsychosozialen Modell und bildet die soziale Komponente (Teilhabe und Aktivität) direkt ab.",
    "truth": "R",
    "reason": null,
    "quote": "Sie basiert auf dem biopsychosozialen Modell und bildet die soziale Komponente (Teilhabe und Aktivität) direkt ab.",
    "sourceRef": "ZM S.9",
    "topic": "zu Gesundheitsbegriff und Klassifikationssystemen",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 1,
    "text": "Die ICF wird vor allem bei chronischen Erkrankungen breit genutzt.",
    "truth": "F",
    "reason": "bei chronischen Erkrankungen wird sie kaum genutzt",
    "quote": "Die ICF wird allerdings bei chronischen Erkrankungen kaum genutzt.",
    "sourceRef": "VL2 p.1",
    "topic": "zu Gesundheitsbegriff und Klassifikationssystemen",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 1,
    "text": "Migräne findet sich bei jungen Frauen in rund 25 % der Fälle.",
    "truth": "R",
    "reason": null,
    "quote": "Migräne findet sich bei jungen Frauen in rund 25% der Fälle, also sehr häufig.",
    "sourceRef": "VL2 p.1",
    "topic": "zu Migräne und ihrer Behandlung",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 1,
    "text": "Verhaltensorientierte Verfahren bei Migräne senken vor allem die Häufigkeit der Anfälle, verbessern aber nicht die Kontrollwahrnehmung.",
    "truth": "F",
    "reason": "umgekehrt: sie verbessern die Kontrollwahrnehmung, nicht die Häufigkeit der Anfälle",
    "quote": "Die Verfahren verbessern die Kontrollwahrnehmung, aber nicht die Häufigkeit der Anfälle.",
    "sourceRef": "ZM S.10",
    "topic": "zu Migräne und ihrer Behandlung",
    "manipulationType": "vertauschung",
    "flags": []
  },
  {
    "unit": 2,
    "text": "Zu den Merkmalen von Schlaf gehört eine homöostatische Regulierung, erkennbar am «Rebound» nach Schlafdeprivation.",
    "truth": "R",
    "reason": null,
    "quote": "homöostatische Regulierung, erkennbar am «Rebound» nach Schlafdeprivation",
    "sourceRef": "VL2 p.5",
    "topic": "zu Merkmalen und Messung des Schlafs",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 2,
    "text": "Seit der Entdeckung des EEG in den 1930er-Jahren gilt Schlaf als passiver Zustand.",
    "truth": "F",
    "reason": "seit dem EEG weiss man, dass Schlaf ein aktiver, stark regulierter Zustand ist; als passiv galt er früher",
    "quote": "Seit der Entdeckung des EEG in den 1930er-Jahren weiss man, dass Schlaf ein aktiver, stark regulierter Zustand ist",
    "sourceRef": "VL2 p.6",
    "topic": "zu Merkmalen und Messung des Schlafs",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 2,
    "text": "Schlafspindeln und K-Komplexe kennzeichnen das Schlafstadium N2.",
    "truth": "R",
    "reason": null,
    "quote": "N2/S2: Schlafspindeln und K-Komplexe",
    "sourceRef": "VL2 p.8",
    "topic": "zu Merkmalen und Messung des Schlafs",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 2,
    "text": "Im neueren System der AASM werden die Stadien S1 und S2 zu einem Stadium zusammengefasst.",
    "truth": "F",
    "reason": "zusammengefasst werden S3 und S4 (zu N3, Slow Wave Sleep)",
    "quote": "wobei S3 und S4 zusammengefasst werden",
    "sourceRef": "VL2 p.8",
    "topic": "zu Merkmalen und Messung des Schlafs",
    "manipulationType": "zahl",
    "flags": []
  },
  {
    "unit": 2,
    "text": "Die EEG-Amplituden werden erst mit zunehmender Schlaftiefe grösser, nicht schon mit zunehmender Müdigkeit.",
    "truth": "R",
    "reason": null,
    "quote": "Die EEG-Amplituden werden nicht mit zunehmender Müdigkeit grösser, sondern erst mit zunehmender Schlaftiefe.",
    "sourceRef": "VL2 p.9",
    "topic": "zu Merkmalen und Messung des Schlafs",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 2,
    "text": "Die Körpertemperatur ist am frühen Morgen am höchsten und am Abend am tiefsten.",
    "truth": "F",
    "reason": "umgekehrt: am frühen Morgen am tiefsten, am Abend am höchsten",
    "quote": "Am frühen Morgen ist sie am tiefsten, am Abend am höchsten.",
    "sourceRef": "VL2 p.9",
    "topic": "zur Regulation des Schlaf-Wach-Rhythmus",
    "manipulationType": "vertauschung",
    "flags": []
  },
  {
    "unit": 2,
    "text": "Licht hemmt die Melatoninausschüttung, Dunkelheit aktiviert sie.",
    "truth": "R",
    "reason": null,
    "quote": "Steuerung: Licht → Retina → Nucleus suprachiasmaticus → Zirbeldrüse; Licht hemmt, Dunkelheit aktiviert",
    "sourceRef": "VL2 p.10",
    "topic": "zur Regulation des Schlaf-Wach-Rhythmus",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 2,
    "text": "Pappenheimer zeigte, dass Blut von Ziegen mit Schlafentzug bei anderen Tieren Schlaf auslöst.",
    "truth": "F",
    "reason": "es war Hirnflüssigkeit (CSF), nicht Blut",
    "quote": "Pappenheimer (1967) zeigte, dass Hirnflüssigkeit (CSF) von Ziegen mit Schlafentzug bei anderen Tieren Schlaf auslöst",
    "sourceRef": "VL2 p.11",
    "topic": "zur Regulation des Schlaf-Wach-Rhythmus",
    "manipulationType": "zuordnung",
    "flags": []
  },
  {
    "unit": 2,
    "text": "Das ARAS enthält cholinerge und adrenerge Anteile; zu den adrenergen gehört der Locus coeruleus.",
    "truth": "R",
    "reason": null,
    "quote": "enthält cholinerge (PPT, LDT) und adrenerge Anteile (Locus coeruleus, Nuclei raphe)",
    "sourceRef": "VL2 p.12",
    "topic": "zur Regulation des Schlaf-Wach-Rhythmus",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 2,
    "text": "Im Wachzustand hemmt der laterale Hypothalamus den Hirnstamm über Orexin.",
    "truth": "F",
    "reason": "er aktiviert den Hirnstamm über Orexin",
    "quote": "Im Wachzustand aktiviert der laterale Hypothalamus den Hirnstamm über Orexin.",
    "sourceRef": "VL2 p.13",
    "topic": "zur Regulation des Schlaf-Wach-Rhythmus",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 2,
    "text": "In den Bunker-Experimenten ohne äussere Zeitgeber pendelte sich der Schlaf-Wach-Rhythmus bei etwa 25.1 Stunden ein.",
    "truth": "R",
    "reason": null,
    "quote": "Der Schlaf-Wach-Rhythmus verlängerte sich über die Tage langsam und pendelte sich bei etwa 25.1 Stunden ein",
    "sourceRef": "VL2 p.15",
    "topic": "zur Regulation des Schlaf-Wach-Rhythmus",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 2,
    "text": "Der stärkste Zeitgeber für den zirkadianen Rhythmus ist die soziale Interaktion.",
    "truth": "F",
    "reason": "der stärkste Zeitgeber ist Licht",
    "quote": "Licht ist der stärkste, dazu kommen Nahrung, Lärm, Temperatur und soziale Interaktion",
    "sourceRef": "VL2 p.16",
    "topic": "zur Regulation des Schlaf-Wach-Rhythmus",
    "manipulationType": "zuordnung",
    "flags": []
  },
  {
    "unit": 2,
    "text": "Unter Schlafentzug schätzen sich Personen mit zunehmendem Defizit für fähiger ein, genau wie unter Alkohol.",
    "truth": "F",
    "reason": "bei Schlafentzug schätzen sie sich schlechter ein, nur bei Alkohol für fähiger",
    "quote": "Bei Alkohol halten sich die Personen mit steigender Dosis für fähiger, bei Schlafentzug schätzen sie sich mit zunehmendem Defizit schlechter ein.",
    "sourceRef": "VL2 p.19",
    "topic": "zu den Folgen von Schlaf und Schlafentzug",
    "manipulationType": "zuordnung",
    "flags": []
  },
  {
    "unit": 2,
    "text": "Wer unmittelbar nach einer Hepatitis-A-Impfung schlafen konnte, hatte die bessere Impfwirkung.",
    "truth": "R",
    "reason": null,
    "quote": "Nach einer Hepatitis-A-Impfung durfte die eine Gruppe in der ersten Nacht schlafen, die andere nicht. Wer unmittelbar nach der Impfung schlafen konnte, hatte die bessere Impfwirkung",
    "sourceRef": "VL2 p.20",
    "topic": "zu den Folgen von Schlaf und Schlafentzug",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 2,
    "text": "Nach Schlafentzug entkoppelt sich die Amygdala vom mPFC, was zu einer Disinhibition führt.",
    "truth": "R",
    "reason": null,
    "quote": "Nach Schlafentzug entkoppelt sich die Amygdala vom mPFC, es kommt zur Disinhibition.",
    "sourceRef": "VL2 p.23",
    "topic": "zu den Folgen von Schlaf und Schlafentzug",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 3,
    "text": "In der schnellen Stressachse (SAM) leitet der Sympathikus über das Rückenmark direkt zum Nebennierenmark, das Adrenalin und Noradrenalin ausschüttet.",
    "truth": "R",
    "reason": null,
    "quote": "Der Sympathikus leitet über Nervenbahnen durch das Rückenmark direkt zum Nebennierenmark, das Adrenalin und Noradrenalin ausschüttet.",
    "sourceRef": "VL3 p.5",
    "topic": "zur biologischen Stressantwort",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 3,
    "text": "Bei sympathischer Aktivierung steigt die Herzratenvariabilität innert Sekunden an.",
    "truth": "F",
    "reason": "die Herzratenvariabilität sinkt",
    "quote": "deshalb steigen Blutdruck, Herzrate und Alpha-Amylase innert Sekunden, und die Herzratenvariabilität sinkt",
    "sourceRef": "VL3 p.5",
    "topic": "zur biologischen Stressantwort",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 3,
    "text": "Cortisol fährt die HPA-Achse über eine negative Rückkopplung selbst wieder herunter.",
    "truth": "R",
    "reason": null,
    "quote": "Cortisol hält die Mobilisierung danach aufrecht, greift in den Stoffwechsel ein und fährt über eine negative Rückkopplung die Achse selbst wieder herunter.",
    "sourceRef": "VL3 p.5",
    "topic": "zur biologischen Stressantwort",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 3,
    "text": "Bei sozialem Stress hält die Stressantwort weniger lange an als bei nicht-sozialem Stress.",
    "truth": "F",
    "reason": "sozialer Stress ist gravierender, die Stressantwort hält länger an",
    "quote": "sozial vs. nicht-sozial (sozialer Stress ist deutlich gravierender, die Stressantwort hält länger an)",
    "sourceRef": "ZM S.12",
    "topic": "zu Stressbegriff und Stressmodellen",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 3,
    "text": "Eine external fatalistische Kontrollüberzeugung kann zu erlernter Hilflosigkeit führen.",
    "truth": "R",
    "reason": null,
    "quote": "external fatalistisch (unkontrollierbar) sein. Letzteres kann zu erlernter Hilflosigkeit führen.",
    "sourceRef": "ZM S.12",
    "topic": "zu Stressbegriff und Stressmodellen",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 3,
    "text": "Im Allgemeinen Adaptationssyndrom nach Selye springt die HPA-Achse schon in der Alarmreaktion an, die SAM-Achse erst in der Widerstandsphase.",
    "truth": "F",
    "reason": "umgekehrt: in der Alarmreaktion Sympathikus und SAM-Achse, in der Widerstandsphase die HPA-Achse",
    "quote": "Alarmreaktion: Sympathikus und SAM-Achse, Adrenalin/Noradrenalin, sofortige Energiemobilisierung.",
    "sourceRef": "ZM S.13",
    "topic": "zu Stressbegriff und Stressmodellen",
    "manipulationType": "vertauschung",
    "flags": []
  },
  {
    "unit": 3,
    "text": "Das noradrenerge System wird unter Stress hochgefahren; seine Bahnen entspringen im Locus coeruleus.",
    "truth": "R",
    "reason": null,
    "quote": "Merke: Dieses System wird unter Stress hochgefahren. Die Bahnen entspringen im Locus coeruleus.",
    "sourceRef": "VL3 p.7",
    "topic": "zur biologischen Stressantwort",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 3,
    "text": "In ICD und DSM spielt die Ätiologie üblicherweise eine zentrale Rolle, auch ausserhalb der stressbedingten Störungen.",
    "truth": "F",
    "reason": "sonst spielt die Ätiologie keine Rolle; bei F43 ist Stress ausnahmsweise die definierte Ursache",
    "quote": "In DSM und ICD spielt die Ätiologie sonst üblicherweise keine Rolle — hier ist das anders, weil Stress die definierte Ursache ist.",
    "sourceRef": "VL3 p.8",
    "topic": "zu Stress als Ursache psychischer Störungen",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 3,
    "text": "Bei stressassoziierten Störungen ist der identifizierbare Stressor ein notwendiger, aber nicht hinreichender Kausalfaktor.",
    "truth": "R",
    "reason": null,
    "quote": "Es muss ein identifizierbarer Stressor vorliegen, und die Person muss ihn benennen können. Er ist ein notwendiger, aber nicht hinreichender Kausalfaktor",
    "sourceRef": "VL3 p.9",
    "topic": "zu Stress als Ursache psychischer Störungen",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 3,
    "text": "Eine PTBS setzt per Definition innerhalb eines Monats nach dem Ereignis ein.",
    "truth": "F",
    "reason": "der Beginn kann bis Jahrzehnte nach dem Ereignis liegen; «innerhalb eines Monats» gilt für die Anpassungsstörung",
    "quote": "Dauer: mindestens mehrere Wochen — der Beginn kann aber bis Jahrzehnte nach dem Ereignis liegen.",
    "sourceRef": "VL3 p.14",
    "topic": "zu Stress als Ursache psychischer Störungen",
    "manipulationType": "zuordnung",
    "flags": []
  },
  {
    "unit": 3,
    "text": "Zu den Symptomgruppen der PTBS gehört die anhaltende Wahrnehmung einer erhöhten aktuellen Bedrohung, etwa durch Hypervigilanz.",
    "truth": "R",
    "reason": null,
    "quote": "anhaltende Wahrnehmung einer erhöhten aktuellen Bedrohung, etwa durch Hypervigilanz oder eine verstärkte Schreckreaktion",
    "sourceRef": "VL3 p.14",
    "topic": "zu Stress als Ursache psychischer Störungen",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 3,
    "text": "Die Symptome einer Anpassungsstörung klingen in der Regel innerhalb weniger Tage ab.",
    "truth": "F",
    "reason": "innerhalb von sechs Monaten; «innert Tagen» gilt für die akute Belastungsreaktion",
    "quote": "Dauer: Die Symptome klingen in der Regel innerhalb von sechs Monaten ab, sofern der Stressor nicht länger anhält.",
    "sourceRef": "VL3 p.15",
    "topic": "zu Stress als Ursache psychischer Störungen",
    "manipulationType": "zuordnung",
    "flags": []
  },
  {
    "unit": 3,
    "text": "Die dissoziative Identitätsstörung trägt den Code 6B64.",
    "truth": "R",
    "reason": null,
    "quote": "6B64 Dissoziative Identitätsstörung",
    "sourceRef": "VL3 p.12",
    "topic": "zu Stress als Ursache psychischer Störungen",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 3,
    "text": "Bei der bipolaren Störung ist Stress Teil der Diagnosekriterien.",
    "truth": "F",
    "reason": "Stress kommt in den Kriterien nicht vor; er wirkt nur als Auslöser einer Episode",
    "quote": "In den Diagnosekriterien der bipolaren Störung kommt Stress nicht vor.",
    "sourceRef": "VL3 p.16",
    "topic": "zu Stress als Auslöser und zur bipolaren Störung",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 3,
    "text": "Laut Leitlinie ist die Therapie der Manie rein psychotherapeutisch nicht belegt.",
    "truth": "R",
    "reason": null,
    "quote": "Die Therapie der Manie ist rein psychotherapeutisch nicht belegt.",
    "sourceRef": "VL3 p.18",
    "topic": "zu Stress als Auslöser und zur bipolaren Störung",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 4,
    "text": "GLP-1 aus dem Darm gehört zu den hemmenden Signalen, die die Nahrungsaufnahme verringern.",
    "truth": "R",
    "reason": null,
    "quote": "Hormone, die das Motivationsverhalten zur Nahrungsaufnahme dämpfen und so die Nahrungsaufnahme verringern: - Leptin aus den Fettzellen - Insulin und Amylin aus der Bauchspeicheldrüse - GLP-1 aus dem Darm",
    "sourceRef": "VL4 p.5",
    "topic": "zur Regulation von Hunger und Motivation",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 4,
    "text": "Im Nucleus arcuatus regen die POMC/CART-Neurone den Appetit an, die NPY/AgRP-Neurone dämpfen ihn.",
    "truth": "F",
    "reason": "umgekehrt: POMC/CART dämpfen (anorexigen), NPY/AgRP regen an (orexigen)",
    "quote": "Die POMC/CART-Neurone dämpfen den Appetit (anorexigen), die NPY/AgRP-Neurone regen ihn an (orexigen).",
    "sourceRef": "VL4 p.7",
    "topic": "zur Regulation von Hunger und Motivation",
    "manipulationType": "vertauschung",
    "flags": []
  },
  {
    "unit": 4,
    "text": "Der Pfad von der Substantia nigra zum dorsalen Striatum ist für Gewohnheiten zuständig.",
    "truth": "R",
    "reason": null,
    "quote": "Von der Substantia nigra führt ein zweiter Pfad zum dorsalen Striatum. Er ist für Gewohnheiten zuständig",
    "sourceRef": "VL4 p.7",
    "topic": "zur Regulation von Hunger und Motivation",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 4,
    "text": "Unter normalen Bedingungen verstärkt der präfrontale Kortex das belohnungsorientierte Verhalten.",
    "truth": "F",
    "reason": "er begrenzt es",
    "quote": "unter normalen Bedingungen begrenzt der präfrontale Kortex das belohnungsorientierte Verhalten",
    "sourceRef": "VL4 p.8",
    "topic": "zu Belohnungssystem und Sucht",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 4,
    "text": "Phasische Dopaminsignale markieren Salienz und unterstützen assoziatives Lernen.",
    "truth": "R",
    "reason": null,
    "quote": "Phasische Dopaminsignale markieren Salienz und unterstützen assoziatives Lernen",
    "sourceRef": "VL4 p.8",
    "topic": "zu Belohnungssystem und Sucht",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 4,
    "text": "Bei vulnerablen Personen setzen relevante Hinweisreize unterdurchschnittlich wenig Dopamin frei.",
    "truth": "F",
    "reason": "sie setzen überproportional viel Dopamin frei",
    "quote": "Bei vulnerablen Personen setzen relevante Hinweisreize überproportional viel Dopamin frei, während die hemmenden präfrontalen Netzwerke schwächer wirken.",
    "sourceRef": "VL4 p.8",
    "topic": "zu Belohnungssystem und Sucht",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 4,
    "text": "Verhaltenssüchte und Substanzstörungen teilen dieselben mesokortikolimbischen Mechanismen.",
    "truth": "R",
    "reason": null,
    "quote": "Deshalb teilen Verhaltenssüchte und Substanzstörungen dieselben mesokortikolimbischen Mechanismen",
    "sourceRef": "VL4 p.8",
    "topic": "zu Belohnungssystem und Sucht",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 4,
    "text": "Dass Valenz-Systeme in allen psychischen Störungen eine Rolle spielen, ist im RDoC des US National Institute of Mental Health abgebildet.",
    "truth": "R",
    "reason": null,
    "quote": "Dass Motivationssysteme — die Valenz-Systeme — in allen psychischen Störungen eine Rolle spielen, ist im RDoC (Research Domain Criteria) des US National Institute of Mental Health abgebildet.",
    "sourceRef": "VL4 p.9",
    "topic": "zu Belohnungssystem und Sucht",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 4,
    "text": "Der restriktive Typ der Anorexia nervosa ist durch Massnahmen zur Gewichtsreduktion gekennzeichnet.",
    "truth": "F",
    "reason": "restriktiv = ohne Massnahmen; mit Massnahmen ist der aktive Typ",
    "quote": "F50.00 restriktiver Typ: Anorexia nervosa ohne Massnahmen zur Gewichtsreduktion.",
    "sourceRef": "VL4 p.10",
    "topic": "zu Essstörungen nach ICD",
    "manipulationType": "vertauschung",
    "flags": []
  },
  {
    "unit": 4,
    "text": "R63.0 (Anorexia o.n.A.) wird als unspezifische Form der Anorexia nervosa kodiert.",
    "truth": "F",
    "reason": "R63.0 ist der blosse Appetitverlust und bei F50 ausgeschlossen; die unspezifische Form ist F50.08",
    "quote": "R63.0 meint also den blossen Appetitverlust, nicht die Essstörung. Er wird gerade nicht als Form der Anorexia nervosa kodiert.",
    "sourceRef": "VL4 p.10",
    "topic": "zu Essstörungen nach ICD",
    "manipulationType": "zuordnung",
    "flags": []
  },
  {
    "unit": 4,
    "text": "Bei der atypischen Anorexia nervosa können Schlüsselsymptome wie die Amenorrhoe fehlen.",
    "truth": "R",
    "reason": null,
    "quote": "Es können z. B. Schlüsselsymptome wie die deutliche Angst vor dem Dicksein oder die Amenorrhoe fehlen, trotz erheblichem Gewichtsverlust und gewichtsreduzierendem Verhalten.",
    "sourceRef": "VL4 p.10",
    "topic": "zu Essstörungen nach ICD",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 4,
    "text": "Im ICD-10 ist die Binge-Eating-Störung bereits eine eigenständige Diagnose.",
    "truth": "F",
    "reason": "eigenständig erst im ICD-11 (6B82)",
    "quote": "Im ICD-10 gibt es Binge Eating noch nicht als eigene Diagnose, sondern nur als Teil einer bulimischen Störung.",
    "sourceRef": "VL4 p.11",
    "topic": "zu Essstörungen nach ICD",
    "manipulationType": "negation",
    "flags": []
  },
  {
    "unit": 4,
    "text": "Bei Anorexia nervosa ist vor allem KVT hilfreich, möglichst mit Einbezug und Schulung der Angehörigen.",
    "truth": "R",
    "reason": null,
    "quote": "Hilfreich ist Psychotherapie, vor allem KVT, möglichst mit Einbezug und Schulung der Angehörigen, die massiv mitbetroffen sind.",
    "sourceRef": "ZM S.58",
    "topic": "zur Behandlung von Essstörungen und Sucht",
    "manipulationType": null,
    "flags": []
  },
  {
    "unit": 4,
    "text": "Bei den Konsumstörungen im ICD-10 kodiert die dritte Stelle das klinische Bild und die vierte Stelle die Substanz.",
    "truth": "F",
    "reason": "umgekehrt: die dritte Stelle kodiert die Substanz, die vierte das klinische Bild",
    "quote": "Konsum im ICD-10: F10–F19. Geht es um die spezifische Substanz, folgt die Systematik für jede Substanz demselben Muster. Die dritte Stelle kodiert die Substanz",
    "sourceRef": "VL4 p.15",
    "topic": "zu Essstörungen und Konsumstörungen nach ICD",
    "manipulationType": "vertauschung",
    "flags": []
  },
  {
    "unit": 4,
    "text": "Laut Leitlinie soll bei Alkoholabhängigkeit eine Komplexbehandlung durch ein multiprofessionelles Team angeboten werden.",
    "truth": "R",
    "reason": null,
    "quote": "Bei Alkoholabhängigkeit soll eine Komplexbehandlung angeboten werden, also eine Kombination verschiedener Interventionen durch ein multiprofessionelles Team",
    "sourceRef": "VL4 p.17",
    "topic": "zur Behandlung von Essstörungen und Sucht",
    "manipulationType": null,
    "flags": []
  }
]
