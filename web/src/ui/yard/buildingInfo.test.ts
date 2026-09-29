import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { readYard, type YardBuilding } from "@/game/yard/yardModel";
import {
  bombResources,
  buildingInfo,
  damagePerSecond,
  townHallUnlocks,
} from "./buildingInfo";

/**
 * The per-type info rows (WP1.5: "tower numbers from `TOWER_STATS`").
 *
 * The expected figures are worked by hand from the generated tables, so a
 * regenerated table that changes a number fails here rather than silently
 * changing what the panel says. Cannon Tower level 4 is range 190, damage 80
 * every 40 ticks; level 5 is 200 and 100. Sniper Tower level 1 is 300 and 100
 * every 80 ticks; level 2 is 308 and 210.
 */

const one = (data: Partial<BuildingData> & { t: number }): YardBuilding => {
  const save = {
    error: 0,
    currenttime: 1_000,
    savetime: 1_000,
    buildingdata: { "1": { id: 1, X: 0, Y: 0, ...data } },
  } as unknown as BaseLoadResponse;
  const found = readYard(save).buildings[0];
  if (!found) throw new Error("no building");
  return found;
};

const rowsOf = (data: Partial<BuildingData> & { t: number }) => buildingInfo(one(data)).rows;
const row = (data: Partial<BuildingData> & { t: number }, label: string) =>
  rowsOf(data).find((entry) => entry.label === label);

describe("towers", () => {
  it("damage per second is int(damage × 40 / rate), as the original's upgrade text", () => {
    expect(damagePerSecond(80, 40)).toBe(80);
    expect(damagePerSecond(100, 80)).toBe(50);
    expect(damagePerSecond(1100, 80)).toBe(550);
    expect(damagePerSecond(10, 0)).toBe(0);
  });

  it("Cannon Tower 4: range 190 → 200, damage 80/s → 100/s", () => {
    expect(row({ t: 20, l: 4 }, "Range")).toEqual({
      label: "Range",
      now: { text: "190" },
      next: { text: "200" },
    });
    expect(row({ t: 20, l: 4 }, "Damage")).toEqual({
      label: "Damage",
      now: { text: "80/s" },
      next: { text: "100/s" },
    });
  });

  it("Sniper Tower 1: range 300 → 308, damage 50/s → 105/s", () => {
    expect(row({ t: 21, l: 1 }, "Range")?.next).toEqual({ text: "308" });
    expect(row({ t: 21, l: 1 }, "Damage")).toMatchObject({
      now: { text: "50/s" },
      next: { text: "105/s" },
    });
  });

  it("marks a next level that hits softer instead of showing it as a gain", () => {
    // Tesla Tower 1 → 2 trades damage per second for range in the props table.
    expect(row({ t: 25, l: 1 }, "Damage")).toMatchObject({
      now: { text: "400/s" },
      next: { text: "320/s" },
      down: true,
    });
    expect(row({ t: 25, l: 1 }, "Range")?.down).toBeUndefined();
  });

  it("a tower at its top level has no next value", () => {
    const damage = row({ t: 20, l: 10 }, "Damage");
    expect(damage?.now).toEqual({ text: "200/s" });
    expect(damage?.next).toBeUndefined();
  });

  it("health leads the rows", () => {
    expect(rowsOf({ t: 20, l: 4 })[0]?.label).toBe("Health");
  });
});

describe("Flinger", () => {
  it("attack range in cells and fling capacity, now and next", () => {
    expect(row({ t: 5, l: 1 }, "Attack range")).toMatchObject({
      now: { text: "4 cells" },
      next: { text: "6 cells" },
    });
    expect(row({ t: 5, l: 1 }, "Fling capacity")).toMatchObject({
      now: { text: "500" },
      next: { text: "1,000" },
    });
    expect(row({ t: 5, l: 4 }, "Attack range")).toEqual({
      label: "Attack range",
      now: { text: "10 cells" },
    });
  });
});

describe("Catapult", () => {
  it("unlocks twig bombs at 1, pebble at 2, putty at 3", () => {
    expect(bombResources(1)).toEqual(["r1"]);
    expect(bombResources(2)).toEqual(["r1", "r2"]);
    expect(bombResources(3)).toEqual(["r1", "r2", "r3"]);
    expect(row({ t: 51, l: 1 }, "Bombs")).toMatchObject({
      now: { resources: ["r1"] },
      next: { resources: ["r1", "r2"] },
    });
  });

  it("level 3 to 4 adds no bomb, so no next value", () => {
    expect(row({ t: 51, l: 3 }, "Bombs")?.next).toBeUndefined();
  });
});

describe("economy buildings", () => {
  it("Storage Silo 1: 7,500 → 15,000 added to each resource", () => {
    expect(row({ t: 6, l: 1 }, "Storage added")).toMatchObject({
      now: { amount: 7_500 },
      next: { amount: 15_000 },
    });
  });

  it("Twig Snapper 1: 720 twigs an hour → 1,440, holding 720 → 2,160", () => {
    expect(row({ t: 1, l: 1 }, "Makes")).toMatchObject({
      now: { resource: "r1", amount: 720, suffix: "/h" },
      next: { resource: "r1", amount: 1_440 },
    });
    expect(row({ t: 1, l: 1 }, "Holds")).toMatchObject({
      now: { resource: "r1", amount: 720 },
      next: { resource: "r1", amount: 2_160 },
    });
  });

  it("each harvester makes its own resource", () => {
    expect(row({ t: 4, l: 1 }, "Makes")?.now).toMatchObject({ resource: "r4" });
  });
});

describe("Town Hall", () => {
  it("lists what the next level lets the yard build", () => {
    expect(townHallUnlocks(0)).toContain("Flinger (new)");
    expect(townHallUnlocks(1)).toContain("Storage Silo +1");
    // The Town Hall itself is not something a Town Hall unlocks.
    expect(townHallUnlocks(1).some((item) => item.startsWith("Town Hall"))).toBe(false);
  });

  it("the panel titles the list with the next level", () => {
    const info = buildingInfo(one({ t: 14, l: 1 }));
    expect(info.list?.label).toBe("Town Hall 2 unlocks");
    expect(info.list?.items).toContain("Storage Silo +1");
  });

  it("a Town Hall at the top has no list", () => {
    expect(buildingInfo(one({ t: 14, l: 10 })).list).toBeNull();
  });
});

describe("on an outpost (#191)", () => {
  const onOutpost = (data: Partial<BuildingData> & { t: number }) => {
    const save = {
      error: 0,
      currenttime: 1_000,
      savetime: 1_000,
      type: "outpost",
      buildingdata: { "1": { id: 1, X: 0, Y: 0, ...data } },
    } as unknown as BaseLoadResponse;
    return buildingInfo(readYard(save).buildings[0]!, "outpost").rows;
  };
  const label = (rows: ReturnType<typeof onOutpost>, name: string) => rows.find((entry) => entry.label === name);

  it("stops at the outpost's level cap: a level 6 Laser has no next level there", () => {
    expect(label(onOutpost({ t: 23, l: 6 }), "Damage")?.next).toBeUndefined();
    expect(row({ t: 23, l: 6 }, "Damage")?.next).toBeDefined();
  });

  it("reads the core's 200,000 health from the outpost table", () => {
    expect(label(onOutpost({ t: 112, l: 1 }), "Health")?.now).toEqual({ text: "200,000 / 200,000" });
  });

  it("gives an outpost Flinger one cell a level", () => {
    expect(label(onOutpost({ t: 5, l: 2 }), "Attack range")).toMatchObject({
      now: { text: "2 cells" },
      next: { text: "3 cells" },
    });
    expect(row({ t: 5, l: 2 }, "Attack range")?.now).toEqual({ text: "6 cells" });
  });

  it("shows an autobanking harvester's rate but no buffer", () => {
    const rows = onOutpost({ t: 1, l: 3 });
    expect(label(rows, "Makes")).toBeDefined();
    expect(label(rows, "Holds")).toBeUndefined();
    expect(row({ t: 1, l: 3 }, "Holds")).toBeDefined();
  });
});
