import { Graphics } from "pixi.js";
import type { ChampionAbilityId } from "@/game/combat/rules";
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
export const BEAM_TICKS = 32;
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
