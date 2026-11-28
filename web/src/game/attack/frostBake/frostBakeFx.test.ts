import { describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import { FrostBakeFx, type FrostBakeHost, type FrostSet, frostAuraSet, frostFxFromUrl, KRAMPUS_ABILITY_SET, sizeOf } from "./frostBakeFx";

/** Every cell name a plan uses (pieces and flipbooks). */
const cellsOf = (node: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(node)) node.forEach((one) => cellsOf(one, found));
  else if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.cell === "string") found.add(record.cell);
    if (Array.isArray(record.flipbook)) record.flipbook.forEach((one) => typeof one === "string" && found.add(one));
    Object.values(record).forEach((one) => cellsOf(one, found));
  }
  return found;
};

const checkAtlas = (set: FrostSet): void => {
  for (const cell of cellsOf(set.plan)) {
    expect(set.cells).toContain(cell);
    expect(set.bounds[cell]).toBeDefined();
  }
  // The atlas holds only what the plan draws.
  expect([...set.cells].sort()).toEqual([...cellsOf(set.plan)].sort());
};

describe("Krampus's frost ability sets", () => {
  it("draws no aura unless the dev switch names a round-2 set", () => {
    expect(frostFxFromUrl()).toBe("current");
    expect(frostAuraSet("current")).toBeNull();
  });

  it("reads reach sizes as the circle's diameter", () => {
    expect(sizeOf("reach", 400)).toBe(400);
    expect(sizeOf("reach*0.5", 400)).toBe(200);
    expect(sizeOf("radius", 400)).toBe(200);
    expect(sizeOf(36, 400)).toBe(36);
  });

  it("plays neon's Ice Shards and Blizzard Stomp for everyone, and no aura of its own", () => {
    expect(KRAMPUS_ABILITY_SET.model).toBe("neon");
    expect(Object.keys(KRAMPUS_ABILITY_SET.plan).sort()).toEqual(["blizzardStomp", "iceShards"]);
    checkAtlas(KRAMPUS_ABILITY_SET);
  });

  it("keeps neon's solid marks steady and its mist fading, as neon answered", () => {
    const held = [...(KRAMPUS_ABILITY_SET.plan.blizzardStomp?.held ?? []), ...(KRAMPUS_ABILITY_SET.plan.iceShards?.held ?? [])];
    const hold = (cell: string): number | undefined => held.find((one) => one.cell === cell)?.hold;
    expect(hold("tower_ice_clamp")).toBe(1);
    expect(hold("flyer_chill_crystals")).toBe(1);
    expect(hold("frost_wisp_puff")).toBeLessThan(1);
    expect(hold("snow_flurry_cluster")).toBeLessThan(1);
  });

  it.each(["astra", "neon"] as const)("%s round-2 aura: only the aura, every cell in its atlas", (id) => {
    const set = frostAuraSet(id)!;
    expect(set.model).toBe(id);
    expect(set.round).toBe("round-2");
    expect(Object.keys(set.plan)).toEqual(["frostAura"]);
    checkAtlas(set);
  });

  it("says when its atlas fails to load, so the battle draws the plain shard and rings", async () => {
    const layer = new Container();
    let krampus: { id: number; level: number; feet: { x: number; y: number }; top: number; heading: number }[] = [];
    const host: FrostBakeHost = {
      air: () => layer,
      ground: () => layer,
      krampus: () => krampus,
      creep: () => null,
      tower: () => null,
      blinded: () => [],
      towerPoints: () => [],
      jolt: () => {},
      auraRadius: () => 200,
      classic: false,
      low: false,
    };
    const fx = new FrostBakeFx(KRAMPUS_ABILITY_SET, host);
    fx.update(0);
    await new Promise((done) => setTimeout(done, 0));
    // No Krampus yet: nothing is loaded, nothing failed.
    expect(fx.failed).toBe(false);
    krampus = [{ id: 1, level: 6, feet: { x: 0, y: 0 }, top: -80, heading: 0 }];
    fx.update(1);
    // The test runner has no document, so the load fails.
    await vi.waitFor(() => expect(fx.failed).toBe(true));
    fx.destroy();
  });
});
