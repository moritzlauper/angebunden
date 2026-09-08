import type { Readable } from 'node:stream'

/**
 * Streamender CSV-Leser für die GTFS-Dateien (bis 2.5 GB).
 * Ruft `onRow` mit einem wiederverwendeten String-Array auf – wer Werte behalten
 * will, muss sie kopieren. Das spart bei Millionen Zeilen viel Garbage Collection.
 */
export async function readCsv(
  stream: Readable,
  onRow: (row: string[], col: (name: string) => number) => void
): Promise<number> {
  let header: string[] | null = null
  let colIndex = new Map<string, number>()
  const col = (name: string) => {
    const i = colIndex.get(name)
    if (i === undefined) throw new Error(`Spalte "${name}" fehlt (${header?.join(',')})`)
    return i
  }

  let rest = ''
  let count = 0
  const fields: string[] = []

  const handleLine = (line: string) => {
    if (!line) return
    parseLine(line, fields)
    if (!header) {
      header = fields.slice()
      // UTF-8 BOM aus der ersten Spalte entfernen
      header[0] = header[0].replace(/^﻿/, '')
      colIndex = new Map(header.map((h, i) => [h.trim(), i]))
      return
    }
    count++
    onRow(fields, col)
  }

  stream.setEncoding('utf8')
  for await (const chunk of stream) {
    const buf = rest + (chunk as string)
    let start = 0
    let nl = buf.indexOf('\n', start)
    while (nl !== -1) {
      let line = buf.slice(start, nl)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      handleLine(line)
      start = nl + 1
      nl = buf.indexOf('\n', start)
    }
    rest = buf.slice(start)
  }
  if (rest) handleLine(rest.endsWith('\r') ? rest.slice(0, -1) : rest)
  return count
}

/** Zerlegt eine CSV-Zeile in `out`. Behandelt Anführungszeichen und "" als escaptes Quote. */
function parseLine(line: string, out: string[]): void {
  out.length = 0
  const n = line.length
  let i = 0
  while (i <= n) {
    if (i === n) {
      out.push('')
      break
    }
    if (line.charCodeAt(i) === 34 /* " */) {
      i++
      const start = i
      let needsUnescape = false
      while (i < n) {
        if (line.charCodeAt(i) === 34) {
          if (line.charCodeAt(i + 1) === 34) {
            needsUnescape = true
            i += 2
            continue
          }
          break
        }
        i++
      }
      const value = line.slice(start, i)
      out.push(needsUnescape ? value.replace(/""/g, '"') : value)
      i++ // schliessendes Quote
      if (i < n && line.charCodeAt(i) === 44) i++
      else break
    } else {
      const comma = line.indexOf(',', i)
      if (comma === -1) {
        out.push(line.slice(i))
        break
      }
      out.push(line.slice(i, comma))
      i = comma + 1
    }
  }
}

/** "25:13:00" -> 90780. Zeiten nach Mitternacht bleiben korrekt. */
export function parseGtfsTime(t: string): number {
  if (!t) return -1
  const h = (t.charCodeAt(0) - 48) * 10 + (t.charCodeAt(1) - 48)
  const m = (t.charCodeAt(3) - 48) * 10 + (t.charCodeAt(4) - 48)
  const s = (t.charCodeAt(6) - 48) * 10 + (t.charCodeAt(7) - 48)
  return h * 3600 + m * 60 + s
}
