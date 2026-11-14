import { stemFromTopic } from './parse.ts'

/**
 * Stellt eine Session zusammen. Die kleinste Lerneinheit ist die Aussage; eine Frage
 * ist nur eine Zusammenstellung von fünf Aussagen für den Moment.
 *
 * Regeln:
 *  1. nur UEs bis zur eingestellten Grenze,
 *  2. mindestens drei UEs pro Session (wenn vorhanden), die neueste UE doppelt,
 *  3. die Anzahl richtiger Aussagen variiert über die Session (0 bis 5),
 *  4. eine Aussage nie zusammen mit ihrer Umkehrung oder einer Variante derselben
 *     Ur-Aussage (hier: nie zweimal dieselbe Familie in einer Session).
 *
 * Reihenfolge: zuerst fällige Aussagen, dann neue, dann die am wenigsten stabilen.
 * Im Prüfungsmodus zählt nicht der Plan, sondern Schwäche und «lange nicht gesehen».
 */

export type Candidate = {
  id: number
  unitNumber: number
  unitTitle: string
  truth: 'R' | 'F'
  topic: string | null
  /** Wurzel der Variantenfamilie (parentId ?? id) */
  family: number
  /** null = neu, noch nie geübt */
  due: Date | null
  stability: number | null
  lapses: number
  lastAnswered: Date | null
  /** Anteil falscher Antworten (0–1), null wenn nie beantwortet */
  wrongRate: number | null
}

export type ComposeOptions = {
  ueLimit: number
  nQuestions?: number
  now?: Date
  examMode?: boolean
  /** Höchstens so viele neue Aussagen bekommen Vorrang */
  newLimit?: number
  rng?: () => number
}

export type ComposedQuestion = {
  unitNumber: number
  stem: string
  statementIds: number[]
  trueCount: number
}

const DAY = 86_400_000
const PER_QUESTION = 5

export function priority(c: Candidate, now: Date, examMode: boolean): number {
  if (examMode) {
    const unseen = !c.lastAnswered || now.getTime() - c.lastAnswered.getTime() > 3 * DAY
    return (unseen ? 2 : 0) + (c.wrongRate ?? 0.5) + c.lapses * 0.3 + ((c.stability ?? 0) < 21 ? 0.5 : 0)
  }
  if (c.due === null) return 2
  const diff = (now.getTime() - c.due.getTime()) / DAY
  if (diff >= 0) return 3 + Math.min(diff, 30) / 30 + c.lapses * 0.1
  return 1 / (1 - diff) // nicht fällig: je näher, desto eher
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Anzahl richtiger Aussagen pro Frage: gestreut, nicht immer gleich. */
export function truthTargets(n: number, rng: () => number): number[] {
  const weights = [1, 2, 3, 3, 2, 1] // 0..5
  const total = weights.reduce((a, b) => a + b, 0)
  const draw = () => {
    let r = rng() * total
    for (let k = 0; k < weights.length; k++) {
      r -= weights[k]
      if (r < 0) return k
    }
    return 2
  }
  const wantDistinct = Math.min(n, 3)
  let best: number[] = []
  for (let attempt = 0; attempt < 60; attempt++) {
    const t = Array.from({ length: n }, draw)
    if (new Set(t).size >= wantDistinct) return t
    if (new Set(t).size > new Set(best).size) best = t
  }
  return best.length ? best : Array.from({ length: n }, (_, i) => i % 6)
}

/** Welche UE bekommt welche Frage: neueste doppelt, dann die übrigen nach Dringlichkeit. */
export function planUnits(unitWeights: Map<number, number>, n: number): number[] {
  const units = [...unitWeights.keys()].sort((a, b) => a - b)
  if (units.length === 0) return []
  const newest = units[units.length - 1]
  const others = units.filter((u) => u !== newest).sort((a, b) => (unitWeights.get(b) ?? 0) - (unitWeights.get(a) ?? 0))
  const plan: number[] = []
  if (n >= 4 || others.length === 0) plan.push(newest, newest)
  else plan.push(newest)
  for (const u of others) if (plan.length < n) plan.push(u)
  const cycle = [newest, ...others]
  let i = 0
  while (plan.length < n) plan.push(cycle[i++ % cycle.length])
  return plan.slice(0, n)
}

export function composeSession(candidates: Candidate[], opts: ComposeOptions): ComposedQuestion[] {
  const now = opts.now ?? new Date()
  const n = opts.nQuestions ?? 5
  const rng = opts.rng ?? Math.random
  const examMode = !!opts.examMode
  const newLimit = opts.newLimit ?? 15

  const eligible = candidates.filter((c) => c.unitNumber <= opts.ueLimit)
  if (eligible.length < PER_QUESTION) return []

  // Priorität mit etwas Zufall, damit gleich dringende Aussagen nicht immer gleich gemischt werden.
  const scored = eligible.map((c) => ({ c, p: priority(c, now, examMode) + rng() * 0.05 }))
  scored.sort((a, b) => b.p - a.p)
  // Nur die ersten `newLimit` neuen Aussagen behalten Vorrang.
  let seenNew = 0
  for (const s of scored) {
    if (!examMode && s.c.due === null) {
      seenNew++
      if (seenNew > newLimit) s.p = 0.5
    }
  }
  scored.sort((a, b) => b.p - a.p)

  const unitWeights = new Map<number, number>()
  for (const s of scored) unitWeights.set(s.c.unitNumber, (unitWeights.get(s.c.unitNumber) ?? 0) + s.p)
  const titles = new Map(eligible.map((c) => [c.unitNumber, c.unitTitle]))

  const plan = planUnits(unitWeights, n)
  const targets = truthTargets(plan.length, rng)
  const usedIds = new Set<number>()
  const usedFamilies = new Set<number>()
  const free = (c: Candidate) => !usedIds.has(c.id) && !usedFamilies.has(c.family)

  const take = (unitNumber: number | null, truth: 'R' | 'F', count: number): Candidate[] => {
    const got: Candidate[] = []
    for (const s of scored) {
      if (got.length >= count) break
      if (unitNumber !== null && s.c.unitNumber !== unitNumber) continue
      if (s.c.truth !== truth || !free(s.c)) continue
      got.push(s.c)
      usedIds.add(s.c.id)
      usedFamilies.add(s.c.family)
    }
    return got
  }

  const out: ComposedQuestion[] = []
  for (let qi = 0; qi < plan.length; qi++) {
    const unitNumber = plan[qi]
    let t = targets[qi]
    const picked: Candidate[] = []
    // erst aus der geplanten UE, dann aus allen anderen bis zur Grenze
    const fill = (truth: 'R' | 'F', count: number) => {
      const a = take(unitNumber, truth, count)
      const b = a.length < count ? take(null, truth, count - a.length) : []
      return [...a, ...b]
    }
    const trues = fill('R', t)
    picked.push(...trues)
    const falses = fill('F', PER_QUESTION - trues.length)
    picked.push(...falses)
    if (picked.length < PER_QUESTION) picked.push(...fill('R', PER_QUESTION - picked.length))
    if (picked.length < PER_QUESTION) {
      // nicht genug Aussagen für eine ganze Frage: zurückgeben und aufhören
      for (const c of picked) {
        usedIds.delete(c.id)
        usedFamilies.delete(c.family)
      }
      break
    }
    t = picked.filter((c) => c.truth === 'R').length
    const ordered = shuffle(picked, rng)
    out.push({ unitNumber, stem: stemFor(ordered, unitNumber, titles), statementIds: ordered.map((c) => c.id), trueCount: t })
  }
  return out
}

function stemFor(stmts: Candidate[], unitNumber: number, titles: Map<number, string>): string {
  const topics = new Set(stmts.map((s) => s.topic).filter(Boolean))
  const units = new Set(stmts.map((s) => s.unitNumber))
  if (topics.size === 1 && stmts.every((s) => s.topic)) return stemFromTopic([...topics][0] as string)
  if (units.size === 1) return `Welche Aussagen zu «${titles.get(unitNumber) ?? `UE ${unitNumber}`}» treffen zu?`
  const list = [...units].sort((a, b) => a - b).map((u) => `UE ${u}`).join(', ')
  return `Welche Aussagen treffen zu? (Mischfrage ${list})`
}
