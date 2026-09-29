import { describe, expect, test } from "bun:test";
import { championsAfterAttack, siegeAfterAttack } from "./attackerRow.js";

/** The attacker's own row after an attack, from the log rather than the save (#23, C1). */

const champion = (t: number, hp: number, l = 2) => ({ t, hp, l, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 });

const logOf = (...events: Record<string, unknown>[]) => ({ v: 1, seed: 7, events });
const flingChampion = (t: number) => ({ kind: "fling", t: 40, x: 0, y: 0, r: 100, monsters: {}, champion: { t, l: 2 } });
const useSiege = (weapon: string, t = 80) => ({ kind: "siege", t, x: 0, y: 0, weapon });

describe("championsAfterAttack", () => {
  test("a flung champion takes the save's health, only downwards", () => {
    const stored = [champion(1, 500)];
    expect(championsAfterAttack(stored, [champion(1, 200)], logOf(flingChampion(1)))).toEqual([champion(1, 200)]);
    expect(championsAfterAttack(stored, [champion(1, 0)], logOf(flingChampion(1)))).toEqual([champion(1, 0)]);
    expect(championsAfterAttack(stored, [champion(1, 99_999)], logOf(flingChampion(1)))).toEqual(stored);
  });

  test("never takes its level, status or feeding from the save", () => {
    const crafted = { ...champion(1, 100, 6), status: 0, fd: 99, pl: 6 };
    expect(championsAfterAttack([champion(1, 500)], [crafted], logOf(flingChampion(1)))).toEqual([champion(1, 100)]);
  });

  test("a champion the log never flung, or one the attacker does not own, is left alone", () => {
    const stored = [champion(1, 500), champion(5, 300)];
    const after = championsAfterAttack(stored, [champion(5, 0), champion(3, 1)], logOf(flingChampion(1)));
    expect(after).toEqual(stored);
  });

  test("no log or no report changes nothing", () => {
    const stored = [champion(1, 500)];
    expect(championsAfterAttack(stored, [champion(1, 1)], undefined)).toEqual(stored);
    expect(championsAfterAttack(stored, undefined, logOf(flingChampion(1)))).toEqual(stored);
  });
});

describe("siegeAfterAttack", () => {
  test("spends one per use the log records, and adds nothing", () => {
    const stored = { jars: { quantity: 3 }, decoy: { quantity: 1 } };
    expect(siegeAfterAttack(stored, logOf(useSiege("jars"), useSiege("jars", 90), useSiege("rocket")))).toEqual({
      jars: { quantity: 1 },
      decoy: { quantity: 1 },
    });
  });

  test("never goes below nothing", () => {
    expect(siegeAfterAttack({ jars: { quantity: 1 } }, logOf(useSiege("jars"), useSiege("jars", 90)))).toEqual({
      jars: { quantity: 0 },
    });
  });

  test("without a usable log the stock is left as it is", () => {
    const stored = { jars: { quantity: 3 } };
    expect(siegeAfterAttack(stored, undefined)).toBe(stored);
    expect(siegeAfterAttack(stored, { v: 2 })).toBe(stored);
    expect(siegeAfterAttack(null, logOf(useSiege("jars")))).toBeNull();
  });
});
