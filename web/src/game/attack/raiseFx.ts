import { Assets, Graphics, Sprite, Texture, type ColorMatrix, type Container } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";
import { artUrl } from "../../artUrl";

/**
 * How Rezghul's raise looks: the orb it throws at a corpse, the corpse rising
 * out of the ground, and the zombie it becomes. Drawing only: the engine
 * decides what is raised and when (`raiseOrb` and `rise` events, the
 * snapshot's `zombie` flag); nothing here reaches the battle.
 *
 * ## What Flash did
 *
 * - **The orb** (`ResurrectProjectile.as`): a 20 x 20 sprite flying 2 px a
 *   loop from Rezghul's feet to a point by the corpse. Each loop it is drawn
 *   10 px off its path, round a circle it turns 0.05 rad a loop, under a
 *   white `GlowFilter` (blur 9) that TweenMax takes from alpha 0 to 0.8 over
 *   1 s. The filter is applied into the orb's own 20 x 20 bitmap
 *   (`render`, `applyFilter` onto `m_rasterData`), so the glow never leaves
 *   the orb's box: a soft white haze round its rim.
 *   Its picture, `monsters/projectiles/rezghul_projectile.png`, never shipped,
 *   so Flash fell back to the orange fireball; the owner asked for Rezghul's
 *   own orb instead (12 Nov 2026), painted in both looks.
 * - **The rise** (`RezghulResurrectAttack.resurrect`, `:71-89`): an
 *   `EFFECTS.Dig` (twenty dirt clods, `Particles.Create(…, 30, 20)`) and
 *   `GIBLETS.Create(…, 50, 20, 10)` (twenty bits of goo) 20 px below the
 *   corpse, and the new monster's graphic tweening up from 20 px below its
 *   feet over 0.8 s on `Sine.easeOut`. The clods and bits hop out
 *   (`ParticlesObject.init`, `GIBLET.init`); the clods stay on the ground,
 *   the goo is gone where it lands. No disc, ring or flash.
 * - **The zombie** (`Zombiefy.as:26-53`): TweenMax takes its graphic's
 *   saturation from 1 to 0 over 1 s.
 * - **Lightning**: Flash also throws a green (`0x00FF00`) `EFFECTS.Lightning`
 *   (`EFFECTS.as:112-142`, a 1 px jagged line glowing 4 px, three ticks) off
 *   the orb on a quarter of its loops (`ResurrectProjectile.as:51-77`) and
 *   round a zombie's feet on a tenth (`Zombiefy.as:46`). The owner turned
 *   those lines down (16 Nov 2026), so they are off; `lightning: true`
 *   brings them back.
 *
 * ## Ours (owner, 16 Nov 2026)
 *
 * Flash's own (the orb's rim haze, the clods and goo) plus a soft sea-green
 * glow round the orb in flight and a soft green glow on the ground as the
 * monster rises. The owner picked this ("B, with soft glow") over Flash's
 * alone, for both Classic and Modern.
 */

/* ── Timing and arithmetic (pure, tested in raiseFx.test.ts) ───────────── */

/** Battle ticks a second: 80 loops, as the engine runs. */
const TICKS_PER_SECOND = 80;

/** The rise's `TweenLite.from` (`RezghulResurrectAttack.as:80-85`): 20 px over 0.8 s. */
export const RISE_DROP_PX = 20;
export const RISE_TICKS = 0.8 * TICKS_PER_SECOND;

/** Zombiefy's saturation tween, 1 s (`Zombiefy.as:34`). */
export const ZOMBIE_FADE_TICKS = TICKS_PER_SECOND;

/** The orb's sprite is 20 x 20 (`SPRITES.as:95`); Flash moves its corner. */
export const ORB_HALF = 10;
/** `k_ORBIT_RADIUS` and `k_ORBIT_SPEED` (`ResurrectProjectile.as:22-24`). */
export const ORB_ORBIT_PX = 10;
export const ORB_ORBIT_STEP = 0.05;
/** The glow's tween: alpha 0 to 0.8 over 1 s (`ResurrectProjectile.as:37-41`). */
export const ORB_GLOW_ALPHA = 0.8;
export const ORB_GLOW_TICKS = TICKS_PER_SECOND;
/** `Math.random() > 0.75`: a spark off the orb on a quarter of its loops (`:51`). */
export const ORB_SPARK_CHANCE = 0.25;
/** `k_MAX_DISTANCE_TO_LIGHTNING_TARGET` (`:16`). */
export const ORB_SPARK_REACH = 125;
/** `Math.random() > 0.9`: a spark on a zombie on a tenth of its loops (`Zombiefy.as:46`). */
export const ZOMBIE_SPARK_CHANCE = 0.1;
/**
 * `getRandomPointOnGraphic` (`GameObject.as:66-73`): a quarter of the graphic
 * either way, 52 x 50 for a creep, as the engine aims its raise.
 */
export const ZOMBIE_SPARK_SPREAD_X = 52 * 0.25;
export const ZOMBIE_SPARK_SPREAD_Y = 50 * 0.25;
/** `EFFECTS.Lightning` is gone after three ticks, fading by 1.75 a tick (as the Tesla's in towerFx). */
export const BOLT_TICKS = 3;
/** `0x00FF00`, the colour both of Rezghul's lightnings pass. */
export const RAISE_BOLT_COLOUR = 0x00ff00;

/** TweenMax's default ease, `Quad.easeOut`. */
const quadOut = (t: number): number => t * (2 - t);

/**
 * How far below its feet a raised monster is drawn `age` ticks after it rose,
 * in px: 20 at first, up to 0 on `Sine.easeOut` over 0.8 s, 0 after (and
 * before, for a creep that never rose).
 */
export const riseDrop = (age: number): number => {
  if (age < 0 || age >= RISE_TICKS) return 0;
  return RISE_DROP_PX * (1 - Math.sin(((age / RISE_TICKS) * Math.PI) / 2));
};

/** A zombie's saturation `age` ticks after it rose: 1 down to 0 over 1 s, `Quad.easeOut`. */
export const zombieSaturation = (age: number): number => {
  if (age <= 0) return 1;
  if (age >= ZOMBIE_FADE_TICKS) return 0;
  return 1 - quadOut(age / ZOMBIE_FADE_TICKS);
};

/** The luminance weights TweenMax's `ColorMatrixFilterPlugin` greys with. */
const LUM_R = 0.212671;
const LUM_G = 0.71516;
const LUM_B = 0.072169;

/**
 * TweenMax's `setSaturation` matrix (`ColorMatrixFilterPlugin`), the 4 x 5
 * row-major layout Pixi's `ColorMatrixFilter.matrix` takes: 1 leaves the
 * colours alone, 0 is grey by luminance.
 */
export const saturationMatrix = (saturation: number): ColorMatrix => {
  const inverse = 1 - saturation;
  const r = inverse * LUM_R;
  const g = inverse * LUM_G;
  const b = inverse * LUM_B;
  // prettier-ignore
  return [
    r + saturation, g, b, 0, 0,
    r, g + saturation, b, 0, 0,
    r, g, b + saturation, 0, 0,
    0, 0, 0, 1, 0,
  ];
};

/**
 * How far along its flight an orb thrown `flightTicks` before it lands is,
 * `age` ticks after it was thrown, from 0 to 1. It moves 2 px on the loop it
 * is thrown and on every loop after, and lands on the last
 * (`Engine.raiseOrbFlight`): a straight line at one speed, since the point it
 * homes on never moves.
 */
export const orbProgress = (age: number, flightTicks: number): number => {
  if (flightTicks <= 0) return 1;
  return Math.min(1, Math.max(0, (age + 1) / (flightTicks + 1)));
};

/** Where the orb is drawn off its path `age` ticks into its flight: its orbit, 0.05 rad a loop. */
export const orbOrbit = (age: number): Point => {
  const angle = ORB_ORBIT_STEP * (age + 1);
  return { x: Math.cos(angle) * ORB_ORBIT_PX, y: Math.sin(angle) * ORB_ORBIT_PX };
};

/** The orb's glow `age` ticks after it was thrown: 0 up to 0.8 over 1 s, `Quad.easeOut`. */
export const orbGlowAlpha = (age: number): number =>
  ORB_GLOW_ALPHA * quadOut(Math.min(1, Math.max(0, age / ORB_GLOW_TICKS)));

/**
 * The middle of the orb `age` ticks into a flight from corner `from` to
 * corner `to` (world px): the corner on its line, its orbit, and half its
 * sprite, which Flash draws from the corner.
 */
export const orbCentre = (from: Point, to: Point, age: number, flightTicks: number): Point => {
  const along = orbProgress(age, flightTicks);
  const orbit = orbOrbit(age);
  return {
    x: from.x + (to.x - from.x) * along + orbit.x + ORB_HALF,
    y: from.y + (to.y - from.y) * along + orbit.y + ORB_HALF,
  };
};

/** Repeatable jitter from a tick, a key and an index, in `[0, 1)`: the battle replays, so do its sparks. */
export const raiseJitter = (tick: number, key: number, index: number): number => {
  const mixed =
    Math.imul((tick + 1) * 0x9e3779b1 + key * 0x27d4eb2f, index * 2 + 0x85ebca6b) >>> 0;
  return (mixed % 10_007) / 10_007;
};

/**
 * The corners of an `EFFECTS.Lightning` from `from` to `to` (`EFFECTS.as:
 * 112-142`): one every 30 px of its length, starting on `from`'s line, each
 * thrown -7 to 8 px off, then the end thrown -5 to 5 px across and 0 to 10 px
 * up. `random` gives `[0, 1)`, Flash's `Math.random`.
 */
export const lightningPath = (from: Point, to: Point, random: () => number): Point[] => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.trunc(Math.hypot(dx, dy));
  const corners = Math.trunc(distance / 30);
  const angle = Math.atan2(dy, dx);
  const path: Point[] = [{ x: from.x, y: from.y }];
  for (let index = 0; index < corners; index += 1) {
    const along = (distance / corners) * index;
    path.push({
      x: Math.trunc(Math.cos(angle) * along) + from.x - 7 + random() * 15,
      y: Math.trunc(Math.sin(angle) * along) + from.y - 7 + random() * 15,
    });
  }
  path.push({ x: to.x - 5 + random() * 10, y: to.y - random() * 10 });
  return path;
};

/* ── The clods and goo of the rise (pure, tested) ─────────────────────── */

/** One clod of earth or bit of goo thrown out as a monster rises. */
export interface RiseBit {
  /** Where it lands, world px off the burst's middle. */
  readonly dx: number;
  readonly dy: number;
  /** Ticks after the rise it sets off, and ticks it flies. */
  readonly delay: number;
  readonly flight: number;
  /** How high its hop goes at its top, px. */
  readonly hop: number;
  /** Clods stay on the ground; goo is gone where it lands (`GIBLET.Arrived`). */
  readonly goo: boolean;
  /** 0..1, picks its size and shade. */
  readonly shade: number;
}

/** `EFFECTS.Dig`: `Particles.Create(at, 1 + rnd * 0.5, 30, 20)`. */
export const RISE_CLODS = 20;
export const RISE_CLOD_REACH = 30;
/** `GIBLETS.Create(at, 1, 50, 20, 10)`: twenty bits out to 50 px, landing 10 px lower. */
export const RISE_GOO = 20;
export const RISE_GOO_REACH = 50;
export const RISE_GOO_DROP = 10;
/**
 * Flash makes a set only while fewer than this many are in the air
 * (`Particles.Create`'s 80, `GIBLETS.Create`'s 20): four raised at once
 * throw four sets of clods but one of goo.
 */
export const RISE_CLODS_CAP = 80;
export const RISE_GOO_CAP = 20;
/** A clod lies on the ground this long once down, then fades over {@link RISE_CLOD_FADE_TICKS}. */
export const RISE_CLOD_LIE_TICKS = 2 * TICKS_PER_SECOND;
export const RISE_CLOD_FADE_TICKS = TICKS_PER_SECOND;

/**
 * A well-mixed number in `[0, 1)` from a seed and an index (a SplitMix32
 * finish): the bits must scatter, where a plain multiply lines them up in
 * rows and rings.
 */
export const bitRandom = (seed: number, index: number): number => {
  let mixed = (Math.imul(seed | 0, 0x9e3779b1) + Math.imul(index + 1, 0x85ebca6b)) | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  mixed ^= mixed >>> 15;
  return (mixed >>> 0) / 4294967296;
};

/**
 * The clods and goo a rise at `seed` throws (`Particles.Create`,
 * `GIBLETS.Create`): each `reach * (0.2 + rnd * 0.8)` out, half again on
 * three in ten, round a circle on the ground drawn flat (`GRID.ToISO`), set
 * off a hundredth of a second after the one before, flying
 * `max(0.3, sqrt(d * 0.3) * 0.2)` s and hopping `flight * 50` px high
 * (`ParticlesObject.init`).
 */
export const riseBits = (seed: number, clods = true, goo = true): RiseBit[] => {
  const bits: RiseBit[] = [];
  const throwSet = (
    count: number,
    reach: number,
    drop: number,
    goo: boolean,
    salt: number,
  ): void => {
    for (let index = 0; index < count; index += 1) {
      const random = (n: number): number => bitRandom(seed, salt * 1000 + index * 5 + n);
      let distance = reach * 0.2 + random(0) * reach * 0.8;
      if (random(1) <= 0.3) distance *= 1.5;
      const angle = random(2) * Math.PI * 2;
      const gx = Math.cos(angle) * distance;
      const gy = Math.sin(angle) * distance;
      const seconds = Math.max(0.3, Math.sqrt(distance * 0.3) * 0.2);
      bits.push({
        dx: gx - gy,
        dy: (gx + gy) * 0.5 + drop,
        delay: (index / 100) * TICKS_PER_SECOND,
        flight: seconds * TICKS_PER_SECOND,
        hop: seconds * 50,
        goo,
        shade: random(3),
      });
    }
  };
  if (clods) throwSet(RISE_CLODS, RISE_CLOD_REACH, 0, false, 1);
  if (goo) throwSet(RISE_GOO, RISE_GOO_REACH, RISE_GOO_DROP, true, 2);
  return bits;
};

/**
 * Where a bit is `age` ticks after the rise, off the burst's middle, and how
 * much of it shows: hidden before it sets off, then along its line on
 * `Sine.easeInOut` with a hop of `sin(pi * t)`, then lying (a clod, fading
 * late) or gone (goo).
 */
export const riseBitAt = (
  bit: RiseBit,
  age: number,
): { x: number; y: number; alpha: number } => {
  const flown = age - bit.delay;
  if (flown < 0) return { x: 0, y: 0, alpha: 0 };
  if (flown < bit.flight) {
    const t = flown / bit.flight;
    const along = (1 - Math.cos(Math.PI * t)) / 2;
    return { x: bit.dx * along, y: bit.dy * along - bit.hop * Math.sin(Math.PI * t), alpha: 1 };
  }
  if (bit.goo) return { x: bit.dx, y: bit.dy, alpha: 0 };
  const lying = flown - bit.flight - RISE_CLOD_LIE_TICKS;
  const alpha = lying <= 0 ? 1 : Math.max(0, 1 - lying / RISE_CLOD_FADE_TICKS);
  return { x: bit.dx, y: bit.dy, alpha };
};

/** Ticks until every bit of a rise is gone. */
export const RISE_BITS_TICKS =
  (RISE_CLODS / 100) * TICKS_PER_SECOND +
  Math.max(0.3, Math.sqrt(RISE_CLOD_REACH * 1.5 * 0.3) * 0.2) * TICKS_PER_SECOND +
  RISE_CLOD_LIE_TICKS +
  RISE_CLOD_FADE_TICKS;

/** The soft glow on the ground as a monster rises: up at once, gone over 1.2 s. */
export const RISE_GLOW_TICKS = 1.2 * TICKS_PER_SECOND;
export const riseGlowAlpha = (age: number): number => {
  if (age < 0 || age >= RISE_GLOW_TICKS) return 0;
  const t = age / RISE_GLOW_TICKS;
  return 1 - t * t;
};

/* ── Pictures ───────────────────────────────────────────────────────────── */

/** Rezghul's orb, painted for the owner (12 Nov 2026): the Classic one at Flash's own path. */
export const ORB_URL_CLASSIC = artUrl("/assets/monsters/projectiles/rezghul_projectile@2x.png");
export const ORB_URL_MODERN = artUrl("/assets/monsters/projectiles/rezghul_projectile.modern@2x.png");

/** The rim haze: Flash's white; the Modern look tints it the orb's sea-green. */
const HAZE_CLASSIC = 0xffffff;
const HAZE_MODERN = 0xdcfff0;
/** The haze reaches this far out from the orb's middle: Flash's glow kept in its 20 px box, softened. */
const HAZE_RADIUS = ORB_HALF + 4;
/** Ours: a wider sea-green glow round the orb, and one on the ground at a rise. */
const AURA_COLOUR = 0x5dffb4;
const AURA_RADIUS = ORB_HALF * 2.6;
const AURA_ALPHA = 0.55;
const RISE_GLOW_COLOUR = 0x5dffa0;
const RISE_GLOW_RADIUS = 34;
const RISE_GLOW_ALPHA = 0.7;

/** Earth for the clods (as the battle's dig) and goo for the bits (as its death gibs). */
const CLOD_COLOURS = [0x7a5532, 0x5a3d22, 0x94693f] as const;
const GOO_COLOURS = [0x5da832, 0x3f7a1e, 0x8ad14a] as const;

/** The size a soft glow texture is drawn at: big enough that no zoom shows steps. */
const GLOW_TEXTURE_PX = 256;
const DOT_TEXTURE_PX = 32;

let glowTexture: Texture | null = null;
let dotTexture: Texture | null = null;

/** A canvas texture, or the plain white one where there is no canvas (tests). */
const canvasTexture = (
  size: number,
  paint: (context: CanvasRenderingContext2D) => void,
): Texture => {
  if (typeof document === "undefined") return Texture.WHITE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return Texture.WHITE;
  paint(context);
  return Texture.from(canvas);
};

/** A white glow that falls off as a bell curve, with no edge: tinted for each use. */
const softGlow = (): Texture => {
  glowTexture ??= canvasTexture(GLOW_TEXTURE_PX, (context) => {
    const half = GLOW_TEXTURE_PX / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    for (let stop = 0; stop <= 16; stop += 1) {
      const r = stop / 16;
      // exp(-4.5 r^2), pulled to 0 at the edge.
      const alpha = Math.max(
        0,
        (Math.exp(-4.5 * r * r) - Math.exp(-4.5)) / (1 - Math.exp(-4.5)),
      );
      gradient.addColorStop(r, `rgba(255,255,255,${alpha.toFixed(4)})`);
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, GLOW_TEXTURE_PX, GLOW_TEXTURE_PX);
  });
  return glowTexture;
};

/** A round white dot with a soft rim, for the clods and goo. */
const softDot = (): Texture => {
  dotTexture ??= canvasTexture(DOT_TEXTURE_PX, (context) => {
    const half = DOT_TEXTURE_PX / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.7, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, DOT_TEXTURE_PX, DOT_TEXTURE_PX);
  });
  return dotTexture;
};

/** A glow sprite `radius` px out, tinted, that never takes a pointer. */
const glowSprite = (radius: number, tint: number, add: boolean): Sprite => {
  const sprite = new Sprite(softGlow());
  sprite.anchor.set(0.5);
  sprite.width = radius * 2;
  sprite.height = radius * 2;
  sprite.tint = tint;
  sprite.eventMode = "none";
  if (add) sprite.blendMode = "add";
  return sprite;
};

/* ── The effect ─────────────────────────────────────────────────────────── */

/** An orb in the air: its own `raiseOrb` event, in world px. */
interface Flight {
  readonly tick: number;
  readonly landTick: number;
  readonly creepId: number;
  readonly from: Point;
  readonly to: Point;
  readonly haze: Sprite;
  readonly aura: Sprite;
  readonly sprite: Sprite;
  /** The last tick it threw (or did not throw) a spark on. */
  sparkTick: number;
}

/** A rise's clods and goo, and its soft glow, on the ground. */
interface Burst {
  readonly tick: number;
  readonly bits: readonly RiseBit[];
  readonly sprites: readonly Sprite[];
  readonly at: Point;
  readonly glow: Sprite;
}

interface Bolt {
  readonly tick: number;
  readonly path: readonly Point[];
}

/** A zombie the battle layer is drawing: its feet, and the tick it rose. */
export interface ZombieAt {
  readonly id: number;
  readonly ground: Point;
}

/** The feet of the closest monster of either side within reach of a point, or null. */
export type CreepNear = (at: Point, reach: number) => Point | null;

export interface RaiseFxOptions {
  /** Above the creeps: the orbs (Flash's `MAP._PROJECTILES`). */
  readonly air: () => Container;
  /** On the ground, under the creeps: the clods, goo and the rise's glow (`MAP._GROUND`). */
  readonly ground: () => Container;
  readonly classic: boolean;
  readonly reducedMotion?: boolean;
  /** Flash's green lightning off the orb and round the zombies; off since the owner turned it down. */
  readonly lightning?: boolean;
  readonly load?: (url: string) => Promise<Texture>;
}

/**
 * Rezghul's orbs in flight, the clods and goo of its rises, and (when asked
 * for) Flash's green lightning round the orbs and the zombies.
 */
export class RaiseFx {
  private readonly flights: Flight[] = [];
  private readonly bursts: Burst[] = [];
  private readonly bolts: Bolt[] = [];
  private lightningGraphics: Graphics | null = null;
  private readonly zombieSparkTick = new Map<number, number>();
  private texture: Texture | null = null;
  private asked = false;
  private readonly classic: boolean;
  private readonly reducedMotion: boolean;
  private readonly lightning: boolean;
  private readonly load: (url: string) => Promise<Texture>;

  constructor(private readonly options: RaiseFxOptions) {
    this.classic = options.classic;
    this.reducedMotion = options.reducedMotion ?? false;
    this.lightning = options.lightning ?? false;
    this.load = options.load ?? ((url) => Assets.load<Texture>(url));
  }

  /** Starts the orb picture's fetch, so the first throw shows it. */
  preload(): void {
    if (this.asked) return;
    this.asked = true;
    this.load(this.classic ? ORB_URL_CLASSIC : ORB_URL_MODERN)
      .then((texture) => {
        this.texture = texture;
        for (const flight of this.flights) {
          flight.sprite.texture = texture;
          flight.sprite.visible = true;
        }
      })
      .catch((caught: unknown) => {
        // Asked once: the orbs fly as their glow alone.
        console.warn("Rezghul orb picture did not load.", caught);
      });
  }

  /** A Rezghul threw its raise: corners `from` and `to` are world px, as the event's. */
  throwOrb(tick: number, landTick: number, creepId: number, from: Point, to: Point): void {
    this.preload();
    const aura = glowSprite(AURA_RADIUS, AURA_COLOUR, true);
    const haze = glowSprite(HAZE_RADIUS, this.classic ? HAZE_CLASSIC : HAZE_MODERN, false);
    haze.alpha = 0;
    aura.alpha = 0;
    // Until the picture is in, the glow flies alone.
    const sprite = new Sprite(this.texture ?? Texture.EMPTY);
    sprite.visible = this.texture !== null;
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    const layer = this.options.air();
    layer.addChild(aura, haze, sprite);
    this.flights.push({
      tick,
      landTick,
      creepId,
      from,
      to,
      haze,
      aura,
      sprite,
      sparkTick: tick - 1,
    });
  }

  /**
   * A monster rose with its feet at `feet` (world px): the clods and goo
   * thrown from 20 px below them, and a soft glow on the ground round it.
   */
  rise(tick: number, burstAt: Point, feet: Point): void {
    const ground = this.options.ground();
    const glow = glowSprite(RISE_GLOW_RADIUS, RISE_GLOW_COLOUR, true);
    glow.height = RISE_GLOW_RADIUS;
    glow.position.set(feet.x, feet.y);
    glow.alpha = 0;
    ground.addChild(glow);
    const bits = this.reducedMotion
      ? []
      : riseBits(
          Math.round(burstAt.x * 31 + burstAt.y * 17 + tick),
          this.inAir(tick, false) < RISE_CLODS_CAP,
          this.inAir(tick, true) < RISE_GOO_CAP,
        );
    const sprites = bits.map((bit) => {
      const sprite = new Sprite(softDot());
      sprite.anchor.set(0.5);
      // Clods 3-4.5 px (Flash's 1-1.5 scale), goo 2.5-3.5 px.
      const size = bit.goo ? 2.5 + bit.shade : 3 + bit.shade * 1.5;
      sprite.width = size;
      sprite.height = size * (bit.goo ? 1 : 0.8);
      const colours = bit.goo ? GOO_COLOURS : CLOD_COLOURS;
      sprite.tint =
        colours[Math.floor(bit.shade * colours.length) % colours.length] ?? 0x7a5532;
      sprite.eventMode = "none";
      sprite.visible = false;
      ground.addChild(sprite);
      return sprite;
    });
    this.bursts.push({ tick, bits, sprites, at: burstAt, glow });
  }

  /** Clods (or goo) of every rise still in the air at `tick`, as Flash counts them for its caps. */
  private inAir(tick: number, goo: boolean): number {
    let count = 0;
    for (const burst of this.bursts) {
      const age = tick - burst.tick;
      for (const bit of burst.bits)
        if (bit.goo === goo && age < bit.delay + bit.flight) count += 1;
    }
    return count;
  }

  /** Clods and goo thrown by the rises still showing, for tests. */
  get bitCounts(): { clods: number; goo: number } {
    let clods = 0;
    let goo = 0;
    for (const burst of this.bursts)
      for (const bit of burst.bits) {
        if (bit.goo) goo += 1;
        else clods += 1;
      }
    return { clods, goo };
  }

  /** Orbs in the air, for tests. */
  get flightCount(): number {
    return this.flights.length;
  }

  /** Rises still showing clods, goo or glow, for tests. */
  get burstCount(): number {
    return this.bursts.length;
  }

  /** Lightning bolts showing, for tests. */
  get boltCount(): number {
    return this.bolts.length;
  }

  /**
   * Moves the orbs to `tick`, drops the landed ones, moves the rises' clods
   * and goo, and (with lightning on) throws this tick's sparks and redraws
   * them.
   */
  update(tick: number, creepNear: CreepNear, zombies: Iterable<ZombieAt>): void {
    let keep = 0;
    for (const flight of this.flights) {
      if (tick >= flight.landTick) {
        this.dropFlight(flight);
        continue;
      }
      this.flights[keep] = flight;
      keep += 1;
      const age = Math.max(0, tick - flight.tick);
      const centre = orbCentre(flight.from, flight.to, age, flight.landTick - flight.tick);
      flight.sprite.position.set(Math.round(centre.x), Math.round(centre.y));
      const glow = orbGlowAlpha(age);
      flight.haze.position.set(centre.x, centre.y);
      flight.haze.alpha = glow;
      flight.aura.position.set(centre.x, centre.y);
      flight.aura.alpha = (glow / ORB_GLOW_ALPHA) * AURA_ALPHA;
      if (this.lightning)
        for (let at = flight.sparkTick + 1; at <= tick; at += 1)
          this.orbSpark(flight, at, centre, creepNear);
      flight.sparkTick = tick;
    }
    this.flights.length = keep;

    keep = 0;
    for (const burst of this.bursts) {
      const age = tick - burst.tick;
      if (age > RISE_BITS_TICKS && age > RISE_GLOW_TICKS) {
        this.dropBurst(burst);
        continue;
      }
      this.bursts[keep] = burst;
      keep += 1;
      burst.bits.forEach((bit, index) => {
        const sprite = burst.sprites[index];
        if (!sprite) return;
        const at = riseBitAt(bit, age);
        sprite.visible = at.alpha > 0;
        sprite.alpha = at.alpha;
        sprite.position.set(burst.at.x + at.x, burst.at.y + at.y);
      });
      burst.glow.alpha = RISE_GLOW_ALPHA * riseGlowAlpha(age);
      if (!this.reducedMotion) {
        const grow = 0.85 + 0.3 * Math.min(1, Math.max(0, age / RISE_GLOW_TICKS));
        burst.glow.width = RISE_GLOW_RADIUS * 2 * grow;
        burst.glow.height = RISE_GLOW_RADIUS * grow;
      }
    }
    this.bursts.length = keep;

    if (!this.lightning) return;
    const seen = new Set<number>();
    for (const zombie of zombies) {
      seen.add(zombie.id);
      const last = this.zombieSparkTick.get(zombie.id) ?? tick - 1;
      for (let at = Math.max(last + 1, tick - BOLT_TICKS); at <= tick; at += 1)
        this.zombieSpark(zombie, at);
      this.zombieSparkTick.set(zombie.id, tick);
    }
    for (const id of this.zombieSparkTick.keys())
      if (!seen.has(id)) this.zombieSparkTick.delete(id);

    this.drawBolts(tick);
  }

  destroy(): void {
    for (const flight of this.flights) this.dropFlight(flight);
    this.flights.length = 0;
    for (const burst of this.bursts) this.dropBurst(burst);
    this.bursts.length = 0;
    this.bolts.length = 0;
    this.lightningGraphics?.destroy();
    this.lightningGraphics = null;
  }

  private dropFlight(flight: Flight): void {
    flight.haze.destroy();
    flight.aura.destroy();
    flight.sprite.destroy();
  }

  private dropBurst(burst: Burst): void {
    for (const sprite of burst.sprites) sprite.destroy();
    burst.glow.destroy();
  }

  /**
   * `randerElectricityAroundProjectile` (`ResurrectProjectile.as:56-77`): from
   * a random point on the orb's 20 px box to the closest creep within 125 px,
   * if a roll beats its distance, else to another random point on the box.
   */
  private orbSpark(flight: Flight, tick: number, centre: Point, creepNear: CreepNear): void {
    if (this.reducedMotion) return;
    const key = flight.creepId * 7919 + flight.tick;
    if (raiseJitter(tick, key, 0) >= ORB_SPARK_CHANCE) return;
    let index = 1;
    const random = (): number => raiseJitter(tick, key, (index += 1));
    const corner = { x: centre.x - ORB_HALF, y: centre.y - ORB_HALF };
    let target: Point | null = null;
    const enemy = creepNear(centre, ORB_SPARK_REACH);
    if (enemy) {
      const distance = Math.hypot(enemy.x - centre.x, enemy.y - centre.y);
      if (random() > distance / ORB_SPARK_REACH) {
        target = {
          x: enemy.x + random() * ZOMBIE_SPARK_SPREAD_X * 2 - ZOMBIE_SPARK_SPREAD_X,
          y: enemy.y + random() * ZOMBIE_SPARK_SPREAD_Y * 2 - ZOMBIE_SPARK_SPREAD_Y,
        };
      }
    }
    target ??= { x: corner.x + random() * ORB_HALF * 2, y: corner.y + random() * ORB_HALF * 2 };
    const start = {
      x: corner.x + random() * ORB_HALF * 2,
      y: corner.y + random() * ORB_HALF * 2,
    };
    this.bolts.push({ tick, path: lightningPath(start, target, random) });
  }

  /** `Zombiefy.tick` (`Zombiefy.as:42-49`): between two random points round its feet. */
  private zombieSpark(zombie: ZombieAt, tick: number): void {
    if (this.reducedMotion) return;
    if (raiseJitter(tick, zombie.id, 0) >= ZOMBIE_SPARK_CHANCE) return;
    let index = 1;
    const random = (): number => raiseJitter(tick, zombie.id, (index += 1));
    const point = (): Point => ({
      x: zombie.ground.x + random() * ZOMBIE_SPARK_SPREAD_X * 2 - ZOMBIE_SPARK_SPREAD_X,
      y: zombie.ground.y + random() * ZOMBIE_SPARK_SPREAD_Y * 2 - ZOMBIE_SPARK_SPREAD_Y,
    });
    const from = point();
    const to = point();
    this.bolts.push({ tick, path: lightningPath(from, to, random) });
  }

  private drawBolts(tick: number): void {
    if (!this.lightningGraphics) {
      this.lightningGraphics = new Graphics();
      this.lightningGraphics.eventMode = "none";
      this.lightningGraphics.blendMode = "add";
    }
    const graphics = this.lightningGraphics;
    const layer = this.options.air();
    if (graphics.parent !== layer) layer.addChild(graphics);
    else layer.setChildIndex(graphics, layer.children.length - 1);
    graphics.clear();
    let keep = 0;
    for (const bolt of this.bolts) {
      const age = tick - bolt.tick;
      if (age > BOLT_TICKS || age < 0) continue;
      this.bolts[keep] = bolt;
      keep += 1;
      const alpha = 1 / Math.pow(1.75, age);
      // Flash's 1 px line under a 4 px glow.
      this.trace(bolt.path);
      graphics.stroke({ width: 4, color: RAISE_BOLT_COLOUR, alpha: 0.3 * alpha });
      this.trace(bolt.path);
      graphics.stroke({ width: 1, color: RAISE_BOLT_COLOUR, alpha });
    }
    this.bolts.length = keep;
  }

  private trace(path: readonly Point[]): void {
    const graphics = this.lightningGraphics;
    const [first, ...rest] = path;
    if (!first || !graphics) return;
    graphics.moveTo(first.x, first.y);
    for (const point of rest) graphics.lineTo(point.x, point.y);
  }
}
