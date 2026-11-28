import { describe, expect, it } from "vitest";
import { type FrostSet, frostAuraSet, frostFxFromUrl, KRAMPUS_ABILITY_SET, sizeOf } from "./frostBakeFx";

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
});
