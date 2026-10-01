import type { TribeCounterName } from "../services/onboarding/state.js";

/**
 * The Goals list (`docs/design/tutorial.md` §6.1, issue #227): Flash's quests
 * (`client/scripts/QUESTS.as`, `setupMainQuests`) with Flash's exact rewards,
 * less the quests for features the web does not have, plus three new ones.
 *
 * Flash has 85 quests. Kept: 65. Dropped: C0, C1 and C8 (`block: true`, never
 * paid), EM1 (the Radio Tower), SW4-SW12 (no Siege Factory or Siege Lab), FAN,
 * INVITE1/5/10 and GA1-GA3 (Facebook). New: N1-N3, rewards PLACEHOLDER
 * (decision Q7 of 2026-10-01).
 *
 * The kept entries were read out of `QUESTS.as` by a script: `order`,
 * `reward` (Flash's fifth slot, Shiny, is 0 on every kept quest), `prereq`,
 * `monster_reward`/`reward_creatureid` (the unlock quests' counts come from
 * the `_loc1_` table at `QUESTS.as:1155`), and the rule, mapped to a
 * {@link GoalCondition} as §6.2 says. Names and descriptions are Flash's
 * `q_*` strings (`server/public/gamestage/assets/english.json`), "Blend"
 * said as the web says it, "Juice".
 *
 * Each condition is checked on the server only (`services/goals/goalRules.ts`).
 */

/** The server-side counters a goal can read (`OnboardingCounters`). */
export type GoalCounter = "mushrooms" | "goldMushrooms" | "bestBank" | "juiced" | "baiterRuns";

/** What has to be true for a goal to be met (§6.2). */
export type GoalCondition =
  /** A building of `type` at `level` or more, construction finished. */
  | { kind: "building"; type: number; level: number }
  /** Any building at `level` or more (U1). */
  | { kind: "anyBuilding"; level: number }
  /** One of each of `types` at `level` or more (C3). */
  | { kind: "buildings"; types: readonly number[]; level: number }
  /** The monster unlocked in the Monster Locker (`lockerdata[id].t == 2`). */
  | { kind: "unlocked"; monster: string }
  /** A champion of save type `t` in `save.champion`, at `level` or more (1: hatched). */
  | { kind: "champion"; type: number; level: number }
  /** A server-side counter at `target` or more. */
  | { kind: "counter"; counter: GoalCounter; target: number }
  /** A Map Room 1 tribe of this kind destroyed (WM1-WM4). */
  | { kind: "tribe"; tribe: TribeCounterName }
  /** The staged raid watched (D1: `onboarding.raidSeen`). */
  | { kind: "raid" }
  /** A layout saved in the Yard Planner (`save.savetemplate`). */
  | { kind: "layout" };

/** Resources a goal pays: twigs, pebbles, putty, goo. */
export interface GoalReward {
  readonly r1: number;
  readonly r2: number;
  readonly r3: number;
  readonly r4: number;
}

export interface GoalDef {
  readonly id: string;
  /** Flash's display order (`order`); ties keep this list's order. */
  readonly order: number;
  readonly name: string;
  readonly description: string;
  readonly reward: GoalReward;
  /** Monsters the goal houses, which need room in Housing for all of them (Q10). */
  readonly monsters?: { readonly id: string; readonly count: number };
  /** Shown only once this goal is claimed. */
  readonly prereq?: string;
  readonly condition: GoalCondition;
  /** Hidden on Map Room 2 (WM1-WM4, decision Q9): their tribes are Map Room 1's. */
  readonly mapRoom1Only?: boolean;
}

const LIST: readonly GoalDef[] = [
  {
    id: "U1",
    order: 4,
    name: "Next Level",
    description: "Upgrade any building to Level 2.",
    reward: { r1: 4_000, r2: 4_600, r3: 500, r4: 0 },
    condition: { kind: "anyBuilding", level: 2 },
  },
  {
    id: "T1",
    order: 5,
    name: "Sniper Tower",
    description: "Build a Sniper Tower.",
    reward: { r1: 2_000, r2: 2_000, r3: 0, r4: 0 },
    condition: { kind: "building", type: 21, level: 1 },
  },
  {
    id: "D1",
    order: 6,
    name: "First Blood",
    description: "Defend your yard from a Wild Monster attack.",
    reward: { r1: 800, r2: 800, r3: 1_000, r4: 1_000 },
    condition: { kind: "raid" },
  },
  {
    id: "CR3",
    order: 7,
    name: "Home Sweet Home",
    description: "Build Monster Housing.",
    reward: { r1: 2_000, r2: 2_000, r3: 2_000, r4: 2_000 },
    condition: { kind: "building", type: 15, level: 1 },
  },
  {
    id: "C18",
    order: 8,
    name: "Flinger",
    description: "Build a Flinger.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 1_000 },
    condition: { kind: "building", type: 5, level: 1 },
  },
  {
    id: "C17",
    order: 9,
    name: "Monster Maps",
    description: "Build a Map Room.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 1_000 },
    condition: { kind: "building", type: 11, level: 1 },
  },
  {
    id: "WM1",
    order: 10,
    name: "Junior Destroyer",
    description: "Take down a Legionnaire Tribe's Town Hall.",
    reward: { r1: 6_500, r2: 6_500, r3: 500, r4: 1_500 },
    condition: { kind: "tribe", tribe: "legionnaire" },
    mapRoom1Only: true,
  },
  {
    id: "CR2",
    order: 11,
    name: "Start Hatching",
    description: "Build a Hatchery.",
    reward: { r1: 1_000, r2: 1_000, r3: 0, r4: 1_000 },
    condition: { kind: "building", type: 13, level: 1 },
  },
  {
    id: "C3",
    order: 12,
    name: "Next Level II",
    description: "Upgrade one of each resource building to level 2.",
    reward: { r1: 8_000, r2: 8_000, r3: 8_000, r4: 8_000 },
    condition: { kind: "buildings", types: [1, 2, 3, 4], level: 2 },
  },
  {
    id: "M1",
    order: 13,
    name: "Mushroom Soup",
    description: "Pick 5 Mushrooms.",
    reward: { r1: 1_000, r2: 1_000, r3: 500, r4: 500 },
    condition: { kind: "counter", counter: "mushrooms", target: 5 },
  },
  {
    id: "T2",
    order: 14,
    name: "Cannon Tower",
    description: "Build a Cannon Tower.",
    reward: { r1: 2_000, r2: 2_000, r3: 0, r4: 0 },
    condition: { kind: "building", type: 20, level: 1 },
  },
  {
    id: "S1",
    order: 15,
    name: "Storage Silo",
    description: "Build a Storage Silo.",
    reward: { r1: 2_000, r2: 2_000, r3: 1_000, r4: 1_000 },
    condition: { kind: "building", type: 6, level: 1 },
  },
  {
    id: "C13",
    order: 16,
    name: "Town Hall Level 2",
    description: "Upgrade your Town Hall to Level 2.",
    reward: { r1: 4_000, r2: 4_000, r3: 0, r4: 500 },
    condition: { kind: "building", type: 14, level: 2 },
  },
  {
    id: "WM2",
    order: 18,
    name: "Novice Destroyer",
    description: "Take down a Kozu Tribe's Town Hall.",
    reward: { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 },
    condition: { kind: "tribe", tribe: "kozu" },
    mapRoom1Only: true,
  },
  {
    id: "CR1",
    order: 19,
    name: "Monster Locker",
    description: "Build a Monster Locker.",
    reward: { r1: 1_000, r2: 1_000, r3: 5_000, r4: 0 },
    prereq: "C13",
    condition: { kind: "building", type: 8, level: 1 },
  },
  {
    id: "UC2",
    order: 20,
    name: "Unlock Octo-ooze",
    description: "Unlock Octo-ooze in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C2", count: 10 },
    prereq: "CR1",
    condition: { kind: "unlocked", monster: "C2" },
  },
  {
    id: "UC3",
    order: 21,
    name: "Unlock Bolt",
    description: "Unlock Bolt in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C3", count: 10 },
    prereq: "UC2",
    condition: { kind: "unlocked", monster: "C3" },
  },
  {
    id: "UC4",
    order: 22,
    name: "Unlock Fink",
    description: "Unlock Fink in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C4", count: 10 },
    prereq: "UC3",
    condition: { kind: "unlocked", monster: "C4" },
  },
  {
    id: "C9",
    order: 23,
    name: "Level 3 Twig Snapper",
    description: "Upgrade your Twig Snapper to Level 3.",
    reward: { r1: 20_000, r2: 0, r3: 0, r4: 0 },
    condition: { kind: "building", type: 1, level: 3 },
  },
  {
    id: "C10",
    order: 24,
    name: "Level 3 Pebble Shiner",
    description: "Upgrade your Pebble Shiner to Level 3.",
    reward: { r1: 0, r2: 10_000, r3: 0, r4: 0 },
    condition: { kind: "building", type: 2, level: 3 },
  },
  {
    id: "C11",
    order: 25,
    name: "Level 3 Putty Squisher",
    description: "Upgrade your Putty Squisher to Level 3.",
    reward: { r1: 0, r2: 0, r3: 2_500, r4: 0 },
    condition: { kind: "building", type: 3, level: 3 },
  },
  {
    id: "C12",
    order: 26,
    name: "Level 3 Goo Factory",
    description: "Upgrade your Goo Factory to Level 3.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 2_000 },
    condition: { kind: "building", type: 4, level: 3 },
  },
  {
    id: "S2",
    order: 27,
    name: "Storage Silo Level 2",
    description: "Upgrade your Storage Silo to Level 2.",
    reward: { r1: 4_000, r2: 4_000, r3: 2_000, r4: 2_000 },
    prereq: "S1",
    condition: { kind: "building", type: 6, level: 2 },
  },
  {
    id: "BK1",
    order: 28,
    name: "Resource Gatherer",
    description: "Bank 1,000 resources with a single click.",
    reward: { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 },
    condition: { kind: "counter", counter: "bestBank", target: 1000 },
  },
  {
    id: "C4",
    order: 29,
    name: "Level 4 Twig Snapper",
    description: "Upgrade your Twig Snapper to Level 4.",
    reward: { r1: 20_000, r2: 0, r3: 0, r4: 0 },
    prereq: "C9",
    condition: { kind: "building", type: 1, level: 4 },
  },
  {
    id: "C5",
    order: 30,
    name: "Level 4 Pebble Shiner",
    description: "Upgrade your Pebble Shiner to Level 4.",
    reward: { r1: 0, r2: 20_000, r3: 0, r4: 0 },
    prereq: "C10",
    condition: { kind: "building", type: 2, level: 4 },
  },
  {
    id: "C6",
    order: 31,
    name: "Level 4 Putty Squisher",
    description: "Upgrade your Putty Squisher to Level 4.",
    reward: { r1: 0, r2: 0, r3: 10_000, r4: 0 },
    prereq: "C11",
    condition: { kind: "building", type: 3, level: 4 },
  },
  {
    id: "C7",
    order: 32,
    name: "Level 4 Goo Factory",
    description: "Upgrade your Goo Factory to Level 4.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 10_000 },
    prereq: "C12",
    condition: { kind: "building", type: 4, level: 4 },
  },
  {
    id: "WM3",
    order: 33,
    name: "Savage Destroyer",
    description: "Take down an Abunakki Tribe's Town Hall.",
    reward: { r1: 20_000, r2: 20_000, r3: 20_000, r4: 20_000 },
    condition: { kind: "tribe", tribe: "abunakki" },
    mapRoom1Only: true,
  },
  {
    id: "S3",
    order: 34,
    name: "Storage Silo Level 3",
    description: "Upgrade your Storage Silo to Level 3.",
    reward: { r1: 8_000, r2: 8_000, r3: 4_000, r4: 4_000 },
    prereq: "S2",
    condition: { kind: "building", type: 6, level: 3 },
  },
  {
    id: "C14",
    order: 35,
    name: "Town Hall Level 3",
    description: "Upgrade your Town Hall to Level 3.",
    reward: { r1: 5_000, r2: 5_000, r3: 2_500, r4: 2_500 },
    prereq: "C13",
    condition: { kind: "building", type: 14, level: 3 },
  },
  {
    id: "C51",
    order: 36,
    name: "Catapult",
    description: "Build a Catapult.",
    reward: { r1: 20_000, r2: 0, r3: 0, r4: 0 },
    condition: { kind: "building", type: 51, level: 1 },
  },
  {
    id: "S4",
    order: 37,
    name: "Storage Silo Level 4",
    description: "Upgrade your Storage Silo to Level 4.",
    reward: { r1: 16_000, r2: 16_000, r3: 8_000, r4: 8_000 },
    prereq: "S3",
    condition: { kind: "building", type: 6, level: 4 },
  },
  {
    id: "S5",
    order: 38,
    name: "Storage Silo Level 5",
    description: "Upgrade your Storage Silo to Level 5.",
    reward: { r1: 32_000, r2: 32_000, r3: 16_000, r4: 16_000 },
    prereq: "S4",
    condition: { kind: "building", type: 6, level: 5 },
  },
  {
    id: "UC5",
    order: 39,
    name: "Unlock Eye-ra",
    description: "Unlock Eye-ra in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C5", count: 2 },
    prereq: "C14",
    condition: { kind: "unlocked", monster: "C5" },
  },
  {
    id: "UC6",
    order: 40,
    name: "Unlock Ichi",
    description: "Unlock Ichi in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C6", count: 15 },
    prereq: "UC5",
    condition: { kind: "unlocked", monster: "C6" },
  },
  {
    id: "UC7",
    order: 41,
    name: "Unlock Bandito",
    description: "Unlock Bandito in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C7", count: 15 },
    prereq: "UC6",
    condition: { kind: "unlocked", monster: "C7" },
  },
  {
    id: "UC8",
    order: 42,
    name: "Unlock Fang",
    description: "Unlock Fang in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C8", count: 15 },
    prereq: "UC7",
    condition: { kind: "unlocked", monster: "C8" },
  },
  {
    id: "BK2",
    order: 43,
    name: "Resource Collector",
    description: "Bank 20,000 resources with a single click.",
    reward: { r1: 2_000, r2: 2_000, r3: 2_000, r4: 2_000 },
    prereq: "BK1",
    condition: { kind: "counter", counter: "bestBank", target: 20000 },
  },
  {
    id: "BL1",
    order: 44,
    name: "Monster Juice",
    description: "Juice 10 monsters in the Monster Juicer.",
    reward: { r1: 0, r2: 0, r3: 1_000, r4: 1_000 },
    condition: { kind: "counter", counter: "juiced", target: 10 },
  },
  {
    id: "C15",
    order: 45,
    name: "Town Hall Level 4",
    description: "Upgrade your Town Hall to Level 4.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C9", count: 20 },
    prereq: "C14",
    condition: { kind: "building", type: 14, level: 4 },
  },
  {
    id: "T3",
    order: 46,
    name: "Tesla Tower",
    description: "Build a Tesla Tower.",
    reward: { r1: 10_000, r2: 10_000, r3: 10_000, r4: 0 },
    condition: { kind: "building", type: 25, level: 1 },
  },
  {
    id: "UC9",
    order: 47,
    name: "Unlock Brain",
    description: "Unlock Brain in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C9", count: 20 },
    prereq: "C15",
    condition: { kind: "unlocked", monster: "C9" },
  },
  {
    id: "UC10",
    order: 48,
    name: "Unlock Crabatron",
    description: "Unlock Crabatron in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C10", count: 20 },
    prereq: "UC9",
    condition: { kind: "unlocked", monster: "C10" },
  },
  {
    id: "UC11",
    order: 49,
    name: "Unlock Project X",
    description: "Unlock Project X in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C11", count: 5 },
    prereq: "UC10",
    condition: { kind: "unlocked", monster: "C11" },
  },
  {
    id: "WM4",
    order: 50,
    name: "Dread Destroyer",
    description: "Take down a Dreadnaut Tribe's Town Hall.",
    reward: { r1: 40_000, r2: 40_000, r3: 40_000, r4: 40_000 },
    condition: { kind: "tribe", tribe: "dreadnaut" },
    mapRoom1Only: true,
  },
  {
    id: "C16",
    order: 51,
    name: "Town Hall Level 5",
    description: "Upgrade your Town Hall to Level 5.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C14", count: 5 },
    prereq: "C14",
    condition: { kind: "building", type: 14, level: 5 },
  },
  {
    id: "UG1",
    order: 52,
    name: "Gorgo the Great",
    description: "Evolve Gorgo to Level 6 and watch him \"go bananas\" on your enemies.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 800_000 },
    prereq: "HG1",
    condition: { kind: "champion", type: 1, level: 6 },
  },
  {
    id: "UG2",
    order: 53,
    name: "Drull the Destroyer",
    description: "Evolve Drull to Level 6 and swallow your enemies whole!",
    reward: { r1: 0, r2: 0, r3: 0, r4: 800_000 },
    prereq: "HG2",
    condition: { kind: "champion", type: 2, level: 6 },
  },
  {
    id: "UC13",
    order: 55,
    name: "Unlock Wormzer",
    description: "Unlock Wormzer in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C13", count: 5 },
    prereq: "UC11",
    condition: { kind: "unlocked", monster: "C13" },
  },
  {
    id: "UC12",
    order: 56,
    name: "Unlock D.A.V.E.",
    description: "Unlock D.A.V.E. in the Monster Locker.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "C12", count: 2 },
    prereq: "UC13",
    condition: { kind: "unlocked", monster: "C12" },
  },
  {
    id: "BK3",
    order: 57,
    name: "Resource Trader",
    description: "Bank 100,000 resources with a single click.",
    reward: { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 },
    prereq: "BK2",
    condition: { kind: "counter", counter: "bestBank", target: 100000 },
  },
  {
    id: "UG3",
    order: 57,
    name: "Fomor the Fearless",
    description: "Evolve Fomor to Level 6 and watch your enemies tremble with fear.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 800_000 },
    prereq: "HG3",
    condition: { kind: "champion", type: 3, level: 6 },
  },
  {
    id: "BK4",
    order: 58,
    name: "Resource Mogul",
    description: "Bank 500,000 resources with a single click.",
    reward: { r1: 50_000, r2: 50_000, r3: 50_000, r4: 50_000 },
    prereq: "BK3",
    condition: { kind: "counter", counter: "bestBank", target: 500000 },
  },
  {
    id: "BL2",
    order: 59,
    name: "Monster Smoothie",
    description: "Juice 100 monsters in the Monster Juicer.",
    reward: { r1: 0, r2: 0, r3: 10_000, r4: 10_000 },
    prereq: "BL1",
    condition: { kind: "counter", counter: "juiced", target: 100 },
  },
  {
    id: "BL3",
    order: 60,
    name: "Monster Milkshake",
    description: "Juice 1,000 monsters in the Monster Juicer.",
    reward: { r1: 0, r2: 0, r3: 100_000, r4: 100_000 },
    prereq: "BL2",
    condition: { kind: "counter", counter: "juiced", target: 1000 },
  },
  {
    id: "BL4",
    order: 61,
    name: "Monster Margarita",
    description: "Juice 5,000 monsters in the Monster Juicer.",
    reward: { r1: 0, r2: 0, r3: 1_000_000, r4: 1_000_000 },
    prereq: "BL3",
    condition: { kind: "counter", counter: "juiced", target: 5000 },
  },
  {
    id: "M4",
    order: 62,
    name: "Golden Mushroom Booty",
    description: "Pick 5 Golden Mushrooms.",
    reward: { r1: 1_000, r2: 1_000, r3: 500, r4: 500 },
    prereq: "M1",
    condition: { kind: "counter", counter: "goldMushrooms", target: 5 },
  },
  {
    id: "M2",
    order: 63,
    name: "Mushroom Pizza",
    description: "Pick 100 Mushrooms.",
    reward: { r1: 5_000, r2: 5_000, r3: 5_000, r4: 5_000 },
    prereq: "M1",
    condition: { kind: "counter", counter: "mushrooms", target: 100 },
  },
  {
    id: "M5",
    order: 64,
    name: "Golden Mushroom Bling",
    description: "Pick 20 Golden Mushrooms.",
    reward: { r1: 5_000, r2: 5_000, r3: 5_000, r4: 5_000 },
    prereq: "M4",
    condition: { kind: "counter", counter: "goldMushrooms", target: 20 },
  },
  {
    id: "M6",
    order: 65,
    name: "Golden Mushroom Jackpot",
    description: "Pick 50 Golden Mushrooms.",
    reward: { r1: 50_000, r2: 50_000, r3: 50_000, r4: 50_000 },
    prereq: "M5",
    condition: { kind: "counter", counter: "goldMushrooms", target: 50 },
  },
  {
    id: "M3",
    order: 66,
    name: "Mushroom Burger",
    description: "Pick 200 Mushrooms.",
    reward: { r1: 10_000, r2: 10_000, r3: 20_000, r4: 20_000 },
    prereq: "M2",
    condition: { kind: "counter", counter: "mushrooms", target: 200 },
  },
  {
    id: "HG1",
    order: 67,
    name: "Hatch Gorgo",
    description: "Hatch Gorgo in the Champion Cage.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 10_000 },
    condition: { kind: "champion", type: 1, level: 1 },
  },
  {
    id: "HG2",
    order: 68,
    name: "Hatch Drull",
    description: "Hatch Drull in the Champion Cage.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 10_000 },
    condition: { kind: "champion", type: 2, level: 1 },
  },
  {
    id: "HG3",
    order: 69,
    name: "Hatch Fomor",
    description: "Hatch Fomor in the Champion Cage.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 10_000 },
    condition: { kind: "champion", type: 3, level: 1 },
  },
  // New goals (§6.1, decision Q7): rewards PLACEHOLDER.
  {
    id: "N1",
    order: 80,
    name: "Test Your Defences",
    description: "Finish a practice run with the Wild Monster Baiter.",
    reward: { r1: 5_000, r2: 5_000, r3: 2_500, r4: 2_500 },
    prereq: "CR1",
    condition: { kind: "counter", counter: "baiterRuns", target: 1 },
  },
  {
    id: "N2",
    order: 81,
    name: "Master Planner",
    description: "Save a layout in the Yard Planner.",
    reward: { r1: 2_000, r2: 2_000, r3: 0, r4: 0 },
    condition: { kind: "layout" },
  },
  {
    id: "N3",
    order: 82,
    name: "Into the Wild",
    description: "Upgrade your Map Room to Level 2 and move to Map Room 2.",
    reward: { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 },
    prereq: "C14",
    condition: { kind: "building", type: 11, level: 2 },
  },
];

/** Every goal, in display order. */
export const GOALS: readonly GoalDef[] = LIST.map((goal, index) => ({ goal, index }))
  .sort((a, b) => a.goal.order - b.goal.order || a.index - b.index)
  .map(({ goal }) => goal);

const BY_ID = new Map(GOALS.map((goal) => [goal.id, goal]));

/** A goal by id, or undefined. */
export const goalById = (id: string): GoalDef | undefined => BY_ID.get(id);
