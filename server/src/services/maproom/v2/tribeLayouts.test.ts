import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Tribe, Tribes } from "../../../enums/Tribes.js";
import type { SaveData } from "../../../types/EntityData.js";
import { abunaki } from "../../../game-data/tribes/v2/abunaki.js";
import { dreadnaught } from "../../../game-data/tribes/v2/dreadnaught.js";
import { kozu } from "../../../game-data/tribes/v2/kozu.js";
import { legionnaire } from "../../../game-data/tribes/v2/legionnaire.js";
import { savedTribeLevels } from "../../../game-data/tribes/v2/levels/index.js";
import { calculateTribeLevel, minimumTribeLevels } from "./calculateTribeLevel.js";
import {
  TRIBE_IDS,
  forgetSavedLayouts,
  ignoreShippedSaves,
  originalLayoutLevels,
  rememberSavedLayout,
  tribeIdAt,
  tribeLayoutFor,
  tribeLevels,
  type TribeId,
} from "./tribeLayouts.js";

/** `fetchTribeData` as it was before per-level yards: equal level bands, one per layout. */
const oldPick = (tribeIndex: number, level: number): SaveData => {
  const selectedTribe = [legionnaire, kozu, abunaki, dreadnaught][tribeIndex]!;
  const tribe = Tribes[tribeIndex] as Tribe;
  const sortedKeys = Object.keys(selectedTribe).sort((a, b) => parseInt(a) - parseInt(b));
  const levelRange = 45 - minimumTribeLevels[tribe];
  const levelsPerKey = Math.ceil(levelRange / sortedKeys.length);
  let keyIndex = Math.floor((level - minimumTribeLevels[tribe]) / levelsPerKey);
  keyIndex = Math.max(0, Math.min(keyIndex, sortedKeys.length - 1));
  return selectedTribe[parseInt(sortedKeys[keyIndex]!)]!;
};

const stub = (name: string): SaveData => ({ name, buildingdata: {} }) as SaveData;

// The checks below are of the original layouts and the editor's saves; the
// shipped saved yards have their own test.
beforeEach(() => ignoreShippedSaves(true));
afterEach(() => {
  forgetSavedLayouts();
  ignoreShippedSaves(false);
});

describe("tribeLayoutFor", () => {
  test("the shipped saved yards stand at levels real camps have, and those camps use them", () => {
    ignoreShippedSaves(false);
    let checked = 0;
    for (const tribe of TRIBE_IDS) {
      for (const [level, save] of Object.entries(savedTribeLevels[tribe] ?? {})) {
        expect(tribeLevels(tribe)).toContain(Number(level));
        expect(tribeLayoutFor(tribe, Number(level))).toEqual({ from: Number(level), save, saved: true });
        checked++;
      }
    }
    // Owner's yards, 3 Nov: Legionnaire 29-41, Kozu 34/38/42, Abunakki and Dreadnaut every level.
    expect(checked).toBe(17);
  });

  test("each shipped saved yard is built on the Flash layout of its own level, not another one's", () => {
    // The Kozu 38 yard once copied the 34 one, so 38 camps showed Flash's
    // 29-36 yard (690 buildings) instead of its 37-44 one (931): owner, 8 Nov.
    // Tower levels, resources and a few moved or added buildings are fine;
    // the yard must just stay closest to the original its level had in Flash.
    const spots = (save: SaveData): Set<string> =>
      new Set(Object.values(save.buildingdata ?? {}).map((b) => `${b.t}@${b.X},${b.Y}`));
    const likeness = (a: Set<string>, b: Set<string>): number =>
      [...a].filter((spot) => b.has(spot)).length / Math.max(a.size, b.size);
    let checked = 0;
    for (const tribe of TRIBE_IDS) {
      const originals = [...originalLayoutLevels(tribe).values()];
      for (const [level, save] of Object.entries(savedTribeLevels[tribe] ?? {})) {
        // Shipped saves are off here, so this is the Flash original for the level.
        const flash = tribeLayoutFor(tribe, Number(level)).save;
        const yard = spots(save);
        const closest = Math.max(...originals.map((original) => likeness(yard, spots(original))));
        expect({ tribe, level, likeness: likeness(yard, spots(flash)) }).toEqual({ tribe, level, likeness: closest });
        checked++;
      }
    }
    expect(checked).toBe(17);
  });

  test("with no saved yards, every camp level gets exactly the yard the old banding gave it", () => {
    let checked = 0;
    TRIBE_IDS.forEach((tribe, index) => {
      for (const level of tribeLevels(tribe)) {
        expect(tribeLayoutFor(tribe, level).save).toBe(oldPick(index, level));
        checked++;
      }
    });
    // Legionnaire 5, Kozu 4, Abunakki 5, Dreadnaut 5: the levels camps really have.
    expect(checked).toBe(19);
  });

  test("lists exactly the levels real camps have", () => {
    const real = new Map<TribeId, Set<number>>();
    for (let x = 0; x < 200; x++) {
      for (let y = 0; y < 200; y++) {
        const index = (x + y) % Tribes.length;
        const id = tribeIdAt(index);
        if (!real.has(id)) real.set(id, new Set());
        real.get(id)!.add(calculateTribeLevel(x, y, Tribes[index]!));
      }
    }
    for (const tribe of TRIBE_IDS) expect(tribeLevels(tribe)).toEqual([...real.get(tribe)!].sort((a, b) => a - b));
    expect(tribeLevels("legionnaire")).toEqual([25, 29, 33, 37, 41]);
    expect(tribeLevels("kozu")).toEqual([30, 34, 38, 42]);
    expect(tribeLevels("abunaki")).toEqual([27, 31, 35, 39, 43]);
    expect(tribeLevels("dreadnaught")).toEqual([28, 32, 36, 40, 44]);
  });

  test("every real camp cell keeps its yard (levels from calculateTribeLevel)", () => {
    for (let x = 0; x < 120; x++) {
      for (let y = 0; y < 120; y += 7) {
        const index = (x + y) % Tribes.length;
        const level = calculateTribeLevel(x, y, Tribes[index]!);
        expect(tribeLayoutFor(tribeIdAt(index), level).save).toBe(oldPick(index, level));
      }
    }
  });

  test("the original layouts stand at the first level of their old bands", () => {
    expect([...originalLayoutLevels("legionnaire").keys()]).toEqual([25, 32, 39]);
    expect([...originalLayoutLevels("kozu").keys()]).toEqual([29, 37]);
    expect([...originalLayoutLevels("abunaki").keys()]).toEqual([25, 35]);
    expect([...originalLayoutLevels("dreadnaught").keys()]).toEqual([25, 35]);
  });

  test("a level with its own yard uses it; levels without one use the nearest saved yard below", () => {
    const at30 = stub("kozu 30");
    rememberSavedLayout("kozu", 30, at30);

    expect(tribeLayoutFor("kozu", 29).save).toBe(kozu[0]!);
    expect(tribeLayoutFor("kozu", 30)).toEqual({ from: 30, save: at30, saved: true });
    expect(tribeLayoutFor("kozu", 36).save).toBe(at30);
    // The original second layout still starts at 37.
    expect(tribeLayoutFor("kozu", 37)).toEqual({ from: 37, save: kozu[1]!, saved: false });
    expect(tribeLayoutFor("kozu", 44).save).toBe(kozu[1]!);
  });

  test("a saved yard at an original layout's level replaces it, and only that tribe changes", () => {
    const replaced = stub("legionnaire 32");
    rememberSavedLayout("legionnaire", 32, replaced);

    expect(tribeLayoutFor("legionnaire", 31).save).toBe(legionnaire[0]!);
    expect(tribeLayoutFor("legionnaire", 32).save).toBe(replaced);
    expect(tribeLayoutFor("legionnaire", 38).save).toBe(replaced);
    expect(tribeLayoutFor("legionnaire", 39).save).toBe(legionnaire[2]!);
    for (const level of tribeLevels("abunaki")) expect(tribeLayoutFor("abunaki", level).save).toBe(oldPick(2, level));
  });

  test("a single top level can have its own yard", () => {
    const top = stub("dreadnaught 44");
    rememberSavedLayout("dreadnaught", 44, top);
    expect(tribeLayoutFor("dreadnaught", 43).save).toBe(dreadnaught[1]!);
    expect(tribeLayoutFor("dreadnaught", 44).save).toBe(top);
  });
});
