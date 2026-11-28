import type { Container} from "pixi.js";
import { Assets, Rectangle, Sprite, Texture, TilingSprite } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";
import { artUrl } from "../../artUrl";
import { bitPath, tintAt } from "./blastFx";

/**
 * The painted pieces of Gorgo's, Drull's and Fomor's abilities (owner, desk
 * card mm-abilities2, 28 Nov 2026: "the animations aren't good at all"):
 * stone, rock chips, ground cracks, dirt, acid, blood, fangs, a target mark,
 * a daze star, a soap bubble, mist, a healing cross, a shockwave, a bubble's
 * pop, a slash, and six of the towers' own painted bits (smoke, debris, a
 * ring, a cloud, a glow, a burst). Each is a cell of one sheet per look,
 * painted by the image model (prompts and `build_atlas.py` in `art-samples/ability-fx`): the Modern
 * sheet in the clean 3D look, the Classic one in Flash's grainy pre-render.
 *
 * Every piece is a pooled sprite placed from its age alone, as the towers'
 * {@link ShotFx} bits are, so 1x, 2x and a replay draw the same. Drawing only:
 * nothing here reaches the battle.
 *
 * Until the sheet is in, nothing is drawn; the rings and words the battle
 * layer draws for each ability still show.
 */

/** The cells, in the sheet's order: 192 px each, six across. */
export const ABILITY_CELLS = [
  "stone",
  "shard",
  "pebbles",
  "crack",
  "clods",
  "glob",
  "splat",
  "drops",
  "blood",
  "fangs",
  "reticle",
  "star",
  "bubble",
  "mist",
  "plus",
  "shock",
  "pop",
  "slash",
  "smoke",
  "debris",
  "ring",
  "wisp",
  "glow",
  "burst",
] as const;
export type AbilityCell = (typeof ABILITY_CELLS)[number];

/**
 * Another sheet of named cells in the same 192 px grid (the mm-anim bake-off,
 * 28 Nov 2026: a designer model's own pieces, `fxSets.ts`). A cell name not
 * on it draws nothing.
 */
export interface AbilityAtlas {
  readonly url: (classic: boolean) => string;
  readonly cells: readonly string[];
  readonly columns: number;
}
export const ABILITY_CELL = 192;
const COLUMNS = 6;

/** The sheet for the look: `server/public/assets/fx/ability-fx.<look>.webp`. */
export const abilitySheetUrl = (classic: boolean): string =>
  artUrl(`/assets/fx/ability-fx.${classic ? "classic" : "modern"}.webp`);

/** Pieces alive at once; the cost ceiling with several champions fighting. */
export const MAX_ABILITY_BITS = 220;
/** The same on low effects (phones, or the player's choice). */
export const LOW_ABILITY_BITS = 70;
/** The share of a burst's extra pieces low effects keep. */
const LOW_SHARE = 0.4;

interface Bit {
  readonly sprite: Sprite;
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
  readonly squash: number;
  readonly fadeIn: number;
  readonly peak: number;
  readonly hold: number;
  readonly colours: readonly number[];
  readonly rotation: number;
  readonly spin: number;
  readonly easeOut: boolean;
  /** Follows a point that moves (a creep), added to its path; null for none. */
  readonly follow: (() => Point | null) | null;
  /** Flies from where it starts to `to` along an arc `arc` px high, over its life. */
  readonly to: (() => Point | null) | null;
  readonly arc: number;
  /** A flipbook: these cells over its life (or every `frameTicks` ticks, looping). */
  readonly frames: readonly string[] | null;
  readonly frameTicks: number;
}

/** A piece to throw; everything but its cell and where it starts has a default. */
export interface AbilityBitSpec {
  readonly cell: AbilityCell | (string & {});
  readonly at: Point;
  readonly delay?: number;
  readonly life?: number;
  /** Height over the ground point, px. */
  readonly z?: number;
  readonly vx?: number;
  readonly vy?: number;
  readonly vz?: number;
  readonly drag?: number;
  readonly gravity?: number;
  /** Width at birth and at death, px; height is `squash` of it. */
  readonly size0?: number;
  readonly size1?: number;
  readonly squash?: number;
  readonly fadeIn?: number;
  readonly peak?: number;
  /** Share of its life it holds full before fading. */
  readonly hold?: number;
  readonly colours?: readonly number[];
  readonly rotation?: number;
  readonly spin?: number;
  readonly easeOut?: boolean;
  /** Light adds to what is under it (glows, mist); solid pieces do not. */
  readonly add?: boolean;
  /** Laid on the ground, under every creep and building (cracks, splats). */
  readonly ground?: boolean;
  /** Rides along with a moving point: `at` is then an offset from it. */
  readonly follow?: () => Point | null;
  /** Flies to this point over its life (a spit, a blood drop), `arc` px high at its top. */
  readonly to?: () => Point | null;
  readonly arc?: number;
  /** A flipbook: these cells over its life (`cell` is then only the first). */
  readonly frames?: readonly string[];
  /** With `frames`: ticks per frame, looping; 0 or none spreads them over the life once. */
  readonly frameTicks?: number;
}

/** A piece held on a point for this frame only. */
export interface AbilitySpot {
  readonly cell: AbilityCell | (string & {});
  readonly at: Point;
  /** Width, px; height is `squash` of it. */
  readonly size: number;
  readonly alpha: number;
  readonly tint?: number;
  readonly rotation?: number;
  readonly squash?: number;
  readonly add?: boolean;
  readonly ground?: boolean;
}

export interface AbilityBitLayers {
  /** Over the creeps and buildings. */
  readonly air: Container;
  /** On the ground, under them; fetched when first wanted. */
  readonly ground: () => Container;
}

export class AbilityBits {
  private readonly bits: Bit[] = [];
  private readonly pool: Sprite[] = [];
  private readonly drawn: Sprite[] = [];
  private readonly cells = new Map<string, Texture>();
  private sheet: Texture | null = null;
  private asked = false;
  private readonly cap: number;

  constructor(
    private readonly layers: AbilityBitLayers,
    private readonly classic = false,
    private readonly low = false,
    private readonly load: (url: string) => Promise<Texture> = (url) => Assets.load<Texture>(url),
    private readonly atlas: AbilityAtlas | null = null,
  ) {
    this.cap = low ? LOW_ABILITY_BITS : MAX_ABILITY_BITS;
  }

  get ready(): boolean {
    return this.sheet !== null;
  }

  get bitCount(): number {
    return this.bits.length;
  }

  get drawnCount(): number {
    return this.drawn.length;
  }

  /** Low effects: fewer pieces per burst, and no stone over Gorgo's body. */
  get lowEffects(): boolean {
    return this.low;
  }

  /** Starts the sheet's fetch, once. */
  preload(): void {
    if (this.asked) return;
    this.asked = true;
    this.load(this.atlas ? this.atlas.url(this.classic) : abilitySheetUrl(this.classic))
      .then((texture) => {
        this.sheet = texture;
      })
      .catch((caught: unknown) => {
        // Asked once: the abilities keep their rings and words.
        console.warn("Ability effects sheet did not load.", caught);
      });
  }

  /** How many of `count` extra pieces to throw: fewer on low effects and when the yard is busy. */
  many(count: number): number {
    const busy = this.bits.length > this.cap / 2 ? 0.5 : 1;
    return Math.max(1, Math.round(count * busy * (this.low ? LOW_SHARE : 1)));
  }

  /** Throws one piece; false at the cap or before the sheet is in. */
  emit(tick: number, spec: AbilityBitSpec): boolean {
    const texture = this.cell(spec.cell);
    if (!texture || this.bits.length >= this.cap) return false;
    const sprite = this.pool.pop() ?? this.makeSprite();
    sprite.texture = texture;
    sprite.blendMode = spec.add ? "add" : "normal";
    sprite.visible = false;
    (spec.ground ? this.layers.ground() : this.layers.air).addChild(sprite);
    this.bits.push({
      sprite,
      born: tick + (spec.delay ?? 0),
      life: spec.life ?? 24,
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
      easeOut: spec.easeOut ?? false,
      follow: spec.follow ?? null,
      to: spec.to ?? null,
      arc: spec.arc ?? 0,
      frames: spec.frames && spec.frames.length > 0 ? spec.frames : null,
      frameTicks: spec.frameTicks ?? 0,
    });
    return true;
  }

  /** A new frame: last frame's spots go, to be drawn again if still wanted. */
  begin(): void {
    for (const sprite of this.drawn) this.release(sprite);
    this.drawn.length = 0;
  }

  /** Holds a piece on a point for this frame; false before the sheet is in. */
  spot(spec: AbilitySpot): boolean {
    if (spec.alpha <= 0.01) return true;
    const texture = this.cell(spec.cell);
    if (!texture) return false;
    const sprite = this.pool.pop() ?? this.makeSprite();
    sprite.texture = texture;
    sprite.blendMode = spec.add ? "add" : "normal";
    sprite.visible = true;
    sprite.alpha = Math.min(1, spec.alpha);
    sprite.tint = spec.tint ?? 0xffffff;
    sprite.rotation = spec.rotation ?? 0;
    sprite.position.set(spec.at.x, spec.at.y);
    sprite.width = spec.size;
    sprite.height = spec.size * (spec.squash ?? 1);
    (spec.ground ? this.layers.ground() : this.layers.air).addChild(sprite);
    this.drawn.push(sprite);
    return true;
  }

  /** The stone swatch as a texture that repeats, for Gorgo's Stone Skin; null before the sheet is in. */
  stoneTiles(): TilingSprite | null {
    const texture = this.cell("stone");
    if (!texture) return null;
    const tiles = new TilingSprite({ texture, width: 1, height: 1 });
    tiles.eventMode = "none";
    return tiles;
  }

  /** Places every piece for `tick`. */
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
  }

  /** Every piece gone: the battle stood down. */
  clear(): void {
    this.begin();
    for (const bit of this.bits) this.release(bit.sprite);
    this.bits.length = 0;
  }

  destroy(): void {
    this.clear();
    for (const sprite of this.pool) sprite.destroy();
    this.pool.length = 0;
    for (const texture of this.cells.values()) texture.destroy(false);
    this.cells.clear();
  }

  private cell(cell: string): Texture | null {
    this.preload();
    const sheet = this.sheet;
    if (!sheet) return null;
    let texture = this.cells.get(cell);
    if (!texture) {
      const frame = this.atlas ? atlasCellFrame(this.atlas, cell) : abilityCellFrame(cell as AbilityCell);
      if (!frame) return null;
      texture = new Texture({ source: sheet.source, frame });
      this.cells.set(cell, texture);
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
    if (bit.frames) {
      const count = bit.frames.length;
      const index =
        bit.frameTicks > 0 ? Math.floor(age / bit.frameTicks) % count : Math.min(count - 1, Math.floor(t * count));
      const texture = this.cell(bit.frames[index] ?? bit.frames[0]!);
      if (texture) sprite.texture = texture;
    }
    let x: number;
    let y: number;
    const to = bit.to?.();
    if (to) {
      // A flight from its start to `to`, rising `arc` at its middle.
      const ease = bit.easeOut ? 1 - (1 - t) * (1 - t) : t;
      x = bit.x + (to.x - bit.x) * ease;
      y = bit.y + (to.y - bit.y) * ease - Math.sin(ease * Math.PI) * bit.arc;
      sprite.rotation =
        bit.rotation + bit.spin * age + Math.atan2(to.y - bit.y - Math.cos(ease * Math.PI) * bit.arc * Math.PI, to.x - bit.x);
    } else {
      const path = bitPath(bit, age);
      x = path.x;
      y = path.y - path.z;
      sprite.rotation = bit.rotation + bit.spin * age;
    }
    const follow = bit.follow?.();
    if (bit.follow && !follow) {
      sprite.visible = false;
      return;
    }
    if (follow) {
      x += follow.x;
      y += follow.y;
    }
    const grow = bit.easeOut && !bit.to ? 1 - (1 - t) * (1 - t) * (1 - t) : t;
    const size = bit.size0 + (bit.size1 - bit.size0) * grow;
    let alpha = bit.peak;
    if (bit.fadeIn > 0 && age < bit.fadeIn) alpha *= age / bit.fadeIn;
    if (t > bit.hold) alpha *= Math.max(0, 1 - (t - bit.hold) / (1 - bit.hold));
    sprite.visible = alpha > 0.01;
    sprite.alpha = alpha;
    sprite.tint = tintAt(bit.colours, t);
    sprite.position.set(x, y);
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

/** Where a named cell sits on another sheet; null when it is not there. */
export const atlasCellFrame = (atlas: AbilityAtlas, cell: string): Rectangle | null => {
  const index = atlas.cells.indexOf(cell);
  if (index < 0) return null;
  return new Rectangle(
    (index % atlas.columns) * ABILITY_CELL,
    Math.floor(index / atlas.columns) * ABILITY_CELL,
    ABILITY_CELL,
    ABILITY_CELL,
  );
};

/** Where a cell sits on the sheet. */
export const abilityCellFrame = (cell: AbilityCell): Rectangle => {
  const index = ABILITY_CELLS.indexOf(cell);
  return new Rectangle(
    (index % COLUMNS) * ABILITY_CELL,
    Math.floor(index / COLUMNS) * ABILITY_CELL,
    ABILITY_CELL,
    ABILITY_CELL,
  );
};
