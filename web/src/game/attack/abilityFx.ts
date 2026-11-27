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
}

export const ABILITY_LOOKS: Readonly<Record<ChampionAbilityId, AbilityLook>> = {
  stoneSkin: { colour: 0xb8b8b0, word: "Stone Skin", landRing: 0, punchy: null },
  chestPound: { colour: 0xff5a3c, word: "Chest Pound", landRing: 0, punchy: "light" },
  groundSlam: { colour: 0xc9a25a, word: "Slam", landRing: 0, punchy: "full" },
  bloodthirst: { colour: 0xd0202a, word: "", landRing: 0, punchy: null },
  twinBite: { colour: 0xff7b2e, word: "Twin Bite", landRing: 18, punchy: null },
  pounce: { colour: 0xffb347, word: "Pounce", landRing: 0, punchy: "light" },
  healingMist: { colour: 0x6ef0a0, word: "Healing Mist", landRing: 0, punchy: null },
  bubble: { colour: 0x7fd8ff, word: "Bubble", landRing: 22, punchy: null },
  acidSpit: { colour: 0x9be22d, word: "Acid", landRing: 26, punchy: null },
};

/** The tint an ability's state leaves on a creep's body; null when none does. */
export const abilityStateTint = (creep: {
  readonly stone?: boolean;
  readonly marked?: boolean;
  readonly stunned?: boolean;
}): number | null => {
  if (creep.stone) return 0x9c9c94;
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
      const radius = Math.max(14, height * 0.62);
      const cy = bubble.y - height / 2;
      graphic.circle(bubble.x, cy, radius).fill({ color: 0x9fe4ff, alpha: 0.18 });
      graphic.circle(bubble.x, cy, radius).stroke({ color: 0xc8f2ff, alpha: 0.85, width: 2 });
      graphic
        .circle(bubble.x - radius * 0.35, cy - radius * 0.4, radius * 0.18)
        .fill({ color: 0xffffff, alpha: 0.55 });
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}
