/**
 * Verschickt die Suchabos der Wohnungssuche per E-Mail.
 *
 *   node pipeline/21-suchabos.ts [wohnungen.json]
 *
 * Läuft im Workflow `wohnungen.yml` direkt nach dem Sammler. Für jedes aktive
 * Abo in `wohnungen_suchabos`:
 *
 * * Neu angelegt (`bestaetigt = false`): eine Bestätigung mit den Wohnungen,
 *   die heute schon passen.
 * * Sonst: alle Inserate, die seit dem letzten Lauf zum ersten Mal aufgetaucht
 *   sind (`erstGesehen > geprueft_bis`) und zum Filter passen, in einer Mail.
 *
 * Geprüft wird mit derselben Funktion wie auf der Seite (`app/wohnungen/filter.ts`).
 *
 * Braucht drei Umgebungsvariablen, sonst tut das Skript nichts. Es sind
 * dieselben Werte wie bei Vercel, nur müssen sie zusätzlich als Secrets in
 * GitHub stehen, weil der Versand im Workflow läuft:
 *   SUPABASE_URL                Adresse des Supabase-Projekts
 *   SUPABASE_SERVICE_ROLE_KEY   geheimer Schlüssel, liest alle Abos an der Row Level Security vorbei
 *   RESEND_API_KEY              Schlüssel von resend.com für den Versand
 *   SUCHABO_ABSENDER            freiwillig, sonst «angebunden <wohnungen@angebunden.ch>»; Domain bei Resend bestätigt
 */
import { readFileSync } from 'node:fs'
import { FILTER_LEER, passt, type Filter } from '../app/wohnungen/filter.ts'
import type { Inserat, Wohnungen } from '../app/wohnungen/typen.ts'

const DATEI = process.argv[2] ?? 'public/data/zuerich/wohnungen.json'
const SITE = (process.env.SITE_URL ?? 'https://angebunden.ch').replace(/\/$/, '')
const SUPABASE = process.env.SUPABASE_URL?.replace(/\/$/, '')
const GEHEIM = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESEND = process.env.RESEND_API_KEY
const ABSENDER = process.env.SUCHABO_ABSENDER || 'angebunden <wohnungen@angebunden.ch>'

/** Höchstens so viele Wohnungen in einer Mail; der Rest steht auf der Seite. */
const MAX_IN_MAIL = 15

type Abo = {
  id: string
  email: string
  name: string
  filter: Partial<Filter>
  bestaetigt: boolean
  geprueft_bis: string | null
  abmelde_token: string
  /** Prüfsummen der Inserate, die dieses Abo schon kennt (fehlt, solange die Migration nicht eingespielt ist). */
  gesendet?: string[] | null
}

/** So viele Prüfsummen merkt sich ein Abo, die neuesten zuerst. Reicht für jede Suche in Zürich. */
const GEDAECHTNIS = 4000

/** Kurze, stabile Prüfsumme eines Links (FNV-1a, 32 Bit), damit die Liste im Abo klein bleibt. */
function pruefsumme(text: string): string {
  let h = 0x811c9dc5
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** Alle Prüfsummen eines Inserats: jeder Link zählt, auch wenn Doppelte anders zusammengelegt werden. */
const summen = (i: Inserat) => i.links.map((l) => pruefsumme(l.url))

async function db(pfad: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE}/rest/v1/${pfad}`, {
    ...init,
    headers: {
      apikey: GEHEIM!,
      Authorization: `Bearer ${GEHEIM}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

const html = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const nf = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '’')

function zeile(i: Inserat): string {
  const eck = [
    i.zimmer != null ? `${String(i.zimmer).replace('.5', '½')} Zi.` : null,
    i.flaeche != null ? `${Math.round(i.flaeche)} m²` : null,
    [i.strasse, i.plz].filter(Boolean).join(', ') || null,
    i.befristet ? 'befristet' : null,
  ].filter(Boolean)
  const bild = i.bild
    ? `<img src="${html(i.bild)}" width="96" height="72" alt="" style="display:block;width:96px;height:72px;object-fit:cover;border-radius:8px;background:#eeeeeb">`
    : `<div style="width:96px;height:72px;border-radius:8px;background:#eeeeeb"></div>`
  return `
  <tr>
    <td style="padding:10px 12px 10px 0;vertical-align:top"><a href="${html(i.links[0].url)}">${bild}</a></td>
    <td style="padding:10px 0;vertical-align:top;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
      <div style="font-size:16px;font-weight:600">${i.miete != null ? `CHF ${nf(i.miete)}` : 'Preis auf Anfrage'}</div>
      <a href="${html(i.links[0].url)}" style="color:#18181b;font-size:14px;text-decoration:none">${html(i.titel)}</a>
      <div style="font-size:12px;color:#71717a;margin-top:2px">${html(eck.join(' · '))}</div>
      <div style="font-size:12px;margin-top:6px">
        <a href="${html(i.links[0].url)}" style="color:#18181b">Inserat öffnen</a>
        <span style="color:#a1a1aa"> · </span>
        <a href="${SITE}/wohnungen?inserat=${encodeURIComponent(i.id)}&amp;u=${encodeURIComponent(i.links[0].url)}" style="color:#18181b">Auf der Karte</a>
      </div>
    </td>
  </tr>`
}

function mail(abo: Abo, inserate: Inserat[], bestaetigung: boolean): { betreff: string; inhalt: string } {
  const abmelden = `${SITE}/wohnungen?abmelden=${abo.abmelde_token}`
  const titel = bestaetigung
    ? `Dein Suchabo «${abo.name}» ist aktiv`
    : `${inserate.length} neue ${inserate.length === 1 ? 'Wohnung' : 'Wohnungen'}: ${abo.name}`
  const text = bestaetigung
    ? `Ab jetzt bekommst du eine Mail, sobald eine neue Wohnung zu deiner Suche passt. Der Sammler schaut alle fünf Minuten nach.${
        inserate.length ? ` Heute passen schon ${inserate.length}, hier die neuesten fünf:` : ''
      }`
    : 'Diese Wohnungen sind seit der letzten Mail neu dazugekommen:'
  // Die Bestätigung zeigt nur ein paar Beispiele, die Liste ist dann meist lang.
  const liste = inserate.slice(0, bestaetigung ? 5 : MAX_IN_MAIL)
  const mehr = inserate.length - liste.length
  const inhalt = `<!doctype html><html><body style="margin:0;background:#f7f7f5">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
    <div style="font-size:15px;font-weight:600">angebunden<span style="color:#cc3934">.</span> Wohnungen</div>
    <h1 style="font-size:20px;margin:18px 0 6px">${html(titel)}</h1>
    <p style="font-size:14px;line-height:1.5;color:#3f3f46;margin:0 0 8px">${html(text)}</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${liste.map(zeile).join('')}</table>
    ${mehr > 0 ? `<p style="font-size:13px;color:#71717a">und ${mehr} weitere.</p>` : ''}
    <p style="margin:22px 0"><a href="${SITE}/wohnungen" style="background:#18181b;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-size:14px">Alle auf der Karte ansehen</a></p>
    <p style="font-size:12px;color:#a1a1aa;line-height:1.5;margin-top:28px">
      Du bekommst diese Mail, weil du auf ${html(SITE.replace(/^https?:\/\//, ''))} das Suchabo «${html(abo.name)}» angelegt hast.
      <a href="${abmelden}" style="color:#71717a">Abmelden</a> · <a href="${SITE}/wohnungen" style="color:#71717a">Suchabos verwalten</a>
    </p>
  </div></body></html>`
  return { betreff: titel, inhalt }
}

async function senden(an: string, betreff: string, inhalt: string, abmelden: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: ABSENDER,
      to: [an],
      subject: betreff,
      html: inhalt,
      headers: { 'List-Unsubscribe': `<${abmelden}>` },
    }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
}

async function main() {
  if (!SUPABASE || !GEHEIM || !RESEND) {
    console.log('Suchabos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY oder RESEND_API_KEY fehlt, kein Versand.')
    return
  }
  const daten = JSON.parse(readFileSync(DATEI, 'utf8')) as Wohnungen
  const abos = (await db('wohnungen_suchabos?aktiv=eq.true&select=*')) as Abo[]
  const jetzt = Date.parse(daten.erstellt)
  let mails = 0

  for (const abo of abos) {
    try {
      // Was nur auf der Seite Sinn ergibt, gilt im Abo nicht.
      const f: Filter = { ...FILTER_LEER, ...abo.filter, nurGemerkt: false, nurAusschnitt: false, nurNeu: false }
      const alle = daten.inserate.filter((i) => passt(i, f, new Set(), jetzt, null))
      const kennt = new Set(abo.gesendet ?? [])
      // Neu ist, was das Abo noch nie gesehen hat und seit dem letzten Lauf aufgetaucht ist.
      const neu = abo.bestaetigt
        ? alle.filter(
            (i) => !summen(i).some((h) => kennt.has(h)) && (!abo.geprueft_bis || i.erstGesehen > abo.geprueft_bis)
          )
        : alle
      neu.sort((a, b) => b.erstGesehen.localeCompare(a.erstGesehen))

      // Alles, was jetzt passt, gilt ab jetzt als bekannt, die neuesten zuerst.
      const gesendet = [...new Set([...neu.flatMap(summen), ...alle.flatMap(summen), ...(abo.gesendet ?? [])])].slice(0, GEDAECHTNIS)

      // Erst den Stand speichern, dann senden: Bricht etwas dazwischen ab, fehlt höchstens eine
      // Mail, statt dass dieselbe Wohnung beim nächsten Lauf noch einmal hinausgeht.
      const speichern = (stand: Record<string, unknown>) =>
        db(`wohnungen_suchabos?id=eq.${abo.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(stand),
        })
      const neuerStand = { bestaetigt: true, geprueft_bis: daten.erstellt }
      try {
        await speichern({ ...neuerStand, gesendet })
      } catch (e) {
        // Ohne die Spalte `gesendet` (Migration noch nicht eingespielt) wenigstens den Zeitpunkt.
        if (!String(e).includes('gesendet')) throw e
        await speichern(neuerStand)
      }

      if (!abo.bestaetigt || neu.length) {
        const { betreff, inhalt } = mail(abo, neu, !abo.bestaetigt)
        try {
          await senden(abo.email, betreff, inhalt, `${SITE}/wohnungen?abmelden=${abo.abmelde_token}`)
          mails++
        } catch (e) {
          // Versand gescheitert: den alten Stand zurück, damit es der nächste Lauf noch einmal versucht.
          await speichern({ bestaetigt: abo.bestaetigt, geprueft_bis: abo.geprueft_bis, gesendet: abo.gesendet ?? [] }).catch(() =>
            speichern({ bestaetigt: abo.bestaetigt, geprueft_bis: abo.geprueft_bis })
          )
          throw e
        }
      }
    } catch (e) {
      // Ein kaputtes Abo hält die anderen nicht auf.
      console.warn(`Suchabo ${abo.id}: ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(`Suchabos: ${abos.length} aktiv, ${mails} Mails verschickt.`)
}

await main()
