import type { EventReward } from "./events/eventRewards.js";

/**
 * Daily login card, daily quests and weekly quests (beta 6, owner's decisions
 * 2 Nov 2026, `agent-handoffs/quests-design-grill.md`). EVERY number and every
 * quest kind lives in this one file; the engine (`services/quests/*`) reads
 * nothing else, so changing the list or a number is an edit here only.
 *
 * Decided by the owner: the login card's Shiny, 5 daily quests and their
 * all-done Shiny, 3 weekly quests (social, resources, fighting) with their
 * needs and rewards (decision 13, confirmed 2 Nov), one free swap a day,
 * resets at 00:00 UTC and Monday 00:00 UTC.
 *
 * PROVISIONAL (still to settle): the daily `need` tables, the catapult
 * targets and hit reach, and what counts as a won attack / a held defence
 * ({@link FIGHT_RULES}). Marked `provisional: true` where it is per kind.
 */

/** Shiny paid on each day of the 7-day login card. */
export const LOGIN_CARD_SHINY = [2, 2, 3, 3, 5, 5, 10] as const;

/** How many daily quests a day brings. */
export const DAILY_QUEST_COUNT = 5;
/** Shiny for claiming all daily quests, once a day. */
export const DAILY_ALL_DONE_SHINY = 5;
/** Free swaps a day (replace one unfinished, unclaimed daily quest). */
export const DAILY_FREE_SWAPS = 1;
/**
 * The daily kind every day brings (owner, decision 11): one of the 5 is
 * always "destroy a tribe's yard N times" when the player can pick it; a swap
 * on it changes the tribe, never the kind.
 */
export const DAILY_ALWAYS = "destroyTribe";

/** Shiny paid with each weekly quest, on top of its own reward. */
export const WEEKLY_QUEST_SHINY = 5;
/** Shiny for claiming all three weekly quests, once a week. */
export const WEEKLY_ALL_DONE_SHINY = 10;

/**
 * What the server counts towards quests. Each is added where the server
 * itself sees the action happen (never from the client's word). A quest with
 * a variant (a monster, a tribe, a building type) counts the stat's
 * `<stat>:<variant>` key instead, which the hooks add next to the plain one.
 * - `lootR1`..`lootR4`: resources looted in attacks on players, bots and Wild
 *   Monster tribes (owner, decision 13), per kind: the battle's credit before
 *   the attacker's storage cap, so a full storage still counts.
 * - `hatch` (`hatch:<monster id>`): monsters that finished hatching.
 * - `attackLaunch`: an attack launched on a player's yard (no win needed).
 * - `tribeDestroy` (`tribeDestroy:<tribe>`): a Wild Monster tribe's yard destroyed.
 * - `catapultHit` (`catapultHit:<building type>`): a catapult bomb that lands on that building type in an attack.
 * - `upgradeResource`, `upgradeDefence`: an upgrade started on a harvester / a tower (cancel takes it back).
 * - `mushroom`, `juice` (monsters juiced), `feedChampion`.
 * - `friendHelp`, `friendGift`: a friend's yard helped, a gift sent.
 * - `attackWin`, `defenceWin`: attacks won, attacks and wild monster raids held off (weekly fighting).
 * - `newFriend`: a new friend that counts (level 5+, played in the last 7 days, never a friend before).
 */
export const QUEST_STATS = [
  "lootR1",
  "lootR2",
  "lootR3",
  "lootR4",
  "hatch",
  "attackLaunch",
  "tribeDestroy",
  "catapultHit",
  "upgradeResource",
  "upgradeDefence",
  "mushroom",
  "juice",
  "feedChampion",
  "friendHelp",
  "friendGift",
  "attackWin",
  "defenceWin",
  "newFriend",
] as const;
export type QuestStat = (typeof QUEST_STATS)[number];

/**
 * What a quest's variant is picked from when the quest is picked:
 * - `monster`: a monster the player has unlocked (Pokey and every Locker unlock).
 * - `tribe`: a Wild Monster tribe ({@link QUEST_TRIBES}).
 * - `building`: a building type from {@link CATAPULT_TARGETS}.
 */
export type QuestVariant = "monster" | "tribe" | "building";

/** The tribes a "destroy a tribe's yard" quest names (the onboarding tribe counter names). */
export const QUEST_TRIBES = ["legionnaire", "kozu", "abunakki", "dreadnaut"] as const;

/** Building types a catapult quest names (PROVISIONAL): towers, harvesters, silo, Town Hall. */
export const CATAPULT_TARGETS: readonly number[] = [1, 2, 3, 4, 6, 14, 20, 21, 23, 25];

/** Harvesters: what an "upgrade a resource building" quest counts. */
export const RESOURCE_BUILDINGS: readonly number[] = [1, 2, 3, 4];

/**
 * How near (yard units, from the building's spot) a catapult bomb must land
 * to count as a hit on it. PROVISIONAL: an approximation of the battle's own
 * blast reach, which the battle does not report per building.
 */
export const CATAPULT_HIT_RADIUS = 60;

/** What a player must have for a quest kind to be picked. */
export interface QuestUnlock {
  /** A building of this type in the main yard. */
  readonly building?: number;
  /** Town Hall at this level or above. */
  readonly townHall?: number;
  /** A friend they can help or gift (friends long enough, both level 5+). */
  readonly friend?: boolean;
  /** No such friend (the social quest's stand-in). */
  readonly noFriend?: boolean;
  /** A champion. */
  readonly champion?: boolean;
}

/** A random need between `min` and `max` (inclusive), picked with the quest. */
export interface RandomNeed {
  readonly random: readonly [min: number, max: number];
}

/** A need that is a share of the player's storage cap when the quest is picked (rounded down, at least 1). */
export interface CapShareNeed {
  readonly capShare: number;
}

/** A number per Town Hall level 1-10 (index 0 = level 1); levels past the table use its last entry. */
export type ByTownHall = readonly [number, number, number, number, number, number, number, number, number, number];

/**
 * Resources a quest pays: which ones, each a share of the player's storage
 * cap when the quest is picked (rounded down; the claim is capped at storage
 * like every reward).
 */
export interface QuestResourcePay {
  readonly resources: readonly ("r1" | "r2" | "r3" | "r4")[];
  /** Share of the storage cap paid in each resource named. */
  readonly share: number;
}

export interface QuestKind {
  /** Stable id: saved in players' records, so never rename one in use. */
  readonly id: string;
  /** The stats that move it (any of them). */
  readonly stats: readonly QuestStat[];
  /** How many, by Town Hall level, or a random number picked with the quest. */
  readonly need: ByTownHall | RandomNeed | CapShareNeed;
  /** Picked with the quest and stored with it; the quest counts `<stat>:<variant>`. */
  readonly variant?: QuestVariant;
  readonly unlock?: QuestUnlock;
  /** Resources it pays (daily quests; weekly ones may add them too). */
  readonly pay?: QuestResourcePay;
  /** Anything else it pays (speed-ups), on top. */
  readonly extra?: readonly EventReward[];
  /** Not signed off by the owner yet. */
  readonly provisional?: boolean;
}

// ---------------------------------------------------------------------------
// Daily quests (PROVISIONAL list and numbers).
// ---------------------------------------------------------------------------

/**
 * Owner, decision 12: each daily quest pays 4% of the player's storage cap in
 * ONE resource (which one is per quest below). The one setting to tune.
 */
export const DAILY_PAY_SHARE = 0.04;

/**
 * The owner's 11 daily kinds (decision 10, 2 Nov 2026); 5 are picked a day
 * from the ones the player has unlocked. The numbers are PROVISIONAL.
 */
export const DAILY_QUESTS: readonly QuestKind[] = [
  // 1. Hatch N of one unlocked monster, N random 1-5.
  { id: "hatchMonster", stats: ["hatch"], variant: "monster", need: { random: [1, 5] }, unlock: { building: 13 }, pay: { resources: ["r4"], share: DAILY_PAY_SHARE }, provisional: true },
  // 2. Launch an attack on a player.
  { id: "attackPlayer", stats: ["attackLaunch"], need: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], unlock: { building: 11 }, pay: { resources: ["r3"], share: DAILY_PAY_SHARE }, provisional: true },
  // 3. Destroy one tribe's yard N times.
  { id: "destroyTribe", stats: ["tribeDestroy"], variant: "tribe", need: [1, 1, 1, 2, 2, 2, 3, 3, 3, 3], unlock: { building: 11 }, pay: { resources: ["r1"], share: DAILY_PAY_SHARE }, provisional: true },
  // 4. Hit a named building type with the catapult N times in attacks (owner, decision 11: hit, not destroy).
  //    The kind is final; its numbers and CATAPULT_TARGETS / CATAPULT_HIT_RADIUS are provisional.
  { id: "catapultHit", stats: ["catapultHit"], variant: "building", need: [2, 2, 3, 3, 3, 4, 4, 5, 5, 5], unlock: { building: 51 }, pay: { resources: ["r2"], share: DAILY_PAY_SHARE } },
  // 5. Upgrade a resource building.
  { id: "upgradeResource", stats: ["upgradeResource"], need: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], unlock: { building: 1 }, pay: { resources: ["r1"], share: DAILY_PAY_SHARE }, provisional: true },
  // 6. Upgrade a defensive building.
  { id: "upgradeDefence", stats: ["upgradeDefence"], need: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], unlock: { building: 20 }, pay: { resources: ["r2"], share: DAILY_PAY_SHARE }, provisional: true },
  // 7. Pick mushrooms.
  { id: "mushroom", stats: ["mushroom"], need: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3], pay: { resources: ["r3"], share: DAILY_PAY_SHARE }, provisional: true },
  // 8. Help a friend's yard.
  { id: "friendHelp", stats: ["friendHelp"], need: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3], unlock: { friend: true }, pay: { resources: ["r1"], share: DAILY_PAY_SHARE }, provisional: true },
  // 9. Send a gift to a friend.
  { id: "friendGift", stats: ["friendGift"], need: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], unlock: { friend: true }, pay: { resources: ["r2"], share: DAILY_PAY_SHARE }, provisional: true },
  // 10. Feed your champion.
  { id: "feedChampion", stats: ["feedChampion"], need: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], unlock: { champion: true }, pay: { resources: ["r3"], share: DAILY_PAY_SHARE }, provisional: true },
  // 11. Juice monsters.
  { id: "juice", stats: ["juice"], need: [2, 3, 3, 5, 5, 5, 8, 8, 10, 10], unlock: { building: 9 }, pay: { resources: ["r4"], share: DAILY_PAY_SHARE }, provisional: true },
];

// ---------------------------------------------------------------------------
// Weekly quests: one from each group (numbers PROVISIONAL).
// ---------------------------------------------------------------------------

/**
 * Owner, decision 13: the weekly Resources quest is "loot X of one named
 * resource in attacks", X = this share of the storage cap (one full storage;
 * not yet checked against loot per attack, tune after beta).
 */
export const WEEKLY_LOOT_CAP_SHARE = 1;
/** Decision 13: the weekly Resources quest pays this share of the storage cap in THAT resource. */
export const WEEKLY_LOOT_PAY_SHARE = 0.15;
/** Decision 13 (owner confirmed 2 Nov): attacks won or defences held for the weekly Fighting quest, every Town Hall level. */
export const WEEKLY_FIGHTS = 10;
const WEEKLY_FIGHTS_NEED: ByTownHall = [
  WEEKLY_FIGHTS, WEEKLY_FIGHTS, WEEKLY_FIGHTS, WEEKLY_FIGHTS, WEEKLY_FIGHTS,
  WEEKLY_FIGHTS, WEEKLY_FIGHTS, WEEKLY_FIGHTS, WEEKLY_FIGHTS, WEEKLY_FIGHTS,
];
/** Decision 13: Social and Fighting each pay a 1-hour speed-up (SP2). */
const WEEKLY_SPEEDUP: readonly EventReward[] = [{ kind: "speedup", item: "SP2", count: 1 }];

/** A weekly loot quest for one resource (Map Room needed to attack). */
const weeklyLoot = (id: string, stat: QuestStat, resource: "r1" | "r2" | "r3" | "r4"): QuestKind => ({
  id,
  stats: [stat],
  need: { capShare: WEEKLY_LOOT_CAP_SHARE },
  unlock: { building: 11 },
  pay: { resources: [resource], share: WEEKLY_LOOT_PAY_SHARE },
});

/** The weekly groups, in the order they are shown. One kind is picked from each. */
export const WEEKLY_GROUPS = ["social", "resources", "fighting"] as const;
export type WeeklyGroup = (typeof WEEKLY_GROUPS)[number];

export const WEEKLY_QUESTS: Readonly<Record<WeeklyGroup, readonly QuestKind[]>> = {
  social: [
    // Owner: help or gift friends 5 times, any mix.
    { id: "weeklyHelpGift", stats: ["friendHelp", "friendGift"], need: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], unlock: { friend: true }, extra: WEEKLY_SPEEDUP },
    // Owner: players with no qualifying friend make 5 new friends instead.
    { id: "weeklyNewFriends", stats: ["newFriend"], need: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], unlock: { noFriend: true }, extra: WEEKLY_SPEEDUP },
  ],
  resources: [
    // Owner, decision 13: loot X of one named resource in attacks (tribes count too).
    weeklyLoot("weeklyLootTwigs", "lootR1", "r1"),
    weeklyLoot("weeklyLootPebbles", "lootR2", "r2"),
    weeklyLoot("weeklyLootPutty", "lootR3", "r3"),
    weeklyLoot("weeklyLootGoo", "lootR4", "r4"),
  ],
  fighting: [
    // Owner: won attacks OR held defences both count.
    { id: "weeklyFights", stats: ["attackWin", "defenceWin"], need: WEEKLY_FIGHTS_NEED, extra: WEEKLY_SPEEDUP },
  ],
};

/**
 * What counts as a won attack and a held defence, by the defender's yard
 * damage (0-100) when the attack lands. PROVISIONAL.
 */
export const FIGHT_RULES = {
  /** An attack is won when it leaves the yard at least this damaged, and did some damage. */
  winDamage: 50,
  /** A defence is held when the attack leaves the yard less damaged than this. */
  holdDamage: 50,
} as const;

/** The value for Town Hall level `th` (1-based); 0 or less reads level 1, past the table reads its last entry. */
export const byTownHall = (table: ByTownHall, th: number): number =>
  table[Math.min(table.length, Math.max(1, Math.floor(th) || 1)) - 1]!;

/** Every quest kind, daily and weekly, by id. */
export const QUEST_KINDS: ReadonlyMap<string, QuestKind> = new Map(
  [...DAILY_QUESTS, ...WEEKLY_GROUPS.flatMap((group) => WEEKLY_QUESTS[group])].map((kind) => [kind.id, kind])
);
