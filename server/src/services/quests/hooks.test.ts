import { describe, expect, test } from "bun:test";

import { CATAPULT_HIT_RADIUS, FIGHT_RULES } from "../../game-data/quests.js";
import { BaseType } from "../../enums/Base.js";
import {
  attackQuestEvents,
  campTribeOf,
  catapultQuestEvents,
  defenceQuestEvents,
  housedQuestEvents,
  jobQuestEvents,
  lootQuestEvents,
  upgradeQuestEvents,
} from "./hooks.js";

describe("what server-seen actions add to quests", () => {
  test("finished hatches count per monster; other jobs count nothing", () => {
    expect(
      jobQuestEvents([
        { kind: "hatch", id: "C2", detail: { count: 3 } },
        { kind: "hatch", id: "C2", detail: { count: 1 } },
        { kind: "hatch", id: "C5", detail: { count: 0 } },
        { kind: "upgrade", id: 4, detail: { from: 1, level: 2 } },
      ])
    ).toEqual({ hatch: 4, "hatch:C2": 4 });
    expect(housedQuestEvents({ C1: 2, C3: 1 })).toEqual({ hatch: 3, "hatch:C1": 2, "hatch:C3": 1 });
  });

  test("an upgrade started on a harvester or a tower, and a cancel taking it back", () => {
    expect(upgradeQuestEvents(1)).toEqual({ upgradeResource: 1 });
    expect(upgradeQuestEvents(4, -1)).toEqual({ upgradeResource: -1 });
    expect(upgradeQuestEvents(20)).toEqual({ upgradeDefence: 1 });
    expect(upgradeQuestEvents(14)).toEqual({});
    expect(upgradeQuestEvents(undefined)).toEqual({});
  });

  test("loot counts per resource from the credit before the cap (decision 13)", () => {
    expect(lootQuestEvents({ r1: 1200.7, r2: 0, r3: 50, r4: -5 })).toEqual({ lootR1: 1200, lootR3: 50 });
    expect(lootQuestEvents(null)).toEqual({});
  });
});

describe("attacks", () => {
  const camp = (wmid: number, extra = {}) => ({
    type: BaseType.TRIBE,
    wmid,
    buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0 }, "1": { id: 1, t: 20, X: 300, Y: 300 } },
    ...extra,
  });

  test("a won attack: the yard ends at least half damaged and the attack added damage", () => {
    const player = { type: BaseType.MAIN, buildingdata: {} };
    expect(attackQuestEvents({ defender: player, damageBefore: 10, damageAfter: FIGHT_RULES.winDamage })).toEqual({ attackWin: 1 });
    expect(attackQuestEvents({ defender: player, damageBefore: 10, damageAfter: 49 })).toEqual({});
    expect(attackQuestEvents({ defender: player, damageBefore: 80, damageAfter: 80 })).toEqual({});
  });

  test("a win on a player's yard also counts attackWin:player (the alliance goal); the quests read attackWin either way", () => {
    const player = { type: BaseType.MAIN, buildingdata: {} };
    const won = { defender: player, damageBefore: 10, damageAfter: FIGHT_RULES.winDamage };
    expect(attackQuestEvents({ ...won, playerYard: true })).toEqual({ attackWin: 1, "attackWin:player": 1 });
    expect(attackQuestEvents({ ...won, playerYard: false })).toEqual({ attackWin: 1 });
    expect(attackQuestEvents({ ...won, damageAfter: 49, playerYard: true })).toEqual({});
  });

  test("the attack's loot is counted with it, won or not", () => {
    const player = { type: BaseType.MAIN, buildingdata: {} };
    expect(attackQuestEvents({ defender: player, damageBefore: 0, damageAfter: 5, loot: { r2: 900 } })).toEqual({ lootR2: 900 });
  });

  test("a Map Room 2 camp's tribe is its wmid's tens; destroyed when its Town Hall fell in this attack", () => {
    expect(campTribeOf(camp(12))).toBe("kozu");
    expect(campTribeOf(camp(31))).toBe("dreadnaut");
    expect(campTribeOf({ type: BaseType.MAIN, wmid: 12 })).toBeNull();

    const fell = attackQuestEvents({ defender: camp(21), damageBefore: 0, damageAfter: 30, before: {}, after: { "0": 0 } });
    expect(fell).toEqual({ tribeDestroy: 1, "tribeDestroy:abunakki": 1 });
    const already = attackQuestEvents({ defender: camp(21), damageBefore: 0, damageAfter: 30, before: { "0": 0 }, after: { "0": 0 } });
    expect(already).toEqual({});
  });

  test("a catapult bomb counts on each target type it lands near", () => {
    const yard = { "0": { t: 14, X: 0, Y: 0 }, "1": { t: 20, X: 1000, Y: 1000 }, "2": { t: 15, X: 2000, Y: 0 } };
    const log = {
      events: [
        { kind: "bomb", t: 1, x: 10, y: 10, id: "tw0" },
        { kind: "bomb", t: 2, x: 1000, y: 1000 + CATAPULT_HIT_RADIUS, id: "tw0" },
        { kind: "bomb", t: 3, x: 5000, y: 5000, id: "tw0" },
        { kind: "bomb", t: 4, x: 2000, y: 0, id: "tw0" },
        { kind: "fling", t: 5, x: 0, y: 0, r: 100, monsters: { C1: 5 } },
      ],
    };
    expect(catapultQuestEvents(log, yard)).toEqual({ catapultHit: 2, "catapultHit:14": 1, "catapultHit:20": 1 });
    expect(catapultQuestEvents(null, yard)).toEqual({});
  });

  test("a held defence: the attack left the yard less than half damaged", () => {
    expect(defenceQuestEvents(FIGHT_RULES.holdDamage - 1)).toEqual({ defenceWin: 1 });
    expect(defenceQuestEvents(FIGHT_RULES.holdDamage)).toEqual({});
  });
});
