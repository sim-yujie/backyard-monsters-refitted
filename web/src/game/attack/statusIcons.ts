/**
 * The little badges over a creep that is under an effect (beta.5): poisoned,
 * burning, enraged, puttied, in Krallen's loot aura.
 *
 * ## What Flash did
 *
 * A `CStatusEffect` (`client/scripts/com/monsters/monsters/components/statusEffects/CStatusEffect.as`)
 * hung its icon on the monster while it lasted and took it off when it ended
 * or the monster died: Korath's flame (`effects/flame_icon.png`) and Fang's
 * venom (`effects/venom_icon.v2.png`). Two or more sat side by side above the
 * graphic, the first in the middle and the rest alternating right and left,
 * 5 px apart (`updatePosition`). Auras and boosts had no icon there, only a
 * glow filter.
 *
 * ## What this does
 *
 * Every effect the engine reports on a {@link CreepSnapshot} gets a round
 * badge in its own colour, the row centred over the health bar in
 * {@link STATUS_EFFECTS}' order so the icons never swap places as effects
 * come and go. The badges are drawn shapes, not Flash's 16 px bitmaps, so they
 * stay sharp at any zoom and readable on a phone; the flame and the drop keep
 * Flash's outlines.
 *
 * ## Adding an effect
 *
 * One line in {@link STATUS_EFFECTS}: the snapshot flag that says it is on,
 * a colour and a glyph. The glyphs a slow, a stun and a freeze need are
 * drawn already, waiting for the engine to have those effects:
 *
 *     { id: "slowed", colour: 0x4aa3ff, glyph: "chevronsDown", stacks: (c) => (c.slowed ? 1 : 0) },
 *
 * Drawing only; nothing here reaches the battle.
 */

import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { CreepSnapshot } from "@/game/combat/rules";

/** The shapes a badge can carry, each drawn round (0, 0) inside {@link GLYPH_SIZE}. */
export type GlyphName =
  | "drop"
  | "flame"
  | "brows"
  | "blob"
  | "coin"
  | "chevronsDown"
  | "stars"
  | "snowflake";

export interface StatusEffect {
  readonly id: string;
  /** What a player would call it; for tests and the review page. */
  readonly label: string;
  readonly colour: number;
  readonly glyph: GlyphName;
  /** How strongly it is on the creep: 0 when it is not, its stacks when it stacks. */
  readonly stacks: (creep: CreepSnapshot) => number;
}

/** Every effect with a badge, in the order the row shows them left to right. */
export const STATUS_EFFECTS: readonly StatusEffect[] = [
  { id: "poisoned", label: "Poisoned", colour: 0x7bd62a, glyph: "drop", stacks: (c) => c.poisonStacks ?? 0 },
  { id: "burning", label: "Burning", colour: 0xff8a1a, glyph: "flame", stacks: (c) => (c.burning ? 1 : 0) },
  { id: "enraged", label: "Enraged", colour: 0xff4a4a, glyph: "brows", stacks: (c) => (c.enraged ? 1 : 0) },
  { id: "puttied", label: "Putty boost", colour: 0xff8ce6, glyph: "blob", stacks: (c) => (c.puttied ? 1 : 0) },
  { id: "lootBoosted", label: "Loot boost", colour: 0xf5c542, glyph: "coin", stacks: (c) => (c.lootBoosted ? 1 : 0) },
];

/** One badge to show: the effect and how many stacks it has. */
export interface ActiveStatus {
  readonly effect: StatusEffect;
  readonly stacks: number;
}

/** The effects on a creep, in {@link STATUS_EFFECTS}' order; empty for none or no creep. */
export const statusesOf = (
  creep: CreepSnapshot | null,
  effects: readonly StatusEffect[] = STATUS_EFFECTS,
): ActiveStatus[] => {
  if (!creep) return [];
  const on: ActiveStatus[] = [];
  for (const effect of effects) {
    const stacks = effect.stacks(creep);
    if (stacks > 0) on.push({ effect, stacks });
  }
  return on;
};

/** A badge's radius in world px; a creep's health bar is 18 wide. */
export const BADGE_RADIUS = 5.5;
/** The space between two badges, and between the row and the bar under it. */
export const BADGE_GAP = 1.5;
/** The box a glyph is drawn to fit, before it is scaled into the badge. */
const GLYPH_SIZE = 10;
/** A stacking effect's badge grows this much a stack past the first, up to {@link MAX_GROWTH_STACKS}. */
const STACK_GROWTH = 0.08;
const MAX_GROWTH_STACKS = 5;
const BADGE_FILL = 0x1f1a14;
const BADGE_FILL_ALPHA = 0.85;

/** A badge's scale for its stacks: 1 for one, a little bigger for each more, capped. */
export const badgeScale = (stacks: number): number =>
  1 + (Math.min(Math.max(stacks, 1), MAX_GROWTH_STACKS) - 1) * STACK_GROWTH;

/**
 * Where each of `count` badges goes: a row centred on `centreX`, its badges'
 * centres on one line `BADGE_GAP` above `barTop`, so a long row spreads both
 * ways as Flash's did rather than running off one side.
 */
export const statusRow = (
  count: number,
  centreX: number,
  barTop: number,
): { x: number; y: number }[] => {
  const step = BADGE_RADIUS * 2 + BADGE_GAP;
  const first = centreX - ((count - 1) * step) / 2;
  const y = barTop - BADGE_GAP - BADGE_RADIUS;
  return Array.from({ length: count }, (_, index) => ({ x: first + index * step, y }));
};

/** Draws `glyph` in `colour` round (0, 0), inside a {@link GLYPH_SIZE} box. */
const drawGlyph = (context: GraphicsContext, glyph: GlyphName, colour: number): void => {
  switch (glyph) {
    case "drop":
      // The venom drop the layer drew before (issue #352), Flash's outline.
      context
        .moveTo(0, -4.6)
        .bezierCurveTo(1.4, -2.4, 3.2, -0.6, 3.2, 1.2)
        .arc(0, 1.2, 3.2, 0, Math.PI)
        .bezierCurveTo(-3.2, -0.6, -1.4, -2.4, 0, -4.6)
        .fill({ color: colour });
      context.circle(-1.2, 1.4, 0.9).fill({ color: 0xffffff, alpha: 0.55 });
      return;
    case "flame":
      // `flame_icon.png`'s shape: a tongue up the middle over a round base.
      context
        .moveTo(0.4, -4.8)
        .quadraticCurveTo(1.2, -1.8, 3.2, -0.8)
        .quadraticCurveTo(4.4, 3.8, 0, 4.2)
        .quadraticCurveTo(-4.4, 3.8, -3.2, -0.4)
        .quadraticCurveTo(-2, 0.8, -1.4, -1.2)
        .quadraticCurveTo(-1, -3.4, 0.4, -4.8)
        .fill({ color: colour });
      context
        .moveTo(0, -0.6)
        .quadraticCurveTo(2.2, 1.6, 1.6, 3)
        .quadraticCurveTo(0, 4, -1.6, 3)
        .quadraticCurveTo(-1.8, 1.2, 0, -0.6)
        .fill({ color: 0xffe066 });
      return;
    case "brows":
      // An angry face, brows down over a frown: Fomor's enrage, faster and harder to hurt.
      context.moveTo(-3.4, -2.8).lineTo(-0.9, -1.4).stroke({ color: colour, width: 1.4, cap: "round" });
      context.moveTo(3.4, -2.8).lineTo(0.9, -1.4).stroke({ color: colour, width: 1.4, cap: "round" });
      context.circle(-1.7, 0.4, 0.9).fill({ color: colour });
      context.circle(1.7, 0.4, 0.9).fill({ color: colour });
      context.moveTo(-2, 3.4).quadraticCurveTo(0, 1.8, 2, 3.4).stroke({ color: colour, width: 1.3, cap: "round" });
      return;
    case "blob":
      // A splat of putty with a shine.
      context
        .moveTo(-3.8, 1.8)
        .quadraticCurveTo(-4.4, -2.6, -0.8, -3.4)
        .quadraticCurveTo(1.6, -4.6, 3.4, -2)
        .quadraticCurveTo(4.8, 1, 2.6, 3.2)
        .quadraticCurveTo(-0.4, 4.6, -3.8, 1.8)
        .fill({ color: colour });
      context.circle(-1.2, -1.4, 1).fill({ color: 0xffffff, alpha: 0.6 });
      return;
    case "coin":
      context.circle(0, 0, 4).fill({ color: colour });
      context.circle(0, 0, 2.6).stroke({ color: 0x9c6a12, width: 1 });
      context.rect(-0.5, -1.6, 1, 3.2).fill({ color: 0x9c6a12 });
      return;
    case "chevronsDown":
      for (const y of [-2.6, 0.8]) {
        context
          .moveTo(-3.4, y)
          .lineTo(0, y + 2.6)
          .lineTo(3.4, y)
          .stroke({ color: colour, width: 1.6, cap: "round", join: "round" });
      }
      return;
    case "stars":
      for (const [x, y, r] of [
        [-2, -1.4, 2.4],
        [2.4, 1.8, 1.8],
      ] as const) {
        context
          .moveTo(x, y - r)
          .lineTo(x + r * 0.3, y - r * 0.3)
          .lineTo(x + r, y)
          .lineTo(x + r * 0.3, y + r * 0.3)
          .lineTo(x, y + r)
          .lineTo(x - r * 0.3, y + r * 0.3)
          .lineTo(x - r, y)
          .lineTo(x - r * 0.3, y - r * 0.3)
          .closePath()
          .fill({ color: colour });
      }
      return;
    case "snowflake":
      for (const angle of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        const dx = Math.cos(angle) * 4.2;
        const dy = Math.sin(angle) * 4.2;
        context.moveTo(-dx, -dy).lineTo(dx, dy).stroke({ color: colour, width: 1.4, cap: "round" });
      }
      context.circle(0, 0, 1.1).fill({ color: colour });
      return;
  }
};

/** One shared drawing per effect, so a hundred poisoned creeps draw one shape a hundred times. */
const contexts = new Map<string, GraphicsContext>();

/** The badge for `effect`: a dark disc ringed in its colour, the glyph inside. */
export const badgeContext = (effect: StatusEffect): GraphicsContext => {
  const key = `${effect.id}:${effect.glyph}:${effect.colour}`;
  const ready = contexts.get(key);
  if (ready) return ready;
  const context = new GraphicsContext();
  context.circle(0, 0, BADGE_RADIUS).fill({ color: BADGE_FILL, alpha: BADGE_FILL_ALPHA });
  context.circle(0, 0, BADGE_RADIUS - 0.5).stroke({ color: effect.colour, width: 1 });
  const inner = ((BADGE_RADIUS - 1.2) * 2) / GLYPH_SIZE;
  context.scale(inner, inner);
  drawGlyph(context, effect.glyph, effect.colour);
  contexts.set(key, context);
  return context;
};

/**
 * A creep's row of badges: one Graphics per effect it has carried, made on
 * first need and kept with the creep's pooled view, shown or hidden each frame.
 */
export class StatusIconRow {
  readonly container = new Container();
  private readonly badges = new Map<string, Graphics>();

  constructor() {
    this.container.eventMode = "none";
    this.container.visible = false;
  }

  /** The badges showing now, by effect id, left to right; for tests. */
  get shown(): string[] {
    return [...this.badges.entries()]
      .filter(([, badge]) => badge.visible)
      .sort(([, one], [, other]) => one.x - other.x)
      .map(([id]) => id);
  }

  /** Shows `statuses` in a row centred on `centreX` above a bar whose top is `barTop`. */
  show(statuses: readonly ActiveStatus[], centreX: number, barTop: number, alpha = 1): void {
    if (statuses.length === 0 || alpha <= 0) {
      this.hide();
      return;
    }
    for (const badge of this.badges.values()) badge.visible = false;
    const spots = statusRow(statuses.length, centreX, barTop);
    statuses.forEach(({ effect, stacks }, index) => {
      const badge = this.badge(effect);
      const spot = spots[index] as { x: number; y: number };
      badge.visible = true;
      badge.position.set(Math.round(spot.x), Math.round(spot.y));
      badge.scale.set(badgeScale(stacks));
    });
    this.container.alpha = alpha;
    this.container.visible = true;
  }

  hide(): void {
    this.container.visible = false;
    for (const badge of this.badges.values()) badge.visible = false;
  }

  destroy(): void {
    // The drawings are shared; only the Graphics over them go.
    for (const badge of this.badges.values()) badge.destroy();
    this.badges.clear();
    this.container.destroy();
  }

  private badge(effect: StatusEffect): Graphics {
    const ready = this.badges.get(effect.id);
    if (ready) return ready;
    const badge = new Graphics(badgeContext(effect));
    this.badges.set(effect.id, badge);
    this.container.addChild(badge);
    return badge;
  }
}
