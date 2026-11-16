import { Assets, Graphics, Sprite, Texture, type ColorMatrix, type Container } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";

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
 *   1 s. On a quarter of its loops a green (`0x00FF00`) `EFFECTS.Lightning`
 *   jumps from a random point on it to the closest monster within 125 px (with
 *   a chance that falls with the distance), or to another random point on it.
 *   Flash's `Targeting.getClosestEnemy(…, k_TARGETS_ALL)` despite its name
 *   takes the closest creep of EITHER side, Rezghul and its army included
 *   (`Targeting.as:73-82, 403-414`); a building closer than any creep gives
 *   none. The buildings are left out here.
 *   Its picture, `monsters/projectiles/rezghul_projectile.png`, never shipped,
 *   so Flash fell back to the orange fireball; the owner asked for Rezghul's
 *   own orb instead (12 Nov 2026), painted in both looks.
 * - **The rise** (`RezghulResurrectAttack.resurrect`, `:71-89`): an
 *   `EFFECTS.Dig` and `GIBLETS` 20 px below the corpse, and the new monster's
 *   graphic tweening up from 20 px below its feet over 0.8 s on `Sine.easeOut`.
 * - **The zombie** (`Zombiefy.as:26-53`): TweenMax takes its graphic's
 *   saturation from 1 to 0 over 1 s, and on a tenth of its loops a green
 *   `EFFECTS.Lightning` jumps between two random points round its feet.
 * - **`EFFECTS.Lightning`** (`EFFECTS.as:112-142`): a 1 px line with a corner
 *   every 30 px, each thrown up to 7 px off, glowing 4 px, drawn additively,
 *   gone in three ticks.
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

/* ── Pictures ───────────────────────────────────────────────────────────── */

/** Rezghul's orb, painted for the owner (12 Nov 2026): the Classic one at Flash's own path. */
export const ORB_URL_CLASSIC = "/assets/monsters/projectiles/rezghul_projectile@2x.png";
export const ORB_URL_MODERN = "/assets/monsters/projectiles/rezghul_projectile.modern@2x.png";

/** The glow's colour: Flash's white; the Modern look tints it the orb's sea-green. */
const GLOW_CLASSIC = 0xffffff;
const GLOW_MODERN = 0xc8ffe6;

/* ── The effect ─────────────────────────────────────────────────────────── */

/** An orb in the air: its own `raiseOrb` event, in world px. */
interface Flight {
  readonly tick: number;
  readonly landTick: number;
  readonly creepId: number;
  readonly from: Point;
  readonly to: Point;
  readonly glow: Graphics;
  readonly sprite: Sprite;
  /** The last tick it threw (or did not throw) a spark on. */
  sparkTick: number;
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

/**
 * Rezghul's orbs in flight and the green lightning round them and round its
 * zombies, all in one layer above the creeps (Flash's `MAP._PROJECTILES`).
 */
export class RaiseFx {
  private readonly flights: Flight[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly lightning = new Graphics();
  private readonly zombieSparkTick = new Map<number, number>();
  private texture: Texture | null = null;
  private asked = false;

  constructor(
    private readonly layer: () => Container,
    private readonly classic: boolean,
    private readonly reducedMotion = false,
    private readonly load: (url: string) => Promise<Texture> = (url) =>
      Assets.load<Texture>(url),
  ) {
    this.lightning.eventMode = "none";
    this.lightning.blendMode = "add";
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
    const glow = new Graphics();
    const colour = this.classic ? GLOW_CLASSIC : GLOW_MODERN;
    // A soft halo: Flash's 9 px blur, as rings fading out from the orb's edge.
    glow.circle(0, 0, ORB_HALF + 5).fill({ color: colour, alpha: 0.18 });
    glow.circle(0, 0, ORB_HALF + 3).fill({ color: colour, alpha: 0.3 });
    glow.circle(0, 0, ORB_HALF + 1).fill({ color: colour, alpha: 0.45 });
    glow.eventMode = "none";
    glow.alpha = 0;
    // Until the picture is in, the glow flies alone.
    const sprite = new Sprite(this.texture ?? Texture.EMPTY);
    sprite.visible = this.texture !== null;
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    const layer = this.layer();
    layer.addChild(glow, sprite);
    if (!this.lightning.parent) layer.addChild(this.lightning);
    else layer.setChildIndex(this.lightning, layer.children.length - 1);
    this.flights.push({ tick, landTick, creepId, from, to, glow, sprite, sparkTick: tick - 1 });
  }

  /** Orbs in the air, for tests. */
  get flightCount(): number {
    return this.flights.length;
  }

  /** Lightning bolts showing, for tests. */
  get boltCount(): number {
    return this.bolts.length;
  }

  /**
   * Moves the orbs to `tick`, drops the landed ones, throws this tick's
   * sparks off the orbs and the `zombies`, and redraws the lightning.
   */
  update(tick: number, creepNear: CreepNear, zombies: Iterable<ZombieAt>): void {
    let keep = 0;
    for (const flight of this.flights) {
      if (tick >= flight.landTick) {
        flight.glow.destroy();
        flight.sprite.destroy();
        continue;
      }
      this.flights[keep] = flight;
      keep += 1;
      const age = Math.max(0, tick - flight.tick);
      const centre = orbCentre(flight.from, flight.to, age, flight.landTick - flight.tick);
      flight.sprite.position.set(Math.round(centre.x), Math.round(centre.y));
      flight.glow.position.set(centre.x, centre.y);
      flight.glow.alpha = orbGlowAlpha(age);
      for (let at = flight.sparkTick + 1; at <= tick; at += 1)
        this.orbSpark(flight, at, centre, creepNear);
      flight.sparkTick = tick;
    }
    this.flights.length = keep;

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
    for (const flight of this.flights) {
      flight.glow.destroy();
      flight.sprite.destroy();
    }
    this.flights.length = 0;
    this.bolts.length = 0;
    this.lightning.destroy();
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
    const graphics = this.lightning;
    graphics.clear();
    let keep = 0;
    for (const bolt of this.bolts) {
      const age = tick - bolt.tick;
      if (age > BOLT_TICKS || age < 0) continue;
      this.bolts[keep] = bolt;
      keep += 1;
      const alpha = 1 / Math.pow(1.75, age);
      // The 4 px glow, then the line: Flash's 1 px; the Modern look a little bolder.
      this.trace(bolt.path);
      graphics.stroke({
        width: this.classic ? 4 : 5,
        color: RAISE_BOLT_COLOUR,
        alpha: 0.3 * alpha,
      });
      this.trace(bolt.path);
      graphics.stroke({
        width: this.classic ? 1 : 1.5,
        color: this.classic ? RAISE_BOLT_COLOUR : 0xd8ffd8,
        alpha,
      });
    }
    this.bolts.length = keep;
  }

  private trace(path: readonly Point[]): void {
    const [first, ...rest] = path;
    if (!first) return;
    this.lightning.moveTo(first.x, first.y);
    for (const point of rest) this.lightning.lineTo(point.x, point.y);
  }
}
