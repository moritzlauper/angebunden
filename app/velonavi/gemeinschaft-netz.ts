/**
 * Die Verbindung zur Gemeinschaft: Messwerte schicken, Durchschnitte holen.
 *
 * Ohne Anmeldung und ohne die Supabase-Bibliothek, nur mit `fetch` an die
 * REST-Schnittstelle. Wer nur lernt, lädt so keine 250 KB Bibliothek und
 * verrät nichts ausser der IP-Adresse, die jede Seite sieht.
 */

import { PROJEKT } from './konto'
import type { Beitrag, Gemeinschaft } from './gemeinschaft.ts'

const ZWISCHENSPEICHER = 'velonavi.gemeinschaft'
/** Die Durchschnitte ändern sich langsam: Zweimal am Tag nachfragen reicht. */
const GUELTIG = 12 * 3600_000
const PORTION = 500

const kopf = () => ({ apikey: PROJEKT.schluessel!, authorization: `Bearer ${PROJEKT.schluessel}`, 'content-type': 'application/json' })

export async function ladeGemeinschaft(): Promise<Gemeinschaft | null> {
  if (!PROJEKT.adresse || !PROJEKT.schluessel) return null
  try {
    const roh = window.localStorage.getItem(ZWISCHENSPEICHER)
    if (roh) {
      const { t, d } = JSON.parse(roh) as { t: number; d: Gemeinschaft }
      if (Date.now() - t < GUELTIG && d?.kanten && d?.ampeln) return d
    }
  } catch {
    /* ohne Zwischenspeicher fragt jeder Besuch neu */
  }
  const r = await fetch(`${PROJEKT.adresse}/rest/v1/rpc/velonavi_gemeinschaft`, { method: 'POST', headers: kopf(), body: '{}' })
  if (!r.ok) throw new Error(`Gemeinschaft: ${r.status}`)
  const roh = (await r.json()) as Partial<Gemeinschaft> | null
  // Eine Antwort ohne die beiden Tabellen (Wartung, Proxy) gilt als keine Antwort.
  if (!roh || typeof roh.kanten !== 'object' || typeof roh.ampeln !== 'object') throw new Error('Gemeinschaft: unerwartete Antwort')
  const d = roh as Gemeinschaft
  try {
    window.localStorage.setItem(ZWISCHENSPEICHER, JSON.stringify({ t: Date.now(), d }))
  } catch {
    /* voller Speicher */
  }
  return d
}

/** Schickt die Messwerte in Portionen. Wirft, wenn eine Portion nicht ankommt. */
export async function sendeBeitrag(b: Beitrag) {
  if (!PROJEKT.adresse || !PROJEKT.schluessel) throw new Error('Kein Projekt')
  const senden = async (tabelle: string, zeilen: unknown[]) => {
    for (let i = 0; i < zeilen.length; i += PORTION) {
      const r = await fetch(`${PROJEKT.adresse}/rest/v1/${tabelle}`, {
        method: 'POST',
        headers: { ...kopf(), prefer: 'return=minimal' },
        body: JSON.stringify(zeilen.slice(i, i + PORTION)),
      })
      if (!r.ok) throw new Error(`${tabelle}: ${r.status}`)
    }
  }
  await senden('velonavi_messungen_kanten', b.kanten)
  await senden('velonavi_messungen_ampeln', b.ampeln)
}
