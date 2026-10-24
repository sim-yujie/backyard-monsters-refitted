import { Assets, Rectangle, Sprite, Texture, type Container } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";
import { bitPath, tintAt } from "./blastFx";

/**
 * The painted bits of the towers' shots (beta.5 tower attack effects): glows,
 * flares, muzzle flashes, sparks, impact bursts, electric zaps, smoke and
 * rings, each a cell of one sheet painted by the image model in greyscale on a
 * key colour and tinted here. Drawing only: nothing here reaches the battle,
 * its damage, targeting or replay.
 *
 * Two kinds of sprite:
 * - bits: thrown once (a spark, a puff), pooled, and placed from their age
 *   alone, as `BlastFx` places its own, so 1x, 2x and a replay draw the same;
 * - lamps: a glow held on a point while something lasts (a Tesla's coil while
 *   it charges, a Railgun winding up), drawn again every frame they are wanted
 *   and taken away by the first sweep they are not.
 *
 * Until the sheet is in, nothing is drawn: the caller's code-drawn lines still
 * show the shot.
 */

/** The sheet: twelve 192 px cells, four across (`server/public/assets/fx/`). */
export const SHOT_FX_SHEET_URL = "/assets/fx/tower-fx.png";
export const SHOT_FX_CELL = 192;
const COLUMNS = 4;

/** The cells, in the sheet's order. `muzzle` and `spark` point right; `scorch` is dark. */
export const SHOT_LOOKS = [
  "glow",
  "flare",
  "muzzle",
  "spark",
  "burst",
  "zap",
  "smoke",
  "wisp",
  "ring",
  "orb",
  "beam",
  "scorch",
] as const;
export type ShotLook = (typeof SHOT_LOOKS)[number];

/** Bits alive at once in full; the cost ceiling with every tower firing. */
export const MAX_SHOT_BITS = 240;
/** The same on low effects (phones, or the player's choice). */
export const LOW_SHOT_BITS = 90;
/** The share of a burst's extra bits low effects keep. */
const LOW_SHARE = 0.4;

interface Bit {
  readonly sprite: Sprite;
  readonly look: ShotLook;
  readonly born: number;
  readonly life: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly drag: number;
  readonly gravity: number;
  readonly size0: number;
  readonly size1: number;
  /** Height as a share of width: 0.5 lays a ring flat on the ground. */
  readonly squash: number;
  readonly fadeIn: number;
  readonly peak: number;
  readonly hold: number;
  readonly colours: readonly number[];
  readonly rotation: number;
  readonly spin: number;
  /** Drawn long along its flight, turned to face it: a spark. */
  readonly stretch: boolean;
  readonly easeOut: boolean;
}

/** A bit to throw; everything but its look and where it starts has a default. */
export type ShotSpec = Partial<Omit<Bit, "sprite" | "born" | "x" | "y">> & {
  readonly look: ShotLook;
  readonly at: Point;
  readonly delay?: number;
  /** Light adds to what is under it (glows, sparks); smoke and scorch do not. */
  readonly add?: boolean;
};

export interface LampSpec {
  readonly look: ShotLook;
  readonly at: Point;
  /** Width in world px; height is `squash` of it. */
  readonly size: number;
  readonly alpha: number;
  readonly tint: number;
  readonly rotation?: number;
  readonly squash?: number;
}

export class ShotFx {
  private readonly bits: Bit[] = [];
  private readonly pool: Sprite[] = [];
  private readonly lamps = new Map<object, Sprite>();
  private readonly lit = new Set<object>();
  private readonly cells = new Map<ShotLook, Texture>();
  private sheet: Texture | null = null;
  private asked = false;
  private readonly cap: number;

  constructor(
    private readonly layer: Container,
    private readonly low = false,
    private readonly load: (url: string) => Promise<Texture> = (url) => Assets.load<Texture>(url),
  ) {
    this.cap = low ? LOW_SHOT_BITS : MAX_SHOT_BITS;
  }

  /** Bits alive, for tests and the frame-rate check. */
  get bitCount(): number {
    return this.bits.length;
  }

  /** Whether the sheet is in, so bits are drawn at all. */
  get ready(): boolean {
    return this.sheet !== null;
  }

  /** Starts the sheet's fetch, once. */
  preload(): void {
    if (this.asked) return;
    this.asked = true;
    this.load(SHOT_FX_SHEET_URL)
      .then((texture) => {
        this.sheet = texture;
      })
      .catch((caught: unknown) => {
        // Asked once: the shots keep their code-drawn lines.
        console.warn("Tower effects sheet did not load.", caught);
      });
  }

  /**
   * How many of `count` extra bits to throw: fewer on low effects, and half
   * again once the yard is busy, so the cap is met by thinning, not by
   * dropping whole bursts.
   */
  many(count: number): number {
    const busy = this.bits.length > this.cap / 2 ? 0.5 : 1;
    return Math.max(1, Math.round(count * busy * (this.low ? LOW_SHARE : 1)));
  }

  /** Throws one bit; false at the cap or before the sheet is in. */
  emit(tick: number, spec: ShotSpec): boolean {
    const texture = this.cell(spec.look);
    if (!texture || this.bits.length >= this.cap) return false;
    const sprite = this.pool.pop() ?? this.makeSprite();
    sprite.texture = texture;
    sprite.blendMode = spec.add ? "add" : "normal";
    sprite.visible = false;
    this.layer.addChild(sprite);
    this.bits.push({
      sprite,
      look: spec.look,
      born: tick + (spec.delay ?? 0),
      life: spec.life ?? 12,
      x: spec.at.x,
      y: spec.at.y,
      z: spec.z ?? 0,
      vx: spec.vx ?? 0,
      vy: spec.vy ?? 0,
      vz: spec.vz ?? 0,
      drag: spec.drag ?? 0,
      gravity: spec.gravity ?? 0,
      size0: spec.size0 ?? 16,
      size1: spec.size1 ?? spec.size0 ?? 16,
      squash: spec.squash ?? 1,
      fadeIn: spec.fadeIn ?? 0,
      peak: spec.peak ?? 1,
      hold: spec.hold ?? 0,
      colours: spec.colours ?? [0xffffff],
      rotation: spec.rotation ?? 0,
      spin: spec.spin ?? 0,
      stretch: spec.stretch ?? false,
      easeOut: spec.easeOut ?? false,
    });
    return true;
  }

  /** Holds a glow on `key` this frame; one the next {@link update} does not see again goes. */
  lamp(key: object, spec: LampSpec): void {
    const texture = this.cell(spec.look);
    if (!texture) return;
    let sprite = this.lamps.get(key);
    if (!sprite) {
      sprite = this.pool.pop() ?? this.makeSprite();
      sprite.blendMode = "add";
      this.layer.addChild(sprite);
      this.lamps.set(key, sprite);
    }
    sprite.texture = texture;
    sprite.visible = spec.alpha > 0;
    sprite.alpha = Math.min(1, Math.max(0, spec.alpha));
    sprite.tint = spec.tint;
    sprite.rotation = spec.rotation ?? 0;
    sprite.position.set(spec.at.x, spec.at.y);
    sprite.width = spec.size;
    sprite.height = spec.size * (spec.squash ?? 1);
    this.lit.add(key);
  }

  /** Places every bit for `tick` and takes away the lamps not lit since the last call. */
  update(tick: number): void {
    let keep = 0;
    for (const bit of this.bits) {
      const age = tick - bit.born;
      if (age > bit.life) {
        this.release(bit.sprite);
        continue;
      }
      this.bits[keep] = bit;
      keep += 1;
      this.drawBit(bit, age);
    }
    this.bits.length = keep;

    for (const [key, sprite] of this.lamps) {
      if (this.lit.has(key)) continue;
      this.release(sprite);
      this.lamps.delete(key);
    }
    this.lit.clear();
  }

  /** Every bit and lamp gone: the battle stood down. */
  clear(): void {
    for (const bit of this.bits) this.release(bit.sprite);
    this.bits.length = 0;
    this.lit.clear();
    for (const sprite of this.lamps.values()) sprite.destroy();
    this.lamps.clear();
  }

  destroy(): void {
    this.clear();
    for (const sprite of this.pool) sprite.destroy();
    this.pool.length = 0;
    for (const texture of this.cells.values()) texture.destroy(false);
    this.cells.clear();
  }

  private cell(look: ShotLook): Texture | null {
    this.preload();
    const sheet = this.sheet;
    if (!sheet) return null;
    let texture = this.cells.get(look);
    if (!texture) {
      const index = SHOT_LOOKS.indexOf(look);
      texture = new Texture({
        source: sheet.source,
        frame: new Rectangle(
          (index % COLUMNS) * SHOT_FX_CELL,
          Math.floor(index / COLUMNS) * SHOT_FX_CELL,
          SHOT_FX_CELL,
          SHOT_FX_CELL,
        ),
      });
      this.cells.set(look, texture);
    }
    return texture;
  }

  private drawBit(bit: Bit, age: number): void {
    const { sprite } = bit;
    if (age < 0) {
      sprite.visible = false;
      return;
    }
    const t = age / bit.life;
    const path = bitPath(bit, age);
    const grow = bit.easeOut ? 1 - (1 - t) * (1 - t) * (1 - t) : t;
    const size = bit.size0 + (bit.size1 - bit.size0) * grow;
    let alpha = bit.peak;
    if (bit.fadeIn > 0 && age < bit.fadeIn) alpha *= age / bit.fadeIn;
    if (t > bit.hold) alpha *= Math.max(0, 1 - (t - bit.hold) / (1 - bit.hold));
    sprite.visible = alpha > 0.01;
    sprite.alpha = alpha;
    sprite.tint = tintAt(bit.colours, t);
    sprite.position.set(path.x, path.y - path.z);
    if (bit.stretch) {
      const slow = Math.max(0.0001, Math.pow(1 - bit.drag, age));
      const vx = bit.vx * slow;
      const vy = bit.vy * slow - (bit.vz - bit.gravity * age);
      sprite.rotation = Math.atan2(vy, vx);
      sprite.width = size * (1.4 + Math.min(3, Math.hypot(vx, vy) * 0.5));
      sprite.height = size * 0.5;
      return;
    }
    sprite.rotation = bit.rotation + bit.spin * age;
    sprite.width = size;
    sprite.height = size * bit.squash;
  }

  private makeSprite(): Sprite {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    return sprite;
  }

  private release(sprite: Sprite): void {
    sprite.visible = false;
    sprite.parent?.removeChild(sprite);
    this.pool.push(sprite);
  }
}
