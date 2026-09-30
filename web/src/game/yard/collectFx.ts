import type { HarvestKey } from "./harvest";

/**
 * The resource balls a bank throws from each harvester to the Town Hall
 * (issue #208), as the Flash client drew them: the numbers, with no Pixi, so
 * the unit tests can check every one. The sprites are `CollectFxLayer.ts`.
 *
 * Flash (`BRESOURCE.as:441-468` → `ResourcePackages.as:23-126` →
 * `ResourcePackage.as:27-93`):
 *
 * - Every harvester that banked throws {@link ballCount} balls of its
 *   resource at the Town Hall; Bank all calls every harvester's `Bank` in
 *   the same frame (`BUILDINGINFO.as:458-466`), so they all go at once. With
 *   no Town Hall nothing is thrown.
 * - Ball `i` (0-based) leaves `i / 6` s late.
 * - A flight takes `(distance + random 0..50) / 150` s, at least 0.8 s, and
 *   eases along the straight line from spout to spout with Sine.easeInOut.
 * - On top of that the ball rises `time × 120` px by half-time (Sine.easeOut)
 *   and falls back by the end (Sine.easeIn): an arc.
 * - Its shadow starts on the ground under the harvester's spout, `height`
 *   below and `height / 2` to the right (the Flash light is at the upper
 *   left), slides `time × 100` px right as it fades out by half-time, and
 *   comes back in under the Town Hall's spout as the ball lands.
 * - The ball is hidden until its delay is up.
 *
 * **Faster than Flash, on purpose** (owner, 2026-09-30): on a spread-out yard
 * Flash's balls took five seconds and more to arrive. Here they fly twice as
 * fast (300 px/s), no flight is shorter than 0.5 s or longer than 1.5 s, and
 * the stagger is halved (`i / 12` s), so the last ball lands within about
 * 2.5 s of the press. The arc and the shadow's slide scale with the flight
 * time at twice Flash's rates, so an arc keeps Flash's shape for its
 * distance rather than flattening.
 *
 * Each ball carries its share of the amount, so the top bar can count up as
 * they land; the shares add up to the amount banked exactly.
 */

/** Where a building's balls leave from or land at, from its anchor (`_spoutPoint`), and how high that is (`_spoutHeight`). */
export interface Spout {
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

/** `BUILDING1.as:23-24` … `BUILDING4.as:25-26`, `BUILDING14.as:20-21`. */
export const SPOUTS: Readonly<Record<number, Spout>> = {
  1: { x: -23, y: -20, height: 45 },
  2: { x: -22, y: -24, height: 47 },
  3: { x: 28, y: -17, height: 50 },
  4: { x: -1, y: -31, height: 65 },
  14: { x: 1, y: -67, height: 135 },
};

/** A building with no spout of its own (`ResourcePackages.as:115-118`). */
export const DEFAULT_SPOUT: Spout = { x: 0, y: -20, height: 20 };

export const TOWN_HALL_TYPE = 14;

export const spoutOf = (type: number): Spout => SPOUTS[type] ?? DEFAULT_SPOUT;

/** Balls a harvester lets go of per second: ball `i` waits `i / 12` s (Flash: `param4 / 6`). */
export const BALLS_PER_S = 12;
/** World px per second of flight (Flash: `time /= 150`). */
export const SPEED_PX_S = 300;
/** Up to this many px of random extra distance per ball (`Math.random() * 50`). */
export const JITTER_PX = 50;
/** The shortest flight (Flash: `if (time < 0.8)`). */
export const MIN_FLIGHT_S = 0.5;
/** The longest flight; Flash had no cap. */
export const MAX_FLIGHT_S = 1.5;
/** Px of lift at half-time per second of flight (Flash: `-(time * 120)`). */
export const LIFT_PX_PER_S = 240;
/** Px the shadow slides right by half-time per second of flight (Flash: `time * 100`). */
export const SHADOW_SLIDE_PX_PER_S = 200;
/**
 * The shadow's opacity at the start: `ResourcePackage_CLIP` places `mcShadow`
 * with an alpha multiplier of 205/256, and the tween back ends at 1.
 */
export const SHADOW_START_ALPHA = 205 / 256;

/** How many balls an amount makes (`ResourcePackages.as:67-93`). */
export const ballCount = (amount: number): number =>
  amount > 20_000
    ? 12
    : amount > 10_000
      ? 9
      : amount > 5_000
        ? 7
        : amount > 1_000
          ? 5
          : amount > 400
            ? 4
            : amount > 200
              ? 3
              : amount > 100
                ? 2
                : 1;

/** One banked harvester, where it is drawn. */
export interface BankSource {
  readonly type: number;
  /** World px of the building's anchor, draw offset included. */
  readonly x: number;
  readonly y: number;
  readonly resource: HarvestKey;
  readonly amount: number;
}

/** One ball. Positions are world px; times are seconds from the throw. */
export interface Flight {
  readonly resource: HarvestKey;
  /** What its landing adds to the pool. */
  readonly share: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly fromHeight: number;
  readonly toX: number;
  readonly toY: number;
  readonly toHeight: number;
  readonly delay: number;
  readonly duration: number;
}

/**
 * Every ball a bank throws: `sources` are the harvesters that banked, `town`
 * the Town Hall's anchor. Empty with no Town Hall, as in Flash.
 */
export const planFlights = (
  sources: readonly BankSource[],
  town: { readonly x: number; readonly y: number } | null,
  random: () => number = Math.random,
): Flight[] => {
  if (!town) return [];
  const hall = spoutOf(TOWN_HALL_TYPE);
  const toX = town.x + hall.x;
  const toY = town.y + hall.y;
  const flights: Flight[] = [];
  for (const source of sources) {
    const amount = Math.floor(source.amount);
    if (amount <= 0) continue;
    const spout = spoutOf(source.type);
    const fromX = source.x + spout.x;
    const fromY = source.y + spout.y;
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const count = ballCount(amount);
    const share = Math.floor(amount / count);
    for (let index = 0; index < count; index++) {
      const duration = Math.min(
        MAX_FLIGHT_S,
        Math.max(MIN_FLIGHT_S, (distance + random() * JITTER_PX) / SPEED_PX_S),
      );
      flights.push({
        resource: source.resource,
        // The last ball takes what the even split leaves over.
        share: index === count - 1 ? amount - share * (count - 1) : share,
        fromX,
        fromY,
        fromHeight: spout.height,
        toX,
        toY,
        toHeight: hall.height,
        delay: index / BALLS_PER_S,
        duration,
      });
    }
  }
  return flights;
};

/** Where a ball and its shadow are drawn at one moment. */
export interface FlightPose {
  /** False before the ball's delay is up. */
  readonly visible: boolean;
  /** The ball's ground-line point, world px. */
  readonly x: number;
  readonly y: number;
  /** Px the ball is drawn above that point. */
  readonly lift: number;
  /** The shadow's offset from (x, y), and its opacity. */
  readonly shadowX: number;
  readonly shadowY: number;
  readonly shadowAlpha: number;
  /** The flight is over: the ball has landed. */
  readonly landed: boolean;
}

const easeInOut = (t: number): number => -0.5 * (Math.cos(Math.PI * t) - 1);
const easeOut = (t: number): number => Math.sin((t * Math.PI) / 2);
const easeIn = (t: number): number => 1 - Math.cos((t * Math.PI) / 2);
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** A ball `elapsed` seconds after its bank was thrown. */
export const flightPose = (flight: Flight, elapsed: number): FlightPose => {
  const { duration } = flight;
  const t = elapsed - flight.delay;
  const progress = clamp01(t / duration);
  const along = easeInOut(progress);
  const x = flight.fromX + (flight.toX - flight.fromX) * along;
  const y = flight.fromY + (flight.toY - flight.fromY) * along;

  const half = duration / 2;
  const peak = duration * LIFT_PX_PER_S;
  const startShadowX = flight.fromHeight / 2;
  const slidX = startShadowX + duration * SHADOW_SLIDE_PX_PER_S;
  let lift: number;
  let shadowX: number;
  let shadowY: number;
  let shadowAlpha: number;
  if (t <= half) {
    const k = easeOut(clamp01(t / half));
    lift = peak * k;
    shadowX = startShadowX + (slidX - startShadowX) * k;
    shadowY = flight.fromHeight;
    shadowAlpha = SHADOW_START_ALPHA * (1 - k);
  } else {
    const k = easeIn(clamp01((t - half) / half));
    lift = peak * (1 - k);
    shadowX = slidX + (flight.toHeight / 2 - slidX) * k;
    shadowY = flight.fromHeight + (flight.toHeight - flight.fromHeight) * k;
    shadowAlpha = k;
  }
  return { visible: t >= 0, x, y, lift, shadowX, shadowY, shadowAlpha, landed: t >= duration };
};

/** How long a bank's balls take to all land: the longest delay plus flight. */
export const flightsEnd = (flights: readonly Flight[]): number =>
  flights.reduce((end, flight) => Math.max(end, flight.delay + flight.duration), 0);

/** When each resource's last ball lands, seconds from the throw. */
export const flightEnds = (flights: readonly Flight[]): Partial<Record<HarvestKey, number>> => {
  const ends: Partial<Record<HarvestKey, number>> = {};
  for (const flight of flights) {
    ends[flight.resource] = Math.max(ends[flight.resource] ?? 0, flight.delay + flight.duration);
  }
  return ends;
};

/** What a bank's balls carry, per resource. */
export const flightTotals = (flights: readonly Flight[]): Partial<Record<HarvestKey, number>> => {
  const totals: Partial<Record<HarvestKey, number>> = {};
  for (const flight of flights) totals[flight.resource] = (totals[flight.resource] ?? 0) + flight.share;
  return totals;
};
