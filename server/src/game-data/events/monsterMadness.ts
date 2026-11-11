import { Reward } from "../../enums/Rewards.js";
import type { EventDefinition, LadderTier } from "./events.js";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MONSTER MADNESS ("Wrath of the Champion" in Flash,
 * `client/scripts/com/monsters/replayableEvents/attacking/monsterMadness/MonsterMadness.as`).
 *
 * For {@link MONSTER_MADNESS_DAYS} days, taking over a Map Room 2 outpost
 * scores points (`services/events/takeoverEvents.ts`): a wild tribe camp
 * the value of a player's outpost priced the same as it, a player's outpost
 * its own empire value. Each outpost scores once per run. Reaching a goal
 * unlocks one of Korath's powers, in Flash's order (`MonsterMadness.as:50-63`,
 * `KorathReward.as`): power 1 Burn, 2 Breath of Fire, 3 Fists of Doom.
 * Burn is the flame his hits leave; Flash gave it to every Korath, here only
 * a Korath with power 1 or more burns (`hasFlame` in the fight rules, owner
 * 11 Nov 2026). A power is kept for good, and one won before the player
 * has Korath waits for him (`services/events/korathPower.ts`). Korath
 * himself still comes from owning an Inferno yard (owner I10).
 *
 * NOT ON A CALENDAR (owner, 11 Nov 2026): the event never starts by itself.
 * The owner starts a run from the dashboard (Events tab, "Monster Madness",
 * `POST /api/:v/admin/monster-madness { action: "start" }`), which records
 * its start time (`services/events/monsterMadnessRuns.ts`); each run is its
 * own event, id `monster-madness-<start unix s>`, with its own progress rows.
 * Locally, `EVENTS_FORCE_ON=monster-madness` runs one from today's midnight.
 *
 * The goals are Flash's (`POINTS_GOAL1..3`), as upstream kept them.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const MONSTER_MADNESS_GOALS: readonly number[] = [42_000_000, 94_500_000, 160_125_000];

/** How long a run lasts: Flash's 23 to 27 March 2012 (`MonsterMadness.as:113-118`). */
export const MONSTER_MADNESS_DAYS = 4;

/** Days after a run ends that a goal reached in time can still be claimed. */
export const MONSTER_MADNESS_CLAIM_DAYS = 7;

/** The id every run's id starts with, and the one `EVENTS_FORCE_ON` names. */
export const MONSTER_MADNESS_ID = "monster-madness";

/** Korath's powers by level (`KorathReward` in `enums/Rewards.ts`, `Korath.as:11-15`). */
export const KORATH_POWER_NAMES: Readonly<Record<number, string>> = {
  1: "Burn",
  2: "Breath of Fire",
  3: "Fists of Doom",
};

/** The highest power an event gives (`CHAMPION_MAX_POWER_LEVEL` in the fight rules). */
export const KORATH_MAX_POWER = 3;

/**
 * The Korath power a yard's `rewards` hold (`Reward.KORATH_POWER`), 0 to
 * {@link KORATH_MAX_POWER}; 0 for none or anything unreadable.
 */
export const korathPowerOf = (rewards: unknown): number => {
  const held = rewards && typeof rewards === "object" ? (rewards as Record<string, unknown>)[Reward.KORATH_POWER] : null;
  const value = Number(held && typeof held === "object" ? (held as Record<string, unknown>).value : 0);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), KORATH_MAX_POWER) : 0;
};

/** One tier per goal, goal `i` paying power `i + 1`. */
export const MONSTER_MADNESS_LADDER: readonly LadderTier[] = MONSTER_MADNESS_GOALS.map((need, index) => ({
  need,
  rewards: [{ kind: "korath", power: index + 1 }],
}));

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

/** The run started at `startsAt` (unix s). */
export const monsterMadnessRun = (startsAt: number, id = `${MONSTER_MADNESS_ID}-${Math.floor(startsAt)}`): EventDefinition => ({
  id,
  title: "Monster Madness",
  text: "Take over Map Room 2 outposts for points. Reach a goal to win one of Korath's powers.",
  kind: "monster-madness",
  startsAt: iso(Math.floor(startsAt)),
  endsAt: iso(Math.floor(startsAt) + MONSTER_MADNESS_DAYS * 24 * 60 * 60),
  banner: "/events/monster-madness-banner.jpg",
  ladder: { label: "Takeover points", source: "takeovers", tiers: MONSTER_MADNESS_LADDER },
  requires: { tutorial: true },
  claimDays: MONSTER_MADNESS_CLAIM_DAYS,
});

/**
 * The run `EVENTS_FORCE_ON=monster-madness` switches on locally: its window
 * is moved to today by `eventWindow`, so its own dates are only a length.
 */
export const MONSTER_MADNESS_TEMPLATE: EventDefinition = monsterMadnessRun(0, MONSTER_MADNESS_ID);
