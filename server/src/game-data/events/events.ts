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
 * `events.test.ts`.
 *
 * To switch an event on locally before its date, set
 * `EVENTS_FORCE_ON=<id>[,<id>…]` in `server/.env` (`config/GameConfig.ts`,
 * `eventsForcedOn`); it is ignored on production.
 */

/** One day of a login calendar: what claiming it pays. */
export interface CalendarDay {
  readonly rewards: readonly EventReward[];
}

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
    readonly tiers: readonly LadderTier[];
  };
}

/** How many days before it starts an event shows under "Coming up". */
export const UPCOMING_DAYS = 30;

/**
 * ═══════════════════════════════════════════════════════════════════════
 * HALLOWEEN 2026 LOGIN CALENDAR: the 14 daily rewards, day 1 first.
 * PLACEHOLDER AMOUNTS (2026-10-20), for the owner to tune. Resources land
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
];

/** The event with this id, or undefined. */
export const eventById = (id: string, events: readonly EventDefinition[] = EVENTS): EventDefinition | undefined =>
  events.find((event) => event.id === id);
