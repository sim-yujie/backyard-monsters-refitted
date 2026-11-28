import { Graphics } from "pixi.js";
import type { ChampionAbilityId } from "@/game/combat/rules";
import type { Point } from "@/game/yard/YardGrid";
import type { AbilityBits, AbilityBitSpec } from "./abilityBits";
import type { PunchyStrength } from "./blastFx";

/**
 * How Gorgo's, Drull's and Fomor's abilities look in a fight (Monster
 * Madness redesign, 27 Nov 2026, `championAbilities.ts`): the engine's
 * `ability` event draws rings in the ability's colour where it went off and
 * where it landed, a short word over the champion, and for a few a punchy
 * blast. The states it leaves (stone, stun, bubble, acid, a leap) are drawn
 * on the creep itself: a tint, a sticker, a bubble, a lift.
 *
 * Drawing only; nothing here reaches the battle.
 */

export interface AbilityLook {
  /** The rings' colour. */
  readonly colour: number;
  /** The word over the champion as it goes off; short, as the owner wants. */
  readonly word: string;
  /** Screen px of the ring where it lands (a bubble, a spit, a pounce); 0 for none. */
  readonly landRing: number;
  /** A punchy blast where it lands or round the champion; null for none. */
  readonly punchy: PunchyStrength | null;
  /** Screen px of a tight shock ring round the champion as it goes off; 0 for none. */
  readonly castRing: number;
  /** A beam from the champion to where it lands, in its colour (a bubble, a spit). */
  readonly beam: boolean;
}

export const ABILITY_LOOKS: Readonly<Record<ChampionAbilityId, AbilityLook>> = {
  stoneSkin: { colour: 0xd8d4cc, word: "Stone Skin", landRing: 0, punchy: "light", castRing: 48, beam: false },
  chestPound: { colour: 0xff5a3c, word: "Chest Pound", landRing: 0, punchy: "light", castRing: 70, beam: false },
  groundSlam: { colour: 0xc9a25a, word: "Slam", landRing: 0, punchy: "full", castRing: 0, beam: false },
  bloodthirst: { colour: 0xd0202a, word: "", landRing: 0, punchy: null, castRing: 0, beam: false },
  twinBite: { colour: 0xff7b2e, word: "Twin Bite", landRing: 18, punchy: null, castRing: 0, beam: false },
  pounce: { colour: 0xffb347, word: "Pounce", landRing: 0, punchy: "light", castRing: 0, beam: false },
  healingMist: { colour: 0x6ef0a0, word: "Healing Mist", landRing: 0, punchy: null, castRing: 0, beam: false },
  bubble: { colour: 0x7fd8ff, word: "Bubble", landRing: 22, punchy: null, castRing: 0, beam: true },
  acidSpit: { colour: 0x9be22d, word: "Acid", landRing: 26, punchy: null, castRing: 0, beam: true },
};

/** The tint an ability's state leaves on a creep's body; null when none does. */
export const abilityStateTint = (creep: {
  readonly stone?: boolean;
  readonly marked?: boolean;
  readonly stunned?: boolean;
}): number | null => {
  if (creep.stone) return 0xe4e0d8;
  if (creep.marked) return 0xc4ff5a;
  if (creep.stunned) return 0xfff0a0;
  return null;
};

/** How high, in world px, Drull is drawn through a Pounce, `leap` 0 to 1 of the way. */
export const POUNCE_HEIGHT = 70;
export const pounceLift = (leap: number): number =>
  Math.sin(Math.min(Math.max(leap, 0), 1) * Math.PI) * POUNCE_HEIGHT;

/** One creep inside a Bubble this frame: its feet, the top of its body, what is left of it. */
export interface BubbleAt {
  readonly x: number;
  readonly y: number;
  readonly top: number;
  readonly shield: number;
}

/**
 * The Bubbles round the creeps that have one, all on one graphic redrawn
 * each frame: a pale blue sphere, its edge brighter, sized to the body.
 */
export class BubbleFx {
  readonly root = new Graphics();

  constructor() {
    this.root.eventMode = "none";
  }

  draw(bubbles: Iterable<BubbleAt>): void {
    const graphic = this.root;
    graphic.clear();
    for (const bubble of bubbles) {
      const height = Math.max(16, bubble.y - bubble.top);
      const radius = Math.max(20, height * 0.7);
      const cy = bubble.y - height / 2;
      graphic.circle(bubble.x, cy, radius).fill({ color: 0x9fe4ff, alpha: 0.3 });
      graphic.circle(bubble.x, cy, radius).stroke({ color: 0x3fb8ff, alpha: 0.9, width: 4 });
      graphic.circle(bubble.x, cy, radius).stroke({ color: 0xe8f8ff, alpha: 0.95, width: 1.5 });
      graphic
        .circle(bubble.x - radius * 0.35, cy - radius * 0.4, radius * 0.18)
        .fill({ color: 0xffffff, alpha: 0.55 });
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}

/** One creep in Stone Skin this frame: its feet and the top of its body. */
export interface StoneAt {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly top: number;
}

/**
 * The cracks over a champion in Stone Skin (lead's vet, 27 Nov 2026: the
 * grey alone did not read): a few dark zigzags with a pale edge across the
 * body, the same for a creep each frame so they do not flicker. The grey
 * itself is a colour-matrix filter on the body (`AttackBattleLayer`).
 */
export class StoneFx {
  readonly root = new Graphics();

  constructor() {
    this.root.eventMode = "none";
  }

  draw(stones: Iterable<StoneAt>): void {
    const graphic = this.root;
    graphic.clear();
    for (const stone of stones) {
      const height = Math.max(20, stone.y - stone.top);
      const width = height * 0.8;
      for (const crack of stoneCracks(stone.id)) {
        const points = crack.map(([u, v]) => ({
          x: stone.x + (u - 0.5) * width,
          y: stone.top + v * height,
        }));
        graphic.moveTo(points[0]!.x, points[0]!.y);
        for (const point of points.slice(1)) graphic.lineTo(point.x, point.y);
        graphic.stroke({ color: 0xf4f1ea, alpha: 0.7, width: 3.5 });
        graphic.moveTo(points[0]!.x, points[0]!.y);
        for (const point of points.slice(1)) graphic.lineTo(point.x, point.y);
        graphic.stroke({ color: 0x2c2a26, alpha: 0.9, width: 1.6 });
      }
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}

/** Three zigzag cracks in the body's box, 0 to 1 each way, fixed by the creep's id. */
export const stoneCracks = (id: number): readonly (readonly [number, number])[][] => {
  const turn = (n: number): number => (((id * 9301 + n * 49297) % 233280) / 233280) * 0.16 - 0.08;
  return [
    [
      [0.3 + turn(1), 0.25],
      [0.42 + turn(2), 0.38],
      [0.34 + turn(3), 0.5],
      [0.46 + turn(4), 0.64],
    ],
    [
      [0.66 + turn(5), 0.3],
      [0.58 + turn(6), 0.44],
      [0.7 + turn(7), 0.56],
    ],
    [
      [0.5 + turn(8), 0.7],
      [0.62 + turn(9), 0.8],
      [0.54 + turn(10), 0.9],
    ],
  ];
};

/** A Chest Pound's hold this frame: the taunted tower's top and the Gorgo it shoots. */
export interface TauntAt {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

/**
 * The lines from each tower a Chest Pound holds to its Gorgo (lead's vet,
 * 27 Nov 2026): a red line with bright beads running down it towards him,
 * and a red ring on the tower, for as long as the hold lasts.
 */
export class TauntFx {
  readonly root = new Graphics();

  constructor() {
    this.root.eventMode = "none";
  }

  draw(taunts: Iterable<TauntAt>, tick: number): void {
    const graphic = this.root;
    graphic.clear();
    for (const { from, to } of taunts) {
      graphic.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: 0xff3c28, alpha: 0.75, width: 3 });
      graphic.circle(from.x, from.y, 9).stroke({ color: 0xff3c28, alpha: 0.95, width: 3 });
      for (let bead = 0; bead < 3; bead += 1) {
        const along = ((tick / 40 + bead / 3) % 1 + 1) % 1;
        graphic
          .circle(from.x + (to.x - from.x) * along, from.y + (to.y - from.y) * along, 4)
          .fill({ color: 0xffd0a0, alpha: 0.95 });
      }
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}

/** How long, in battle ticks, a beam or a mist shows. */
export const BEAM_TICKS = 64;
export const MIST_TICKS = 96;

interface Trail {
  readonly tick: number;
  readonly kind: "beam" | "mist";
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly radius: number;
  readonly colour: number;
}

/**
 * Fomor's casts drawn so they read (lead's vet, 27 Nov 2026): a beam from him
 * to the ally he bubbles or the target he spits on, and Healing Mist as a
 * green haze over its whole ring that fades out. Drawing only.
 */
export class TrailFx {
  readonly root = new Graphics();
  private trails: Trail[] = [];

  constructor() {
    this.root.eventMode = "none";
  }

  beam(tick: number, from: TauntAt["from"], to: TauntAt["to"], colour: number): void {
    this.trails.push({ tick, kind: "beam", from, to, radius: 0, colour });
  }

  /** `radius` in screen px across; drawn as the ground's 2:1 ellipse. */
  mist(tick: number, at: TauntAt["from"], radius: number, colour: number): void {
    this.trails.push({ tick, kind: "mist", from: at, to: at, radius, colour });
  }

  update(tick: number): void {
    const graphic = this.root;
    graphic.clear();
    this.trails = this.trails.filter((trail) => {
      const age = tick - trail.tick;
      return age >= 0 && age <= (trail.kind === "beam" ? BEAM_TICKS : MIST_TICKS);
    });
    for (const trail of this.trails) {
      const age = tick - trail.tick;
      if (trail.kind === "beam") {
        const fade = 1 - age / BEAM_TICKS;
        const reach = Math.min(1, age / 8);
        const end = {
          x: trail.from.x + (trail.to.x - trail.from.x) * reach,
          y: trail.from.y + (trail.to.y - trail.from.y) * reach,
        };
        graphic.moveTo(trail.from.x, trail.from.y).lineTo(end.x, end.y);
        graphic.stroke({ color: trail.colour, alpha: 0.5 * fade, width: 9 });
        graphic.moveTo(trail.from.x, trail.from.y).lineTo(end.x, end.y);
        graphic.stroke({ color: 0xffffff, alpha: 0.85 * fade, width: 2.5 });
        graphic.circle(end.x, end.y, 6).fill({ color: trail.colour, alpha: fade });
      } else {
        const fade = 1 - age / MIST_TICKS;
        const grow = 0.6 + 0.4 * Math.min(1, age / 24);
        const rx = trail.radius * grow;
        graphic.ellipse(trail.from.x, trail.from.y, rx, rx / 2).fill({ color: trail.colour, alpha: 0.28 * fade });
        graphic.ellipse(trail.from.x, trail.from.y, rx * 0.6, rx * 0.3).fill({ color: 0xe8fff0, alpha: 0.18 * fade });
      }
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}

/* ── The painted looks (owner, desk card mm-abilities2, 28 Nov 2026) ─────── */

/** Where a creep is drawn now: its feet on the ground and the middle and top of its body. */
export interface CreepPlace {
  readonly x: number;
  readonly y: number;
  readonly top: number;
  readonly mid: Point;
}

/** The colours each look paints an ability in: Modern's rich ones, Classic's dustier ones. */
interface Palette {
  readonly dust: readonly number[];
  readonly dustDark: readonly number[];
  readonly pound: number;
  readonly poundGlow: number;
  readonly mist: number;
  readonly heal: number;
  readonly bubble: number;
  readonly acid: number;
  readonly blood: number;
  readonly bite: number;
}

const MODERN: Palette = {
  dust: [0xfff6e6, 0xf6e4c8, 0xe8d0ac],
  dustDark: [0xe0c8a0, 0xc0a07a],
  pound: 0xff6a3c,
  poundGlow: 0xff4020,
  mist: 0x7dffb0,
  heal: 0x8cffb4,
  bubble: 0xc8f0ff,
  acid: 0xb4ff3c,
  blood: 0xff2a2a,
  bite: 0xffc27a,
};

const CLASSIC: Palette = {
  dust: [0xe8dcc4, 0xd8c8a8, 0xc4b494],
  dustDark: [0xb8a888, 0x948468],
  pound: 0xd06040,
  poundGlow: 0xb04028,
  mist: 0x9ad8a8,
  heal: 0xa8e8b8,
  bubble: 0xd8eef8,
  acid: 0xa8d050,
  blood: 0xb02020,
  bite: 0xe0c8a0,
};

/** A number 0 to 1 fixed by its seeds, so a replay throws the same pieces. */
export const abilityNoise = (a: number, b: number, c = 0): number => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** How long, in battle ticks (80 a second), the pieces last. */
export const CRACK_TICKS = 130;
export const DUST_TICKS = 70;
export const MIST_DRIFT_TICKS = 150;

/** The px a ground ring's painted ellipse is wide inside its cell's width (`shock`, `crack`, `splat`). */
const GROUND_FILL = 0.92;

/**
 * Every ability's look, thrown as painted pieces ({@link AbilityBits}):
 * - Stone Skin: chips of rock fly in and set on him in a puff of dust; his
 *   body takes on a stone surface while it lasts (the battle layer masks it
 *   to his shape); it crumbles off when it ends.
 * - Chest Pound: a red burst at his chest and two shockwaves out to its
 *   reach; a target mark spins over each tower it holds, and red sparks run
 *   from the tower to him.
 * - Ground Slam: the ground cracks under him, a ring of dust rolls out to
 *   its reach, rocks and clods are thrown up and land; dizzy stars circle
 *   over everything it stuns.
 * - Bloodthirst: drops of blood fly from what he bit into him, and he glows red.
 * - Twin Bite: a second set of jaws snaps shut on the target, with slashes
 *   and a spray of blood.
 * - Pounce: dust kicks up as he leaps, a trail of dust follows him through
 *   the air, and he lands in a crack, a shockwave and a spray of stones.
 * - Healing Mist: green mist rolls out over his ring, and green crosses rise
 *   off everyone it heals.
 * - Bubble: a small bubble floats from him to the ally, which then sits in a
 *   glossy wobbling bubble until it pops in a ring of droplets.
 * - Acid Spit: a glob of acid arcs onto the target and splats; green drops
 *   drip and fizz off it while it is marked.
 */
export class AbilityPainter {
  private readonly palette: Palette;

  constructor(
    private readonly bits: AbilityBits,
    private readonly classic: boolean,
  ) {
    this.palette = classic ? CLASSIC : MODERN;
  }

  /** Whether the sheet is in: until then the caller keeps its plain rings and shapes. */
  get ready(): boolean {
    this.bits.preload();
    return this.bits.ready;
  }

  /** Light adds on in Modern; Classic, like Flash, lays its pieces over the yard. */
  private get glow(): boolean {
    return !this.classic;
  }

  private emit(tick: number, spec: AbilityBitSpec): void {
    this.bits.emit(tick, spec);
  }

  /** `count` pieces, thinned on low effects or a busy yard. */
  private many(count: number): number {
    return this.bits.many(count);
  }

  /** The ability went off: its cast, at its champion, and where it lands. */
  cast(
    tick: number,
    ability: ChampionAbilityId,
    caster: CreepPlace,
    follow: () => CreepPlace | null,
    radius: number,
    to: { readonly at: Point; readonly follow: (() => Point | null) | null } | null,
    seed: number,
  ): void {
    switch (ability) {
      case "stoneSkin":
        return this.stoneSkin(tick, caster, follow, seed);
      case "chestPound":
        return this.chestPound(tick, caster, radius, seed);
      case "groundSlam":
        return this.groundSlam(tick, caster, radius, seed);
      case "twinBite":
        if (to) this.twinBite(tick, to.at, seed);
        return;
      case "pounce":
        if (to) this.pounceOff(tick, caster, seed);
        else this.pounceLand(tick, caster, seed);
        return;
      case "healingMist":
        return this.healingMist(tick, caster, radius, seed);
      case "bubble":
        if (to) this.bubbleThrow(tick, caster, to);
        return;
      case "acidSpit":
        if (to) this.acidSpit(tick, caster, to, seed);
        return;
      case "bloodthirst":
        return;
    }
  }

  private stoneSkin(tick: number, caster: CreepPlace, follow: () => CreepPlace | null, seed: number): void {
    const height = Math.max(30, caster.y - caster.top);
    const mid = (): Point | null => follow()?.mid ?? null;
    const count = this.many(8);
    for (let n = 0; n < count; n += 1) {
      const angle = (n / count) * Math.PI * 2 + abilityNoise(seed, n) * 0.6;
      const reach = height * (0.9 + abilityNoise(seed, n, 1) * 0.5);
      // Chips start round him and fly in onto his body.
      this.emit(tick, {
        cell: n % 3 === 0 ? "pebbles" : "shard",
        at: { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.6 },
        follow: mid,
        to: () => ({ x: 0, y: 0 }),
        arc: 0,
        delay: Math.round(abilityNoise(seed, n, 2) * 6),
        life: 16,
        size0: 22,
        size1: 12,
        fadeIn: 3,
        hold: 0.8,
        rotation: angle,
      });
    }
    this.emit(tick + 14, {
      cell: "mist",
      at: { x: caster.x, y: caster.y - 4 },
      life: 40,
      size0: height * 0.9,
      size1: height * 1.6,
      squash: 0.55,
      peak: 0.7,
      colours: [0xd8d4cc, 0xb0aca4],
      easeOut: true,
    });
    this.emit(tick + 14, {
      cell: "shock",
      at: { x: caster.x, y: caster.y },
      ground: true,
      life: 26,
      size0: height * 0.8,
      size1: height * 2.2,
      peak: 0.8,
      colours: [0xf4f0e8],
      easeOut: true,
    });
  }

  /** Stone Skin wore off: the stone crumbles off him and falls. */
  stoneCrumble(tick: number, caster: CreepPlace, seed: number): void {
    const height = Math.max(30, caster.y - caster.top);
    const count = this.many(7);
    for (let n = 0; n < count; n += 1) {
      const side = abilityNoise(seed, n) - 0.5;
      this.emit(tick, {
        cell: n % 2 === 0 ? "shard" : "pebbles",
        at: { x: caster.mid.x + side * height * 0.7, y: caster.y },
        z: (caster.y - caster.mid.y) * (0.6 + abilityNoise(seed, n, 1) * 0.8),
        vx: side * 1.6,
        vy: (abilityNoise(seed, n, 2) - 0.5) * 0.6,
        vz: 0.8,
        gravity: 0.12,
        life: 50,
        hold: 0.6,
        size0: 16,
        spin: side * 0.2,
      });
    }
    this.emit(tick, {
      cell: "mist",
      at: { x: caster.x, y: caster.y - 6 },
      life: 36,
      size0: height,
      size1: height * 1.5,
      squash: 0.5,
      peak: 0.5,
      colours: [0xd0ccc4],
      easeOut: true,
    });
  }

  private chestPound(tick: number, caster: CreepPlace, radius: number, seed: number): void {
    const palette = this.palette;
    const chest = { x: caster.mid.x, y: caster.mid.y - (caster.mid.y - caster.top) * 0.2 };
    this.emit(tick, {
      cell: "burst",
      at: chest,
      life: 16,
      size0: 30,
      size1: 90,
      colours: [0xffffff, palette.pound],
      add: this.glow,
      easeOut: true,
      rotation: abilityNoise(seed, 1) * Math.PI,
    });
    if (this.glow) {
      this.emit(tick, { cell: "glow", at: chest, life: 22, size0: 40, size1: 90, colours: [palette.poundGlow], peak: 0.55, add: true, easeOut: true });
    }
    // Two shockwaves out to its reach, the second a beat later.
    const wide = (radius * 2) / GROUND_FILL;
    for (let n = 0; n < 2; n += 1) {
      this.emit(tick, {
        cell: "shock",
        at: { x: caster.x, y: caster.y },
        ground: true,
        delay: n * 9,
        life: 36,
        size0: 40,
        size1: wide,
        colours: [palette.pound, palette.poundGlow],
        peak: n === 0 ? 0.9 : 0.65,
        easeOut: true,
      });
    }
    const puffs = this.many(6);
    for (let n = 0; n < puffs; n += 1) {
      const angle = (n / puffs) * Math.PI * 2 + abilityNoise(seed, n, 3);
      this.emit(tick, {
        cell: "mist",
        at: { x: caster.x + Math.cos(angle) * 14, y: caster.y + Math.sin(angle) * 7 },
        vx: Math.cos(angle) * 1.4,
        vy: Math.sin(angle) * 0.7,
        drag: 0.04,
        life: DUST_TICKS * 0.6,
        size0: 20,
        size1: 44,
        squash: 0.7,
        peak: 0.65,
        colours: palette.dust,
        easeOut: true,
      });
    }
  }

  private groundSlam(tick: number, caster: CreepPlace, radius: number, seed: number): void {
    const palette = this.palette;
    const at = { x: caster.x, y: caster.y };
    this.emit(tick, {
      cell: "crack",
      at,
      ground: true,
      life: CRACK_TICKS,
      size0: Math.min(radius * 0.75, 118),
      size1: Math.min(radius * 0.8, 124),
      peak: 0.9,
      fadeIn: 2,
      hold: 0.6,
      easeOut: true,
    });
    this.emit(tick, {
      cell: "shock",
      at,
      ground: true,
      life: 40,
      size0: 30,
      size1: (radius * 2) / GROUND_FILL,
      colours: palette.dust,
      peak: 0.95,
      easeOut: true,
    });
    // A ring of dust rolling out to the slam's reach.
    const puffs = this.many(12);
    for (let n = 0; n < puffs; n += 1) {
      const angle = (n / puffs) * Math.PI * 2 + abilityNoise(seed, n) * 0.4;
      const speed = (radius / DUST_TICKS) * (1.6 + abilityNoise(seed, n, 1) * 0.5);
      this.emit(tick, {
        cell: "mist",
        at: { x: at.x + Math.cos(angle) * 10, y: at.y + Math.sin(angle) * 5 },
        z: 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5,
        vz: 0.25,
        drag: 0.035,
        life: DUST_TICKS,
        size0: 40,
        size1: 96,
        squash: 0.6,
        peak: 0.9,
        colours: palette.dust,
        easeOut: true,
      });
    }
    // Rocks and clods thrown up, which land and lie a moment.
    const rocks = this.many(9);
    for (let n = 0; n < rocks; n += 1) {
      const angle = abilityNoise(seed, n, 4) * Math.PI * 2;
      const speed = 0.8 + abilityNoise(seed, n, 5) * 1.6;
      this.emit(tick, {
        cell: n % 3 === 0 ? "clods" : n % 3 === 1 ? "shard" : "pebbles",
        at,
        z: 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5,
        vz: 2.4 + abilityNoise(seed, n, 6) * 1.6,
        gravity: 0.11,
        life: 75,
        hold: 0.7,
        size0: 12 + abilityNoise(seed, n, 7) * 8,
        spin: (abilityNoise(seed, n, 8) - 0.5) * 0.3,
      });
    }
    this.emit(tick, {
      cell: "debris",
      at: { x: at.x, y: at.y - 18 },
      life: 34,
      size0: 60,
      size1: 90,
      colours: palette.dustDark,
      easeOut: true,
    });
  }

  /** Stars circling over a creep or tower Ground Slam stunned, for this frame. */
  dizzy(tick: number, over: Point, key: number): void {
    for (let n = 0; n < 3; n += 1) {
      const angle = tick * 0.09 + (n * Math.PI * 2) / 3 + key;
      const depth = Math.sin(angle);
      this.bits.spot({
        cell: "star",
        at: { x: over.x + Math.cos(angle) * 15, y: over.y + depth * 5 },
        size: 11 + depth * 2,
        alpha: 0.75 + depth * 0.25,
        rotation: angle * 0.5,
      });
    }
  }

  /** A tower Chest Pound holds, for this frame: a target mark over it, red sparks running to Gorgo. */
  taunt(tick: number, tower: Point, gorgo: Point, key: number): void {
    const palette = this.palette;
    const pulse = 0.5 + 0.5 * Math.sin(tick * 0.15 + key);
    this.bits.spot({
      cell: "reticle",
      at: { x: tower.x, y: tower.y - 22 },
      size: 34 + pulse * 6,
      alpha: 0.95,
      rotation: tick * 0.02,
    });
    const dx = gorgo.x - tower.x;
    const dy = gorgo.y - tower.y;
    const length = Math.hypot(dx, dy);
    const sparks = Math.max(2, Math.min(6, Math.round(length / 45)));
    for (let n = 0; n < sparks; n += 1) {
      const along = ((tick / 50 + n / sparks) % 1 + 1) % 1;
      this.bits.spot({
        cell: "glow",
        at: { x: tower.x + dx * along, y: tower.y + dy * along - Math.sin(along * Math.PI) * length * 0.12 },
        size: this.glow ? 22 : 14,
        alpha: (this.glow ? 0.9 : 0.75) * Math.sin(along * Math.PI),
        tint: palette.poundGlow,
        add: this.glow,
      });
    }
  }

  /** Drull's Bloodthirst after a blow: drops of blood fly from what he bit into him. */
  bloodthirst(tick: number, from: Point, follow: () => CreepPlace | null, seed: number): void {
    const palette = this.palette;
    const mid = (): Point | null => follow()?.mid ?? null;
    const now = follow();
    if (!now) return;
    const drops = this.many(4);
    for (let n = 0; n < drops; n += 1) {
      this.emit(tick, {
        cell: "blood",
        at: { x: from.x + (abilityNoise(seed, n) - 0.5) * 20, y: from.y + (abilityNoise(seed, n, 1) - 0.5) * 14 },
        to: mid,
        arc: 40 + abilityNoise(seed, n, 2) * 24,
        delay: n * 4,
        life: 30,
        size0: 18,
        size1: 12,
        fadeIn: 2,
        hold: 0.85,
        // The drop's point trails behind it as it flies.
        rotation: -Math.PI / 2,
        colours: [palette.blood],
      });
      // A red wisp along with each drop, so the stream reads against his red hide.
      this.emit(tick, {
        cell: "mist",
        at: { x: from.x, y: from.y },
        to: mid,
        arc: 40 + abilityNoise(seed, n, 2) * 24,
        delay: n * 4 + 1,
        life: 30,
        size0: 30,
        size1: 18,
        peak: this.glow ? 0.7 : 0.45,
        hold: 0.7,
        colours: [palette.blood],
        add: this.glow,
      });
    }
    this.emit(tick + 18, {
      cell: "glow",
      at: { x: 0, y: 0 },
      follow: mid,
      life: 26,
      size0: 60,
      size1: 100,
      peak: this.glow ? 0.85 : 0.45,
      colours: [palette.blood],
      add: this.glow,
      easeOut: true,
    });
  }

  private twinBite(tick: number, at: Point, seed: number): void {
    const palette = this.palette;
    const bite = { x: at.x, y: at.y + 6 };
    // The jaws open, then snap shut.
    this.emit(tick, { cell: "fangs", at: bite, life: 9, size0: 74, size1: 64, fadeIn: 2, hold: 0.9, squash: 1 });
    this.emit(tick + 9, { cell: "fangs", at: bite, life: 24, size0: 64, size1: 60, squash: 0.55, hold: 0.55 });
    for (let n = 0; n < 2; n += 1) {
      this.emit(tick + 8, {
        cell: "slash",
        at: { x: bite.x + (n === 0 ? -6 : 6), y: bite.y },
        life: 16,
        size0: 46,
        size1: 56,
        rotation: n === 0 ? 0.4 : Math.PI + 0.4,
        colours: [0xffffff, palette.bite],
        add: this.glow,
        easeOut: true,
      });
    }
    const drops = this.many(4);
    for (let n = 0; n < drops; n += 1) {
      const angle = -Math.PI / 2 + (abilityNoise(seed, n) - 0.5) * 2.4;
      this.emit(tick + 9, {
        cell: "blood",
        at: bite,
        z: 4,
        vx: Math.cos(angle) * 1.4,
        vy: 0.3,
        vz: 1.6 + abilityNoise(seed, n, 1),
        gravity: 0.1,
        life: 34,
        hold: 0.6,
        size0: 8,
        size1: 6,
        colours: [palette.blood],
      });
    }
  }

  private pounceOff(tick: number, caster: CreepPlace, seed: number): void {
    const puffs = this.many(5);
    for (let n = 0; n < puffs; n += 1) {
      const angle = (n / puffs) * Math.PI * 2 + abilityNoise(seed, n);
      this.emit(tick, {
        cell: "mist",
        at: { x: caster.x, y: caster.y },
        vx: Math.cos(angle) * 1.2,
        vy: Math.sin(angle) * 0.6,
        drag: 0.05,
        life: 40,
        size0: 18,
        size1: 40,
        squash: 0.7,
        peak: 0.75,
        colours: this.palette.dust,
        easeOut: true,
      });
    }
  }

  /** Drull in the air, for this frame: a puff of dust left behind him every few ticks. */
  pounceTrail(tick: number, place: CreepPlace): void {
    if (tick % 3 !== 0) return;
    this.emit(tick, {
      cell: "mist",
      at: place.mid,
      life: 26,
      size0: 24,
      size1: 12,
      peak: 0.55,
      colours: this.palette.dust,
    });
  }

  private pounceLand(tick: number, caster: CreepPlace, seed: number): void {
    const palette = this.palette;
    const at = { x: caster.x, y: caster.y };
    this.emit(tick, { cell: "crack", at, ground: true, life: CRACK_TICKS * 0.7, size0: 56, size1: 60, peak: 0.85, hold: 0.5, easeOut: true });
    this.emit(tick, {
      cell: "shock",
      at,
      ground: true,
      life: 30,
      size0: 30,
      size1: 150,
      colours: palette.dust,
      peak: 0.9,
      easeOut: true,
    });
    const puffs = this.many(7);
    for (let n = 0; n < puffs; n += 1) {
      const angle = (n / puffs) * Math.PI * 2 + abilityNoise(seed, n);
      this.emit(tick, {
        cell: "mist",
        at: { x: at.x + Math.cos(angle) * 8, y: at.y + Math.sin(angle) * 4 },
        vx: Math.cos(angle) * 1.6,
        vy: Math.sin(angle) * 0.8,
        drag: 0.05,
        life: 50,
        size0: 22,
        size1: 52,
        squash: 0.7,
        peak: 0.8,
        colours: palette.dust,
        easeOut: true,
      });
    }
    const rocks = this.many(5);
    for (let n = 0; n < rocks; n += 1) {
      const angle = abilityNoise(seed, n, 3) * Math.PI * 2;
      this.emit(tick, {
        cell: n % 2 === 0 ? "pebbles" : "clods",
        at,
        z: 4,
        vx: Math.cos(angle) * 1.2,
        vy: Math.sin(angle) * 0.6,
        vz: 2 + abilityNoise(seed, n, 4),
        gravity: 0.12,
        life: 55,
        hold: 0.7,
        size0: 12,
        spin: 0.15,
      });
    }
  }

  private healingMist(tick: number, caster: CreepPlace, radius: number, seed: number): void {
    const palette = this.palette;
    const puffs = this.many(18);
    for (let n = 0; n < puffs; n += 1) {
      const angle = (n / puffs) * Math.PI * 2 + abilityNoise(seed, n) * 0.5;
      const start = radius * (0.12 + abilityNoise(seed, n, 1) * 0.5);
      const speed = (radius * (0.15 + abilityNoise(seed, n, 2) * 0.15)) / MIST_DRIFT_TICKS;
      this.emit(tick, {
        cell: "mist",
        at: { x: caster.x + Math.cos(angle) * start, y: caster.y + Math.sin(angle) * start * 0.5 },
        z: 10 + abilityNoise(seed, n, 3) * 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5,
        vz: 0.06,
        delay: Math.round(abilityNoise(seed, n, 4) * 20),
        life: MIST_DRIFT_TICKS,
        size0: 80,
        size1: 150,
        squash: 0.55,
        fadeIn: 30,
        peak: this.glow ? 0.34 : 0.3,
        hold: 0.3,
        colours: [palette.mist],
        add: this.glow,
        spin: (abilityNoise(seed, n, 5) - 0.5) * 0.01,
      });
    }
  }

  /** Healing Mist healed this ally: green crosses rise off it. */
  healOn(tick: number, follow: () => CreepPlace | null, seed: number): void {
    const mid = (): Point | null => follow()?.mid ?? null;
    const count = this.many(3);
    for (let n = 0; n < count; n += 1) {
      this.emit(tick, {
        cell: "plus",
        at: { x: (abilityNoise(seed, n) - 0.5) * 26, y: -4 },
        follow: mid,
        vz: 0.45,
        delay: n * 8 + 10,
        life: 50,
        size0: 14,
        size1: 18,
        fadeIn: 6,
        hold: 0.4,
        colours: [this.palette.heal],
        add: this.glow,
      });
    }
  }

  private bubbleThrow(
    tick: number,
    caster: CreepPlace,
    to: { readonly at: Point; readonly follow: (() => Point | null) | null },
  ): void {
    this.emit(tick, {
      cell: "bubble",
      at: caster.mid,
      to: to.follow ?? (() => to.at),
      arc: 30,
      life: 26,
      size0: 14,
      size1: 30,
      fadeIn: 3,
      hold: 0.9,
      colours: [this.palette.bubble],
      add: this.glow,
    });
  }

  /** A creep inside a Bubble, for this frame: a glossy sphere round its body, wobbling. */
  bubbleOn(tick: number, place: CreepPlace, key: number): void {
    const height = Math.max(24, place.y - place.top);
    const size = Math.max(44, height * 1.35);
    const wobble = Math.sin(tick * 0.12 + key) * 0.04;
    this.bits.spot({
      cell: "bubble",
      at: place.mid,
      size: size * (1 + wobble),
      squash: (1 - wobble) / (1 + wobble),
      alpha: this.glow ? 0.95 : 0.8,
      tint: this.palette.bubble,
      add: this.glow,
    });
    if (this.glow) {
      this.bits.spot({ cell: "glow", at: place.mid, size: size * 1.1, alpha: 0.25, tint: 0x60c8ff, add: true });
    }
  }

  /** A creep's Bubble burst or ran out: a ring of droplets. */
  bubblePop(tick: number, place: CreepPlace): void {
    const height = Math.max(24, place.y - place.top);
    const size = Math.max(44, height * 1.35);
    this.emit(tick, {
      cell: "pop",
      at: place.mid,
      life: 18,
      size0: size,
      size1: size * 1.5,
      colours: [this.palette.bubble],
      add: this.glow,
      easeOut: true,
    });
  }

  private acidSpit(
    tick: number,
    caster: CreepPlace,
    to: { readonly at: Point; readonly follow: (() => Point | null) | null },
    seed: number,
  ): void {
    const palette = this.palette;
    const target = to.follow ?? (() => to.at);
    const flight = 18;
    this.emit(tick, {
      cell: "glob",
      at: caster.mid,
      to: target,
      arc: 34,
      life: flight,
      size0: 34,
      size1: 30,
      hold: 0.95,
      colours: [0xffffff],
    });
    const land = target() ?? to.at;
    this.emit(tick + flight, {
      cell: "splat",
      at: { x: 0, y: 2 },
      follow: target,
      life: 50,
      size0: 40,
      size1: 58,
      hold: 0.5,
      easeOut: true,
    });
    const drops = this.many(4);
    for (let n = 0; n < drops; n += 1) {
      const angle = -Math.PI / 2 + (abilityNoise(seed, n) - 0.5) * 2.6;
      this.emit(tick + flight, {
        cell: "drops",
        at: land,
        z: 6,
        vx: Math.cos(angle) * 1.5,
        vy: 0.2,
        vz: 1.4 + abilityNoise(seed, n, 1),
        gravity: 0.1,
        life: 34,
        hold: 0.6,
        size0: 12,
        size1: 9,
      });
    }
    this.emit(tick + flight, {
      cell: "smoke",
      at: land,
      vz: 0.3,
      life: 40,
      size0: 24,
      size1: 46,
      peak: 0.55,
      colours: [palette.acid],
      add: this.glow,
      easeOut: true,
    });
  }

  /** Something marked by Acid Spit, for this frame: green drops drip and fizz off it now and then. */
  acidOn(tick: number, over: Point, key: number): void {
    if ((tick + key * 7) % 14 !== 0) return;
    const side = abilityNoise(tick, key) - 0.5;
    this.emit(tick, {
      cell: "drops",
      at: { x: over.x + side * 26, y: over.y },
      vz: -0.2,
      gravity: 0.05,
      z: 10,
      life: 26,
      size0: 9,
      size1: 6,
      hold: 0.5,
    });
    this.emit(tick, {
      cell: "smoke",
      at: { x: over.x - side * 18, y: over.y - 6 },
      vz: 0.5,
      life: 30,
      size0: 10,
      size1: 22,
      peak: 0.5,
      colours: [this.palette.acid],
      add: this.glow,
    });
  }
}
