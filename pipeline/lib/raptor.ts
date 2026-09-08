/**
 * RAPTOR (Round-bAsed Public Transit Optimized Router).
 *
 * Sucht die früheste Ankunft an allen Haltestellen für eine Abfahrt zu einer festen
 * Zeit. Der Algorithmus arbeitet in Runden: Runde k entspricht "k-1 mal umgestiegen".
 * Er braucht keine Prioritätswarteschlange, sondern scannt pro Runde nur die Linien,
 * die von neu erreichten Haltestellen bedient werden. Ein Lauf über das Zürcher Netz
 * dauert dadurch rund eine Millisekunde.
 *
 * Referenz: Delling, Pajor, Werneck (2012), Microsoft Research.
 */

export const INF = 0x7fffffff

export type RaptorNetwork = {
  nStations: number
  nPatterns: number
  patternStopOffsets: Int32Array
  patternStops: Int32Array
  patternTripCount: Int32Array
  patternTimeOffsets: Int32Array
  patternTimes: Int32Array
  stopPatternOffsets: Int32Array
  stopPatterns: Int32Array
  transferOffsets: Int32Array
  transferTargets: Int32Array
  transferTimes: Int32Array
}

export function toRaptorNetwork(raw: any): RaptorNetwork {
  return {
    nStations: raw.stationIds.length,
    nPatterns: raw.patternTripCount.length,
    patternStopOffsets: Int32Array.from(raw.patternStopOffsets),
    patternStops: Int32Array.from(raw.patternStops),
    patternTripCount: Int32Array.from(raw.patternTripCount),
    patternTimeOffsets: Int32Array.from(raw.patternTimeOffsets),
    patternTimes: Int32Array.from(raw.patternTimes),
    stopPatternOffsets: Int32Array.from(raw.stopPatternOffsets),
    stopPatterns: Int32Array.from(raw.stopPatterns),
    transferOffsets: Int32Array.from(raw.transferOffsets),
    transferTargets: Int32Array.from(raw.transferTargets),
    transferTimes: Int32Array.from(raw.transferTimes),
  }
}

/** Wiederverwendbarer Arbeitsspeicher – ein Router pro Thread, nicht pro Anfrage. */
export class Raptor {
  readonly best: Int32Array // beste Ankunftszeit je Haltestelle
  private board: Int32Array // Stand zu Rundenbeginn, nur daraus darf eingestiegen werden
  private marked: Int32Array
  private markedFlag: Uint8Array
  private queuePattern: Int32Array
  private queuePos: Int32Array
  private queuedAt: Int32Array

  private net: RaptorNetwork
  private maxRounds: number
  private transferPenalty: number

  constructor(net: RaptorNetwork, maxRounds: number, transferPenalty: number) {
    // Bewusst keine Parameter-Properties: Nodes Type-Stripping kennt sie nicht.
    this.net = net
    this.maxRounds = maxRounds
    this.transferPenalty = transferPenalty
    this.best = new Int32Array(net.nStations)
    this.board = new Int32Array(net.nStations)
    this.marked = new Int32Array(net.nStations)
    this.markedFlag = new Uint8Array(net.nStations)
    this.queuePattern = new Int32Array(net.nPatterns)
    this.queuePos = new Int32Array(net.nPatterns)
    this.queuedAt = new Int32Array(net.nPatterns)
  }

  /**
   * @param origin  Haltestellen-Index
   * @param depart  Abfahrtszeit in Sekunden ab Mitternacht
   * @returns `best`: Ankunftszeit je Haltestelle (absolut), INF wenn unerreichbar.
   *          Das Array gehört dem Router und wird beim nächsten Lauf überschrieben.
   */
  run(origin: number, depart: number): Int32Array {
    const n = this.net
    const { best, board, marked, markedFlag, queuePattern, queuePos, queuedAt } = this
    best.fill(INF)
    markedFlag.fill(0)
    queuedAt.fill(-1)

    best[origin] = depart
    let nMarked = 0
    marked[nMarked++] = origin
    markedFlag[origin] = 1

    // Zu Fuss erreichbare Nachbarhaltestellen zählen schon vor der ersten Fahrt
    for (let e = n.transferOffsets[origin]; e < n.transferOffsets[origin + 1]; e++) {
      const t = n.transferTargets[e]
      const arr = depart + n.transferTimes[e]
      if (arr < best[t]) {
        best[t] = arr
        if (!markedFlag[t]) {
          markedFlag[t] = 1
          marked[nMarked++] = t
        }
      }
    }

    for (let round = 1; round <= this.maxRounds && nMarked > 0; round++) {
      board.set(best)

      // --- Linien einsammeln, die von markierten Haltestellen bedient werden
      let nQueued = 0
      for (let m = 0; m < nMarked; m++) {
        const s = marked[m]
        markedFlag[s] = 0
        for (let e = n.stopPatternOffsets[s]; e < n.stopPatternOffsets[s + 1]; e += 2) {
          const p = n.stopPatterns[e]
          const pos = n.stopPatterns[e + 1]
          const q = queuedAt[p]
          if (q === -1) {
            queuedAt[p] = nQueued
            queuePattern[nQueued] = p
            queuePos[nQueued] = pos
            nQueued++
          } else if (pos < queuePos[q]) {
            queuePos[q] = pos
          }
        }
      }
      nMarked = 0

      // --- jede Linie einmal von vorne nach hinten durchfahren
      const penalty = round > 1 ? this.transferPenalty : 0
      for (let q = 0; q < nQueued; q++) {
        const p = queuePattern[q]
        queuedAt[p] = -1
        const stopOff = n.patternStopOffsets[p]
        const len = n.patternStopOffsets[p + 1] - stopOff
        const timeOff = n.patternTimeOffsets[p]
        const nTrips = n.patternTripCount[p]
        const stride = len * 2

        let trip = -1
        let tripOff = 0
        for (let pos = queuePos[q]; pos < len; pos++) {
          const stop = n.patternStops[stopOff + pos]

          if (trip >= 0) {
            const arr = n.patternTimes[tripOff + pos * 2]
            if (arr < best[stop]) {
              best[stop] = arr
              if (!markedFlag[stop]) {
                markedFlag[stop] = 1
                marked[nMarked++] = stop
              }
            }
          }

          // Kommen wir hier in eine frühere Fahrt derselben Linie?
          const ready = board[stop]
          if (ready !== INF) {
            const limit = ready + penalty
            let cand = trip
            if (cand < 0) {
              // erste Fahrt, deren Abfahrt nicht vor `limit` liegt
              let lo = 0
              let hi = nTrips
              while (lo < hi) {
                const mid = (lo + hi) >> 1
                if (n.patternTimes[timeOff + mid * stride + pos * 2 + 1] < limit) lo = mid + 1
                else hi = mid
              }
              cand = lo < nTrips ? lo : -1
            } else {
              while (
                cand > 0 &&
                n.patternTimes[timeOff + (cand - 1) * stride + pos * 2 + 1] >= limit
              )
                cand--
            }
            if (cand >= 0 && cand !== trip) {
              trip = cand
              tripOff = timeOff + trip * stride
            }
          }
        }
      }

      // --- Fusswege von allen in dieser Runde verbesserten Haltestellen
      const wasMarked = nMarked
      for (let m = 0; m < wasMarked; m++) {
        const s = marked[m]
        const arrS = best[s]
        for (let e = n.transferOffsets[s]; e < n.transferOffsets[s + 1]; e++) {
          const t = n.transferTargets[e]
          const arr = arrS + n.transferTimes[e]
          if (arr < best[t]) {
            best[t] = arr
            if (!markedFlag[t]) {
              markedFlag[t] = 1
              marked[nMarked++] = t
            }
          }
        }
      }
    }

    return best
  }
}
