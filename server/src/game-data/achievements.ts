/**
 * The achievements list (`docs/design/achievements.md` §5, issue #204): all 22
 * of Flash's entries (`client/scripts/ACHIEVEMENTS.as:35-51`), numbered as
 * Flash numbered them so the stored record lines up with Flash's
 * `stats.achievements` one to one (D7). Entry 0, Flash's empty placeholder, is
 * left out.
 *
 * Names, descriptions and Shiny were approved by the owner on 2026-10-05
 * (open questions Q1 and Q6). Six entries need features the web does not have
 * (Q2): they stay `available: false`, which means never evaluated, never sent
 * to a client and never paid, until their feature lands (WP9, #299).
 *
 * Each rule reads the server-side stats of `save.achievements`
 * (`services/achievements/state.ts`), never `save.stats`, which `/base/save`
 * lets a client write.
 */

/**
 * The stats a rule can read, Flash's names where Flash had one
 * (`ACHIEVEMENTS.as:12-32`). Flash's `DESCENT_LEVEL`, `UNDERHALL_LEVEL` and
 * `INFERNO_QUESTS_COMPLETED` are renamed: Flash's own constants never matched
 * them, so they never counted (§3.3). Every value only ever goes up.
 */
export const ACHIEVEMENT_STATS = [
  "thlevel",
  "map2",
  "wmoutpost",
  "playeroutpost",
  "monstersblended",
  "upgrade_champ1",
  "upgrade_champ2",
  "upgrade_champ3",
  "heavytraps",
  "wm2hall",
  "blocksbuilt",
  "starterkit",
  "alliance",
  "unlock_monster",
  "stockpile",
  "hugerage",
  "descent",
  "underhall",
  "infernoquests",
] as const;

export type AchievementStat = (typeof ACHIEVEMENT_STATS)[number];

/** One part of a rule: the stat at `target` or more. */
export interface AchievementRule {
  readonly stat: AchievementStat;
  readonly target: number;
}

export interface AchievementDef {
  /** Flash's number, 1 to 22. */
  readonly id: number;
  readonly name: string;
  readonly description: string;
  /** Paid once, the moment it unlocks. */
  readonly shiny: number;
  readonly rules: readonly AchievementRule[];
  /** `all`: every rule met. `any`: one is enough (Flash's `ANY: 1`, entry 4 only). */
  readonly mode: "all" | "any";
  /** False: its feature is missing, so it is never evaluated, shown or paid (§5.3). */
  readonly available: boolean;
  /** Where Flash defined the rule and moved its stat (`client/scripts`). */
  readonly flash: string;
}

const LIST: readonly AchievementDef[] = [
  {
    id: 1,
    name: "Moving Up",
    description: "Upgrade your Town Hall to level 2.",
    shiny: 5,
    rules: [{ stat: "thlevel", target: 2 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:37; BUILDING14.as:137, :151, :177",
  },
  {
    id: 2,
    name: "Town Planner",
    description: "Upgrade your Town Hall to level 5.",
    shiny: 10,
    rules: [{ stat: "thlevel", target: 5 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:37; BUILDING14.as:137, :151, :177",
  },
  {
    id: 3,
    name: "Backyard Boss",
    description: "Upgrade your Town Hall to level 8.",
    shiny: 15,
    rules: [{ stat: "thlevel", target: 8 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:37; BUILDING14.as:137, :151, :177",
  },
  {
    id: 4,
    name: "Champion Trainer",
    description: "Fully evolve Gorgo, Drull or Fomor (level 6).",
    shiny: 15,
    rules: [
      { stat: "upgrade_champ1", target: 1 },
      { stat: "upgrade_champ2", target: 1 },
      { stat: "upgrade_champ3", target: 1 },
    ],
    // Flash's ANY loop only ever counted Gorgo (ACHIEVEMENTS.as:118-131, §3.3); this is what it meant.
    mode: "any",
    available: true,
    flash: "ACHIEVEMENTS.as:38-44; CHAMPIONCAGE.as:597, :807, :852",
  },
  {
    id: 5,
    name: "Champion of Champions",
    description: "Fully evolve Gorgo, Drull and Fomor (level 6).",
    shiny: 25,
    rules: [
      { stat: "upgrade_champ1", target: 1 },
      { stat: "upgrade_champ2", target: 1 },
      { stat: "upgrade_champ3", target: 1 },
    ],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:44-48; CHAMPIONCAGE.as:597, :807, :852",
  },
  {
    id: 6,
    name: "Brave New World",
    description: "Upgrade your Map Room to level 2 and join the world map.",
    shiny: 10,
    rules: [{ stat: "map2", target: 1 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:48; BUILDING11.as:54, :286",
  },
  {
    id: 7,
    name: "Camp Crusher",
    description: "Take over a wild monster camp.",
    shiny: 10,
    rules: [{ stat: "wmoutpost", target: 1 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:48; BASE.as:2306",
  },
  {
    id: 8,
    name: "Empire Builder",
    description: "Take over 5 outposts from other players.",
    shiny: 20,
    rules: [{ stat: "playeroutpost", target: 5 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:48; BASE.as:2314",
  },
  {
    id: 9,
    name: "Huge Rage",
    description: "Fire the biggest Putty catapult bomb.",
    shiny: 10,
    rules: [{ stat: "hugerage", target: 1 }],
    mode: "all",
    // Flash blocked it and never awarded it (ACHIEVEMENTS.as:48-50, :113-116).
    available: false,
    flash: "ACHIEVEMENTS.as:48-50; com/monsters/effects/ResourceBombs.as:318-319",
  },
  {
    id: 10,
    name: "Kozu Crusher",
    description: "Destroy a Kozu Town Hall.",
    shiny: 10,
    rules: [{ stat: "wm2hall", target: 1 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:51; ATTACK.as:961-963",
  },
  {
    id: 11,
    name: "Juice Master",
    description: "Juice 5,000 monsters.",
    shiny: 20,
    rules: [{ stat: "monstersblended", target: 5000 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:51; BUILDING9.as:45-47",
  },
  {
    id: 12,
    name: "Great Wall",
    description: "Build 200 Blocks.",
    shiny: 10,
    rules: [{ stat: "blocksbuilt", target: 200 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:51; BUILDING17.as:34",
  },
  {
    id: 13,
    name: "Instant Outpost",
    description: "Buy a Starter Kit.",
    shiny: 5,
    rules: [{ stat: "starterkit", target: 1 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:51; popup_prefab.as:272",
  },
  {
    id: 14,
    name: "Better Together",
    description: "Join an alliance.",
    shiny: 5,
    rules: [{ stat: "alliance", target: 1 }],
    mode: "all",
    // Waits for a web alliance screen.
    available: false,
    flash: "ACHIEVEMENTS.as:51; BASE.as:819; com/monsters/alliances/ALLIANCES.as:553",
  },
  {
    id: 15,
    name: "Hoarder",
    description: "Hold more than 25,000,000 of each resource at once.",
    shiny: 25,
    rules: [{ stat: "stockpile", target: 1 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:51; BASE.as:4725-4726",
  },
  {
    id: 16,
    name: "Trapper",
    description: "Build 8 Heavy Traps.",
    shiny: 10,
    rules: [{ stat: "heavytraps", target: 8 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:51; BUILDING117.as:14",
  },
  {
    id: 17,
    name: "New Recruit",
    description: "Unlock a monster in the Monster Locker.",
    shiny: 5,
    rules: [{ stat: "unlock_monster", target: 1 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:51; CREATURELOCKER.as:75, :85, :911",
  },
  {
    id: 18,
    name: "Into the Depths",
    description: "Clear the first Descent level.",
    shiny: 10,
    rules: [{ stat: "descent", target: 1 }],
    mode: "all",
    // Waits for Inferno Descent.
    available: false,
    flash: "ACHIEVEMENTS.as:51; ATTACK.as:975",
  },
  {
    id: 19,
    name: "Rock Bottom",
    description: "Clear all 14 Descent levels.",
    shiny: 25,
    rules: [{ stat: "descent", target: 14 }],
    mode: "all",
    // Waits for Inferno Descent (MAPROOM_DESCENT.as:24: 14 levels).
    available: false,
    flash: "ACHIEVEMENTS.as:51; ATTACK.as:975",
  },
  {
    id: 20,
    name: "Hall of the Deep",
    description: "Upgrade the Underhall to level 5.",
    shiny: 15,
    rules: [{ stat: "underhall", target: 5 }],
    mode: "all",
    // Waits for the Inferno yard; Flash's intent inferred from BUILDING14.as:138.
    available: false,
    flash: "ACHIEVEMENTS.as:51; BUILDING14.as:138",
  },
  {
    id: 21,
    name: "Hellraiser",
    description: "Complete 10 Inferno quests.",
    shiny: 15,
    rules: [{ stat: "infernoquests", target: 10 }],
    mode: "all",
    // Waits for Inferno quests.
    available: false,
    flash: "ACHIEVEMENTS.as:51; QUESTS.as:1652",
  },
  {
    id: 22,
    name: "Top of the Heap",
    description: "Upgrade your Town Hall to level 10.",
    shiny: 25,
    rules: [{ stat: "thlevel", target: 10 }],
    mode: "all",
    available: true,
    flash: "ACHIEVEMENTS.as:51; BUILDING14.as:137, :151, :177",
  },
];

/** All 22, in Flash's order. */
export const ACHIEVEMENTS: readonly AchievementDef[] = LIST;

/** The entries players can earn now: 16 of them (§5.1). */
export const AVAILABLE_ACHIEVEMENTS: readonly AchievementDef[] = LIST.filter((entry) => entry.available);

const BY_ID = new Map(LIST.map((entry) => [entry.id, entry]));

/** The entry with Flash's number `id`; undefined for anything else. */
export const achievementById = (id: number): AchievementDef | undefined => BY_ID.get(id);
