import { BLACK_SPURTZ_TYPE, SPURTZ_TYPE } from "../../config/SpurtzConfig.js";
import type { YardEventKey } from "../tribes/events/index.js";

/**
 * The Brukkarg tribe's attack events (beta 10, bruk-port; owner, 27 Nov 2026):
 * the dashboard starts one at a time, and each run puts its card on the
 * Events page, from which the player attacks the event's yards in order
 * (`game-data/tribes/events/`, `services/events/yards/`).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE NUMBERS: the one place to change them.
 *
 * Creature Carnage (Flash `Battletoads.as`): Town Hall 2 to 4 only, as Flash.
 * Prize (owner): Glimmers for each yard beaten, {@link CARNAGE_GLIMMERS}, and
 * a NEW Creature Carnage trophy decoration for beating all ten. The Glimmer
 * amounts are PLACEHOLDERS waiting for the owner's approval: 220 for all
 * ten (a wave event's 32 waves pay 310, a 14-day big event 400). The trophy
 * is paid once its art is wired ({@link CARNAGE_TROPHY_TYPE}).
 *
 * Brukkarg War (Flash `BrukkargWarEvent.as`): yard k opens once 5k waves are
 * beaten ({@link BRUKWAR_WAVES_PER_YARD}). The Spurtz Cannon prizes as Flash's
 * quotas and rewards: 3 yards beaten lets the player build 1 Spurtz Cannon, 4
 * yards 2, and 5 turns them into Black Diamond Spurtz Cannons (2 allowed).
 * The cannon limits live in `config/SpurtzConfig.ts`.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Glimmers per Creature Carnage yard beaten, yard 1 first (PLACEHOLDER, owner to approve). */
export const CARNAGE_GLIMMERS: readonly number[] = [10, 10, 15, 15, 20, 20, 25, 25, 30, 50];

/**
 * The Creature Carnage trophy's decoration type, paid for beating all ten
 * yards. null until its art (both looks) is picked by the owner and wired;
 * Creature Carnage should not run live before then (no trophy is paid).
 * 240 is kept for it (the revamp decorations end at 232).
 */
export const CARNAGE_TROPHY_TYPE: number | null = null;
export const CARNAGE_TROPHY_RESERVED_TYPE = 240;

/** Brukkarg War: waves to beat before each yard opens (Flash `readyToAttackNextYard`). */
export const BRUKWAR_WAVES_PER_YARD = 5;

/** A prize for beating a number of an event's yards. */
export interface YardPrize {
  /** Paid once this many of the event's yards are beaten. */
  readonly yards: number;
  readonly glimmers?: number;
  /** A decoration put in the yard's storage. */
  readonly decoration?: number;
  /** A Spurtz Cannon reward (`config/SpurtzConfig.ts`). */
  readonly spurtz?: 1 | 2 | 3;
}

export interface YardEventDefinition {
  readonly key: YardEventKey;
  readonly title: string;
  readonly text: string;
  /** How long a run lasts, when the dashboard starts one. */
  readonly days: number;
  /** The Town Hall levels that may attack (inclusive); absent: any. */
  readonly townHall?: { readonly min: number; readonly max: number };
  /** Waves to beat before each yard opens; absent: no waves. */
  readonly wavesPerYard?: number;
  /** The prizes, by yards beaten. */
  readonly prizes: readonly YardPrize[];
  readonly banner: { readonly modern: string; readonly classic: string };
}

const carnagePrizes = (): YardPrize[] =>
  CARNAGE_GLIMMERS.map((glimmers, index) => ({
    yards: index + 1,
    glimmers,
    ...(index === CARNAGE_GLIMMERS.length - 1 && CARNAGE_TROPHY_TYPE !== null ? { decoration: CARNAGE_TROPHY_TYPE } : {}),
  }));

export const YARD_EVENTS: readonly YardEventDefinition[] = [
  {
    key: "carnage",
    title: "Creature Carnage",
    text: "The Brukkarg tribe has built 10 yards. Wreck each Town Hall to win Glimmers and the Carnage trophy.",
    days: 7,
    townHall: { min: 2, max: 4 },
    prizes: carnagePrizes(),
    banner: { modern: "/events/carnage-banner.jpg", classic: "/events/carnage-banner-classic.jpg" },
  },
  {
    key: "brukwar",
    title: "Brukkarg War",
    text: "Hold off the Brukkarg waves, then hit back at their yards. Win Spurtz Cannons.",
    days: 5,
    wavesPerYard: BRUKWAR_WAVES_PER_YARD,
    prizes: [
      { yards: 3, spurtz: 1 },
      { yards: 4, spurtz: 2 },
      { yards: 5, spurtz: 3 },
    ],
    banner: { modern: "/events/brukwar-banner.jpg", classic: "/events/brukwar-banner-classic.jpg" },
  },
];

export const yardEventByKey = (key: string): YardEventDefinition | null =>
  YARD_EVENTS.find((event) => event.key === key) ?? null;

/** The building types the Spurtz prizes concern, for the tests. */
export const SPURTZ_PRIZE_TYPES = [SPURTZ_TYPE, BLACK_SPURTZ_TYPE] as const;
