/**
 * Startbestand für «Klinische Biopsychologie» (26HS 200-401a).
 *
 * BANK: die bisherige Exercises-Datei Klickerfragen_KliBio.md, unverändert. Jede
 * Aussage hat Lösung, Begründung und Fundstelle, aber noch kein wörtliches Zitat;
 * sie kommt deshalb mit dem Hinweis «import_ohne_zitat» in die Bank.
 *
 * OLAT: die Klickerfragen zu VL4 aus OLAT. Ohne Lösungsschlüssel, deshalb nur als
 * Stilvorlage für Länge, Fallen und Schwierigkeit, nicht als Aussagen.
 */

export const SUBJECT = {
  name: 'Klinische Biopsychologie',
  shortName: 'KliBio',
  courseCode: '26HS 200-401a',
  vaultPath: 'Klinische Biopsychologie',
  slidesPattern: 'Slides/VL{n}.pdf',
  zmPath: 'Zusammenfassungen/ZM_Klinische Biopsychologie.pdf',
  ueLimit: 4,
}

export const UNITS = [
  { number: 1, title: 'Einführung' },
  { number: 2, title: 'Schlaf' },
  { number: 3, title: 'Stress' },
  { number: 4, title: 'Essen und Konsum' },
]

export const BANK = `# 14.11.2026

## Frage 1 (UE 4: Essen und Konsum)
Welche Aussagen zu Hunger- und Sättigungssignalen treffen zu?

A)Ghrelin überwindet die Blut-Hirn-Schranke und wirkt u. a. im Hippocampus, wo es Erinnerungen an Essen beeinflusst.
B) Insulin und Amylin stammen aus der Bauchspeicheldrüse und verringern die Nahrungsaufnahme.
C) Leptin wird in der Bauchspeicheldrüse gebildet und steigert den Appetit.
D) Der paraventrikuläre Thalamus erhält Signale aus dem Nucleus arcuatus und dem lateralen Hypothalamus und gibt sie an das dopaminerge Motivationssystem weiter.
E) Das dopaminerge System entscheidet nicht darüber, ob der Körper Energie braucht, sondern darüber, ob man Lust hat zu essen.

> [!check]- Lösung
> **Richtig: A, B, D, E**
> - A: richtig (ZM S.69)
> - B: richtig (VL4 p.5)
> - C: falsch, Leptin kommt aus den Fettzellen und hemmt den Appetit (VL4 p.5)
> - D: richtig (VL4 p.6)
> - E: richtig (VL4 p.5)

## Frage 2 (UE 4: Essen und Konsum)
Welche Aussagen zu den Behandlungsempfehlungen bei Essstörungen und Suchterkrankungen treffen zu?

A) Laut Vorlesung wird in der Therapie von Essstörungen Pharmakotherapie mit Psychotherapie kombiniert.
B) Hypnotherapie wird zur Raucherentwöhnung mit Empfehlungsgrad A empfohlen.
C)Psychodynamische Kurzzeittherapie ist bei Alkohol mit Empfehlungsgrad A empfohlen.
D) Verhaltenstherapeutische Gruppeninterventionen zur Tabakabstinenz sollen laut Leitlinie mit Empfehlungsgrad A angeboten werden.
E) GLP-1-Präparate allein sichern bei der Binge-Eating-Störung den langfristigen Therapieerfolg.

> [!check]- Lösung
> **Richtig: D**
> - A: falsch, laut Vorlesung gibt es keine Pharmakotherapie bei Essstörungen; GLP-1 gibt höchstens initiale Kontrolle (VL4 p.16)
> - B: falsch, Grad 0, «kann angeboten werden» (VL4 p.17)
> - C: falsch, Grad 0 (VL4 p.17)
> - D: richtig (VL4 p.17)
> - E: falsch, GLP-1 gibt initiale Kontrolle, langfristig trägt die Verhaltensintervention (VL4 p.16)

## Frage 3 (UE 1: Einführung)
Welche Aussagen zu Konzept, Körperwahrnehmung und Diagnosesystemen treffen zu?

A) Die Verhaltensmedizin ist ein Teilgebiet der Psychosomatik und grenzt sich klar von der Gesundheitspsychologie ab.
B) Jeder Vorlesungstermin ist aufgebaut als klinisches Beispiel → Grundlagen → Prüfungsfragen.
C) Propriozeption bezeichnet die Wahrnehmung der Eingeweide und der Organtätigkeit.
D) Der Illness Perception Questionnaire wurde 1984 von Leventhal entwickelt.
E) Das DSM wird von der WHO herausgegeben und ist stärker symptomorientiert als die ICD.

> [!check]- Lösung
> **Richtig: keine**
> - A: falsch, sie liegt im Schnittfeld u. a. von Klinischer Psychologie, Gesundheitspsychologie, Biologischer Psychologie, Neurowissenschaften, Psychosomatik und Medizinischer Psychologie (VL1 p.3)
> - B: falsch, umgekehrt: Prüfungsfragen → Grundlagen → klinisches Beispiel (VL1 p.7)
> - C: falsch, das ist Viszerozeption; Propriozeption = Lage, Bewegung, Kraft, Geschwindigkeit (VL1 p.12)
> - D: falsch, IPQ von Moss-Morris et al. (2002), deutsch Gaab & Ehlert (2005) (VL1 p.14)
> - E: falsch, das DSM stammt von der APA und ist weniger symptomorientiert als die ICD (VL1 p.23)

## Frage 4 (UE 2: Schlaf)
Welche Aussagen zur Regulation des Schlafs und zu den Schlaf-Wach-Schaltkreisen treffen zu?

A) Neben Prozess S und Prozess C kommt als dritter Faktor die externe Stimulation dazu.
B) Melatonin wird in der Zirbeldrüse aus Tryptophan über Serotonin gebildet und hat seinen Peak in der Nacht.
C) Im Schlaf hemmt der VLPO über GABA wachheitsfördernde Zentren wie den TMN.
D) Nach dem Flip-Flop-Modell gibt es keine stabilen Zwischenzustände zwischen Wachen und Schlafen.
E) Das Flip-Flop-Modell widerspricht dem Zwei-Prozesse-Modell nicht, sondern erklärt den Mechanismus des Übergangs.

> [!check]- Lösung
> **Richtig: A, B, C, D, E**
> - A: richtig (VL2 p.9)
> - B: richtig (VL2 p.10)
> - C: richtig (VL2 p.13)
> - D: richtig, gegenseitige Hemmung → bi-stabil, schneller Wechsel (VL2 p.14)
> - E: richtig, Borbély erklärt, wann geschlafen wird, das Flip-Flop-Modell, wie der Wechsel abläuft (VL2 p.14)

## Frage 5 (UE 3: Stress)
Welche Aussagen zur Stressantwort und zu den stressbezogenen Störungen treffen zu?

A) In der HPA-Achse schüttet der Hypothalamus CRH aus, die Hypophyse ACTH und die Nebennierenrinde Cortisol.
B) Adrenalin und Noradrenalin werden in der Nebennierenrinde gebildet.
C) Unter Stress übernimmt der präfrontale Kortex verstärkt die Steuerung, was zu langsamen, durchdachten Reaktionen führt.
D) Für eine Anpassungsstörung braucht es ein Ereignis von extrem bedrohlicher Natur.
E) Die akute Belastungsreaktion gilt als normale Reaktion und klingt innert Tagen ab.

> [!check]- Lösung
> **Richtig: A, E**
> - A: richtig (VL3 p.5)
> - B: falsch, sie kommen aus dem Nebennierenmark (VL3 p.5)
> - C: falsch, die frontale Kontrolle nimmt ab, die Amygdala übernimmt (bottom-up) (VL3 p.6)
> - D: falsch, der Auslöser liegt im normalen Lebensbereich, z. B. Scheidung oder Trauerfall (VL3 p.15)
> - E: richtig (VL3 p.13)
`

export const OLAT_EXAMPLES = [
  {
    unit: 4,
    kind: 'olat',
    sourceLabel: 'OLAT Klickerfragen_VL4, Frage 1',
    stem: 'Welche Aussagen zum Zusammenhang zwischen Motivationssystemen, Belohnung und psychischen Störungen treffen vollständig zu?',
    options: [
      'Das Belohnungsnetzwerk umfasst u.a. das ventrale Striatum/Nucleus accumbens, den orbitofrontalen Cortex (OFC), den anterioren cingulären Cortex (ACC), die Amygdala und den Hippocampus; phasische Dopaminsignale markieren dabei Salienz und unterstützen assoziatives Lernen.',
      'Der Hypothalamus (u.a. Nucleus arcuatus und lateraler Hypothalamus) integriert orexigene und anorexigene Signale aus Peripherie und ZNS und leitet sie im Hungerzustand unter Umgehung des Thalamus direkt an die dopaminergen Neurone des ventralen Tegmentums weiter.',
      'Unter normalen Bedingungen verstärken Signale des präfrontalen Kortex belohnungsorientiertes Verhalten, weshalb eine Abschwächung der präfrontalen Aktivität bei vulnerablen Personen das Risiko für Verhaltenssüchte und Substanzstörungen verringert.',
      'Verhaltenssüchte, wie Glücksspielstörung und Substanzstörungen, weisen gemeinsame mesokortikolimbische Mechanismen auf.',
      'Das RDoC-System des NIMH berücksichtigt Motivationssysteme (Valenz-Systeme) als transdiagnostisch relevante Systeme, also nicht nur bei Substanzabhängigkeitsstörungen.',
    ],
  },
  {
    unit: 4,
    kind: 'olat',
    sourceLabel: 'OLAT Klickerfragen_VL4, Frage 2',
    stem: 'Welche Aussagen zu Essstörungen nach ICD sind korrekt?',
    options: [
      'Anorexia nervosa ist laut ICD durch einen absichtlichen selbst herbeigeführten oder aufrechterhaltenen Gewichtsverlust charakterisiert, wobei die Angst vor einem dicken Körper als tiefverwurzelte Idee besteht.',
      'Die Binge-Eating-Störung beschreibt im ICD-10 eine eigene Störung, die gekennzeichnet ist durch Essanfälle ohne anschliessende kompensatorische Massnahmen.',
      'Der Code R63.0 (Anorexia o.n.A.) gehört nach ICD-10 zur Kategorie F50.- (Essstörungen) und wird als unspezifische Form der Anorexia nervosa mitkodiert.',
      'Von einer Atypischen Anorexia nervosa spricht man, wenn trotz erheblichen Gewichtsverlusts und gewichtsreduzierendem Verhalten Schlüsselsymptome wie die Angst vor dem Dicksein oder die Amenorrhoe fehlen und das Gesamtbild die Diagnose Anorexia nervosa nicht rechtfertigt.',
      'Der restriktive Typ der Anorexia nervosa ist durch den zusätzlichen Einsatz gewichtsreduzierender Massnahmen, wie selbstinduziertem Erbrechen, gekennzeichnet, während beim aktiven Typ keine solchen Massnahmen vorliegen.',
    ],
  },
  {
    unit: 4,
    kind: 'olat',
    sourceLabel: 'OLAT Klickerfragen_VL4, Frage 3',
    stem: 'Welche Aussagen zu den Behandlungsempfehlungen bei Essstörungen und Suchterkrankungen treffen zu?',
    options: [
      'Im Rahmen der Therapie der Binge-Eating-Störung werden u.a. Expositionssitzungen mit besonders schmackhaften Nahrungsmitteln durchgeführt, wobei die Teilnehmenden Nahrungsmittel mitbringen, die bei ihnen am ehesten ein unkontrollierbares Essverhalten auslösen.',
      'Verhaltenstherapeutische Gruppeninterventionen zur Erreichung der Tabakabstinenz sollen laut Leitlinie mit Empfehlungsgrad A in der medizinischen, psychotherapeutischen und psychosozialen Gesundheitsversorgung angeboten werden.',
      'Die Therapie von Essstörungen kombiniert Pharmakotherapie mit Psychotherapie, so dass die Stärkung der Selbstkontrollfähigkeiten den Patient:innen leichter fällt.',
      'Laut Leitlinie sollen motivationale Interventionsformen im Rahmen der Postakutbehandlung von Suchterkrankungen angeboten werden.',
      'Auch Hypnotherapie wird laut Leitlinie zur Raucherentwöhnung mit hohem Evidenz- und Empfehlungsgrad (A) empfohlen',
    ],
  },
].map((e) => ({ ...e, options: e.options.map((text) => ({ text, truth: null })) }))
