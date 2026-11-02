import { afterEach, describe, expect, test } from "bun:test";
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
  originalLayoutLevels,
  rememberSavedLayout,
  tribeIdAt,
  tribeLayoutFor,
  tribeLevels,
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

afterEach(() => forgetSavedLayouts());

describe("tribeLayoutFor", () => {
  test("ships with no editor-saved yards, so the checks below cover the live data", () => {
    for (const tribe of TRIBE_IDS) expect(Object.keys(savedTribeLevels[tribe] ?? {})).toEqual([]);
  });

  test("with no saved yards, every camp level gets exactly the yard the old banding gave it", () => {
    let checked = 0;
    TRIBE_IDS.forEach((tribe, index) => {
      for (const level of tribeLevels(tribe)) {
        expect(tribeLayoutFor(tribe, level).save).toBe(oldPick(index, level));
        checked++;
      }
    });
    // Legionnaire, Abunakki and Dreadnaut 25-44 (20 each), Kozu 29-44 (16).
    expect(checked).toBe(76);
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
