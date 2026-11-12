import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { User } from "../../../database/models/user.model.js";
import { matchesWhere } from "../../../testing/matchesWhere.js";
import { memoryRedis } from "../../../testing/memoryRedis.js";

/**
 * The Map Room 2 attack range as `rangeCheckV2` loads it: the Flinger levels
 * it measures with are the yards' as of now, the same the fog of war's sight
 * uses (`flingerLevelsNow`), so an upgrade counts the moment it is done and
 * never while it is still counting down.
 */

type Row = Record<string, unknown>;

let saves: Row[];

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      find: async (_entity: unknown, where: Row) => saves.filter((row) => matchesWhere(row, where)),
      findOne: async () => null,
    },
  },
  redis: memoryRedis(new Map()),
}));

const { rangeCheckV2 } = await import("./validateRange.js");

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A level 2 Flinger (reach 6) upgrading to 3 (reach 8), saved 100 s ago with `left` seconds to go then. */
const mainYard = (left: number, over: Row = {}): Row => ({
  baseid: "home-1",
  flinger: 2,
  savetime: nowSeconds() - 100,
  buildingdata: { "9": { id: 9, t: 5, l: 2, X: 0, Y: 0, cU: left, cL: 32_400 } },
  buildinghealthdata: {},
  ...over,
});

const attacker = (save: Row): User =>
  ({
    userid: 1,
    alliance_id: null,
    save: { baseid: save.baseid, homebase: ["100", "100"], flinger: save.flinger, outposts: [] },
  }) as unknown as User;

/** Seven cells straight down the home column: past reach 6, inside reach 8. */
const SEVEN_AWAY = { x: 100, y: 107 };

beforeEach(() => {
  saves = [];
});

describe("rangeCheckV2 and a Flinger upgrade", () => {
  test("a running upgrade still measures at the old level", async () => {
    const save = mainYard(3_600);
    saves = [save];

    const { verdict } = await rangeCheckV2(attacker(save), { cell: SEVEN_AWAY });

    expect(verdict.ok).toBe(false);
  });

  test("a finished upgrade reaches further before the yard is opened again", async () => {
    // Done 10 s ago; `flinger` on the row still says 2.
    const save = mainYard(90);
    saves = [save];

    const { verdict } = await rangeCheckV2(attacker(save), { cell: SEVEN_AWAY });

    expect(verdict.ok).toBe(true);
  });

  test("an outpost's finished upgrade counts without the outpost being opened", async () => {
    const home = mainYard(3_600, { flinger: 1, buildingdata: { "9": { id: 9, t: 5, l: 1, X: 0, Y: 0 } } });
    // Level 2 to 3 (reach 2 to 3), done 10 s ago, three cells from the target.
    const outpost = mainYard(90, { baseid: "out-a" });
    saves = [home, outpost];
    const user = attacker(home);
    (user.save as unknown as Row).outposts = [[100, 120, "out-a"]];

    const { verdict } = await rangeCheckV2(user, { cell: { x: 100, y: 123 } });

    expect(verdict.ok).toBe(true);
  });
});
