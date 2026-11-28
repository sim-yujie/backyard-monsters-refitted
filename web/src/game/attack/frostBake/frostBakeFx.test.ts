import { describe, expect, it } from "vitest";
import { frostFxFromUrl, frostSet, sizeOf } from "./frostBakeFx";

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

describe("krampus-fx bake-off sets", () => {
  it("draws today's look unless the dev switch names a set", () => {
    expect(frostFxFromUrl()).toBe("current");
    expect(frostSet("current")).toBeNull();
  });

  it("reads reach sizes as the circle's diameter", () => {
    expect(sizeOf("reach", 400)).toBe(400);
    expect(sizeOf("reach*0.5", 400)).toBe(200);
    expect(sizeOf("radius", 400)).toBe(200);
    expect(sizeOf(36, 400)).toBe(36);
  });

  it.each(["astra", "neon"] as const)("%s: every cell its plan names is in its atlas, with bounds", (id) => {
    const set = frostSet(id)!;
    for (const cell of cellsOf(set.plan)) {
      expect(set.cells).toContain(cell);
      expect(set.bounds[cell]).toBeDefined();
    }
    expect(Object.keys(set.plan).sort()).toEqual(["blizzardStomp", "frostAura", "iceShards"]);
  });
});
