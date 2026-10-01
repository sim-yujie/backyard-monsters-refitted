import { describe, expect, test } from "bun:test";
import { countBank, countJuiced, countMushroom, countTribeDestroyed, tribeOfBase } from "./counters.js";

/** A save whose counters already hold something, and a field another package owns. */
const save = () => ({
  onboarding: {
    v: 1,
    guide: { state: "active", step: "raid" },
    counters: { mushrooms: 2, goldMushrooms: 1, bestBank: 500, juiced: 7, tribes: { kozu: 1 } },
    tips: { mail: 5 },
  },
});

describe("Goals counters (#227)", () => {
  test("a mushroom, golden or not", () => {
    expect(countMushroom(save(), false).counters).toMatchObject({ mushrooms: 3, goldMushrooms: 1 });
    expect(countMushroom(save(), true).counters).toMatchObject({ mushrooms: 3, goldMushrooms: 2 });
    // Nothing else in the record moves.
    expect(countMushroom(save(), true)).toMatchObject({ guide: { step: "raid" }, tips: { mail: 5 } });
  });

  test("bestBank keeps the biggest single bank, all resources together", () => {
    expect(countBank(save(), { r1: 300, r2: 300 })?.counters.bestBank).toBe(600);
    expect(countBank(save(), { r1: 200, r4: 300 })).toBeNull();
    expect(countBank(save(), {})).toBeNull();
  });

  test("juiced adds the count; none is no write", () => {
    expect(countJuiced(save(), 5)?.counters.juiced).toBe(12);
    expect(countJuiced(save(), 0)).toBeNull();
  });

  test("tribes by base id; the practice camp counts as Legionnaire", () => {
    expect(tribeOfBase("1")).toBe("legionnaire");
    expect(tribeOfBase("2")).toBe("legionnaire");
    expect(tribeOfBase("11")).toBe("kozu");
    expect(tribeOfBase("21")).toBe("abunakki");
    expect(tribeOfBase("31")).toBe("dreadnaut");
    expect(tribeOfBase("999")).toBeUndefined();
    expect(countTribeDestroyed(save(), "12")?.counters.tribes).toMatchObject({ kozu: 2, legionnaire: 0 });
    expect(countTribeDestroyed(save(), "999")).toBeNull();
  });
});
