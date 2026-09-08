/**
 * Stichprobe: rechnet bekannte Verbindungen durch, damit man die Ergebnisse
 * gegen den echten Fahrplan halten kann. `pnpm verify` (oder `STADT=basel pnpm verify`)
 */
import { readFileSync } from 'node:fs'
import { Raptor, toRaptorNetwork, INF } from './lib/raptor.ts'
import { CONFIG } from './config.ts'
import { aktiveStadt } from './staedte.ts'

const STADT = aktiveStadt()
const raw = JSON.parse(
  readFileSync(
    new URL(`../data/derived/${STADT.schluessel}/network.json`, import.meta.url).pathname,
    'utf8'
  )
)
const net = toRaptorNetwork(raw)
const raptor = new Raptor(net, CONFIG.maxRounds, CONFIG.transferPenaltySec)

const find = (name: string) => {
  const i = raw.stationNames.findIndex((n: string) => n === name)
  if (i < 0) throw new Error(`Haltestelle "${name}" nicht gefunden`)
  return i
}

const pairs = STADT.verify

const dep = 8 * 3600
console.log(`Abfahrt ${new Date(dep * 1000).toISOString().slice(11, 16)} Uhr, ${CONFIG.serviceDate}\n`)
for (const [a, b] of pairs) {
  const ai = find(a)
  const bi = find(b)
  const best = raptor.run(ai, dep)
  const t = best[bi]
  const mins = t === INF ? '—' : ((t - dep) / 60).toFixed(0).padStart(3) + ' min'
  console.log(`${mins}   ${a}  →  ${b}`)
}

// Wie viele Haltestellen sind ab der Referenzhaltestelle in 30 Minuten erreichbar?
const hb = raptor.run(find(STADT.verifyHub), dep)
let n30 = 0
for (let i = 0; i < net.nStations; i++) if (hb[i] !== INF && hb[i] - dep <= 30 * 60) n30++
console.log(`\nAb ${STADT.verifyHub} in 30 Minuten erreichbar: ${n30} von ${net.nStations} Haltestellen`)
