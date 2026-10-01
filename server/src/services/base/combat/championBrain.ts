import {
  DEFAULT_STANCE,
  learnFromLesson,
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
 * The attacker's champions after an attack's lessons: each champion the
 * battle flung learns from its own lesson, by the Mode the log flung it in;
 * every other champion, and every other field, is as it was.
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
    const learned = learnFromLesson(champion.b, champion.bs, lesson, stances.get(lesson.t) ?? DEFAULT_STANCE);
    return { ...champion, b: learned.brain, bs: learned.stats };
  });
};

/**
 * A champion list the client sent, written wholesale by a path that predates
 * the brain (an owner save, the Inferno), with each champion's brain kept
 * from the stored list by type. The client's list never carries one: the
 * schema drops `b` and `bs` (`ChampionSchema.ts`).
 *
 * @param stored - The champions as stored.
 * @param sent - The client's list, as parsed.
 */
export const withStoredBrains = <T extends ChampionData>(
  stored: readonly ChampionData[] | null | undefined,
  sent: readonly T[]
): T[] =>
  sent.map((champion) => {
    const { b: _b, bs: _bs, ...rest } = champion;
    const kept = (stored ?? []).find((one) => one?.t === champion.t);
    return {
      ...rest,
      ...(kept?.b && { b: kept.b }),
      ...(kept?.bs && { bs: kept.bs }),
    } as T;
  });
