/**
 * Höhenabfrage und ein steigungsabhängiges Gehmodell.
 *
 * Grundlage ist Toblers Wanderfunktion: die Gehgeschwindigkeit fällt exponentiell
 * mit der Steigung, mit dem Maximum bei rund 5 % Gefälle, nicht in der Ebene.
 *
 *     v(s) = v0 · exp(-3.5 · |s + 0.05|) / exp(-3.5 · 0.05)
 *
 * Der zweite Faktor normiert so, dass in der Ebene genau die konfigurierte
 * Gehgeschwindigkeit herauskommt. Toblers Originalkonstante von 6 km/h gilt für
 * Wanderer im Gelände und wäre für einen Weg zur Tramhaltestelle zu hoch.
 *
 * Gerechnet wird der Mittelwert aus Hin- und Rückweg. Ein Haus am Zürichberg
 * hätte sonst einen schnellen Weg zur Haltestelle hinunter und würde besser
 * dastehen, als es sich anfühlt – wer dort wohnt, geht beide Richtungen.
 */
import { readFileSync } from 'node:fs'
import { CONFIG } from '../config.ts'
import { aktiveStadt } from '../staedte.ts'

type DemMeta = { zoom: number; x0: number; y0: number; breite: number; hoehe: number }

const DERIVED = new URL(
  `../../data/derived/${aktiveStadt().schluessel}/`,
  import.meta.url
).pathname

let meta: DemMeta
let raster: Int16Array
let n = 0

export function ladeHoehen(): void {
  if (raster) return
  meta = JSON.parse(readFileSync(DERIVED + 'dem.json', 'utf8'))
  const buf = readFileSync(DERIVED + 'dem.bin')
  raster = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
  n = 2 ** meta.zoom
}

/** Höhe über Meer in Metern, bilinear zwischen den Rasterpunkten interpoliert. */
export function hoehe(lon: number, lat: number): number {
  const r = (lat * Math.PI) / 180
  const fx = (((lon + 180) / 360) * n - meta.x0) * 256
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  const py = (fy - meta.y0) * 256

  const x = Math.min(Math.max(fx, 0), meta.breite - 1.001)
  const y = Math.min(Math.max(py, 0), meta.hoehe - 1.001)
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const tx = x - ix
  const ty = y - iy
  const i = iy * meta.breite + ix
  const h00 = raster[i]
  const h10 = raster[i + 1]
  const h01 = raster[i + meta.breite]
  const h11 = raster[i + meta.breite + 1]
  return (
    ((h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty) / 10
  )
}

const V0 = CONFIG.walkSpeedMs
const NORM = Math.exp(-3.5 * 0.05)

/** Gehgeschwindigkeit in m/s bei Steigung `s` (Höhendifferenz pro Wegstrecke). */
function tempo(s: number): number {
  return (V0 * Math.exp(-3.5 * Math.abs(s + 0.05))) / NORM
}

/**
 * Gehzeit in Sekunden für eine tatsächliche Wegstrecke von `weg` Metern und `dz`
 * Metern Höhenunterschied. Mittel aus Hin- und Rückweg, damit die Zahl nicht von
 * der Richtung abhängt. Kein Umwegfaktor – die Strecke ist schon der echte Weg.
 */
export function gehSekundenWeg(weg: number, dz: number): number {
  if (weg < 1) return 0
  const s = dz / weg
  return 0.5 * (weg / tempo(s) + weg / tempo(-s))
}

/**
 * Gehzeit in Sekunden für eine Luftlinie von `luftlinie` Metern. Der Umwegfaktor
 * schätzt die reale Wegstrecke – nur noch für den Luftlinien-Fallback und den
 * „alles zu Fuss"-Vergleichswert, wo kein Wegnetz vorliegt.
 */
export function gehSekunden(luftlinie: number, dz: number): number {
  return gehSekundenWeg(luftlinie * CONFIG.walkDetourFactor, dz)
}

/**
 * Velogeschwindigkeit in m/s bei Steigung `s`. Monoton: bergauf exponentiell
 * gebremst, bergab schneller, aber auf ein Stadttempo gedeckelt.
 */
function veloTempo(s: number): number {
  return Math.min(CONFIG.veloMaxMs, CONFIG.veloSpeedMs * Math.exp(-CONFIG.veloSteigung * s))
}

/**
 * Velozeit in Sekunden für eine tatsächliche Wegstrecke von `weg` Metern und
 * `dz` Metern Höhenunterschied. Aus Hin- und Rückweg gemittelt, damit ein Haus
 * am Hang nicht allein wegen der schnellen Abfahrt gut dasteht.
 */
export function veloSekundenWeg(weg: number, dz: number): number {
  if (weg < 1) return 0
  const s = dz / weg
  return 0.5 * (weg / veloTempo(s) + weg / veloTempo(-s))
}

/**
 * Velozeit in Sekunden für eine Luftlinie von `luftlinie` Metern. Umwegfaktor
 * als Wegstreckenschätzung – nur noch für den Luftlinien-Fallback.
 */
export function veloSekunden(luftlinie: number, dz: number): number {
  return veloSekundenWeg(luftlinie * CONFIG.veloDetourFactor, dz)
}
