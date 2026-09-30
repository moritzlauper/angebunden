/**
 * Die Fahrten liegen auf dem Gerät, in IndexedDB. Sie verlassen es nur als
 * gekürzte Kopie, wenn man angemeldet ist und die Sicherung im Konto nicht
 * ausgeschaltet hat (`konto.ts`, `sicherung.ts`). Ein localStorage würde
 * nach etwa 60 Fahrten voll sein, eine Spur mit einem Punkt pro Sekunde
 * braucht gut 70 KB für eine halbe Stunde.
 *
 * Wo der Browser keinen Speicher erlaubt (privates Fenster), werfen die
 * Funktionen. Der Aufrufer meldet das, statt eine Fahrt stumm zu verlieren.
 */

import type { Fahrt } from './fahrten.ts'

const DATENBANK = 'velonavi'
const TABELLE = 'fahrten'

let offen: Promise<IDBDatabase> | null = null

function datenbank() {
  offen ??= new Promise<IDBDatabase>((ok, fehler) => {
    if (typeof indexedDB === 'undefined') return fehler(new Error('Kein Speicher im Browser'))
    const oeffnen = (version: number) => {
      const q = indexedDB.open(DATENBANK, version)
      q.onupgradeneeded = () => {
        if (!q.result.objectStoreNames.contains(TABELLE)) q.result.createObjectStore(TABELLE, { keyPath: 'id' })
      }
      q.onsuccess = () => {
        // Eine leere Datenbank gleichen Namens (zum Beispiel aus einem Test) hat die Tabelle nie angelegt: eine Version höher nachholen.
        if (!q.result.objectStoreNames.contains(TABELLE)) {
          const v = q.result.version
          q.result.close()
          oeffnen(v + 1)
          return
        }
        ok(q.result)
      }
      q.onerror = () => fehler(q.error ?? new Error('Speicher nicht verfügbar'))
      q.onblocked = () => fehler(new Error('Speicher gesperrt'))
    }
    oeffnen(1)
  })
  // Ein Fehlversuch soll nicht für immer haften bleiben.
  offen.catch(() => (offen = null))
  return offen
}

async function anfrage<T>(modus: IDBTransactionMode, f: (t: IDBObjectStore) => IDBRequest<T>) {
  const db = await datenbank()
  return new Promise<T>((ok, fehler) => {
    const t = db.transaction(TABELLE, modus)
    const q = f(t.objectStore(TABELLE))
    t.oncomplete = () => ok(q.result)
    t.onerror = () => fehler(t.error ?? new Error('Speichern fehlgeschlagen'))
    t.onabort = () => fehler(t.error ?? new Error('Speichern abgebrochen'))
  })
}

export type Gespeichert = Fahrt & {
  /** Ob die Fahrt (gekürzt) im Konto liegt. */
  gesichert?: boolean
  /** Ob ihre Messwerte schon an die Gemeinschaft gegangen sind (`gemeinschaft.ts`). */
  geteilt?: boolean
}

export async function alleFahrten(): Promise<Gespeichert[]> {
  const alle = await anfrage<Gespeichert[]>('readonly', (s) => s.getAll())
  return alle.sort((a, b) => (a.begonnen < b.begonnen ? 1 : -1))
}

export const speichern = (f: Gespeichert) => anfrage('readwrite', (s) => s.put(f)).then(() => undefined)
export const entfernen = (id: string) => anfrage('readwrite', (s) => s.delete(id)).then(() => undefined)
export const alleEntfernen = () => anfrage('readwrite', (s) => s.clear()).then(() => undefined)
