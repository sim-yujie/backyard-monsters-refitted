import { Assets, Rectangle, Sprite, Texture, type Container } from "pixi.js";
import { TICKS_PER_SECOND, type BombStats } from "@/game/combat/rules";
import type { Point } from "@/game/yard/YardGrid";

/**
 * A resource bomb raining down, as the Flash client drew one (issue #87).
 *
 * `ResourceBomb` (`client/scripts/com/monsters/effects/ResourceBomb.as:120-130`)
 * spreads the bomb's particles — 200 twigs or pebbles, 25 to 50 blobs of
 * putty — at random points inside the blast, each `random * size / 2` from
 * the drop at a random angle, squashed to half height. `ResourceBombParticle`
 * (`ResourceBombParticle.as:99-152`) starts each one off the top of the stage,
 * 100 px to the right of where it lands and a stage height above, hidden;
 * after a delay of `1 + random * 4` s (putty: 1 s) it shows and falls in
 * `0.3 + random * 0.5` s with `Sine.easeIn`. On landing (`Hit`, `:166-225`)
 * the bomb deals the particle's share and the particle turns to debris on the
 * ground layer: a twig switches to its lying-down frame, a pebble plays the
 * 20-frame `pebblehit` dust, a putty blob the 14-frame splat, and the last
 * frame stays.
 *
 * Here the rain is picture only. The engine applies the whole bomb on the tick
 * it is fired and knows nothing of particles; the battle layer holds the hit
 * buildings' damage back and lets it go a share per landing ({@link BombFxHost.landed}).
 * Every clock is the battle tick, so 2x speed doubles the rain as it does
 * everything else. Randomness is `Math.random` unless a test hands in its own:
 * nothing here reaches the simulation. No sound (phase 1 has none).
 */

/** The four sheets under `/assets/effects/`. */
export type BombSheet = "twigs" | "pebble" | "pebblehit" | "putty";

const SHEET_URL: Readonly<Record<BombSheet, string>> = {
  twigs: "/assets/effects/twigs.png",
  pebble: "/assets/effects/pebble.png",
  pebblehit: "/assets/effects/pebblehit.png",
  putty: "/assets/effects/putty.png",
};

/** One cell of a sheet, in its pixels, and the point of it that sits on the drop. */
export interface BombCell {
  readonly sheet: BombSheet;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pivotX: number;
  readonly pivotY: number;
}

/** Where a particle comes from: 100 px right and a stage height up, on screen. */
export const FALL_OFFSET_X = 100;
export const FALL_HEIGHT = 700;

/** Battle ticks per frame of the landing animations: Flash's 40 fps `ENTER_FRAME`. */
export const ANIM_TICKS_PER_FRAME = 2;
export const PEBBLE_HIT_FRAMES = 20;
export const PUTTY_SPLAT_FRAMES = 14;

const TWIG = 1;
const PEBBLE = 2;

/** One particle of the rain, decided when the bomb is dropped. */
export interface BombParticlePlan {
  /** Where it lands, in world px. */
  readonly x: number;
  readonly y: number;
  /** Ticks after the drop it starts to fall, and ticks the fall takes. */
  readonly delay: number;
  readonly fall: number;
  /** The twig or pebble drawn falling: a column of its sheet; 0 for putty. */
  readonly shape: number;
  /** The row a pebble's dust or a putty splat plays along; a twig's shape again. */
  readonly variation: number;
}

/**
 * Where and when a bomb's particles fall (`ResourceBomb.as:122-129`,
 * `ResourceBombParticle.as:62-75, 112-129, 190, 204`). `at` is the drop in
 * world px; `random` draws in `[0, 1)`.
 */
export const planBombRain = (
  bomb: BombStats,
  at: Point,
  random: () => number = Math.random,
): BombParticlePlan[] => {
  const plans: BombParticlePlan[] = [];
  const count = Math.max(0, Math.trunc(bomb.particles));
  for (let index = 0; index < count; index += 1) {
    const angle = random() * 360 * 0.0174532925;
    const distance = Math.trunc((random() * bomb.radius) / 2);
    const x = at.x + Math.sin(angle) * distance;
    const y = at.y + Math.cos(angle) * distance * 0.5;
    const putty = bomb.resource !== TWIG && bomb.resource !== PEBBLE;
    const shape =
      bomb.resource === TWIG
        ? Math.trunc(random() * 5)
        : bomb.resource === PEBBLE
          ? Math.trunc(random() * 18)
          : 0;
    const fall = Math.round((0.3 + random() * 0.5) * TICKS_PER_SECOND);
    const delay = Math.round((putty ? 1 : 1 + random() * 4) * TICKS_PER_SECOND);
    const variation = bomb.resource === TWIG ? shape : Math.trunc(random() * 4);
    plans.push({ x, y, delay, fall, variation, shape });
  }
  return plans;
};

/** `Sine.easeIn`: slow off the mark, fastest on landing. */
export const sineEaseIn = (t: number): number =>
  1 - Math.cos((Math.min(1, Math.max(0, t)) * Math.PI) / 2);

/** The picture a falling particle shows. */
export const fallingCell = (resource: number, plan: BombParticlePlan): BombCell => {
  if (resource === TWIG) {
    return {
      sheet: "twigs",
      x: 24 * plan.shape,
      y: 0,
      width: 24,
      height: 30,
      pivotX: 12,
      pivotY: 15,
    };
  }
  if (resource === PEBBLE) {
    return {
      sheet: "pebble",
      x: 27 * plan.shape,
      y: 0,
      width: 27,
      height: 17,
      pivotX: 13,
      pivotY: 12,
    };
  }
  return { sheet: "putty", x: 0, y: 0, width: 81, height: 52, pivotX: 40, pivotY: 26 };
};

/**
 * The picture a landed particle shows `frame` animation frames after landing:
 * the twig lying down; the pebble's dust or the putty's splat, holding on the
 * last frame. Flash read putty rows 81 px apart on a sheet whose rows are 52
 * (`ResourceBombParticle.as:206, 252`), which cuts across two blobs for three
 * of the four rows; the rows are read where they are.
 */
export const landedCell = (
  resource: number,
  plan: BombParticlePlan,
  frame: number,
): BombCell => {
  if (resource === TWIG) {
    return {
      sheet: "twigs",
      x: 24 * plan.shape,
      y: 30,
      width: 24,
      height: 30,
      pivotX: 12,
      pivotY: 15,
    };
  }
  if (resource === PEBBLE) {
    const cell = Math.min(PEBBLE_HIT_FRAMES - 1, Math.max(0, frame));
    return {
      sheet: "pebblehit",
      x: 80 * cell,
      y: 85 * plan.variation,
      width: 80,
      height: 85,
      pivotX: 40,
      pivotY: 50,
    };
  }
  const cell = Math.min(PUTTY_SPLAT_FRAMES - 1, Math.max(0, frame));
  return {
    sheet: "putty",
    x: 81 * cell,
    y: 52 * plan.variation,
    width: 81,
    height: 52,
    pivotX: 40,
    pivotY: 26,
  };
};

/** The landing animation's last frame, which stays: none for a twig. */
const lastFrame = (resource: number): number =>
  resource === TWIG ? 0 : resource === PEBBLE ? PEBBLE_HIT_FRAMES - 1 : PUTTY_SPLAT_FRAMES - 1;

/** The sheets' textures: fetched on first ask, null until they are in. */
export interface BombArt {
  cell(cell: BombCell): Texture | null;
  destroy(): void;
}

/** {@link BombArt} over Pixi's `Assets`, one fetch per sheet and one framed texture per cell. */
export class BombSheetTextures implements BombArt {
  private readonly sources = new Map<BombSheet, Texture>();
  private readonly asked = new Set<BombSheet>();
  private readonly cells = new Map<string, Texture>();

  constructor(
    private readonly load: (url: string) => Promise<Texture> = (url) =>
      Assets.load<Texture>(url),
  ) {}

  cell(cell: BombCell): Texture | null {
    const key = `${cell.sheet}:${cell.x}:${cell.y}`;
    const cached = this.cells.get(key);
    if (cached) return cached;
    const source = this.source(cell.sheet);
    if (!source) return null;
    const texture = new Texture({
      source: source.source,
      frame: new Rectangle(cell.x, cell.y, cell.width, cell.height),
    });
    this.cells.set(key, texture);
    return texture;
  }

  destroy(): void {
    for (const texture of this.cells.values()) texture.destroy(false);
    this.cells.clear();
    this.sources.clear();
  }

  private source(sheet: BombSheet): Texture | null {
    const ready = this.sources.get(sheet);
    if (ready) return ready;
    if (this.asked.has(sheet)) return null;
    this.asked.add(sheet);
    this.load(SHEET_URL[sheet])
      .then((texture) => this.sources.set(sheet, texture))
      .catch((caught: unknown) => {
        // Asked once: a missing sheet leaves the rain invisible, not broken.
        console.warn(`Bomb sheet ${sheet} did not load.`, caught);
      });
    return null;
  }
}

/** What the rain needs from the battle layer. */
export interface BombFxHost {
  /** Above the buildings: where particles fall (Flash's `MAP._BUILDINGTOPS`). Asked on the first drop. */
  air(): Container;
  /** On the ground, under the buildings: where debris lies (`MAP._BUILDINGBASES`). */
  ground(): Container;
  /** One particle of bomb `key` has landed. */
  landed(key: number): void;
}

interface Particle {
  readonly plan: BombParticlePlan;
  readonly sprite: Sprite;
  landed: boolean;
  /** Landed, on its last frame and drawn: nothing left to do. */
  done: boolean;
  /** The cell on the sprite now, so an unchanged frame is not re-set. */
  cellKey: string;
}

interface Rain {
  readonly key: number;
  readonly resource: number;
  readonly tick: number;
  /** Where each particle starts, relative to where it lands: the stage top at drop-time zoom. */
  readonly startX: number;
  readonly startY: number;
  readonly particles: Particle[];
  /** Particles still to land. */
  airborne: number;
}

export interface BombFxOptions {
  readonly art?: BombArt;
  readonly random?: () => number;
  /** No fall and no dust: each particle appears as debris when it lands. */
  readonly reducedMotion?: boolean;
}

export class BombFx {
  private readonly host: BombFxHost;
  private readonly art: BombArt;
  private readonly random: () => number;
  private readonly reducedMotion: boolean;
  private readonly rains: Rain[] = [];
  private tick = 0;

  constructor(host: BombFxHost, options: BombFxOptions = {}) {
    this.host = host;
    this.art = options.art ?? new BombSheetTextures();
    this.random = options.random ?? Math.random;
    this.reducedMotion = options.reducedMotion ?? false;
  }

  /**
   * A bomb dropped at `at` (world px) on `tick`. `zoom` is the camera's then,
   * so the particles start off the top of the screen as Flash's did at its
   * fixed scale.
   */
  drop(key: number, bomb: BombStats, at: Point, tick: number, zoom = 1): void {
    const scale = 1 / Math.max(0.05, zoom);
    const rain: Rain = {
      key,
      resource: bomb.resource,
      tick,
      startX: FALL_OFFSET_X * scale,
      startY: -FALL_HEIGHT * scale,
      particles: [],
      airborne: 0,
    };
    for (const plan of planBombRain(bomb, at, this.random)) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.visible = false;
      sprite.eventMode = "none";
      this.host.air().addChild(sprite);
      rain.particles.push({ plan, sprite, landed: false, done: false, cellKey: "" });
    }
    rain.airborne = rain.particles.length;
    this.rains.push(rain);
    this.update(Math.max(this.tick, tick));
  }

  /** Particles not yet landed, over every bomb. */
  get airborne(): number {
    return this.rains.reduce((sum, rain) => sum + rain.airborne, 0);
  }

  /** Debris lying on the ground. */
  get debris(): number {
    return this.rains.reduce((sum, rain) => sum + (rain.particles.length - rain.airborne), 0);
  }

  /** Moves every particle to `tick`; a particle past its landing lands, once. */
  update(tick: number): void {
    this.tick = tick;
    for (const rain of this.rains) {
      for (const particle of rain.particles) {
        if (!particle.done) this.place(rain, particle, tick);
      }
    }
  }

  /** Lands everything still in the air, now: the attack is over and the clock has stopped. */
  settle(): void {
    for (const rain of this.rains) {
      for (const particle of rain.particles) {
        if (!particle.landed) this.place(rain, particle, Number.POSITIVE_INFINITY);
      }
    }
  }

  destroy(): void {
    for (const rain of this.rains) {
      for (const particle of rain.particles) particle.sprite.destroy();
    }
    this.rains.length = 0;
    this.art.destroy();
  }

  private place(rain: Rain, particle: Particle, tick: number): void {
    const { plan, sprite } = particle;
    const age = tick - rain.tick;
    const landsAt = plan.delay + plan.fall;
    if (!particle.landed && age < landsAt) {
      if (age < plan.delay || this.reducedMotion) {
        sprite.visible = false;
        return;
      }
      const eased = sineEaseIn((age - plan.delay) / plan.fall);
      this.show(particle, fallingCell(rain.resource, plan));
      sprite.position.set(
        plan.x + rain.startX * (1 - eased),
        plan.y + rain.startY * (1 - eased),
      );
      return;
    }
    if (!particle.landed) {
      particle.landed = true;
      rain.airborne -= 1;
      sprite.parent?.removeChild(sprite);
      this.host.ground().addChild(sprite);
      sprite.position.set(plan.x, plan.y);
      this.host.landed(rain.key);
    }
    const frame = this.reducedMotion
      ? Number.POSITIVE_INFINITY
      : Math.floor((age - landsAt) / ANIM_TICKS_PER_FRAME);
    const shown = this.show(particle, landedCell(rain.resource, plan, frame));
    particle.done = shown && frame >= lastFrame(rain.resource);
  }

  /** Puts a cell on the particle; false while its sheet is still on the way. */
  private show(particle: Particle, cell: BombCell): boolean {
    const key = `${cell.sheet}:${cell.x}:${cell.y}`;
    if (particle.cellKey !== key) {
      const texture = this.art.cell(cell);
      if (!texture) {
        // Not in yet: try again next frame.
        particle.sprite.visible = false;
        return false;
      }
      particle.cellKey = key;
      particle.sprite.texture = texture;
      particle.sprite.pivot.set(cell.pivotX, cell.pivotY);
    }
    particle.sprite.visible = true;
    return true;
  }
}
