/**
 * Auswertung von Inseraten und Vermietungsseiten mit Claude.
 *
 * Zwei Aufgaben, beide nur mit `ANTHROPIC_API_KEY` (fehlt er, liefern die
 * Funktionen nichts und der Sammler arbeitet wie bisher):
 *
 * * `inserateAuswerten`: liest aus Titel und Beschreibung, was die Felder der
 *   Portale verschweigen. Befristet und bis wann, WG-Zimmer statt Wohnung,
 *   Wohnfläche, Ausstattung, Tauschinserate und Zeichen für Betrug. Ersetzt die
 *   Regeln in `inserat-text.ts`, wo das Modell geantwortet hat.
 * * `seiteAuslesen`: holt aus dem Text einer Vermietungsseite (Genossenschaften,
 *   jede mit eigenem Aufbau) die freien Wohnungen als Liste. So braucht nicht
 *   jede Seite einen eigenen Parser.
 *
 * Der Sammler ruft beides nur für Neues auf: Ergebnisse stehen in
 * `wohnungen.json` und werden beim nächsten Lauf wiederverwendet.
 *
 * Umgebung:
 *   ANTHROPIC_API_KEY   Schlüssel für die Claude API
 *   KI_MODELL           freiwillig, sonst claude-opus-5-5
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import type { KiWerte, Merkmal, SeitenFund } from '../../app/wohnungen/typen.ts'

export type { KiWerte, SeitenFund }

const MODELL = process.env.KI_MODELL || 'claude-opus-5-5'

export const MERKMALE: Merkmal[] = ['balkon', 'waschmaschine', 'geschirrspueler', 'lift', 'haustiere', 'hindernisfrei']

/** Ohne Schlüssel kein Client; der Sammler läuft dann ohne Auswertung. */
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ maxRetries: 3, timeout: 120_000 }) : null
export const kiBereit = () => client != null

/** Verbrauchte Tokens seit dem Start, fürs Protokoll. */
export const kiVerbrauch = { anfragen: 0, eingabe: 0, ausgabe: 0 }

const DATUM = /^\d{4}-\d{2}-\d{2}$/

/** Ein Aufruf mit erzwungenem JSON-Schema. Lehnt das Modell ab, springt die Fallback-Kette des Servers ein. */
async function frage<T>(system: string, text: string, schema: Parameters<typeof betaJSONSchemaOutputFormat>[0]): Promise<T | null> {
  if (!client) return null
  const antwort = await client.beta.messages.parse({
    model: MODELL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaJSONSchemaOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: text }],
  })
  kiVerbrauch.anfragen++
  kiVerbrauch.eingabe += antwort.usage.input_tokens
  kiVerbrauch.ausgabe += antwort.usage.output_tokens
  if (antwort.stop_reason === 'refusal' || antwort.stop_reason === 'max_tokens') {
    console.warn(`KI: Antwort unbrauchbar (${antwort.stop_reason})`)
    return null
  }
  return (antwort.parsed_output as T | null) ?? null
}

// ─── Inserate ─────────────────────────────────────────────────────────────

const INSERAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['inserate'],
  properties: {
    inserate: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nr', 'wgZimmer', 'befristet', 'befristetBis', 'flaeche', 'merkmale', 'tausch', 'vorsicht'],
        properties: {
          nr: { type: 'integer' },
          wgZimmer: { type: 'boolean' },
          befristet: { type: 'boolean' },
          befristetBis: { type: ['string', 'null'] },
          flaeche: { type: ['number', 'null'] },
          merkmale: { type: 'array', items: { type: 'string', enum: MERKMALE } },
          tausch: { type: 'boolean' },
          vorsicht: { type: 'boolean' },
        },
      },
    },
  },
} as const

const INSERAT_SYSTEM = (heute: string) => `Du liest Mietinserate aus der Stadt Zürich (Deutsch oder Englisch) und füllst für jedes Inserat die Felder des Schemas. Die Ergebnisse steuern die Filter einer Wohnungssuche und die Suchabo-Mails: Ein falsches «ja» blendet eine passende Wohnung aus, deshalb nur setzen, was der Text hergibt. Heute ist ${heute}.

- nr: die Nummer des Inserats aus der Eingabe.
- wgZimmer: true, wenn ein einzelnes Zimmer in einer geteilten Wohnung vermietet wird (WG, Co-Living, «room in shared flat»). Eine ganze Wohnung, die sich für eine WG eignet («WG-tauglich»), ist false.
- befristet: true bei Zwischenmiete, Untermiete auf Zeit, Ferien- oder Kurzzeitwohnung oder einem festen Mietende. «Befristung möglich» oder ein Mindestmietdauer ist false.
- befristetBis: Ende der Befristung als JJJJ-MM-TT, wenn ein Datum oder Monat genannt ist (Monat ohne Tag: letzter Tag des Monats; ohne Jahr: das nächste solche Datum ab heute). Sonst null.
- flaeche: Wohnfläche der Wohnung in m², bei WG-Zimmern die Fläche des Zimmers. Nur wenn im Text genannt, sonst null.
- merkmale: was die Wohnung ausdrücklich hat. balkon (auch Terrasse, Loggia, Sitzplatz, Garten zur eigenen Nutzung), waschmaschine (eigene Waschmaschine oder Waschturm in der Wohnung, nicht gemeinsame Waschküche), geschirrspueler, lift, haustiere (Haustiere oder Katzen ausdrücklich erlaubt), hindernisfrei (rollstuhlgängig oder hindernisfrei).
- tausch: true, wenn es ein Wohnungstausch ist und die Wohnung nur gegen eine andere abgegeben wird.
- vorsicht: true nur bei deutlichen Zeichen für Betrug: Vermieter im Ausland, Schlüssel per Post, Zahlung oder Kaution vor der Besichtigung, Kontakt nur per E-Mail an eine fremde Adresse, Preis weit unter dem Markt zusammen mit einem dieser Zeichen.`

export type InseratText = { id: string; text: string }

/** Höchstens so viele Zeichen je Inserat. Lange Texte wiederholen meist nur Standardangaben der Verwaltung. */
const MAX_ZEICHEN = 5000

/** Wertet Inserate in Gruppen aus. Liefert je ausgewerteter Kennung die Werte; was scheitert, fehlt. */
export async function inserateAuswerten(liste: InseratText[], heute: string): Promise<Map<string, KiWerte>> {
  const raus = new Map<string, KiWerte>()
  if (!client || liste.length === 0) return raus
  const GRUPPE = 8
  const gruppen: InseratText[][] = []
  for (let i = 0; i < liste.length; i += GRUPPE) gruppen.push(liste.slice(i, i + GRUPPE))

  const eine = async (gruppe: InseratText[]) => {
    const text = gruppe.map((g, nr) => `<inserat nr="${nr}">\n${g.text.slice(0, MAX_ZEICHEN)}\n</inserat>`).join('\n\n')
    try {
      const a = await frage<{ inserate: (KiWerte & { nr: number })[] }>(INSERAT_SYSTEM(heute), text, INSERAT_SCHEMA)
      for (const w of a?.inserate ?? []) {
        const g = gruppe[w.nr]
        if (!g) continue
        raus.set(g.id, {
          wgZimmer: w.wgZimmer,
          befristet: w.befristet,
          befristetBis: w.befristetBis && DATUM.test(w.befristetBis) ? w.befristetBis : null,
          flaeche: w.flaeche != null && w.flaeche >= 6 && w.flaeche <= 600 ? Math.round(w.flaeche) : null,
          merkmale: [...new Set(w.merkmale.filter((m) => MERKMALE.includes(m)))],
          tausch: w.tausch,
          vorsicht: w.vorsicht,
        })
      }
    } catch (e) {
      console.warn(`KI: Gruppe nicht ausgewertet: ${e instanceof Error ? e.message : e}`)
    }
  }

  // Drei Anfragen gleichzeitig: schnell genug für den Fünf-Minuten-Takt, ohne die Grenzen der API zu reizen.
  for (let i = 0; i < gruppen.length; i += 3) await Promise.all(gruppen.slice(i, i + 3).map(eine))
  return raus
}

// ─── Vermietungsseiten ────────────────────────────────────────────────────

const SEITEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['wohnungen'],
  properties: {
    wohnungen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titel', 'art', 'strasse', 'plz', 'ort', 'zimmer', 'flaeche', 'miete', 'bezug', 'befristet', 'link'],
        properties: {
          titel: { type: 'string' },
          art: { type: 'string', enum: ['wohnung', 'wg', 'studio', 'haus', 'moebliert'] },
          strasse: { type: ['string', 'null'] },
          plz: { type: ['string', 'null'] },
          ort: { type: ['string', 'null'] },
          zimmer: { type: ['number', 'null'] },
          flaeche: { type: ['number', 'null'] },
          miete: { type: ['number', 'null'] },
          bezug: { type: ['string', 'null'] },
          befristet: { type: 'boolean' },
          link: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const

const SEITEN_SYSTEM = (heute: string) => `Du bekommst den Text der Vermietungsseite einer Wohnbaugenossenschaft oder Stiftung in Zürich. Links stehen als [Text](Adresse) im Text. Liste jede Wohnung, jedes Studio und jedes Zimmer auf, das jetzt zur Miete ausgeschrieben ist. Heute ist ${heute}.

Nicht aufnehmen: Gewerbe, Ateliers, Lager, Parkplätze, Bastelräume, Gästezimmer; Hinweise wie «zurzeit keine freien Wohnungen»; Wartelisten, Bauprojekte und Erstvermietungen, für die man sich noch nicht auf eine bestimmte Wohnung bewerben kann; abgelaufene Ausschreibungen. Gibt es nichts, ist die Liste leer.

- titel: kurz, wie auf der Seite, z. B. «3½-Zimmer-Wohnung, Siedlung Friesenberg».
- art: wohnung, wg (Zimmer in einer WG oder Cluster), studio, haus oder moebliert.
- strasse mit Hausnummer, plz, ort, soweit genannt.
- zimmer als Zahl (3½ = 3.5), flaeche in m², miete als Bruttomiete pro Monat in CHF (Netto plus Nebenkosten, falls getrennt angegeben).
- bezug: «sofort», «nach Vereinbarung» oder JJJJ-MM-TT.
- befristet: true bei befristeter Vermietung.
- link: die Adresse der Detailseite oder Ausschreibung dieser Wohnung, wenn eine im Text steht, sonst null.`

/** Liest die freien Wohnungen aus dem Text einer Seite. `null`, wenn das Modell nicht antworten konnte. */
export async function seiteAuslesen(text: string, heute: string): Promise<SeitenFund[] | null> {
  if (!client) return null
  const a = await frage<{ wohnungen: SeitenFund[] }>(SEITEN_SYSTEM(heute), text, SEITEN_SCHEMA)
  return a?.wohnungen ?? null
}
