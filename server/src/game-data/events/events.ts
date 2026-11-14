import { coinRewards, BIG_EVENT_COINS, type EventCoins, type EventReward } from "./eventRewards.js";

/**
 * The game's events: seasonal happenings with a start and an end, shown on
 * the web client's Events page (`GET /bm/events`,
 * `controllers/events/eventsState.ts`).
 *
 * TO ADD AN EVENT: append one entry to {@link EVENTS} below. Times are UTC
 * ISO strings; the event is on from `startsAt` up to (not including)
 * `endsAt`. It shows under "Coming up" for {@link UPCOMING_DAYS} days before
 * it starts. Give it a `calendar` for a daily login calendar (one reward per
 * UTC day the player claims), and a `ladder` for a collection ladder (a
 * counter the event's own code raises, `services/events/progressStore.ts`
 * `addToCounter`, with a reward at each tier). Every reward is checked by
 * `events.test.ts`. A ladder whose `source` is `"attackLoot"` is counted by
 * the server's attack code instead (`services/events/lootEvents.ts`): all
 * the loot a player takes in attacks during the event. One whose `source` is
 * `"takeovers"` counts Map Room 2 takeovers (`services/events/takeoverEvents.ts`,
 * Monster Madness, `monsterMadness.ts`).
 *
 * EVENT COINS: a big 1-2 week event (not a weekend event) pays event coins by
 * carrying `coins: BIG_EVENT_COINS` (`eventRewards.ts`, where the numbers
 * live): {@link withEventCoins} adds them to each calendar day and ladder
 * tier, so the page, the claims and the tests all see them as rewards.
 *
 * Events that repeat (the monthly Krallen Hunt) come from a small generator,
 * one entry per run with its own id, so each month is an ordinary event with
 * its own progress rows.
 *
 * To switch an event on locally before its date, set
 * `EVENTS_FORCE_ON=<id>[,<id>…]` in `server/.env` (`config/GameConfig.ts`,
 * `eventsForcedOn`); to hide one that is really on (say Halloween, to try
 * Thanksgiving alone), `EVENTS_FORCE_OFF=<id>[,<id>…]` (`eventsForcedOff`).
 * Both are ignored on production.
 */

/** One day of a login calendar: what claiming it pays. */
export interface CalendarDay {
  readonly rewards: readonly EventReward[];
}

/** Who may take part: a player short of either sees the event but counts nothing. */
export interface EventRequirements {
  /** The lowest main-yard Town Hall level. */
  readonly townHall?: number;
  /** Whether the guided start must be finished (`tutorialstage` 205). */
  readonly tutorial?: boolean;
}

/** What raises a ladder's counter: the event's own code, or every attack's loot. */
export type LadderSource = "own" | "attackLoot" | "takeovers";

/** One tier of a collection ladder: claimable once the counter reaches `need`. */
export interface LadderTier {
  readonly need: number;
  /**
   * The need by the player's Krallen level, 0 (none yet) first, in place of
   * `need`; past the end, the last entry ({@link tierNeed}). The Krallen Hunt's.
   */
  readonly needByKrallenLevel?: readonly number[];
  readonly rewards: readonly EventReward[];
}

/**
 * The player's Krallen level when the hunt began: her level now, less the one
 * a tier claimed this hunt raised her by (`krallen` pays one level). The
 * hunt's goals follow it, so the 3x mark stays 3x the goal the player started
 * with after the first mark raised her. A tier claimed at the top (level 5)
 * raised nothing; its goals are the last entry either way.
 */
export const huntStartLevel = (
  tiers: readonly LadderTier[],
  claimedTiers: readonly number[],
  krallenLevel: number
): number => {
  const raised = claimedTiers.some((index) => tiers[index]?.rewards.some((reward) => reward.kind === "krallen"));
  return raised && krallenLevel > 0 ? krallenLevel - 1 : krallenLevel;
};

/** What a tier needs of a player whose Krallen is at `krallenLevel` (0 for none). */
export const tierNeed = (tier: LadderTier, krallenLevel: number): number => {
  const needs = tier.needByKrallenLevel;
  if (!needs?.length) return tier.need;
  const index = Math.min(Math.max(Math.trunc(krallenLevel) || 0, 0), needs.length - 1);
  return needs[index]!;
};

export interface EventDefinition {
  /** Stable id, also the key of the players' progress rows. Never reuse one. */
  readonly id: string;
  readonly title: string;
  /**
   * One or two short sentences for the Events page. `{goal}` stands for the
   * player's own need for the first ladder tier, in words ("60 million").
   */
  readonly text: string;
  /** The same, worded for before the start ("is coming"); `text` when absent. */
  readonly upcomingText?: string;
  /** What sort of event; the web client may dress the page by it. */
  readonly kind: string;
  /** UTC, ISO 8601. */
  readonly startsAt: string;
  /** UTC, ISO 8601; the first moment the event is over. */
  readonly endsAt: string;
  /** A web client path to the banner picture, e.g. `/events/<id>-banner.png`. */
  readonly banner?: string;
  /** The daily login calendar, day 1 first. */
  readonly calendar?: readonly CalendarDay[];
  /** The collection ladder, lowest tier first. What the counter counts is the event's own business. */
  readonly ladder?: {
    /** What the counter counts, for the page: "Pumpkins found". */
    readonly label: string;
    /**
     * Who raises the counter. `own` (the default): the event's own code.
     * `attackLoot`: `services/events/lootEvents.ts`, with every resource an
     * attack takes, before the storage cap. `takeovers`:
     * `services/events/takeoverEvents.ts`, with each Map Room 2 outpost taken
     * over, once per outpost.
     */
    readonly source?: LadderSource;
    readonly tiers: readonly LadderTier[];
  };
  /** Who may take part; everyone when absent. */
  readonly requires?: EventRequirements;
  /**
   * Days after `endsAt` that a ladder tier reached in time can still be
   * claimed (the counter stops at `endsAt`). Meanwhile the event shows as
   * "ended" to players with something left to claim. 0 when absent.
   */
  readonly claimDays?: number;
  /**
   * Event coins this big event pays on top of its rewards, one amount for
   * every calendar day and one per ladder tier (`BIG_EVENT_COINS`); none when
   * absent. Added to the rewards by {@link withEventCoins}.
   */
  readonly coins?: EventCoins;
}

/**
 * `event` with its `coins` added to its rewards: `perCalendarDay` to every
 * calendar day, `milestones[i]` to ladder tier `i`. The same event when it
 * has no `coins`. {@link EVENTS} passes every event through this.
 */
export const withEventCoins = (event: EventDefinition): EventDefinition => {
  const coins = event.coins;
  if (!coins) return event;
  return {
    ...event,
    ...(event.calendar && {
      calendar: event.calendar.map((day) => ({ ...day, rewards: [...day.rewards, ...coinRewards(coins.perCalendarDay)] })),
    }),
    ...(event.ladder && {
      ladder: {
        ...event.ladder,
        tiers: event.ladder.tiers.map((tier, index) => ({
          ...tier,
          rewards: [...tier.rewards, ...coinRewards(coins.milestones[index])],
        })),
      },
    }),
  };
};

/** How many days before it starts an event shows under "Coming up". */
export const UPCOMING_DAYS = 30;

/**
 * ═══════════════════════════════════════════════════════════════════════
 * HALLOWEEN 2026 LOGIN CALENDAR: the 14 daily rewards, day 1 first.
 * Amounts approved by the owner (2026-10-20). Resources land
 * clamped to the player's storage cap, like every other reward.
 * r1 Twigs, r2 Pebbles, r3 Putty, r4 Goo. Decoration 111 is the
 * Mini-Pumpkin, 110 the D.A.V.E. Pumpkin.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const HALLOWEEN_2026_CALENDAR: readonly CalendarDay[] = [
  /* Day 1  */ { rewards: [{ kind: "resources", amounts: { r1: 10_000, r2: 10_000 } }] },
  /* Day 2  */ { rewards: [{ kind: "shiny", amount: 10 }] },
  /* Day 3  */ { rewards: [{ kind: "speedup", item: "SP2", count: 1 }] },
  /* Day 4  */ { rewards: [{ kind: "resources", amounts: { r3: 15_000, r4: 15_000 } }] },
  /* Day 5  */ { rewards: [{ kind: "resources", amounts: { r1: 20_000, r2: 20_000, r3: 20_000, r4: 20_000 } }] },
  /* Day 6  */ { rewards: [{ kind: "speedup", item: "SP2", count: 2 }] },
  /* Day 7  */ { rewards: [{ kind: "decoration", type: 111, count: 1 }] },
  /* Day 8  */ { rewards: [{ kind: "resources", amounts: { r1: 30_000, r2: 30_000 } }] },
  /* Day 9  */ { rewards: [{ kind: "shiny", amount: 20 }] },
  /* Day 10 */ { rewards: [{ kind: "speedup", item: "SP3", count: 1 }] },
  /* Day 11 */ { rewards: [{ kind: "resources", amounts: { r3: 30_000, r4: 30_000 } }] },
  /* Day 12 */ { rewards: [{ kind: "shopItem", item: "BST" }] },
  /* Day 13 */ { rewards: [{ kind: "speedup", item: "SP3", count: 2 }] },
  /* Day 14 */ {
    rewards: [
      { kind: "decoration", type: 110, count: 1 },
      { kind: "shiny", amount: 25 },
    ],
  },
];

/**
 * ═══════════════════════════════════════════════════════════════════════
 * HALLOWEEN 2026 PUMPKIN HUNT LADDER: what picking pumpkins earns.
 * Tiers set by the owner (2026-10-20). During the event
 * the yard's mushrooms grow as pumpkins, about one an hour
 * (`services/yard/season.ts`), and every pumpkin a player picks adds one to
 * the counter (`controllers/yard/mushrooms.ts`). Each tier is claimed once,
 * by hand, on the Events page. `need` is the pumpkin count.
 * r1 Twigs, r2 Pebbles, r3 Putty, r4 Goo. Decoration 111 is the
 * Mini-Pumpkin, 110 the D.A.V.E. Pumpkin.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const HALLOWEEN_2026_LADDER: readonly LadderTier[] = [
  /* 10 pumpkins  */ { need: 10, rewards: [{ kind: "shiny", amount: 10 }] },
  /* 25 pumpkins  */ { need: 25, rewards: [{ kind: "resources", amounts: { r1: 25_000, r2: 25_000, r3: 25_000, r4: 25_000 } }] },
  /* 50 pumpkins  */ {
    need: 50,
    rewards: [
      { kind: "decoration", type: 111, count: 2 },
      { kind: "shiny", amount: 20 },
    ],
  },
  /* 100 pumpkins */ {
    need: 100,
    rewards: [
      { kind: "decoration", type: 110, count: 1 },
      { kind: "shiny", amount: 30 },
    ],
  },
];

/**
 * ═══════════════════════════════════════════════════════════════════════
 * THANKSGIVING 2026 LOGIN CALENDAR: the 14 daily rewards, day 1 first.
 * Paced exactly like Halloween's (the same resources, Shiny and speed-ups
 * on the same days; owner may change them), with harvest-time treats in
 * place of the pumpkins: day 7 an Acorn, day 12 a Production Overdrive
 * (harvesters at double rate for 12 hours) and day 14 a Scarecrow.
 * Resources land clamped to the player's storage cap, like every other
 * reward. r1 Twigs, r2 Pebbles, r3 Putty, r4 Goo. Decoration 55 is the
 * Acorn, 69 the Scarecrow. Like Halloween, the event also pays Glimmers
 * (event coins) every day and at every ladder tier: its `coins:
 * THANKSGIVING_2026_COINS` in {@link EVENTS} adds them (`withEventCoins`).
 * ═══════════════════════════════════════════════════════════════════════
 */
export const THANKSGIVING_2026_CALENDAR: readonly CalendarDay[] = [
  /* Day 1  */ { rewards: [{ kind: "resources", amounts: { r1: 10_000, r2: 10_000 } }] },
  /* Day 2  */ { rewards: [{ kind: "shiny", amount: 10 }] },
  /* Day 3  */ { rewards: [{ kind: "speedup", item: "SP2", count: 1 }] },
  /* Day 4  */ { rewards: [{ kind: "resources", amounts: { r3: 15_000, r4: 15_000 } }] },
  /* Day 5  */ { rewards: [{ kind: "resources", amounts: { r1: 20_000, r2: 20_000, r3: 20_000, r4: 20_000 } }] },
  /* Day 6  */ { rewards: [{ kind: "speedup", item: "SP2", count: 2 }] },
  /* Day 7  */ { rewards: [{ kind: "decoration", type: 55, count: 1 }] },
  /* Day 8  */ { rewards: [{ kind: "resources", amounts: { r1: 30_000, r2: 30_000 } }] },
  /* Day 9  */ { rewards: [{ kind: "shiny", amount: 20 }] },
  /* Day 10 */ { rewards: [{ kind: "speedup", item: "SP3", count: 1 }] },
  /* Day 11 */ { rewards: [{ kind: "resources", amounts: { r3: 30_000, r4: 30_000 } }] },
  /* Day 12 */ { rewards: [{ kind: "shopItem", item: "POD" }] },
  /* Day 13 */ { rewards: [{ kind: "speedup", item: "SP3", count: 2 }] },
  /* Day 14 */ {
    rewards: [
      { kind: "decoration", type: 69, count: 1 },
      { kind: "shiny", amount: 25 },
    ],
  },
];

/**
 * ═══════════════════════════════════════════════════════════════════════
 * THANKSGIVING 2026 TURKEY HUNT LADDER: what picking turkeys earns.
 * Set by the owner (13 Nov 2026): 25 turkeys for 10 Shiny, 50 for 100
 * Glimmers, 150 for the Scarecrow and 20 Shiny, 200 for the Autumn Maple
 * Tree and 30 Shiny. During the event the yard's mushrooms grow as turkeys
 * that wander near where they grew, about one an hour, at most 10 waiting
 * (`services/yard/season.ts`, `mushrooms.ts`), and every turkey a player
 * picks adds one to the counter (`controllers/yard/mushrooms.ts`): up to
 * about 24 a day for a player who looks in at least every 10 hours. One pick
 * in four is a golden turkey, worth 3 or 8 Shiny, exactly as a golden
 * mushroom (`GOLDEN_SMALL`, `GOLDEN_BIG` in `services/yard/mushrooms.ts`).
 * Each tier is claimed once, by hand, on the Events page. `need` is the
 * turkey count. The 50 tier's 100 Glimmers are paid through the event's
 * coins ({@link THANKSGIVING_2026_COINS}), on top of the usual ladder
 * Glimmers, so the tier shows one Glimmer figure. Decoration 69 is the
 * Scarecrow, 206 the Autumn Maple Tree (`revampDecorations.ts`).
 * ═══════════════════════════════════════════════════════════════════════
 */
export const THANKSGIVING_2026_LADDER: readonly LadderTier[] = [
  /* 25 turkeys  */ { need: 25, rewards: [{ kind: "shiny", amount: 10 }] },
  /* 50 turkeys  */ { need: 50, rewards: [] }, // 100 Glimmers, from THANKSGIVING_2026_COINS
  /* 150 turkeys */ {
    need: 150,
    rewards: [
      { kind: "decoration", type: 69, count: 1 },
      { kind: "shiny", amount: 20 },
    ],
  },
  /* 200 turkeys */ {
    need: 200,
    rewards: [
      { kind: "decoration", type: 206, count: 1 },
      { kind: "shiny", amount: 30 },
    ],
  },
];

/** Glimmers the 50-turkey tier pays as its own prize (owner, 13 Nov 2026). */
export const THANKSGIVING_2026_TIER_GLIMMERS = 100;

/**
 * Thanksgiving's event coins: the big-event amounts ({@link BIG_EVENT_COINS},
 * 15 a day and 20/35/55/80 over the ladder), with the 50-turkey tier's own
 * {@link THANKSGIVING_2026_TIER_GLIMMERS} added to its milestone: 20, 135,
 * 55, 80, 500 in all with the calendar.
 */
export const THANKSGIVING_2026_COINS: EventCoins = {
  ...BIG_EVENT_COINS,
  milestones: BIG_EVENT_COINS.milestones.map((coins, tier) => (tier === 1 ? coins + THANKSGIVING_2026_TIER_GLIMMERS : coins)),
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 * THE MONTHLY KRALLEN HUNT: set by the owner (2026-10-20).
 * Every month from the 15th 00:00 UTC to the end of the month, the first
 * 15-30 November 2026 (never during Halloween). For Town Hall 6 and up,
 * guided start done. Every resource taken in attacks during the event adds
 * up (raids on players, wild monster camps, Map Room 1 tribes; before the
 * storage cap, so loot that did not fit still counts; outpost income does
 * not). Reaching the goal pays Krallen: level 1 the first time, one level
 * more each later month, at most 5 (`services/events/grant.ts`).
 *
 * The goal follows the player's Krallen level (owner, 2026-10-23): 60
 * million to win her, then 90, 150, 250 and 300 million to raise her to
 * levels 2, 3, 4 and 5. A level 5 Krallen keeps the last goal on the page,
 * though the hunt has nothing more to give her.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const KRALLEN_HUNT_GOALS: readonly number[] = [
  60_000_000, 90_000_000, 150_000_000, 250_000_000, 300_000_000,
];

/**
 * ═══════════════════════════════════════════════════════════════════════
 * THE HUNT'S MINIMUM: set by the owner (2026-11-13).
 * A player who owned Krallen when a hunt began and ends it with less than
 * {@link KRALLEN_PENALTY_SHARE} of that hunt's goal loses one Krallen level;
 * a level 1 Krallen is lost and must be won again. 45, 75, 125 and 150
 * million for a Krallen that began the hunt at level 1, 2, 3 and 4 or 5.
 * Without her at the start there is no minimum
 * (`services/events/krallenPenalty.ts`).
 * ═══════════════════════════════════════════════════════════════════════
 */
export const KRALLEN_PENALTY_SHARE = 0.5;

/** The hunt's minimum for a Krallen at `startLevel` when it began; 0 without her. */
export const krallenHuntMinimum = (startLevel: number): number => {
  const level = Math.trunc(startLevel) || 0;
  if (level <= 0) return 0;
  return Math.floor(KRALLEN_HUNT_GOALS[Math.min(level, KRALLEN_HUNT_GOALS.length - 1)]! * KRALLEN_PENALTY_SHARE);
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 * KRALLEN'S LOOT AURA: set by the owner (2026-11-13).
 * A second mark on the hunt at {@link KRALLEN_AURA_GOAL_TIMES} times the
 * player's goal: 180, 300, 450, 675 and 900 million by the Krallen level
 * the player had when the hunt began (a level 5 Krallen keeps the last).
 * Claiming it gives Krallen her loot aura until the END of the NEXT month's
 * hunt (as Flash's second loot mark held for the round after,
 * `KOTHHandler.as:76-84`, `:146-155`); it must be won again to keep it.
 * Only a Krallen of level 3, 4 or 5 carries the aura (strength and radius in
 * `game-rules/combat/champions.ts`, `LOOT_AURA_BONUS`); below level 3, or
 * without the mark, she has none.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const KRALLEN_AURA_GOAL_TIMES = 3;

/** The aura mark's goal by Krallen level at the hunt's start, 0 (none) first. */
export const KRALLEN_AURA_GOALS: readonly number[] = KRALLEN_HUNT_GOALS.map((goal) => goal * KRALLEN_AURA_GOAL_TIMES);

/** How many hunts after the one it was won in the aura runs to the end of. */
export const KRALLEN_AURA_HUNTS_AFTER = 1;

/** The first month the hunt runs, and how many months are listed from it. */
export const KRALLEN_HUNT_FIRST = { year: 2026, month: 11 } as const;
export const KRALLEN_HUNT_MONTHS = 120;

/** Days after a month's hunt ends that a goal reached in time can still be claimed. */
export const KRALLEN_HUNT_CLAIM_DAYS = 7;

const twoDigits = (value: number): string => String(value).padStart(2, "0");

/** The month `count` months after `month` (1-12) of `year`. */
const monthsAfter = (year: number, month: number, count: number): { year: number; month: number } => {
  const months = month - 1 + count;
  return { year: year + Math.floor(months / 12), month: (months % 12) + 1 };
};

/**
 * When the aura won in the hunt of `month` (1-12) of `year` runs out, unix
 * seconds: the end of the hunt {@link KRALLEN_AURA_HUNTS_AFTER} later, the
 * first of the month after that one (November's runs to 1 January).
 */
export const krallenAuraUntil = (year: number, month: number): number => {
  const end = monthsAfter(year, month, KRALLEN_AURA_HUNTS_AFTER + 1);
  return Date.UTC(end.year, end.month - 1, 1) / 1000;
};

/** The Krallen Hunt of `month` (1-12) in `year`, id `krallen-<year>-<mm>`. */
export const krallenHunt = (year: number, month: number): EventDefinition => {
  const next = monthsAfter(year, month, 1);
  return {
    id: `krallen-${year}-${twoDigits(month)}`,
    title: "Krallen Hunt",
    text: "Take {goal} loot in attacks before the month is out to win Krallen, or raise yours a level. Each level needs more loot than the last. Raids on players, wild monster camps and tribes all count, even loot that does not fit in your storage.",
    kind: "krallen",
    startsAt: `${year}-${twoDigits(month)}-15T00:00:00Z`,
    endsAt: `${next.year}-${twoDigits(next.month)}-01T00:00:00Z`,
    ladder: {
      label: "Loot taken",
      source: "attackLoot",
      tiers: [
        { need: KRALLEN_HUNT_GOALS[0]!, needByKrallenLevel: KRALLEN_HUNT_GOALS, rewards: [{ kind: "krallen" }] },
        {
          need: KRALLEN_AURA_GOALS[0]!,
          needByKrallenLevel: KRALLEN_AURA_GOALS,
          rewards: [{ kind: "krallenAura", until: krallenAuraUntil(year, month) }],
        },
      ],
    },
    requires: { townHall: 6, tutorial: true },
    claimDays: KRALLEN_HUNT_CLAIM_DAYS,
  };
};

/** Every month's hunt, {@link KRALLEN_HUNT_FIRST} onwards. */
export const KRALLEN_HUNTS: readonly EventDefinition[] = Array.from({ length: KRALLEN_HUNT_MONTHS }, (_, index) => {
  const months = KRALLEN_HUNT_FIRST.month - 1 + index;
  return krallenHunt(KRALLEN_HUNT_FIRST.year + Math.floor(months / 12), (months % 12) + 1);
});

/**
 * Every event, past, present and future. Append new ones at the end. Each
 * passes through {@link withEventCoins}, so a big event's `coins` are paid.
 */
export const EVENTS: readonly EventDefinition[] = [
  {
    id: "halloween-2026",
    title: "Halloween",
    text: "Spooky season is here! Log in each day to claim a treat, and pick the pumpkins growing in your yard for extra prizes.",
    upcomingText: "Spooky season is coming! Log in each day to claim a treat, and pick the pumpkins growing in your yard for extra prizes.",
    kind: "halloween",
    startsAt: "2026-10-28T00:00:00Z",
    endsAt: "2026-11-11T00:00:00Z",
    banner: "/events/halloween-2026-banner.png",
    calendar: HALLOWEEN_2026_CALENDAR,
    ladder: { label: "Pumpkins found", tiers: HALLOWEEN_2026_LADDER },
    coins: BIG_EVENT_COINS,
  },
  ...KRALLEN_HUNTS,
  {
    id: "thanksgiving-2026",
    title: "Thanksgiving",
    text: "Happy Thanksgiving! Log in each day to claim a treat. Turkeys are roaming your yard: tap one to catch it for prizes, and watch out for the golden turkey!",
    upcomingText: "Thanksgiving is coming! Log in each day to claim a treat, and catch the turkeys roaming your yard for prizes. Watch out for the golden turkey!",
    kind: "thanksgiving",
    // Dates editable: around US Thanksgiving, Thursday 26 November 2026.
    startsAt: "2026-11-19T00:00:00Z",
    endsAt: "2026-12-03T00:00:00Z",
    calendar: THANKSGIVING_2026_CALENDAR,
    ladder: { label: "Turkeys caught", tiers: THANKSGIVING_2026_LADDER },
    coins: THANKSGIVING_2026_COINS,
  },
].map(withEventCoins);

/** The event with this id, or undefined. */
export const eventById = (id: string, events: readonly EventDefinition[] = EVENTS): EventDefinition | undefined =>
  events.find((event) => event.id === id);
