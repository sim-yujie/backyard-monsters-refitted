import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import type { CreepSnapshot } from "@/game/combat/rules";
import {
  BADGE_GAP,
  BADGE_RADIUS,
  STATUS_EFFECTS,
  StatusIconRow,
  badgeContext,
  badgeScale,
  statusRow,
  statusesOf,
  type GlyphName,
  type StatusEffect,
} from "./statusIcons";

/**
 * The status badges' arithmetic and their row without a renderer: which
 * effects a snapshot carries, where the row sits over the bar, how a stacking
 * venom grows, and that a badge comes and goes with its effect.
 */

const creepOf = (overrides: Partial<CreepSnapshot> = {}): CreepSnapshot => ({
  id: 1,
  monsterId: "C1",
  level: 1,
  champion: false,
  friendly: false,
  ix: 100,
  iy: 100,
  hp: 200,
  maxHp: 200,
  flying: false,
  state: "walking",
  targetBuilding: -1,
  targetCreep: -1,
  ...overrides,
});

const idsOf = (creep: CreepSnapshot | null): string[] =>
  statusesOf(creep).map(({ effect }) => effect.id);

describe("statusesOf", () => {
  it("finds nothing on a plain creep, or on no creep", () => {
    expect(idsOf(null)).toEqual([]);
    expect(idsOf(creepOf())).toEqual([]);
    // The engine sends false for an effect that is off; that is no badge.
    expect(idsOf(creepOf({ burning: false, enraged: false, puttied: false, lootBoosted: false }))).toEqual([]);
  });

  it("reads each effect the engine reports", () => {
    expect(idsOf(creepOf({ poisonStacks: 1 }))).toEqual(["poisoned"]);
    expect(idsOf(creepOf({ burning: true }))).toEqual(["burning"]);
    expect(idsOf(creepOf({ enraged: true }))).toEqual(["enraged"]);
    expect(idsOf(creepOf({ puttied: true }))).toEqual(["puttied"]);
    expect(idsOf(creepOf({ lootBoosted: true }))).toEqual(["lootBoosted"]);
  });

  it("keeps the registry's order whatever order the flags are in, and carries the venom's stacks", () => {
    const all = statusesOf(creepOf({ lootBoosted: true, burning: true, poisonStacks: 4, enraged: true }));
    expect(all.map(({ effect }) => effect.id)).toEqual(["poisoned", "burning", "enraged", "lootBoosted"]);
    expect(all[0]?.stacks).toBe(4);
    expect(all[1]?.stacks).toBe(1);
  });

  it("takes a new effect from one registry line", () => {
    const slowed: StatusEffect = {
      id: "slowed",
      label: "Slowed",
      colour: 0x4aa3ff,
      glyph: "chevronsDown",
      stacks: (c) => (c.flying ? 1 : 0),
    };
    const effects = [...STATUS_EFFECTS, slowed];
    expect(statusesOf(creepOf({ flying: true, burning: true }), effects).map(({ effect }) => effect.id)).toEqual([
      "burning",
      "slowed",
    ]);
  });
});

describe("the registry", () => {
  it("gives every effect its own id and its own colour", () => {
    const ids = STATUS_EFFECTS.map((effect) => effect.id);
    const colours = STATUS_EFFECTS.map((effect) => effect.colour);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("draws every glyph, the ones still waiting for an effect too", () => {
    const glyphs: GlyphName[] = ["drop", "flame", "brows", "blob", "coin", "chevronsDown", "stars", "snowflake"];
    for (const glyph of glyphs) {
      const context = badgeContext({ id: `t-${glyph}`, label: glyph, colour: 0x123456, glyph, stacks: () => 0 });
      const bounds = context.bounds;
      // Everything inside the disc: the glyph never pokes out of its badge.
      expect(bounds.minX).toBeGreaterThanOrEqual(-BADGE_RADIUS - 1);
      expect(bounds.maxX).toBeLessThanOrEqual(BADGE_RADIUS + 1);
      expect(bounds.minY).toBeGreaterThanOrEqual(-BADGE_RADIUS - 1);
      expect(bounds.maxY).toBeLessThanOrEqual(BADGE_RADIUS + 1);
    }
  });

  it("shares one drawing per effect", () => {
    const [venom] = STATUS_EFFECTS;
    expect(badgeContext(venom as StatusEffect)).toBe(badgeContext(venom as StatusEffect));
  });
});

describe("statusRow", () => {
  it("puts one badge over the middle of the bar, just above it", () => {
    expect(statusRow(1, 50, 20)).toEqual([{ x: 50, y: 20 - BADGE_GAP - BADGE_RADIUS }]);
  });

  it("spreads a longer row evenly both ways from the middle", () => {
    const row = statusRow(3, 50, 20);
    const step = BADGE_RADIUS * 2 + BADGE_GAP;
    expect(row.map((spot) => spot.x)).toEqual([50 - step, 50, 50 + step]);
    expect(new Set(row.map((spot) => spot.y)).size).toBe(1);
    const pair = statusRow(2, 50, 20);
    expect(((pair[0]?.x ?? 0) + (pair[1]?.x ?? 0)) / 2).toBe(50);
  });
});

describe("badgeScale", () => {
  it("grows a little with each stack past the first, then stops", () => {
    expect(badgeScale(1)).toBe(1);
    expect(badgeScale(2)).toBeGreaterThan(1);
    expect(badgeScale(3)).toBeGreaterThan(badgeScale(2));
    expect(badgeScale(50)).toBe(badgeScale(5));
    expect(badgeScale(0)).toBe(1);
  });
});

describe("StatusIconRow", () => {
  it("starts hidden and shows what it is given, left to right", () => {
    const row = new StatusIconRow();
    expect(row.container.visible).toBe(false);
    row.show(statusesOf(creepOf({ burning: true, poisonStacks: 2 })), 50, 20);
    expect(row.container.visible).toBe(true);
    expect(row.shown).toEqual(["poisoned", "burning"]);
    row.destroy();
  });

  it("drops a badge when its effect ends, and hides when none is left", () => {
    const row = new StatusIconRow();
    row.show(statusesOf(creepOf({ burning: true, poisonStacks: 2 })), 50, 20);
    row.show(statusesOf(creepOf({ burning: true })), 50, 20);
    expect(row.shown).toEqual(["burning"]);
    // The one badge left moves to the middle.
    const flame = row.container.children.find((child) => child.visible) as Graphics;
    expect(flame.x).toBe(50);
    row.show(statusesOf(creepOf()), 50, 20);
    expect(row.container.visible).toBe(false);
    expect(row.shown).toEqual([]);
    row.destroy();
  });

  it("makes one badge per effect and reuses it, scaled by its stacks", () => {
    const row = new StatusIconRow();
    row.show(statusesOf(creepOf({ poisonStacks: 1 })), 0, 0);
    row.show(statusesOf(creepOf({ poisonStacks: 3 })), 0, 0);
    expect(row.container.children).toHaveLength(1);
    expect(row.container.children[0]?.scale.x).toBe(badgeScale(3));
    row.destroy();
  });

  it("fades with the creep, and hides for one that cannot be seen at all", () => {
    const row = new StatusIconRow();
    row.show(statusesOf(creepOf({ burning: true })), 0, 0, 0.3);
    expect(row.container.alpha).toBe(0.3);
    row.show(statusesOf(creepOf({ burning: true })), 0, 0, 0);
    expect(row.container.visible).toBe(false);
    row.destroy();
  });
});
