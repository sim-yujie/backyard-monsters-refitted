import { abunaki, dreadnaught, kozu, legionnaire, tutorial } from "../../game-data/tribes/v1/index.js";
import {
  updateOnboarding,
  type Onboarding,
  type OnboardingSave,
  type TribeCounterName,
} from "../onboarding/state.js";

/**
 * The Goals counters' hooks (`docs/design/tutorial.md` §6.2, issue #227):
 * what each server event adds to `onboarding.counters`. Each returns the
 * whole new record for the event's route to write (a yard action's
 * `slices.onboarding`, or an assignment in the Map Room 1 tribe save), or
 * null when nothing changes, so a route that counts nothing writes nothing.
 *
 * Counters move on server events only (anti-cheat rule 8): a mushroom the
 * server rolled, a bank the server paid, a juice the server performed, a
 * tribe the server's replay destroyed, a raid the server's fight held off.
 */

/** A mushroom picked: `mushrooms` + 1, and `goldMushrooms` + 1 for a golden one (the server's roll). */
export const countMushroom = (save: OnboardingSave, golden: boolean): Onboarding =>
  updateOnboarding(save, ({ counters }) => {
    counters.mushrooms += 1;
    if (golden) counters.goldMushrooms += 1;
  });

/**
 * A bank: `bestBank` becomes the most one request has banked, all four
 * resources together (Collect all is one tap, as Flash's `singleclickbank`
 * was). Null when this bank is no bigger.
 *
 * @param banked - What the bank credited, per resource.
 */
export const countBank = (
  save: OnboardingSave,
  banked: Partial<Record<"r1" | "r2" | "r3" | "r4", number>>,
): Onboarding | null => {
  const total = ["r1", "r2", "r3", "r4"].reduce((sum, key) => {
    const amount = Number(banked[key as keyof typeof banked]);
    return sum + (Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0);
  }, 0);
  let changed = false;
  const onboarding = updateOnboarding(save, ({ counters }) => {
    if (total <= counters.bestBank) return;
    counters.bestBank = total;
    changed = true;
  });
  return changed ? onboarding : null;
};

/**
 * Monsters juiced: `juiced` + `count`. Flash counted every monster that
 * walked into the Juicer (`BUILDING9.Prep`, `client/scripts/BUILDING9.as:44`),
 * from Housing and from a bunker alike; a champion's juicing never called it.
 * Null for none.
 */
export const countJuiced = (save: OnboardingSave, count: number): Onboarding | null => {
  const juiced = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (juiced === 0) return null;
  return updateOnboarding(save, ({ counters }) => {
    counters.juiced += juiced;
  });
};

/** Map Room 1 tribe base id to its tribe; the practice camp, base "1", counts as Legionnaire (§6.2). */
const TRIBE_OF_BASE = new Map<string, TribeCounterName>([
  ...Object.values(legionnaire).map((tier) => [String(tier.baseid), "legionnaire"] as const),
  ...Object.values(kozu).map((tier) => [String(tier.baseid), "kozu"] as const),
  ...Object.values(abunaki).map((tier) => [String(tier.baseid), "abunakki"] as const),
  ...Object.values(dreadnaught).map((tier) => [String(tier.baseid), "dreadnaut"] as const),
  [String(tutorial.baseid), "legionnaire"] as const,
]);

/** The tribe a Map Room 1 base belongs to, or undefined. */
export const tribeOfBase = (baseid: string): TribeCounterName | undefined =>
  TRIBE_OF_BASE.get(String(baseid));

/**
 * A Map Room 1 tribe destroyed by the server's replay: `tribes.<name>` + 1.
 * Null for a base that is no tribe's.
 */
export const countTribeDestroyed = (save: OnboardingSave, baseid: string): Onboarding | null => {
  const tribe = tribeOfBase(baseid);
  if (!tribe) return null;
  return updateOnboarding(save, ({ counters }) => {
    counters.tribes[tribe] += 1;
  });
};

/**
 * A wild monster raid held to a good defence (90% or more of the yard
 * standing, `docs/design/wild-raids.md` §6.3, Q7): `raidsSurvived` + 1, for
 * goal N1. The raid landing calls it only for a good defence.
 */
export const countRaidSurvived = (save: OnboardingSave): Onboarding =>
  updateOnboarding(save, ({ counters }) => {
    counters.raidsSurvived += 1;
  });
