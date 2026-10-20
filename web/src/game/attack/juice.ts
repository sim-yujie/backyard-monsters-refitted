import { championAttackDelay, monsterAttackDelay } from "@/game/combat/rules/stats";

/**
 * Bigger attack effects (feat/attack-juice-demo, the owner's "GO BIG" trial,
 * kept for beta.4 without the shockwave ring when a building falls).
 * Drawing only: nothing here reaches the battle, its clock, its countdown or
 * its replay. The hit-stop holds the picture still for a few frames while the
 * battle runs on underneath, and the slow-motion end plays the effects after
 * the battle is over; neither touches the engine's tick.
 *
 * - `full`: wind-up before each swing, a harder lunge and squash, a longer
 *   flash and an impact spark, a big blast and shake when a building falls,
 *   bouncier numbers, a hit-stop on big hits, slow motion at the end.
 * - `reduced` (the "Reduce effects" setting): the same, without shake,
 *   hit-stop or slow motion, and with fewer bits flying.
 * - `off`: the screen as it was before, for side-by-side clips
 *   (`?juice=0` in the address).
 */
export type JuiceLevel = "full" | "reduced" | "off";

/** Where the "Reduce effects" choice is kept, in this browser only. */
export const REDUCE_EFFECTS_KEY = "bymr.reduceEffects";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Whether the player turned on "Reduce effects". */
export const reduceEffects = (store: Storage | null = storage()): boolean => {
  try {
    return store?.getItem(REDUCE_EFFECTS_KEY) === "1";
  } catch {
    return false;
  }
};

export const setReduceEffects = (on: boolean, store: Storage | null = storage()): void => {
  try {
    if (on) store?.setItem(REDUCE_EFFECTS_KEY, "1");
    else store?.removeItem(REDUCE_EFFECTS_KEY);
  } catch {
    // Site data blocked: the choice lasts this page only.
  }
};

/**
 * The before-and-after switch: `?juice=0` in the address, or `bymr.juiceDemo` set to
 * `off` in this browser, draws the attack as before.
 */
const juiceOffInAddress = (): boolean => {
  try {
    if (storage()?.getItem("bymr.juiceDemo") === "off") return true;
    return new URLSearchParams(window.location.search).get("juice") === "0";
  } catch {
    return false;
  }
};

/** How big the attack effects are drawn right now. */
export const juiceLevel = (): JuiceLevel => {
  // The battle screen's own tests pin the look as it was; the bigger ones' are in juice.test.ts.
  if (import.meta.env.MODE === "test") return "off";
  if (juiceOffInAddress()) return "off";
  return reduceEffects() ? "reduced" : "full";
};

/* ── Wind-up ────────────────────────────────────────────────────────────── */

/**
 * The strike frame for champion sheets that have no repaint layout: the
 * frame of the looped Flash attack cycle where the blow lands. Gorgo's seven
 * frames crouch (0-3), rear up (4), bite at full stretch (5) and settle (6).
 */
export const CHAMPION_STRIKE_FRAMES: Readonly<Record<string, number>> = {
  G1: 5,
};

/** Ticks each wind-up frame shows, at least: slower than the strike, so it reads. */
export const WINDUP_TICKS_PER_FRAME = 8;

/**
 * The swing interval to expect for a creep, in battle ticks: what the table
 * says, until two hits have shown the real gap (an enraged or puttied creep
 * swings at its own pace).
 */
export const expectedSwingGap = (monsterId: string, level: number, champion: boolean): number =>
  champion ? championAttackDelay(monsterId, level) : monsterAttackDelay(monsterId, level);

/**
 * The gap to expect next after a hit `gap` ticks after the one before, or
 * `fallback` when the gap says nothing (the first hit, or one after a pause).
 */
export const nextSwingGap = (gap: number, fallback: number): number =>
  Number.isFinite(gap) && gap > 0 && gap < fallback * 3 ? gap : fallback;

/**
 * The attack-cycle frame to show while a creep waits for its next blow, or
 * null to stand idle. `sinceHit` is ticks since the last hit, `period` the
 * expected gap to the next one, `strike` the cycle's strike frame, `count`
 * its frame count and `ticksPerFrame` its own speed. The frames before the
 * strike are spread over the run-up, as slow as {@link WINDUP_TICKS_PER_FRAME}
 * but never into the follow-through. A blow that comes late holds the last
 * wind-up frame for up to half a swing more, then the creep stands; one that
 * comes early just cuts the wind-up short.
 */
export const windUpFrame = (
  sinceHit: number,
  period: number,
  strike: number,
  count: number,
  ticksPerFrame: number,
): number | null => {
  if (strike <= 0 || !Number.isFinite(sinceHit) || !Number.isFinite(period)) return null;
  const followThrough = (count - strike) * ticksPerFrame;
  const room = Math.floor((period - followThrough) / strike);
  const perFrame = Math.min(Math.max(ticksPerFrame, WINDUP_TICKS_PER_FRAME), room);
  if (perFrame < 2) return null;
  const left = period - sinceHit;
  if (left > strike * perFrame) return null;
  if (left <= 0) return -left <= period / 2 ? strike - 1 : null;
  return Math.max(0, strike - Math.ceil(left / perFrame));
};

/* ── Lunge and squash ───────────────────────────────────────────────────── */

/** Ticks a juiced melee lunge lasts, and how far it reaches, px. */
export const BIG_LUNGE_TICKS = 10;
export const BIG_LUNGE_PX = 10;

/** The juiced lunge `age` ticks after a hit: a fast snap out, a slower ease back. */
export const bigLungeOffset = (age: number): number => {
  if (age < 0 || age >= BIG_LUNGE_TICKS) return 0;
  const t = age / BIG_LUNGE_TICKS;
  // Peaks a fifth of the way in, then eases home.
  return t < 0.2 ? (t / 0.2) * BIG_LUNGE_PX : (1 - (t - 0.2) / 0.8) ** 2 * BIG_LUNGE_PX;
};

/** How far the body leans back during the wind-up, px, at the last wind-up frame. */
export const WINDUP_PULL_PX = 3;

/**
 * The body's squash and stretch: `x` and `y` scale about its feet. Squat
 * and wide while winding up (deeper as the blow nears), tall and thin on the
 * strike, springing back with a wobble.
 */
export const squashScale = (
  sinceHit: number,
  windUp: number | null,
  strike: number,
): { x: number; y: number } => {
  if (Number.isFinite(sinceHit) && sinceHit >= 0 && sinceHit < 14) {
    const t = sinceHit / 14;
    const spring = Math.cos(t * Math.PI * 2.5) * (1 - t);
    return { x: 1 - 0.12 * spring, y: 1 + 0.16 * spring };
  }
  if (windUp !== null && strike > 0) {
    const depth = (windUp + 1) / strike;
    return { x: 1 + 0.08 * depth, y: 1 - 0.1 * depth };
  }
  return { x: 1, y: 1 };
};

/* ── Hit flash and numbers ──────────────────────────────────────────────── */

/** Ticks a struck building shows its flash when juiced (3 before). */
export const BIG_FLASH_TICKS = 7;

/** Ticks a juiced damage number lives (40 before), and how high it flies, px. */
export const BIG_LABEL_TICKS = 56;
export const BIG_LABEL_RISE = 34;
/** Font size of a juiced number, and the bigger one for a hard hit. */
export const BIG_LABEL_SIZE = 18;

/** A juiced number's font size for `amount`: bigger for a harder hit. */
export const bigLabelSize = (amount: number): number =>
  BIG_LABEL_SIZE + Math.min(10, Math.log10(Math.max(1, amount)) * 4);

/** Ticks a merged-in hit makes its number swell again. */
export const BIG_LABEL_KICK_TICKS = 8;

/**
 * A juiced number at `age`: pops in at nearly twice its size, settles with a
 * bounce, hops up and drifts sideways, then shrinks away. `sinceMerge` is the
 * ticks since another hit was added into it, which swells it a little again;
 * null when none has been.
 */
export const bigLabelPose = (
  age: number,
  drift: number,
  sinceMerge: number | null = null,
): { rise: number; dx: number; scale: number; alpha: number } => {
  const t = Math.max(0, Math.min(1, age / BIG_LABEL_TICKS));
  // A ballistic hop: up fast, slowing at the top.
  const rise = (1 - (1 - t) ** 3) * BIG_LABEL_RISE;
  const pop = age < 10 ? 1.9 - 0.9 * (age / 10) + Math.sin((age / 10) * Math.PI) * 0.25 : 1;
  const kick =
    sinceMerge !== null && sinceMerge >= 0 && sinceMerge < BIG_LABEL_KICK_TICKS
      ? 1 + 0.3 * (1 - sinceMerge / BIG_LABEL_KICK_TICKS)
      : 1;
  const end = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
  return { rise, dx: drift * t, scale: Math.max(pop, kick) * (0.6 + 0.4 * end), alpha: Math.max(0, end) };
};

/* ── Many hits on one target ────────────────────────────────────────────── */

/**
 * Many monsters on one building made the big numbers pile up on each other.
 * So, juiced, a target shows at most {@link BIG_LABEL_PER_TARGET} numbers at
 * once, each in its own place (middle, right, left, drifting outwards), and a
 * hit that comes while the newest is still fresh is added into it: one number
 * counting up, swelling with each blow, rather than a stack. Nothing is lost:
 * the numbers on screen add up to the damage done.
 */
export const BIG_LABEL_PER_TARGET = 3;
/** Ticks a fresh number takes further hits into its sum (0.175 s at 1x). */
export const BIG_LABEL_MERGE_TICKS = 14;
/** With all places taken, ticks the newest number still takes hits into its sum. */
export const BIG_LABEL_LATE_MERGE_TICKS = 32;
/** World px a side number drifts outwards over its life. */
export const BIG_LABEL_DRIFT = 12;

export type BigLabelPlan = "new" | "merge" | "drop";

/**
 * What a hit on a target does: start a number, add into the newest one of
 * its kind (`newestAge` ticks old, or null when it has none), or, all
 * `alive` places taken and that one too old, nothing.
 */
export const bigLabelPlan = (newestAge: number | null, alive: number): BigLabelPlan => {
  if (newestAge !== null && newestAge < BIG_LABEL_MERGE_TICKS) return "merge";
  if (alive < BIG_LABEL_PER_TARGET) return "new";
  return newestAge !== null && newestAge < BIG_LABEL_LATE_MERGE_TICKS ? "merge" : "drop";
};

/** The first free place for a new number: 0 the middle, 1 right, -1 left. */
export const bigLabelSide = (taken: readonly number[]): number =>
  [0, 1, -1].find((side) => !taken.includes(side)) ?? 0;

/**
 * Screen px a number on `side` sits from the middle: a whole number's width
 * at `size`, plus a gap, so neighbours clear each other even mid-pop.
 */
export const bigLabelSpread = (side: number, digits: number, size: number): number =>
  side * Math.round(digits * size * 0.62 + 12);

/* ── Hit-stop and slow motion ───────────────────────────────────────────── */

/** Milliseconds the picture holds on a building falling, and on a champion's blow. */
export const HIT_STOP_DESTROY_MS = 70;
export const HIT_STOP_CHAMPION_MS = 40;

/** Seconds of slow motion after the attack-ending blow, the speed it runs, and the ease back. */
export const SLOW_MO_SECONDS = 1.1;
export const SLOW_MO_RATE = 0.25;
export const SLOW_MO_EASE_SECONDS = 0.5;

/**
 * Shown seconds that have passed `wall` seconds after the end, with slow
 * motion: a quarter speed, then easing back to full.
 */
export const slowMoSeconds = (wall: number): number => {
  if (wall <= 0) return 0;
  if (wall <= SLOW_MO_SECONDS) return wall * SLOW_MO_RATE;
  const slow = SLOW_MO_SECONDS * SLOW_MO_RATE;
  const into = wall - SLOW_MO_SECONDS;
  if (into <= SLOW_MO_EASE_SECONDS) {
    // The rate climbs evenly from the slow one to 1.
    const climb = (1 - SLOW_MO_RATE) / SLOW_MO_EASE_SECONDS;
    return slow + into * SLOW_MO_RATE + (climb * into * into) / 2;
  }
  return slow + SLOW_MO_EASE_SECONDS * (1 + SLOW_MO_RATE) / 2 + (into - SLOW_MO_EASE_SECONDS);
};

/** The yard's shake cap when juiced, screen px (8 before). */
export const BIG_MAX_SHAKE = 14;
