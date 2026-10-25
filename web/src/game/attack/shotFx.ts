import { Assets, Rectangle, Sprite, Texture, TilingSprite, type Container } from "pixi.js";
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
 * Under the cells the sheet holds long strips, laid from one end of a line to
 * the other: the Tesla's painted bolts (each with its bright core cut out of it
 * as a strip of its own) and a ray of light, which the beams stack at several
 * widths and tints. A strip is drawn for one frame only ({@link ShotFx.line}):
 * whoever wants it again draws it again, after {@link ShotFx.begin}.
 *
 * Beside the sheet, two flows: paintings that repeat end to end (a laser's
 * plasma, a railgun's spiral), laid along a line and slid along it every frame
 * so the light seems to stream ({@link ShotFx.flow}). Each is its own small
 * image, so it can repeat.
 *
 * Until the sheet is in, nothing is drawn: the caller's code-drawn lines still
 * show the shot.
 */

/** The sheet: twenty 192 px cells, four across, then the strips (`server/public/assets/fx/`). */
export const SHOT_FX_SHEET_URL = "/assets/fx/tower-fx.png";
export const SHOT_FX_CELL = 192;
const COLUMNS = 4;
/** A strip's size on the sheet, two across under the cells. */
export const SHOT_STRIP_WIDTH = 384;
export const SHOT_STRIP_HEIGHT = 96;
const STRIP_COLUMNS = 2;

/**
 * The cells, in the sheet's order. `muzzle`, `spark`, `rifleflash` (a
 * rifle's star of a flash), `ricochet` (a spray of sparks out of a hit),
 * `shell` (a flak shell with its comet of flame) and `aaflash` (a flak gun's
 * fat blast with its ring of gas) point right, their hot point or nose
 * toward one end; `debris` (a fountain of dirt) rises from its bottom middle.
 * `scorch` is dark, `flak` (a flak shell's burst cloud) and `debris` mid
 * grey; `shrapnel` is streaks flying out of an empty middle; `fireball` is a
 * shaded ball of flame, for drawing unlit.
 */
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
  "flak",
  "shrapnel",
  "rifleflash",
  "ricochet",
  "debris",
  "shell",
  "fireball",
  "aaflash",
] as const;
export type ShotLook = (typeof SHOT_LOOKS)[number];
/** Where the strips start: under the cells' last row. */
const STRIP_TOP = SHOT_FX_CELL * Math.ceil(SHOT_LOOKS.length / COLUMNS);

/** The painted lightning bolts, each a zigzag lying left to right with its forks. */
export const BOLT_COUNT = 6;
/**
 * The strips, in the sheet's order: the bolts, then each bolt's bright core,
 * then the ray (a straight stroke of light, soft each side, tapered at the ends),
 * the streak (a lens-flare flash: a hot spot with a long thin streak through it),
 * the bullet (a rifle round's hot head and shock cone at the right end, its tail
 * fading out to the left) and the vapour (a thread of smoke, tight at the right
 * end, widening and breaking up to the left).
 */
export const STRIP_LOOKS = [
  "bolt1", "bolt2", "bolt3", "bolt4", "bolt5", "bolt6",
  "core1", "core2", "core3", "core4", "core5", "core6",
  "ray", "streak", "bullet", "vapour",
] as const;
export type StripLook = (typeof STRIP_LOOKS)[number];

/** The `index`th bolt (any whole number, wrapped), or its core. */
export const boltLook = (index: number, core = false): StripLook => {
  const which = (((Math.trunc(index) % BOLT_COUNT) + BOLT_COUNT) % BOLT_COUNT) + 1;
  return `${core ? "core" : "bolt"}${which}` as StripLook;
};

/** The flows, each its own image so it can repeat: 512 x 64, lying left to right. */
export const FLOW_LOOKS = ["energy", "helix"] as const;
export type FlowLook = (typeof FLOW_LOOKS)[number];
export const flowUrl = (look: FlowLook): string => `/assets/fx/tower-fx-${look}.png`;
/** A flow image's painted height, px: its repeat is laid at the line's width. */
const FLOW_HEIGHT = 64;

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

/** A strip laid along a line for one frame. */
export interface LineSpec {
  readonly look: StripLook;
  readonly from: Point;
  readonly to: Point;
  /** Across the line, world px: the strip's whole painted height. */
  readonly width: number;
  readonly alpha: number;
  readonly tint: number;
  /** Turned over the line, so one painting makes two bolts. */
  readonly flip?: boolean;
}

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

/** A flow laid along a line for one frame, slid `offset` world px along it. */
export interface FlowSpec extends Omit<LineSpec, "look" | "flip"> {
  readonly look: FlowLook;
  readonly offset: number;
  /** How much longer than its painted shape one repeat is laid, 1 by default. */
  readonly stretch?: number;
}

export class ShotFx {
  private readonly bits: Bit[] = [];
  private readonly pool: Sprite[] = [];
  private readonly lamps = new Map<object, Sprite>();
  private readonly lit = new Set<object>();
  /** Strips and spots drawn this frame, given back by the next {@link begin}. */
  private readonly drawn: Sprite[] = [];
  private readonly flowPool: TilingSprite[] = [];
  private readonly flowsDrawn: TilingSprite[] = [];
  private readonly flows = new Map<FlowLook, Texture>();
  private readonly cells = new Map<ShotLook | StripLook, Texture>();
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
    // Phones on low effects never lay a flow, so never fetch one.
    if (this.low) return;
    for (const look of FLOW_LOOKS) {
      this.load(flowUrl(look))
        .then((texture) => {
          texture.source.addressMode = "repeat";
          this.flows.set(look, texture);
        })
        .catch((caught: unknown) => {
          // Without it the beam is only its rays.
          console.warn(`Tower effect ${look} did not load.`, caught);
        });
    }
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

  /** A new frame: last frame's strips and spots go, to be drawn again if still wanted. */
  begin(): void {
    for (const sprite of this.drawn) this.release(sprite);
    this.drawn.length = 0;
    for (const tiles of this.flowsDrawn) {
      tiles.visible = false;
      tiles.parent?.removeChild(tiles);
      this.flowPool.push(tiles);
    }
    this.flowsDrawn.length = 0;
  }

  /** Lays a strip from `from` to `to` for this frame, in added light; false before the sheet is in. */
  line(spec: LineSpec): boolean {
    const length = Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y);
    if (spec.alpha <= 0.01 || length < 1) return true;
    const sprite = this.paint(spec.look, spec.alpha, spec.tint);
    if (!sprite) return false;
    sprite.position.set((spec.from.x + spec.to.x) / 2, (spec.from.y + spec.to.y) / 2);
    sprite.rotation = Math.atan2(spec.to.y - spec.from.y, spec.to.x - spec.from.x);
    sprite.width = length;
    sprite.height = spec.width;
    if (spec.flip) sprite.scale.y = -sprite.scale.y;
    return true;
  }

  /**
   * Lays a flow from `from` to `to` for this frame, in added light, its
   * painting repeated along the line and slid `offset` world px down it; false
   * until its image is in (never, on low effects).
   */
  flow(spec: FlowSpec): boolean {
    const texture = this.flows.get(spec.look);
    if (!texture || !this.sheet) return false;
    const length = Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y);
    if (spec.alpha <= 0.01 || length < 1 || spec.width < 0.5) return true;
    const tiles = this.flowPool.pop() ?? this.makeFlow(texture);
    tiles.texture = texture;
    tiles.visible = true;
    tiles.alpha = Math.min(1, spec.alpha);
    tiles.tint = spec.tint;
    tiles.position.set((spec.from.x + spec.to.x) / 2, (spec.from.y + spec.to.y) / 2);
    tiles.rotation = Math.atan2(spec.to.y - spec.from.y, spec.to.x - spec.from.x);
    tiles.width = length;
    tiles.height = spec.width;
    const scale = spec.width / FLOW_HEIGHT;
    tiles.tileScale.set(scale * (spec.stretch ?? 1), scale);
    // Measured from the line's start, so the light runs from `from` toward `to`.
    tiles.tilePosition.set(spec.offset, 0);
    this.layer.addChild(tiles);
    this.flowsDrawn.push(tiles);
    return true;
  }

  /** Flows on screen this frame, for tests. */
  get flowCount(): number {
    return this.flowsDrawn.length;
  }

  /** A cell held on a point for this frame only, in added light: a gun-ball, a glow at a beam's end. */
  spot(spec: LampSpec): boolean {
    if (spec.alpha <= 0.01) return true;
    const sprite = this.paint(spec.look, spec.alpha, spec.tint);
    if (!sprite) return false;
    sprite.rotation = spec.rotation ?? 0;
    sprite.position.set(spec.at.x, spec.at.y);
    sprite.width = spec.size;
    sprite.height = spec.size * (spec.squash ?? 1);
    return true;
  }

  /** Strips and spots on screen this frame, for tests. */
  get drawnCount(): number {
    return this.drawn.length;
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
    this.begin();
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
    for (const tiles of this.flowPool) tiles.destroy();
    this.flowPool.length = 0;
    for (const texture of this.cells.values()) texture.destroy(false);
    this.cells.clear();
  }

  private cell(look: ShotLook | StripLook): Texture | null {
    this.preload();
    const sheet = this.sheet;
    if (!sheet) return null;
    let texture = this.cells.get(look);
    if (!texture) {
      texture = new Texture({ source: sheet.source, frame: frameOf(look) });
      this.cells.set(look, texture);
    }
    return texture;
  }

  /** A pooled sprite in added light for this frame, or null before the sheet is in. */
  private paint(look: ShotLook | StripLook, alpha: number, tint: number): Sprite | null {
    const texture = this.cell(look);
    if (!texture) return null;
    const sprite = this.pool.pop() ?? this.makeSprite();
    sprite.texture = texture;
    sprite.blendMode = "add";
    sprite.visible = true;
    sprite.alpha = Math.min(1, alpha);
    sprite.tint = tint;
    sprite.scale.set(1);
    this.layer.addChild(sprite);
    this.drawn.push(sprite);
    return sprite;
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

  private makeFlow(texture: Texture): TilingSprite {
    const tiles = new TilingSprite({ texture, width: 1, height: 1 });
    tiles.anchor.set(0.5);
    tiles.blendMode = "add";
    tiles.eventMode = "none";
    return tiles;
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

/** Where a cell or a strip sits on the sheet. */
const frameOf = (look: ShotLook | StripLook): Rectangle => {
  const cell = SHOT_LOOKS.indexOf(look as ShotLook);
  if (cell >= 0) {
    return new Rectangle(
      (cell % COLUMNS) * SHOT_FX_CELL,
      Math.floor(cell / COLUMNS) * SHOT_FX_CELL,
      SHOT_FX_CELL,
      SHOT_FX_CELL,
    );
  }
  const strip = STRIP_LOOKS.indexOf(look as StripLook);
  return new Rectangle(
    (strip % STRIP_COLUMNS) * SHOT_STRIP_WIDTH,
    STRIP_TOP + Math.floor(strip / STRIP_COLUMNS) * SHOT_STRIP_HEIGHT,
    SHOT_STRIP_WIDTH,
    SHOT_STRIP_HEIGHT,
  );
};
