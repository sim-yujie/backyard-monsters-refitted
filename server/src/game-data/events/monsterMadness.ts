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
 * its own empire value up to a top camp's 3.2 million
 * (`PLAYER_OUTPOST_POINTS_CAP`, owner 27 Nov 2026). Each outpost scores once
 * per run.
 *
 * THE CRYSTAL REDESIGN (owner's grilling, 27 Nov 2026): a run lasts
 * {@link MONSTER_MADNESS_DAYS} days and has one goal,
 * {@link MONSTER_MADNESS_GOAL} points, a "clear". A clear pays
 * {@link MONSTER_MADNESS_CRYSTALS_PER_CLEAR} crystal, which the player spends
 * on Gorgo, Drull, Fomor or Korath to unlock that champion's next ability
 * (`services/events/championCrystals.ts`). Korath's three are Flash's powers:
 * 1 Burn, 2 Breath of Fire, 3 Fists of Doom (`MonsterMadness.as:50-63`,
 * `KorathReward.as`); Gorgo's, Drull's and Fomor's are new
 * (`game-rules/combat/championAbilities.ts`). Flash's three goals (42M,
 * 94.5M, 160.125M) each paid the next Korath power. Burn is the flame his
 * hits leave; here only a Korath with power 1 or more burns (`hasFlame`,
 * owner 11 Nov 2026). An ability is kept for good, and one unlocked before
 * the player has the champion waits for him. Korath himself still comes
 * from owning an Inferno yard (owner I10).
 *
 * NOT ON A CALENDAR (owner, 11 Nov 2026): the event never starts by itself.
 * The owner starts a run from the dashboard (Events tab, "Monster Madness",
 * `POST /api/:v/admin/monster-madness { action: "start" }`), which records
 * its start time (`services/events/monsterMadnessRuns.ts`); each run is its
 * own event, id `monster-madness-<start unix s>`, with its own progress rows.
 * Locally, `EVENTS_FORCE_ON=monster-madness` runs one from today's midnight.
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

/** A clear: the run's one goal (owner, 27 Nov 2026; Flash had three, up to 160.125M). */
export const MONSTER_MADNESS_GOAL = 100_000_000;

/** The goals, lowest first: one since the crystal redesign. */
export const MONSTER_MADNESS_GOALS: readonly number[] = [MONSTER_MADNESS_GOAL];

/**
 * Crystals a clear pays. One clear per run: the ladder's one tier is claimed
 * once (the owner's grilling left "per run or per 100M" open; this is the
 * one place to change it).
 */
export const MONSTER_MADNESS_CRYSTALS_PER_CLEAR = 1;

/** How long a run lasts: 7 days (owner, 27 Nov 2026; Flash's ran 4, `MonsterMadness.as:113-118`). */
export const MONSTER_MADNESS_DAYS = 7;

/** Days after a run ends that a goal reached in time can still be claimed. */
export const MONSTER_MADNESS_CLAIM_DAYS = 7;

/** The id every run's id starts with, and the one `EVENTS_FORCE_ON` names. */
export const MONSTER_MADNESS_ID = "monster-madness";

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

/** One tier per goal, each paying a crystal. */
export const MONSTER_MADNESS_LADDER: readonly LadderTier[] = MONSTER_MADNESS_GOALS.map((need) => ({
  need,
  rewards: [{ kind: "crystal", count: MONSTER_MADNESS_CRYSTALS_PER_CLEAR }],
}));

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

/** The run started at `startsAt` (unix s). */
export const monsterMadnessRun = (startsAt: number, id = `${MONSTER_MADNESS_ID}-${Math.floor(startsAt)}`): EventDefinition => ({
  id,
  title: "Monster Madness",
  text: "Take over Map Room 2 outposts for points. Reach the goal for a crystal: it unlocks a champion ability.",
  kind: "monster-madness",
  startsAt: iso(Math.floor(startsAt)),
  endsAt: iso(Math.floor(startsAt) + MONSTER_MADNESS_DAYS * 24 * 60 * 60),
  banner: "/events/monster-madness-banner.jpg",
  ladder: { label: "Takeover points", source: "takeovers", tiers: MONSTER_MADNESS_LADDER },
  // Only Map Room 2 outposts score, so a player on Map Room 1 is told to move first.
  requires: { tutorial: true, mapRoom2: true },
  claimDays: MONSTER_MADNESS_CLAIM_DAYS,
});

/**
 * The run `EVENTS_FORCE_ON=monster-madness` switches on locally: its window
 * is moved to today by `eventWindow`, so its own dates are only a length.
 */
export const MONSTER_MADNESS_TEMPLATE: EventDefinition = monsterMadnessRun(0, MONSTER_MADNESS_ID);
