import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs'

/**
 * FSRS pro Aussage (derselbe Algorithmus wie in Anki). Bewertet wird automatisch:
 *   richtig markiert bzw. richtig weggelassen → «gut»
 *   richtig, aber «war geraten»               → «schwer»
 *   falsch                                    → «nochmals», kommt in der nächsten Session wieder
 *
 * Ohne Kurzzeitschritte (enable_short_term: false): Sessions finden höchstens ein paar
 * Mal am Tag statt, Lernschritte im Minutentakt passen nicht dazu.
 */

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, enable_short_term: false, request_retention: 0.9 }))

/** Ab dieser Stabilität (Tage) gilt eine Aussage als «sicher». */
export const SAFE_STABILITY_DAYS = 21

export type CardFields = {
  due: Date
  stability: number
  difficulty: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: number
  lastReview: Date | null
}

export function gradeFor(correct: boolean, guessed: boolean): Grade {
  if (!correct) return Rating.Again
  return guessed ? Rating.Hard : Rating.Good
}

function toCard(f: CardFields): Card {
  return {
    due: f.due,
    stability: f.stability,
    difficulty: f.difficulty,
    elapsed_days: 0,
    scheduled_days: f.scheduledDays,
    learning_steps: f.learningSteps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state,
    last_review: f.lastReview ?? undefined,
  } as Card
}

function fromCard(c: Card): CardFields {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ?? null,
  }
}

export function review(prev: CardFields | null, grade: Grade, now: Date): CardFields {
  const card = prev ? toCard(prev) : createEmptyCard(now)
  const next = fromCard(scheduler.next(card, now, grade).card)
  // «nochmals»: in der nächsten Session wieder dran, nicht erst morgen.
  if (grade === Rating.Again) next.due = new Date(now.getTime() + 60_000)
  return next
}

export function retrievability(f: CardFields | null, now: Date): number {
  if (!f || f.reps === 0) return 0
  return scheduler.retrievability(toCard(f), now) as number
}

export function isSafe(f: { stability: number } | null | undefined): boolean {
  return !!f && f.stability > SAFE_STABILITY_DAYS
}
