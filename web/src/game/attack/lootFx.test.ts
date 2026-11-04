import { describe, expect, it } from "vitest";
import { Container, Texture } from "pixi.js";
import type { BattleVisualEvent } from "@/game/combat/rules/engine";
import type { CollectFxArt, PackageDot } from "@/game/yard/CollectFxLayer";
import { LABEL_TICKS } from "./creepFx";
import {
  LOOT_BOUNCE_TICKS,
  LOOT_FADE_FROM,
  LOOT_LABEL_LIFT,
  LOOT_LABEL_MAX,
  LOOT_ORB_MAX,
  LOOT_ORB_TICKS,
  LootFx,
  bounceOut,
  lootColour,
  lootDot,
  lootOrbPose,
  lootText,
} from "./lootFx";

/** Loot orbs and numbers during an attack, as Flash's `ParticleLoot` and `ParticleText` (owner, 4 Nov 2026). */

const artOf = (): CollectFxArt & { asked: PackageDot[] } => {
  const asked: PackageDot[] = [];
  return {
    asked,
    dot(resource) {
      asked.push(resource);
      return Texture.WHITE;
    },
    shadow: Texture.WHITE,
    destroy() {},
  };
};

const loot = (tick: number, extra: Partial<Extract<BattleVisualEvent, { kind: "loot" }>> = {}): BattleVisualEvent => ({
  kind: "loot",
  tick,
  buildingId: 1,
  resource: 1,
  amount: 42,
  vacuum: false,
  ...extra,
});

const fxOf = (options: { inferno?: boolean; raided?: boolean; reducedMotion?: boolean } = {}) => {
  const air = new Container();
  const labels = new Container();
  const art = artOf();
  const fx = new LootFx(
    {
      air: () => air,
      labels: () => labels,
      building: (id) => (id === 1 ? { worldX: 100, worldY: 200, footprint: [40, 40] } : null),
      zoom: () => 2,
    },
    { inferno: options.inferno ?? false, raided: options.raided ?? false, reducedMotion: options.reducedMotion ?? false, art, random: () => 1 },
  );
  return { fx, air, labels, art };
};

describe("an orb's flight (`ParticleLoot.Launch`)", () => {
  it("bounces as gs Bounce.easeOut: 0 at the start, 1 at the end, a hop between", () => {
    expect(bounceOut(0)).toBe(0);
    expect(bounceOut(1)).toBeCloseTo(1, 9);
    expect(bounceOut(1 / 2.75)).toBeCloseTo(1, 9);
    expect(bounceOut(1.5 / 2.75)).toBeCloseTo(0.75, 9);
  });

  it("starts r of 35% of the footprint off the anchor, lands its dot on its shadow, slides as far again", () => {
    // A 40 x 40 footprint is an 80 x 40 px diamond: 28 px across, 14 down at 35%.
    const start = lootOrbPose(0, 1, [40, 40]);
    expect(start).toMatchObject({ dotX: 28, dotY: 14, shadowX: 28, shadowY: 21, alpha: 1 });
    const landed = lootOrbPose(LOOT_BOUNCE_TICKS, 1, [40, 40]);
    expect(landed.dotY).toBeCloseTo(21, 9);
    const end = lootOrbPose(LOOT_ORB_TICKS, 1, [40, 40]);
    expect(end.dotX).toBeCloseTo(56, 9);
    expect(end.alpha).toBe(0);
    // Opaque until 1.5 s, then fading.
    expect(lootOrbPose(LOOT_FADE_FROM, -1, [40, 40]).alpha).toBe(1);
    expect(lootOrbPose(LOOT_FADE_FROM + 10, -1, [40, 40]).alpha).toBeLessThan(1);
    expect(lootOrbPose(LOOT_ORB_TICKS / 2, -1, [40, 40]).dotX).toBeLessThan(-28);
  });

  it("sits on its shadow without sliding when motion is reduced", () => {
    const pose = lootOrbPose(LOOT_ORB_TICKS / 2, 1, [40, 40], true);
    expect(pose).toMatchObject({ dotX: 28, dotY: 21, shadowY: 21 });
  });
});

describe("the ball and the number (`ParticleDamageItem.getLootColor`)", () => {
  it("uses the Inferno's resources on an Inferno yard (`param1 += 4`)", () => {
    expect([1, 2, 3, 4].map((resource) => lootDot(resource, false))).toEqual(["r1", "r2", "r3", "r4"]);
    expect([1, 2, 3, 4].map((resource) => lootDot(resource, true))).toEqual(["bone", "coal", "sulfur", "magma"]);
    expect([1, 2, 3, 4].map((resource) => lootColour(resource, false))).toEqual([0x723228, 0x999999, 0xff00ff, 0x00ff00]);
    expect([1, 2, 3, 4].map((resource) => lootColour(resource, true))).toEqual([0xf0e6c5, 0x3f3b36, 0xeeed71, 0xd95300]);
  });

  it("reads +N in an attack and -N when the player's own yard is raided", () => {
    expect(lootText(125, false)).toBe("+125");
    expect(lootText(125, true)).toBe("-125");
  });
});

describe("LootFx", () => {
  it("pops an orb and a +N number 35 px over the building's anchor, and both go in time", () => {
    const { fx, air, labels, art } = fxOf();
    fx.onEvent(loot(10));
    fx.update(10);
    expect(fx.shown).toEqual({ orbs: 1, labels: 1, texts: ["+42"] });
    expect(art.asked).toEqual(["r1"]);
    expect(air.children.length).toBe(2);
    const text = (labels.children[0] as Container).children[0]!;
    expect(text.position.x).toBe(100);
    expect(text.position.y).toBe(200 - LOOT_LABEL_LIFT);
    // Numbers keep their size on screen.
    expect(text.scale.x).toBe(0.5);
    fx.update(10 + LABEL_TICKS + 1);
    expect(fx.shown.labels).toBe(0);
    expect(fx.shown.orbs).toBe(1);
    fx.update(10 + LOOT_ORB_TICKS);
    expect(fx.shown.orbs).toBe(0);
    fx.destroy();
  });

  it("draws Inferno balls on an Inferno yard and -N on a raided one", () => {
    const { fx, art } = fxOf({ inferno: true, raided: true });
    fx.onEvent(loot(1, { resource: 3 }));
    expect(art.asked).toEqual(["sulfur"]);
    expect(fx.shown.texts).toEqual(["-42"]);
    fx.destroy();
  });

  it("shows only the number for the Vacuum Hose's take, whose ball the hose draws", () => {
    const { fx } = fxOf();
    fx.onEvent(loot(1, { vacuum: true, amount: 625 }));
    expect(fx.shown).toEqual({ orbs: 0, labels: 1, texts: ["+625"] });
    fx.destroy();
  });

  it("ignores other events and unknown buildings", () => {
    const { fx } = fxOf();
    fx.onEvent({ kind: "quake", tick: 1, creepId: 1, ix: 0, iy: 0, radius: 10 });
    fx.onEvent(loot(1, { buildingId: 99 }));
    expect(fx.shown.orbs + fx.shown.labels).toBe(0);
    fx.destroy();
  });

  it("keeps at most forty orbs and twenty numbers at once", () => {
    const { fx } = fxOf();
    for (let index = 0; index < 60; index += 1) fx.onEvent(loot(1));
    expect(fx.shown.orbs).toBe(LOOT_ORB_MAX);
    expect(fx.shown.labels).toBe(LOOT_LABEL_MAX);
    fx.destroy();
  });
});
