import { describe, expect, it } from "vitest";

import { brainSummary, learnedFromText, tendenciesText } from "./championBrain";

describe("brainSummary (issue #219)", () => {
  it("says it is still learning with no brain, a zero brain or only faint leanings", () => {
    for (const entry of [{}, { b: { tower: 0 } }, { b: { loot: 49, threat: -49 } }, { b: "junk" }]) {
      const summary = brainSummary(entry);
      expect(summary.tendencies).toEqual([]);
      expect(tendenciesText(summary)).toBe("Still learning");
    }
  });

  it("names each strong leaning in plain words, either way", () => {
    expect(brainSummary({ b: { loot: 120 } }).tendencies).toEqual(["Loves loot"]);
    expect(brainSummary({ b: { loot: -120 } }).tendencies).toEqual(["Ignores loot"]);
    expect(brainSummary({ b: { threat: 90 } }).tendencies).toEqual(["Cautious near towers"]);
    expect(brainSummary({ b: { threat: -90 } }).tendencies).toEqual(["Shrugs off tower fire"]);
    expect(brainSummary({ b: { focus: 50 } }).tendencies).toEqual(["Sticks with the pack"]);
    expect(brainSummary({ b: { focus: -50 } }).tendencies).toEqual(["Goes its own way"]);
    expect(brainSummary({ b: { tower: 60 } }).tendencies).toEqual(["Goes for towers"]);
    expect(brainSummary({ b: { tower: -60 } }).tendencies).toEqual(["Steers clear of towers"]);
    expect(brainSummary({ b: { finish: 70 } }).tendencies).toEqual(["Finishes off the wounded"]);
    expect(brainSummary({ b: { finish: -70 } }).tendencies).toEqual(["Picks fresh targets"]);
  });

  it("puts the strongest first and names three at most", () => {
    const summary = brainSummary({ b: { tower: 60, loot: -200, finish: 55, focus: 150, threat: 90 } });
    expect(summary.tendencies).toEqual(["Ignores loot", "Sticks with the pack", "Cautious near towers"]);
    expect(tendenciesText(summary)).toBe("Ignores loot · Sticks with the pack · Cautious near towers");
  });

  it("counts the attacks it learned from", () => {
    expect(learnedFromText(brainSummary({}))).toBe("It learns from every attack it fights in.");
    expect(learnedFromText(brainSummary({ bs: { n: 1 } }))).toBe("Learned from 1 attack.");
    expect(learnedFromText(brainSummary({ bs: { n: 12, off: 0.4 } }))).toBe("Learned from 12 attacks.");
  });
});
