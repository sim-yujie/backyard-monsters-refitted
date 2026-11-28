import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import { CHAMPION_ABILITY_IDS } from "@/game/combat/rules";
import {
  ABILITY_CELL,
  ABILITY_CELLS,
  AbilityBits,
  LOW_ABILITY_BITS,
  MAX_ABILITY_BITS,
  abilityCellFrame,
  abilitySheetUrl,
} from "./abilityBits";
import { AbilityPainter, abilityNoise, type CreepPlace } from "./abilityFx";

/**
 * The champion abilities' painted pieces (owner, desk card mm-abilities2,
 * 28 Nov 2026): one sheet per look, pooled sprites, a cap, fewer on low.
 */

const fakeSheet = (): Promise<Texture> =>
  Promise.resolve(new Texture({ source: new TextureSource({ width: 1152, height: 768 }) }));

const ready = async (options: { low?: boolean; classic?: boolean } = {}) => {
  const air = new Container();
  const ground = new Container();
  const bits = new AbilityBits({ air, ground: () => ground }, options.classic ?? false, options.low ?? false, fakeSheet);
  bits.preload();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { bits, air, ground };
};

const gorgo: CreepPlace = { x: 100, y: 200, top: 140, mid: { x: 100, y: 170 } };

describe("AbilityBits", () => {
  it("lays its 24 cells six across in 192 px squares, one sheet per look", () => {
    expect(ABILITY_CELLS).toHaveLength(24);
    expect(abilityCellFrame("stone")).toMatchObject({ x: 0, y: 0, width: ABILITY_CELL });
    expect(abilityCellFrame("drops")).toMatchObject({ x: ABILITY_CELL, y: ABILITY_CELL });
    expect(abilityCellFrame("burst")).toMatchObject({ x: 5 * ABILITY_CELL, y: 3 * ABILITY_CELL });
    expect(abilitySheetUrl(false)).toContain("ability-fx.modern.webp");
    expect(abilitySheetUrl(true)).toContain("ability-fx.classic.webp");
  });

  it("throws nothing before the sheet is in", () => {
    const bits = new AbilityBits(
      { air: new Container(), ground: () => new Container() },
      false,
      false,
      () => new Promise<Texture>(() => undefined),
    );
    expect(bits.emit(0, { cell: "shard", at: { x: 0, y: 0 } })).toBe(false);
    expect(bits.spot({ cell: "bubble", at: { x: 0, y: 0 }, size: 40, alpha: 1 })).toBe(false);
    expect(bits.stoneTiles()).toBeNull();
  });

  it("stops at its cap, full and low", async () => {
    for (const [low, cap] of [
      [false, MAX_ABILITY_BITS],
      [true, LOW_ABILITY_BITS],
    ] as const) {
      const { bits } = await ready({ low });
      for (let index = 0; index < cap + 30; index += 1) bits.emit(0, { cell: "shard", at: { x: 0, y: 0 } });
      expect(bits.bitCount).toBe(cap);
      bits.destroy();
    }
  });

  it("puts ground pieces under the creeps and the rest over them, and lets them go after their life", async () => {
    const { bits, air, ground } = await ready();
    bits.emit(10, { cell: "crack", at: { x: 0, y: 0 }, ground: true, life: 20 });
    bits.emit(10, { cell: "shard", at: { x: 0, y: 0 }, life: 5 });
    expect(ground.children).toHaveLength(1);
    expect(air.children).toHaveLength(1);
    bits.update(16);
    expect(bits.bitCount).toBe(1);
    bits.update(31);
    expect(bits.bitCount).toBe(0);
    bits.destroy();
  });

  it("holds a spot for one frame only", async () => {
    const { bits } = await ready();
    bits.begin();
    bits.spot({ cell: "bubble", at: { x: 0, y: 0 }, size: 40, alpha: 1 });
    expect(bits.drawnCount).toBe(1);
    bits.begin();
    expect(bits.drawnCount).toBe(0);
    bits.destroy();
  });

  it("flies a piece to a point that moves, arriving where it is at the end", async () => {
    const { bits, air } = await ready();
    let target = { x: 200, y: 100 };
    bits.emit(0, { cell: "glob", at: { x: 0, y: 0 }, to: () => target, arc: 30, life: 10 });
    target = { x: 300, y: 50 };
    bits.update(10);
    const sprite = air.children[0]!;
    expect(sprite.x).toBeCloseTo(300);
    expect(sprite.y).toBeCloseTo(50);
    bits.destroy();
  });
});

describe("AbilityPainter", () => {
  it("throws pieces for every ability, the same ones every time", async () => {
    for (const ability of Object.values(CHAMPION_ABILITY_IDS).flat()) {
      const counts: number[] = [];
      for (let run = 0; run < 2; run += 1) {
        const { bits } = await ready();
        const painter = new AbilityPainter(bits, false);
        const to = { at: { x: 180, y: 160 }, follow: null };
        painter.cast(100, ability, gorgo, () => gorgo, 150, ability === "pounce" ? null : to, 7);
        if (ability === "pounce") painter.cast(100, ability, gorgo, () => gorgo, 0, to, 7);
        if (ability === "bloodthirst") painter.bloodthirst(100, { x: 180, y: 160 }, () => gorgo, 7);
        counts.push(bits.bitCount);
        bits.destroy();
      }
      expect(counts[0], ability).toBeGreaterThan(0);
      expect(counts[1], ability).toBe(counts[0]);
    }
  });

  it("throws fewer pieces on low effects", async () => {
    const full = await ready();
    const low = await ready({ low: true });
    new AbilityPainter(full.bits, false).cast(0, "groundSlam", gorgo, () => gorgo, 150, null, 1);
    new AbilityPainter(low.bits, false).cast(0, "groundSlam", gorgo, () => gorgo, 150, null, 1);
    expect(low.bits.bitCount).toBeLessThan(full.bits.bitCount);
  });

  it("lays Classic's pieces over the yard, never in added light", async () => {
    const { bits, air, ground } = await ready({ classic: true });
    const painter = new AbilityPainter(bits, true);
    painter.cast(0, "chestPound", gorgo, () => gorgo, 250, null, 3);
    painter.cast(0, "healingMist", gorgo, () => gorgo, 250, null, 3);
    painter.bubbleOn(0, gorgo, 1);
    for (const child of [...air.children, ...ground.children]) expect(child.blendMode).not.toBe("add");
  });

  it("draws held states each frame: a bubble, a target mark, dizzy stars", async () => {
    const { bits } = await ready();
    const painter = new AbilityPainter(bits, false);
    bits.begin();
    painter.bubbleOn(5, gorgo, 1);
    painter.taunt(5, { x: 0, y: 0 }, { x: 200, y: 100 }, 2);
    painter.dizzy(5, { x: 0, y: 0 }, 3);
    expect(bits.drawnCount).toBeGreaterThanOrEqual(1 + 1 + 3);
  });

  it("draws nothing while the sheet is on its way", () => {
    const bits = new AbilityBits(
      { air: new Container(), ground: () => new Container() },
      false,
      false,
      () => new Promise<Texture>(() => undefined),
    );
    const painter = new AbilityPainter(bits, false);
    expect(painter.ready).toBe(false);
  });

  it("keeps its noise between 0 and 1 and fixed by its seeds", () => {
    for (let n = 0; n < 50; n += 1) {
      const value = abilityNoise(n, n * 3, 7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(abilityNoise(n, n * 3, 7)).toBe(value);
    }
  });
});
