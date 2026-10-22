import { describe, expect, test } from "bun:test";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { buildSaveData } from "./mapSaveData.js";

/**
 * Who sees a yard's wild monster raid schedule (`aiattacks`, #302): only its
 * owner. Anyone else gets an empty one, so a bot's yard, whose schedule is
 * never filled, reads the same as a real player's (the bot leak audit, #245).
 */

const OWNER = 2503;
const VIEWER = 77;

const SCHEDULE = {
  v: 1,
  recent: [{ id: "raid-1", at: 1_700_000_000 }],
  lastattack: 1_700_000_000,
  nextAttack: 1_700_100_000,
  attackPreference: 1,
  sessionsSinceLastAttack: 3,
};

const userOf = (userid: number, save?: Save) => ({ userid, shiny_locked: false, save }) as unknown as User;

const yardOf = (type: BaseType) =>
  Object.assign(new Save(), { userid: OWNER, saveuserid: OWNER, type, aiattacks: SCHEDULE, resources: {} });

describe("buildSaveData aiattacks", () => {
  test("the owner gets their own raid schedule", () => {
    const yard = yardOf(BaseType.MAIN);
    expect(buildSaveData(yard, userOf(OWNER, yard), null).aiattacks).toEqual(SCHEDULE);
  });

  test("anyone else gets an empty one, on a main yard and an outpost alike", () => {
    for (const type of [BaseType.MAIN, BaseType.OUTPOST]) {
      const yard = yardOf(type);
      expect(buildSaveData(yard, userOf(VIEWER, new Save()), null).aiattacks).toEqual({});
      expect(yard.aiattacks).toEqual(SCHEDULE);
    }
  });
});

/**
 * Who sees a yard's saved Yard Planner layouts (`savetemplate`, trap spots
 * included): only its owner. A viewer, helper or attacker gets an empty list.
 */
describe("buildSaveData savetemplate", () => {
  const LAYOUTS = [{ slot: 0, name: "Main yard", version: 2, nodes: "[{\"t\":24,\"x\":-85,\"y\":210,\"id\":506}]" }];

  const plannedYard = (type: BaseType) => Object.assign(yardOf(type), { savetemplate: LAYOUTS });

  test("the owner gets their own layouts", () => {
    const yard = plannedYard(BaseType.MAIN);
    expect(buildSaveData(yard, userOf(OWNER, yard), null).savetemplate).toEqual(LAYOUTS);
  });

  test("anyone else gets none, on a main yard and an outpost alike", () => {
    for (const type of [BaseType.MAIN, BaseType.OUTPOST]) {
      const yard = plannedYard(type);
      expect(buildSaveData(yard, userOf(VIEWER, new Save()), null).savetemplate).toEqual([]);
      expect(yard.savetemplate).toEqual(LAYOUTS);
    }
  });
});

/**
 * Who sees where a yard's traps fired (`firedtraps`): only its owner, whose
 * planner offers to put them back. Anyone else would learn where traps stood.
 */
describe("buildSaveData firedtraps", () => {
  const FIRED = [{ t: 24, X: -85, Y: 210, at: 1_700_000_000 }];

  const firedYard = (type: BaseType) => Object.assign(yardOf(type), { firedtraps: FIRED });

  test("the owner gets their own fired traps", () => {
    const yard = firedYard(BaseType.MAIN);
    expect(buildSaveData(yard, userOf(OWNER, yard), null).firedtraps).toEqual(FIRED);
  });

  test("anyone else gets none, on a main yard and an outpost alike", () => {
    for (const type of [BaseType.MAIN, BaseType.OUTPOST]) {
      const yard = firedYard(type);
      expect(buildSaveData(yard, userOf(VIEWER, new Save()), null).firedtraps).toEqual([]);
      expect(yard.firedtraps).toEqual(FIRED);
    }
  });
});
