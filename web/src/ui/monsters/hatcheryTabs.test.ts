import { describe, expect, it } from "vitest";
import type { HatcheryView } from "@/game/monsters/hatchPlan";
import { hatcheryTabs, hatchTabKey, loadHatchTab, saveHatchTab, tabAfterKey } from "./hatcheryTabs";

/** The strip of hatchery tabs on the Hatch tab (owner, 28 Oct): which tabs, their lights, the keys, the memory. */

const view = (id: number, extra: Partial<HatcheryView> = {}): HatcheryView => ({
  id,
  level: 3,
  monster: null,
  paidLevel: 0,
  countdown: 0,
  stage: 0,
  queue: [],
  stackLimit: 4,
  canTake: true,
  works: true,
  state: "idle",
  endsAt: null,
  ...extra,
});

/** A plain in-memory Storage. */
const memory = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
};

describe("hatcheryTabs", () => {
  const numbers = new Map([
    [10, 1],
    [11, 2],
    [12, 3],
  ]);

  it("makes one tab per hatchery, in the yard's numbering", () => {
    const tabs = hatcheryTabs(
      {
        hatcheries: [
          view(12, { level: 1 }),
          view(10, {
            monster: "C3",
            state: "producing",
            endsAt: 500,
            queue: [
              ["C1", 20, 1],
              ["C1", 5, 1],
            ],
          }),
          view(11, { level: 2 }),
        ],
        hcc: null,
      },
      numbers,
    );
    expect(tabs).toEqual([
      { id: 10, number: 1, level: 3, state: "producing", light: "busy", monster: "C3", endsAt: 500, waiting: 25 },
      { id: 11, number: 2, level: 2, state: "idle", light: "idle", monster: null, endsAt: null, waiting: 0 },
      { id: 12, number: 3, level: 1, state: "idle", light: "idle", monster: null, endsAt: null, waiting: 0 },
    ]);
  });

  it("lights a held-up hatchery amber and a damaged one red, with no countdown", () => {
    const tabs = hatcheryTabs(
      {
        hatcheries: [
          view(10, { monster: "C1", state: "stalled", endsAt: 400 }),
          view(11, { state: "damaged" }),
          view(12, { monster: "C1", state: "upgrading", endsAt: 400 }),
        ],
        hcc: null,
      },
      numbers,
    );
    expect(tabs.map((tab) => [tab.light, tab.endsAt])).toEqual([
      ["held", null],
      ["broken", null],
      ["held", null],
    ]);
  });

  it("makes no tabs for a lone hatchery, none, or an HCC's shared queue", () => {
    expect(hatcheryTabs({ hatcheries: [view(10)], hcc: null }, numbers)).toEqual([]);
    expect(hatcheryTabs({ hatcheries: [], hcc: null }, numbers)).toEqual([]);
    expect(hatcheryTabs({ hatcheries: [view(10), view(11)], hcc: { id: 50, works: true } }, numbers)).toEqual([]);
  });
});

describe("tabAfterKey", () => {
  const ids = [10, 11, 12];

  it("moves with the arrows, wrapping round, and jumps with Home and End", () => {
    expect(tabAfterKey(ids, 10, "ArrowRight")).toBe(11);
    expect(tabAfterKey(ids, 12, "ArrowRight")).toBe(10);
    expect(tabAfterKey(ids, 10, "ArrowLeft")).toBe(12);
    expect(tabAfterKey(ids, 11, "ArrowDown")).toBe(12);
    expect(tabAfterKey(ids, 11, "ArrowUp")).toBe(10);
    expect(tabAfterKey(ids, 11, "Home")).toBe(10);
    expect(tabAfterKey(ids, 11, "End")).toBe(12);
  });

  it("ignores other keys and an empty strip", () => {
    expect(tabAfterKey(ids, 10, "Enter")).toBeNull();
    expect(tabAfterKey([], 10, "ArrowRight")).toBeNull();
  });
});

describe("the remembered tab", () => {
  it("keeps one per yard: the main yard, the Inferno, each outpost", () => {
    expect(hatchTabKey("main")).toBe("bymr.hatchTab.main");
    expect(hatchTabKey("inferno")).toBe("bymr.hatchTab.inferno");
    expect(hatchTabKey("outpost", "4012")).toBe("bymr.hatchTab.outpost.4012");
  });

  it("saves and loads a hatchery id", () => {
    const storage = memory();
    expect(loadHatchTab("k", storage)).toBeNull();
    saveHatchTab("k", 11, storage);
    expect(loadHatchTab("k", storage)).toBe(11);
  });

  it("trusts nothing that is not an id", () => {
    const storage = memory();
    for (const raw of ["", "abc", "-1", "1.5", "NaN"]) {
      storage.setItem("k", raw);
      expect(loadHatchTab("k", storage)).toBeNull();
    }
  });

  it("shrugs off a storage that throws, or none", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    } as unknown as Storage;
    expect(loadHatchTab("k", broken)).toBeNull();
    expect(() => saveHatchTab("k", 11, broken)).not.toThrow();
    expect(loadHatchTab("k", null)).toBeNull();
  });
});
