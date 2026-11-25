import {
  DEFAULT_STANCE,
  championByType,
  hasHabits,
  hasMode,
  learnHabits,
  type ChampionLesson,
  type ChampionStance,
  type FlingLog,
} from "../../../game-rules/combat/index.js";
import type { ChampionData } from "../../../schemas/ChampionSchema.js";

/**
 * Where a champion's learning brain is updated (issue #219, the rule itself
 * is `game-rules/combat/brain.ts`).
 *
 * Only when an attack lands, and only here: the save that ends an attack
 * (`baseSave.ts`), a Map Room 1 tribe's (`scaledMR1Tribes.ts`), and the
 * finaliser that lands an abandoned attack or an auto-attack
 * (`finaliseAttack.ts`). Each holds the attack's final lock and ends the
 * attack before letting go, so a lesson is learned exactly once. The lessons
 * come from the server's own replay of the attack, with the brains the attack
 * froze at launch, so nothing the client says goes into them.
 *
 * Only the attacker's champions that fought learn: a defending champion
 * never has a lesson, since the replay records them for attackers alone.
 *
 * A champion with habits (champion modes round 2, `habits.ts`) learns its
 * Mode's habits (`learnHabits`), and drops its old brain the first time.
 * Krallen learns nothing: she has no Mode and fights as Flash's Krallen
 * (owner, 25 Nov 2026, patch 8.7, `hasMode`). A brain an older attack taught
 * her stays in her save, unread.
 *
 * Pure: the callers write the result.
 */

/** The Mode each champion type was flung in, by the log; none is Hybrid. */
const stancesOf = (log: FlingLog): Map<number, ChampionStance> => {
  const stances = new Map<number, ChampionStance>();
  for (const event of log.events) {
    if (event.kind !== "fling" || !event.champion || stances.has(event.champion.t)) continue;
    stances.set(event.champion.t, event.champion.s ?? DEFAULT_STANCE);
  }
  return stances;
};

/**
 * The attacker's champions after an attack's lessons: each champion with
 * habits the battle flung learns from its own lesson, by the Mode the log
 * flung it in; every other champion (Krallen among them), and every other
 * field, is as it was.
 *
 * @param champions - The attacker's `champion` list, as it stands once the
 *   attack's health has been written.
 * @param lessons - The replay's lessons (`AbandonedOutcome.lessons`).
 * @param log - The log the replay fought.
 */
export const championsAfterLessons = <T extends ChampionData>(
  champions: readonly T[] | null | undefined,
  lessons: readonly ChampionLesson[] | undefined,
  log: FlingLog
): T[] | null | undefined => {
  if (!champions || !lessons || lessons.length === 0) return champions as T[] | null | undefined;
  const stances = stancesOf(log);
  return champions.map((champion) => {
    const lesson = lessons.find((one) => one.t === champion?.t);
    if (!lesson) return champion;
    // Krallen has no Mode, so nothing to learn by (patch 8.7).
    const type = championByType(lesson.t);
    if (!hasMode(type) || !hasHabits(type)) return champion;
    const stance = stances.get(lesson.t) ?? DEFAULT_STANCE;
    // The first time, its old brain goes: habits start fresh, the count stays.
    // Its habits for the Mode it fought in (champion modes round 2), by the
    // owner's pick B (`hl`, 19 Nov 2026); a champion without `hl` yet is
    // migrated from its old weights here.
    const learned = learnHabits(champion.h, champion.hs, lesson, stance, champion.bs, champion.hl);
    const { b: _brain, bs: _stats, ...rest } = champion;
    return { ...rest, h: learned.book, hs: learned.stats, hl: learned.learning } as T;
  });
};
