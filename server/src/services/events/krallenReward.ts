import { championEntry } from "../../game-data/championCatalogue.js";
import { KRALLEN_MAX_LEVEL, KRALLEN_TYPE } from "../../game-data/events/eventRewards.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import { CHAMPION_STATUS, levelOf, maxHealthOf, readChampions, statusOf } from "../yard/champion.js";

/**
 * The Krallen Hunt's reward (`game-data/events/events.ts`, owner 2026-10-20):
 * the only way a Krallen is made or raised. The cage cannot raise her
 * (`services/yard/champion.ts`, D17), her feeds never evolve her, and no save
 * a client sends can add or change a champion
 * (`controllers/base/save/baseSave.ts`).
 *
 * - No Krallen yet: she joins the `champion` list at level 1, full health,
 *   fed for one interval from now, beside the cage (status 0), as an egg
 *   hatches (`hatchDueEgg`).
 * - A Krallen already (won now, or an old save's): one level up, at most
 *   {@link KRALLEN_MAX_LEVEL}, full health at the new level, as an evolve
 *   leaves a champion (feeds back to 0). Frozen, she stays frozen with her
 *   feed clock stopped (the chamber's `fz` copy catches up on the next
 *   freeze or thaw, `chamber.ts`); any other state brings her back.
 * - At the top: nothing changes, and `raised` says so.
 *
 * Pure: hands back a fresh list.
 */

/** The player's Krallen level, 0 for none. */
export const krallenLevelOf = (raw: unknown): number => {
  const entry = championEntry(KRALLEN_TYPE)!;
  const krallen = readChampions(raw).find((one) => Math.trunc(Number(one.t)) === KRALLEN_TYPE);
  return krallen ? levelOf(krallen, entry) : 0;
};

export const raiseKrallen = (
  raw: unknown,
  now: number
): { champions: ChampionData[]; level: number; raised: boolean } => {
  const entry = championEntry(KRALLEN_TYPE)!;
  const champions = readChampions(raw);
  const index = champions.findIndex((one) => Math.trunc(Number(one.t)) === KRALLEN_TYPE);

  if (index < 0) {
    const born: ChampionData = {
      t: KRALLEN_TYPE,
      hp: 0,
      l: 1,
      ft: now + entry.feedTime,
      fd: 0,
      fb: 0,
      pl: entry.powerLevel,
      status: CHAMPION_STATUS.ACTIVE,
    };
    born.hp = maxHealthOf(born, entry);
    return { champions: [...champions, born], level: 1, raised: true };
  }

  const was = champions[index]!;
  const level = levelOf(was, entry);
  if (level >= KRALLEN_MAX_LEVEL) return { champions, level, raised: false };

  const frozen = statusOf(was) === CHAMPION_STATUS.FROZEN;
  const next: ChampionData = {
    ...was,
    t: KRALLEN_TYPE,
    l: level + 1,
    fd: 0,
    ft: frozen ? Number(was.ft) || 0 : now + entry.feedTime,
    status: frozen ? CHAMPION_STATUS.FROZEN : CHAMPION_STATUS.ACTIVE,
  };
  next.hp = maxHealthOf(next, entry);
  champions[index] = next;
  return { champions, level: level + 1, raised: true };
};
