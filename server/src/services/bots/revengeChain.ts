import { hatchTime } from "../../game-data/monsterCatalogue.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { HATCHERY_TYPE } from "../yard/hatchery.js";
import type { RevengeArmy } from "./revengePlan.js";

/**
 * A revenge is a chain of attacks, not one (owner 2026-10-23,
 * `docs/design/bot-neighbours.md` §4.7 "Revenge chains"): a real player who
 * hits back attacks two to four times, or until the yard is wrecked, and stops
 * after one when it went badly. Pure: the sweep (`sweep.ts`) reads the chain
 * from the `revenge` job's payload, asks {@link nextInChain} once an attack
 * lands, and re-books the same job for the next attack or deletes it.
 *
 * | After an attack | Then |
 * | --- | --- |
 * | it was the chain's last ({@link CHAIN_LENGTH}, drawn at the first attack) | the chain ends |
 * | it did less than {@link CHAIN_MIN_DAMAGE} points of damage itself | the chain ends |
 * | the yard is left at {@link CHAIN_DESTROYED_DAMAGE}% or more | the chain ends |
 * | otherwise | the next attack, once the bot's hatcheries have refilled its Housing |
 *
 * The next attack goes through every check the first one does (bot, player on
 * Map Room 1, truce, protection, online, under attack) except the caps, which
 * count a whole chain as one revenge (`afterAttack.ts`). It waits at most
 * {@link CHAIN_WAIT_HOURS} past the time its army is ready; a wait that runs
 * past that (36 hours of damage protection after a 50% hit, a bought shield)
 * ends the chain.
 */

/** How many attacks a chain holds at most, drawn per revenge `[PLACEHOLDER]`. */
export const CHAIN_LENGTH = { min: 2, max: 4 } as const;
/** An attack must itself do this many points of damage (0-100) for the chain to go on `[PLACEHOLDER]`. */
export const CHAIN_MIN_DAMAGE = 20;
/** A yard left at this damage or more counts as destroyed: the chain ends `[PLACEHOLDER]`. */
export const CHAIN_DESTROYED_DAMAGE = 90;
/** The next attack gives up this long after its army is ready `[PLACEHOLDER]`. */
export const CHAIN_WAIT_HOURS = 12;
/** A player does not attack the moment the last monster hatches: this much later `[PLACEHOLDER]`. */
export const CHAIN_SLACK_MINUTES = { min: 10, max: 60 } as const;
/** The refill time is held inside this band (a bot with no hatchery takes the top) `[PLACEHOLDER]`. */
export const CHAIN_REFILL_HOURS = { min: 0.5, max: 12 } as const;

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/** A chain under way, as the job's payload keeps it (`payload.chain`). */
export interface RevengeChain {
  /** How many attacks it holds at most. */
  readonly length: number;
  /** How many have landed. */
  readonly done: number;
  /** When the last one was made (its attack log), unix seconds. */
  readonly last: number;
}

/** The chain in a job's payload, or null before its first attack. */
export const readChain = (payload: JsonObject | null | undefined): RevengeChain | null => {
  const chain = payload?.chain as Partial<Record<keyof RevengeChain, unknown>> | undefined;
  const length = Number(chain?.length);
  const done = Number(chain?.done);
  const last = Number(chain?.last);
  if (!Number.isInteger(length) || !Number.isInteger(done) || done < 1 || !Number.isFinite(last)) return null;
  return { length, done, last };
};

/** A chain length, uniform over {@link CHAIN_LENGTH}. */
export const drawChainLength = (rng: () => number): number =>
  CHAIN_LENGTH.min + Math.min(CHAIN_LENGTH.max - CHAIN_LENGTH.min, Math.floor(rng() * (CHAIN_LENGTH.max - CHAIN_LENGTH.min + 1)));

/** The hatcheries standing in a yard's `buildingdata`. */
export const hatcheriesIn = (buildingdata: unknown): number =>
  Object.values((buildingdata ?? {}) as Record<string, { t?: unknown } | null>).filter(
    (building) => Number(building?.t) === HATCHERY_TYPE
  ).length;

/**
 * How long the bot's hatcheries take to hatch the army it sent again, in
 * seconds: each monster's hatch time at the bot's academy level (`cTime`, the
 * game's own), the hatcheries working side by side, held inside
 * {@link CHAIN_REFILL_HOURS}. No hatchery takes the band's top.
 */
export const armyRefillSeconds = (army: Pick<RevengeArmy, "monsters" | "levels">, hatcheries: number): number => {
  const low = CHAIN_REFILL_HOURS.min * HOUR;
  const high = CHAIN_REFILL_HOURS.max * HOUR;
  if (hatcheries < 1) return high;
  let total = 0;
  for (const [id, count] of Object.entries(army.monsters)) {
    total += (hatchTime(id, army.levels[id] ?? 1) ?? 0) * count;
  }
  return Math.min(high, Math.max(low, Math.ceil(total / hatcheries)));
};

/** What follows a landed attack in a chain. */
export type ChainStep =
  | { readonly act: "end"; readonly reason: "length" | "lowDamage" | "destroyed" }
  | { readonly act: "next"; readonly chain: RevengeChain; readonly due: number; readonly giveupAt: number };

/**
 * What follows an attack that landed (the file comment).
 *
 * @param chain - The chain before this attack; null when it was the first.
 * @param landed - The yard's damage before and after the attack (0-100).
 * @param last - When this attack was made, unix seconds.
 * @param refillSeconds - How long the bot takes to refill its army ({@link armyRefillSeconds}).
 * @param rng - Random numbers in [0, 1): the chain length, the slack.
 */
export const nextInChain = (
  chain: RevengeChain | null,
  landed: { readonly damageBefore: number; readonly damageAfter: number },
  last: number,
  refillSeconds: number,
  rng: () => number
): ChainStep => {
  const length = chain?.length ?? drawChainLength(rng);
  const done = (chain?.done ?? 0) + 1;
  if (done >= length) return { act: "end", reason: "length" };
  if (landed.damageAfter - landed.damageBefore < CHAIN_MIN_DAMAGE) return { act: "end", reason: "lowDamage" };
  if (landed.damageAfter >= CHAIN_DESTROYED_DAMAGE) return { act: "end", reason: "destroyed" };
  const slack = CHAIN_SLACK_MINUTES.min + rng() * (CHAIN_SLACK_MINUTES.max - CHAIN_SLACK_MINUTES.min);
  const due = Math.floor(last + refillSeconds + slack * MINUTE);
  return { act: "next", chain: { length, done, last }, due, giveupAt: due + CHAIN_WAIT_HOURS * HOUR };
};
