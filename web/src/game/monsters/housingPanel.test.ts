import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import type { HousingBuildingRow } from "./housing";
import { housingBlocks, livingHere, sharedRoom, waitingForRoom, waitingText } from "./housingPanel";

/** The Housing panel's figures (#170): the blocks, the waiting monsters and the army's order. */

const row = (id: number, capacity: number, extra: Partial<HousingBuildingRow> = {}): HousingBuildingRow => ({
  id,
  level: 6,
  capacity,
  zero: null,
  upgrading: false,
  ...extra,
});

describe("housingBlocks", () => {
  it("fills the Housings in order, each before the next", () => {
    const blocks = housingBlocks([row(1, 540), row(2, 540), row(3, 540), row(4, 540)], 2_150);
    expect(blocks.map((block) => block.used)).toEqual([540, 540, 540, 530]);
    expect(blocks[3]!.fraction).toBeCloseTo(0.981, 3);
  });

  it("leaves the later Housings empty, and a zero Housing at nothing", () => {
    const blocks = housingBlocks([row(1, 200), row(2, 0, { zero: "building" }), row(3, 200)], 250);
    expect(blocks.map((block) => [block.used, block.fraction])).toEqual([
      [200, 1],
      [0, 0],
      [50, 0.25],
    ]);
  });

  it("stops at full when the army is over capacity", () => {
    expect(housingBlocks([row(1, 100)], 150).map((block) => block.fraction)).toEqual([1]);
  });
});

describe("sharedRoom", () => {
  it("is the one room every Housing has, or null", () => {
    expect(sharedRoom([row(1, 540), row(2, 540)])).toBe(540);
    expect(sharedRoom([row(1, 540), row(2, 380)])).toBeNull();
    expect(sharedRoom([row(1, 0, { zero: "damaged" })])).toBeNull();
    expect(sharedRoom([])).toBeNull();
  });
});

describe("waitingForRoom and waitingText", () => {
  const save = (h: string[], hstage: number[]): BaseLoadResponse =>
    ({ monsters: { h: h.map((id) => [id, 0]), hstage } }) as unknown as BaseLoadResponse;

  it("lists the hatched monsters waiting for room, one entry per type", () => {
    const waiting = waitingForRoom(save(["C14", "C3", "C14", "C1"], [2, 2, 2, 1]));
    expect(waiting.map((entry) => [entry.monster.id, entry.count, entry.each])).toEqual([
      ["C14", 2, 70],
      ["C3", 1, 15],
    ]);
  });

  it("says what waits, how much room it needs and that the hatcheries are paused", () => {
    expect(waitingText(waitingForRoom(save(["C14", "C3"], [2, 2])))).toEqual({
      title: "2 monsters are waiting for room",
      text: "A Teratorn (70) and a Bolt (15) have hatched. They move in by themselves once 85 spaces are free. Until then those 2 hatcheries are paused.",
    });
    expect(waitingText(waitingForRoom(save(["C5"], [2])))).toEqual({
      title: "1 monster is waiting for room",
      text: "An Eye-ra (60) has hatched. It moves in by itself once 60 spaces are free. Until then its hatchery is paused.",
    });
    expect(waitingText(waitingForRoom(save(["C1", "C1", "C3"], [2, 2, 2])))!.text).toBe(
      "2 Pokey (10 each) and a Bolt (15) have hatched. They move in by themselves once 35 spaces are free. Until then those 3 hatcheries are paused.",
    );
  });

  it("is nothing when no hatchery waits", () => {
    expect(waitingForRoom(save(["C14", ""], [1, 2]))).toEqual([]);
    expect(waitingText([])).toBeNull();
  });
});

describe("livingHere", () => {
  it("puts the biggest space first", () => {
    const rows = livingHere({ monsters: { housed: { C1: 16, C14: 10, C15: 2, C3: 10 } } } as unknown as BaseLoadResponse);
    expect(rows.map((one) => [one.monster.id, one.total])).toEqual([
      ["C14", 700],
      ["C15", 400],
      ["C1", 160],
      ["C3", 150],
    ]);
  });
});
