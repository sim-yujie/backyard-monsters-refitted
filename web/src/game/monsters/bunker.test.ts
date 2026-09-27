import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { bunkerCapacity, bunkerContents, bunkerPutty, bunkerState, fillCost, fillRows, rowMax } from "./bunker";

/** The bunker rules the Bunker panel draws with (server: `services/yard/bunker.ts`). */

const saveOf = (extra: object = {}): BaseLoadResponse =>
  ({
    buildingdata: { "8": { id: 8, t: 22, l: 2, X: 0, Y: 0, m: { C3: 4, C100: 1 } } },
    buildinghealthdata: {},
    monsters: { housed: { C1: 12, C14: 2, C2: 0 } },
    lockerdata: { C2: { t: 2 }, C5: { t: 1 } },
    academy: {},
    ...extra,
  }) as unknown as BaseLoadResponse;

describe("bunker", () => {
  it("holds the Map Room 2 table by level, nothing while being built", () => {
    expect([0, 1, 2, 3, 4, 5].map(bunkerCapacity)).toEqual([0, 380, 450, 540, 660, 800]);
  });

  it("reads its contents from m, legacy ids merged, junk dropped", () => {
    expect(bunkerContents({ id: 1, t: 22, X: 0, Y: 0, m: { C1: 2, C100: 1, C12: 2, nope: 3, C4: -1 } })).toEqual({
      C1: 2,
      C12: 3,
    });
  });

  it("states room, use and whether it is still being built", () => {
    // Bolt 15 × 4 + Sabre (C12) 1 × its space.
    const state = bunkerState(saveOf(), 8)!;
    expect(state).toMatchObject({ id: 8, level: 2, capacity: 450, contents: { C3: 4, C12: 1 }, building: false });
    expect(state.used).toBeGreaterThan(60);
    expect(bunkerState(saveOf(), 9)).toBeNull();
    const building = bunkerState(
      saveOf({ buildingdata: { "8": { id: 8, t: 22, l: 0, cB: 60, X: 0, Y: 0 } } }),
      8,
    )!;
    expect(building).toMatchObject({ level: 0, capacity: 0, building: true });
  });

  it("costs half the hatch cost in putty, rounded down per type; Shiny per monster when bought", () => {
    const save = saveOf({ academy: { C1: { level: 3 } } });
    expect(bunkerPutty(save, "C1", 1)).toBe(337);
    expect(bunkerPutty(save, "C1", 2)).toBe(675);
    expect(fillCost(save, { C1: 2, C2: 3 }, "housing")).toEqual({ putty: 675 + 750, shiny: 0, count: 5, space: 50 });
    expect(fillCost(save, { C2: 3, C12: 1 }, "buy")).toMatchObject({ putty: 0, shiny: 6 + 65, count: 4 });
  });

  it("offers bunkerable housed monsters, or every buyable one with its lock", () => {
    const save = saveOf();
    expect(fillRows(save, "housing").map((row) => [row.monster.id, row.available])).toEqual([["C1", 12]]);
    const buy = fillRows(save, "buy");
    expect(buy.find((row) => row.monster.id === "C2")).toMatchObject({ price: 2, locked: false, available: null });
    expect(buy.find((row) => row.monster.id === "C5")).toMatchObject({ price: 16, locked: true });
    expect(buy.some((row) => row.monster.id === "C1")).toBe(false);
  });

  it("caps a row at what is available and what fits after the rest of the selection", () => {
    const save = saveOf();
    const [pokey] = fillRows(save, "housing");
    expect(rowMax(save, pokey!, {}, 500)).toBe(12);
    expect(rowMax(save, pokey!, {}, 55)).toBe(5);
    // Two Octo-ooze already take 20 of the 55.
    expect(rowMax(save, pokey!, { C2: 2, C1: 4 }, 55)).toBe(3);
    const locked = fillRows(save, "buy").find((row) => row.locked)!;
    expect(rowMax(save, locked, {}, 500)).toBe(0);
  });
});
