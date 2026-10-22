import { describe, expect, it } from "vitest";
import { boostSummary, loadBoosts } from "./boostSummary";

/**
 * The attack strip's boosts chip (beta.4): what it says for each side, and
 * that it reads the boosts the server froze into the load.
 */
describe("boostSummary", () => {
  it("says nothing when neither side is boosted", () => {
    expect(boostSummary(undefined, "attacker")).toBeNull();
    expect(boostSummary({}, "defender")).toBeNull();
    expect(boostSummary({ attacker: {}, defender: {} }, "attacker")).toBeNull();
  });

  it("an attacker with boosts is Boosted, one line for their monsters", () => {
    expect(boostSummary({ attacker: { monsterDamage: true, monsterSpeed: true } }, "attacker")).toEqual({
      label: "Boosted",
      lines: ["Your monsters: 25% more damage, 50% faster"],
    });
  });

  it("an attacker facing a boosted yard sees Foe boosted, towers and monsters", () => {
    expect(
      boostSummary({ defender: { towerDamage: true, monsterArmour: true } }, "attacker"),
    ).toEqual({
      label: "Foe boosted",
      lines: ["Their towers: 25% more damage", "Their monsters: 30% less damage taken"],
    });
  });

  it("a defender counts their own Tower Overdrive as Boosted and names the attacker's boosts", () => {
    expect(
      boostSummary({ attacker: { monsterSpeed: true }, defender: { towerDamage: true } }, "defender"),
    ).toEqual({
      label: "Boosted",
      lines: ["Your towers: 25% more damage", "The attacker's monsters: 50% faster"],
    });
    expect(boostSummary({ attacker: { monsterDamage: true } }, "defender")).toEqual({
      label: "Foe boosted",
      lines: ["The attacker's monsters: 25% more damage"],
    });
  });

  it("reads the boosts out of a load's defenderforces", () => {
    const defenderforces = {
      bunkers: {},
      defenderLevels: {},
      defenderChampions: [],
      buffs: { attacker: { monsterArmour: true } },
    };
    expect(loadBoosts({ defenderforces })).toEqual({ attacker: { monsterArmour: true } });
    expect(loadBoosts({ defenderforces: { bunkers: {} } })).toBeUndefined();
    expect(loadBoosts(null)).toBeUndefined();
  });
});
