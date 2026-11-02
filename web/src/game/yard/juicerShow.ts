/**
 * The Monster Juicer at work, as Flash drew it: the rules, with no Pixi.
 *
 * Juicing is decided on the server (`POST /bm/yard/juice`): the goo is in the
 * bank and the monsters are out of housing before any of this starts. What
 * follows is only the picture, so leaving the yard or reloading half way loses
 * nothing and doubles nothing.
 *
 * ## The blend (`client/scripts/BUILDING9.as`)
 *
 * Each monster that reaches the Juicer adds `ceil(goo / 400)` to its `_blend`
 * (`Blend`, called from `CreepBase.as:1287` with `_goo`, the monster's hatch
 * cost, `CreepBase.as:94`). `TickFast` runs on the 40 fps stage and, every
 * other frame (20 cells a second), while `_blend > 0` or the strip is past its
 * third cell, shows the next cell (`AnimFrame`):
 *
 * - after the first cell, the `juice` sound;
 * - after the fifteenth, the spurt (`GIBLETS.Create` at the spout, the blend
 *   capped at 70, x1.2 at level 2 and x1.4 at level 3, kept a whole number as
 *   Flash's `int` kept it), then the blend is spent and one goo ball flies to
 *   the Town Hall (`ResourcePackages.Create(.., 1)`);
 * - after the fifty-second, back to the first cell, where it stops unless
 *   more monsters arrived meanwhile.
 *
 * ## The spurt (`GIBLETS.as`, `GIBLET.as`)
 *
 * `GIBLETS.Create(spout, 0.8, 100, n, 28)`: unless 20 or more are already in
 * the air, `n` red giblets, the i-th leaving i/100 s after the first, each from
 * a few px round the spout to a random point `20..100` yard units away (three
 * in ten half as far again), 28 px further down the screen, in
 * `max(0.3, sqrt(d * 0.3) * 0.2)` seconds, easing in and out, hopping
 * `duration * 50` px up on the way. Where it lands it splats
 * (`EFFECTS.SplatParticle(20, ..)`) with the `splat5` sound.
 */

/** The stage's frame rate: `TickFast` is called this often (`yardAnim.ts` `YARD_TICK_HZ`). */
export const JUICER_TICK_HZ = 40;

/** After this cell the `juice` sound plays (`BUILDING9.as:79-81`). */
export const JUICE_SOUND_TICK = 1;

/** After this cell the spurt goes up and the blend is spent (`BUILDING9.as:82-87`, `:110-117`). */
export const JUICE_SPURT_TICK = 15;

/** After this cell the strip goes back to the first (`BUILDING9.as:88-90`). */
export const JUICE_LOOP_TICK = 52;

/** The most the blend counts for in one spurt (`BUILDING9.as:101-103`). */
export const SPURT_CAP = 70;

/** What one monster adds to the blend: `ceil(_goo / 400)`, `_goo` its hatch cost (`CreepBase.as:1287`). */
export const blendOf = (hatchCost: number): number => Math.ceil(Math.max(0, hatchCost) / 400);

/** How many giblets a spurt throws for a blend at a Juicer level (`BUILDING9.as:100-109`). */
export const spurtAmount = (blend: number, level: number): number => {
  let amount = Math.min(Math.floor(blend), SPURT_CAP);
  if (level === 2) amount = Math.floor(amount * 1.2);
  else if (level === 3) amount = Math.floor(amount * 1.4);
  return Math.max(0, amount);
};

export type BlendEvent =
  | { readonly kind: "sound" }
  | { readonly kind: "spurt"; readonly amount: number }
  | { readonly kind: "goo" };

/** Frames a long gap may catch up at once, so a tab woken after minutes does not spin. */
const MAX_TICKS_PER_STEP = 20;

/** One Juicer's blend, as `BUILDING9`'s `TickFast` and `AnimFrame` run it. */
export class JuicerBlend {
  /** What arrivals have added and the next spurt has not spent (`_blend`). */
  blend = 0;
  /** The cell to show next (`_animTick`). */
  animTick = 0;
  /** The cell on show. */
  cell = 0;
  private frameNumber = 0;
  private clock = 0;

  constructor(public level: number) {}

  /** A monster got there (`Blend`). */
  add(amount: number): void {
    this.blend += Math.max(0, amount);
  }

  /** Whether the strip is moving or about to. */
  get running(): boolean {
    return this.blend > 0 || this.animTick > 2;
  }

  /** Moves on by `seconds` and says what happened, in order. */
  advance(seconds: number): BlendEvent[] {
    const events: BlendEvent[] = [];
    this.clock += Math.max(0, seconds) * JUICER_TICK_HZ;
    const ticks = Math.min(MAX_TICKS_PER_STEP, Math.floor(this.clock));
    this.clock = Math.min(this.clock - ticks, 1);
    for (let i = 0; i < ticks; i++) this.tickFast(events);
    return events;
  }

  private tickFast(events: BlendEvent[]): void {
    if (this.running && this.frameNumber % 2 === 0) {
      // `AnimFrame`: show the cell, count on, and at the fifteenth throw the spurt.
      this.cell = this.animTick;
      this.animTick++;
      if (this.animTick === JUICE_SPURT_TICK) {
        events.push({ kind: "spurt", amount: spurtAmount(this.blend, this.level) });
      }
      if (this.animTick === JUICE_SOUND_TICK) events.push({ kind: "sound" });
      if (this.animTick === JUICE_SPURT_TICK) {
        this.blend = 0;
        events.push({ kind: "goo" });
      }
      if (this.animTick === JUICE_LOOP_TICK) this.animTick = 0;
    }
    this.frameNumber++;
  }
}

/* ── Giblets ────────────────────────────────────────────────────────────── */

/** The spout, from the Juicer's anchor, world px (`BUILDING9.as:39`). */
export const JUICER_SPOUT = { x: 0, y: 12 } as const;

/** How far down the screen a giblet lands from where it was aimed (`_spoutHeight`, `BUILDING9.as:40`). */
export const JUICER_SPOUT_HEIGHT = 28;

/** No new spurt while this many giblets are in the air (`GIBLETS.as:58`). */
export const GIBLETS_IN_AIR_LIMIT = 20;

/** One giblet's flight; world px and seconds. */
export interface Giblet {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly delay: number;
  readonly duration: number;
  /** Highest point of its hop above the line, px. */
  readonly hop: number;
  readonly scale: number;
}

/**
 * The giblets of one spurt (`GIBLETS.Create(spout, scale, range, count, height)`),
 * or none while `inAir` are still flying.
 */
export const planGiblets = (
  spout: { readonly x: number; readonly y: number },
  count: number,
  inAir: number,
  random: () => number = Math.random,
  scale = 0.8,
  range = 100,
  height = JUICER_SPOUT_HEIGHT,
): Giblet[] => {
  if (inAir >= GIBLETS_IN_AIR_LIMIT) return [];
  const giblets: Giblet[] = [];
  for (let i = 0; i < count; i++) {
    let distance = range * 0.2 + random() * (range * 0.8);
    if (random() <= 0.3) distance *= 1.5;
    const fromX = spout.x - 3 + random() * 6;
    const fromY = spout.y - 2 + random() * 4;
    // `Spawn`: the angle is degrees fed to cos and sin as radians, so any way round.
    const angle = random() * 360;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    // Out along the ground in yard units, back onto the screen (`GRID.FromISO`, `GRID.ToISO`).
    const toX = fromX + (dx - dy);
    const toY = fromY + (dx + dy) / 2 + height;
    const duration = Math.max(0.3, Math.sqrt(distance * 0.3) * 0.2);
    giblets.push({ fromX, fromY, toX, toY, delay: i / 100, duration, hop: duration * 50, scale });
  }
  return giblets;
};

const sineInOut = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

/**
 * Where a giblet is `t` seconds after its spurt: null before it leaves (it is
 * hidden until then) and after it lands. `lift` is the dot's height over its
 * line, up easing out for half the flight and down easing in for the rest.
 */
export const gibletPose = (giblet: Giblet, t: number): { x: number; y: number; lift: number } | null => {
  const local = t - giblet.delay;
  if (local < 0 || local >= giblet.duration) return null;
  const k = local / giblet.duration;
  const along = sineInOut(k);
  const half = k < 0.5 ? Math.sin((k * 2 * Math.PI) / 2) : Math.cos(((k - 0.5) * 2 * Math.PI) / 2);
  return {
    x: giblet.fromX + (giblet.toX - giblet.fromX) * along,
    y: giblet.fromY + (giblet.toY - giblet.fromY) * along,
    lift: giblet.hop * half,
  };
};
