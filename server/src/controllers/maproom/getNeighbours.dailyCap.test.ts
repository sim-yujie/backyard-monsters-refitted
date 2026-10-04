import { afterAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";

import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import type { User } from "../../database/models/user.model.js";
import type { Save } from "../../database/models/save.model.js";
import type { NeighbourData } from "../../types/NeighbourData.js";

/**
 * The 10 attacks a day cap against the Map Room 1 re-search (issue #247): a
 * pair dropped by the cap stays off both lists through every re-search that
 * day, and can come back on the next day's.
 *
 * The database is faked: `execute` answers the real-player search with the
 * players the query does not name in its parameters, as `NOT IN` would.
 */

const ATTACKER = 101;
const DEFENDER = 102;
const OTHER = 103;

const pointsFor = (level: number) => String(experiencePoints[level - 1]);

const realRow = (userid: number) => ({
  userid,
  baseid: `${userid}00`,
  points: pointsFor(5),
  basevalue: "0",
  lastupdate_at: new Date("2026-10-01T00:00:00Z"),
  username: `player${userid}`,
  pic_square: null,
});

let maprooms: Map<number, Record<string, any>>;

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      findOne: async (_entity: unknown, where: { userid: number }) => maprooms.get(where.userid) ?? null,
      find: async () => [],
      execute: async (_sql: string, params: unknown[]) =>
        [ATTACKER, DEFENDER, OTHER].filter((userid) => !params.includes(userid)).map(realRow),
      persist: () => {},
      flush: async () => {},
    },
  },
  redis: { mget: async (...keys: string[]) => keys.map(() => null), get: async () => null },
}));

const { registerAttacker } = await import("../../services/maproom/v1/registerAttacker.js");
const { overworldNeighbours } = await import("./getNeighbours.js");

const neighbour = (userid: number, extra: Partial<NeighbourData> = {}): NeighbourData => ({
  userid,
  baseid: `${userid}00`,
  level: 5,
  username: `player${userid}`,
  attacksTodayCount: 0,
  attacksTodayDate: 0,
  attacksfrom: 0,
  attacksto: 0,
  retaliatecount: 0,
  ...extra,
});

const save = { points: pointsFor(5), basevalue: "0" } as Save;
const user = (userid: number) => ({ userid, save }) as unknown as User;

/** Makes both lists due for a re-search (thin, last searched an hour ago). */
const dueForResearch = () => {
  for (const maproom of maprooms.values()) {
    maproom.neighborsLastCalculated = new Date(Date.now() - 60 * 60 * 1000);
  }
};

const research = async (userid: number) => {
  dueForResearch();
  await overworldNeighbours(user(userid), save);
  return maprooms.get(userid)!.neighbors.map((entry: NeighbourData) => entry.userid).sort();
};

const DAY_ONE = new Date(2026, 9, 4, 15, 0, 0);
const dayStartOf = (date: Date) => new Date(date).setHours(0, 0, 0, 0) / 1000;

beforeEach(() => {
  setSystemTime(DAY_ONE);
  maprooms = new Map([
    [
      ATTACKER,
      {
        userid: ATTACKER,
        neighbors: [neighbour(DEFENDER, { attacksTodayCount: 9, attacksTodayDate: dayStartOf(DAY_ONE) }), neighbour(OTHER)],
        droppedNeighbours: [],
        neighborsLastCalculated: new Date(),
      },
    ],
    [
      DEFENDER,
      {
        userid: DEFENDER,
        neighbors: [neighbour(ATTACKER, { attacksfrom: 9 }), neighbour(OTHER)],
        droppedNeighbours: [],
        neighborsLastCalculated: new Date(),
      },
    ],
  ]);
});

afterAll(() => {
  setSystemTime();
});

describe("a pair dropped by the 10 attacks a day cap (issue #247)", () => {
  test("the 10th attack drops the pair from both lists and notes the drop on both rows", async () => {
    await registerAttacker(user(ATTACKER), user(DEFENDER));

    const attacker = maprooms.get(ATTACKER)!;
    const defender = maprooms.get(DEFENDER)!;
    expect(attacker.neighbors.map((entry: NeighbourData) => entry.userid)).toEqual([OTHER]);
    expect(defender.neighbors.map((entry: NeighbourData) => entry.userid)).toEqual([OTHER]);
    expect(attacker.droppedNeighbours).toEqual([{ userid: DEFENDER, day: dayStartOf(DAY_ONE) }]);
    expect(defender.droppedNeighbours).toEqual([{ userid: ATTACKER, day: dayStartOf(DAY_ONE) }]);
  });

  test("stays off both lists through a re-search the same day", async () => {
    await registerAttacker(user(ATTACKER), user(DEFENDER));

    setSystemTime(new Date(2026, 9, 4, 23, 59, 0));
    expect(await research(ATTACKER)).toEqual([OTHER]);
    expect(await research(DEFENDER)).toEqual([OTHER]);
  });

  test("can come back on the next day's re-search", async () => {
    await registerAttacker(user(ATTACKER), user(DEFENDER));

    setSystemTime(new Date(2026, 9, 5, 0, 1, 0));
    expect(await research(ATTACKER)).toEqual([DEFENDER, OTHER]);
    expect(await research(DEFENDER)).toEqual([ATTACKER, OTHER]);
  });

  test("a re-search without a drop takes everyone in range", async () => {
    expect(await research(ATTACKER)).toEqual([DEFENDER, OTHER]);
  });
});
