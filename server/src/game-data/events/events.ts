import type { EventReward } from "./eventRewards.js";

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
 * the loot a player takes in attacks during the event.
 *
 * Events that repeat (the monthly Krallen Hunt) come from a small generator,
 * one entry per run with its own id, so each month is an ordinary event with
 * its own progress rows.
 *
 * To switch an event on locally before its date, set
 * `EVENTS_FORCE_ON=<id>[,<id>…]` in `server/.env` (`config/GameConfig.ts`,
 * `eventsForcedOn`); it is ignored on production.
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
export type LadderSource = "own" | "attackLoot";

/** One tier of a collection ladder: claimable once the counter reaches `need`. */
export interface LadderTier {
  readonly need: number;
  readonly rewards: readonly EventReward[];
}

export interface EventDefinition {
  /** Stable id, also the key of the players' progress rows. Never reuse one. */
  readonly id: string;
  readonly title: string;
  /** One or two short sentences for the Events page. */
  readonly text: string;
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
     * attack takes, before the storage cap.
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
}

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
 * THE MONTHLY KRALLEN HUNT: set by the owner (2026-10-20).
 * Every month from the 15th 00:00 UTC to the end of the month, the first
 * 15-30 November 2026 (never during Halloween). For Town Hall 6 and up,
 * guided start done. Every resource taken in attacks during the event adds
 * up (raids on players, wild monster camps, Map Room 1 tribes; before the
 * storage cap, so loot that did not fit still counts; outpost income does
 * not). Reaching the goal pays Krallen: level 1 the first time, one level
 * more each later month, at most 5 (`services/events/grant.ts`).
 * ═══════════════════════════════════════════════════════════════════════
 */
export const KRALLEN_HUNT_GOAL = 100_000_000;

/** The first month the hunt runs, and how many months are listed from it. */
export const KRALLEN_HUNT_FIRST = { year: 2026, month: 11 } as const;
export const KRALLEN_HUNT_MONTHS = 120;

/** Days after a month's hunt ends that a goal reached in time can still be claimed. */
export const KRALLEN_HUNT_CLAIM_DAYS = 7;

const twoDigits = (value: number): string => String(value).padStart(2, "0");

/** The Krallen Hunt of `month` (1-12) in `year`, id `krallen-<year>-<mm>`. */
export const krallenHunt = (year: number, month: number): EventDefinition => {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    id: `krallen-${year}-${twoDigits(month)}`,
    title: "Krallen Hunt",
    text: "Take 100 million loot in attacks before the month is out to win Krallen, or raise yours a level. Raids on players, wild monster camps and tribes all count, even loot that does not fit in your storage.",
    kind: "krallen",
    startsAt: `${year}-${twoDigits(month)}-15T00:00:00Z`,
    endsAt: `${next.year}-${twoDigits(next.month)}-01T00:00:00Z`,
    ladder: {
      label: "Loot taken",
      source: "attackLoot",
      tiers: [{ need: KRALLEN_HUNT_GOAL, rewards: [{ kind: "krallen" }] }],
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

/** Every event, past, present and future. Append new ones at the end. */
export const EVENTS: readonly EventDefinition[] = [
  {
    id: "halloween-2026",
    title: "Halloween",
    text: "Spooky season is here! Log in each day to claim a treat, and pick the pumpkins growing in your yard for extra prizes.",
    kind: "halloween",
    startsAt: "2026-10-28T00:00:00Z",
    endsAt: "2026-11-11T00:00:00Z",
    banner: "/events/halloween-2026-banner.png",
    calendar: HALLOWEEN_2026_CALENDAR,
    ladder: { label: "Pumpkins found", tiers: HALLOWEEN_2026_LADDER },
  },
  ...KRALLEN_HUNTS,
];

/** The event with this id, or undefined. */
export const eventById = (id: string, events: readonly EventDefinition[] = EVENTS): EventDefinition | undefined =>
  events.find((event) => event.id === id);
