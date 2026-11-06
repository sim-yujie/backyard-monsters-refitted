import { infernoConfig } from "../config/InfernoConfig.js";

/**
 * The achievements list (`docs/design/achievements.md` §5, issue #204): all 22
 * of Flash's entries (`client/scripts/ACHIEVEMENTS.as:35-51`), numbered as
 * Flash numbered them so the stored record lines up with Flash's
 * `stats.achievements` one to one (D7). Entry 0, Flash's empty placeholder, is
 * left out.
 *
 * Names, descriptions and Shiny were approved by the owner on 2026-10-05
 * (open questions Q1 and Q6). Five entries need features the web does not have
 * (Q2): they stay `available: false`, which means never evaluated, never sent
 * to a client and never paid, until their feature lands (WP9, #299). Huge Rage,
 * which Flash blocked, was turned on in WP9.
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
  // Beta 7's hidden achievements (#392, owner 6 Nov): web-only, no Flash stat.
  "neighbourly",
  "loginstreak",
  "friends",
  "kozuattacks",
  "outposts",
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
  /** True: it belongs to the new Inferno, so it counts only while the Inferno is switched on (`infernoConfig.enabled`). */
  readonly inferno?: boolean;
  /**
   * True: hidden (#392). Until earned, every list shows it as "???" with no
   * name, description, reward or progress (`services/achievements/view.ts`);
   * the unlock pop-up is the first the player hears of it.
   */
  readonly hidden?: boolean;
  /** Where Flash defined the rule and moved its stat (`client/scripts`); "web" for the web's own. */
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
    // Flash blocked it and never awarded it (ACHIEVEMENTS.as:48-50, :113-116);
    // the owner had it turned on (#299): each landed attack counts its `pu3`
    // bombs (`services/achievements/events.ts`).
    available: true,
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
    // Inferno WP 1.12: Flash's counter after each Descent attack, raised by the landing.
    available: true,
    inferno: true,
    flash: "ACHIEVEMENTS.as:51; ATTACK.as:975",
  },
  {
    id: 19,
    name: "Rock Bottom",
    description: "Clear all 14 Descent levels.",
    shiny: 25,
    rules: [{ stat: "descent", target: 14 }],
    mode: "all",
    // Inferno WP 1.12: Flash's counter after each Descent attack, raised by the landing.
    available: true,
    inferno: true,
    flash: "ACHIEVEMENTS.as:51; ATTACK.as:975",
  },
  {
    id: 20,
    name: "Hall of the Deep",
    description: "Upgrade the Underhall to level 5.",
    shiny: 15,
    rules: [{ stat: "underhall", target: 5 }],
    mode: "all",
    // Inferno WP 4.3: the Under Hall's level, raised by every Inferno yard action.
    available: true,
    inferno: true,
    flash: "ACHIEVEMENTS.as:51; BUILDING14.as:138",
  },
  {
    id: 21,
    name: "Hellraiser",
    description: "Complete 10 Inferno quests.",
    shiny: 15,
    rules: [{ stat: "infernoquests", target: 10 }],
    mode: "all",
    // Inferno WP 4.3: the Inferno quests met (`done`), claimed or not.
    available: true,
    inferno: true,
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
  // ── Beta 7's hidden achievements (#392; owner's targets and Shiny, 6 Nov
  // 2026, beta7-grill item 32). Web-only: Flash had no 23 onwards. Every
  // counter is the server's own (`services/achievements/daily.ts`, `events.ts`).
  {
    id: 23,
    name: "Neighbourly",
    description: "Visit 30 yards in one day.",
    shiny: 15,
    // Other players' yards opened to look or help, each counted once a UTC day.
    rules: [{ stat: "neighbourly", target: 30 }],
    mode: "all",
    available: true,
    hidden: true,
    flash: "web",
  },
  {
    id: 24,
    name: "Regular",
    description: "Play 30 days in a row.",
    shiny: 25,
    // The longest run of UTC days with a load of the player's own main yard.
    rules: [{ stat: "loginstreak", target: 30 }],
    mode: "all",
    available: true,
    hidden: true,
    flash: "web",
  },
  {
    id: 25,
    name: "Popular",
    description: "Have 80 friends.",
    shiny: 15,
    // The most friends held at once.
    rules: [{ stat: "friends", target: 80 }],
    mode: "all",
    available: true,
    hidden: true,
    flash: "web",
  },
  {
    id: 26,
    // Flash's entry 10 is already "Kozu Crusher" (destroy a Kozu Town Hall).
    name: "Kozu Hunter",
    description: "Attack Kozu camps 100 times.",
    shiny: 20,
    // Landed attacks on a Kozu camp (Map Room 1 or 2) that did some damage.
    rules: [{ stat: "kozuattacks", target: 100 }],
    mode: "all",
    available: true,
    hidden: true,
    flash: "web",
  },
  {
    id: 27,
    name: "Landlord",
    description: "Hold 100 outposts at once.",
    shiny: 25,
    // The most outposts on the main save's list at once.
    rules: [{ stat: "outposts", target: 100 }],
    mode: "all",
    available: true,
    hidden: true,
    flash: "web",
  },
];

/** All 27: Flash's 22 in Flash's order, then the web's own. */
export const ACHIEVEMENTS: readonly AchievementDef[] = LIST;

/** The entries players can earn whether or not the new Inferno is on (§5.1). */
export const AVAILABLE_ACHIEVEMENTS: readonly AchievementDef[] = LIST.filter((entry) => entry.available && !entry.inferno);

/** With the Inferno's own (18, 19) once it is switched on. */
const WITH_INFERNO: readonly AchievementDef[] = LIST.filter((entry) => entry.available);

/**
 * The entries players can earn now: {@link AVAILABLE_ACHIEVEMENTS}, and the
 * Inferno's while the new Inferno is on.
 *
 * @param infernoOn - The switch; the config's own unless a test passes one.
 */
export const availableAchievements = (infernoOn: boolean = infernoConfig.enabled): readonly AchievementDef[] =>
  infernoOn ? WITH_INFERNO : AVAILABLE_ACHIEVEMENTS;

const BY_ID = new Map(LIST.map((entry) => [entry.id, entry]));

/** The entry with Flash's number `id`; undefined for anything else. */
export const achievementById = (id: number): AchievementDef | undefined => BY_ID.get(id);
