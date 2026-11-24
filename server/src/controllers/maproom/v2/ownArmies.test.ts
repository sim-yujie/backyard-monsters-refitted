import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * `POST /worldmapv2/ownarmies` (beta 9 #7): the caller's yards on the main
 * yard's world, each with its housed monsters and the room its own buildings
 * give (never the stored `space`), and whether an attack is running there.
 */

const ME = 2505;

type Row = Record<string, unknown>;
let saves: Row[];
let cells: Row[];

const { Save } = await import("../../../database/models/save.model.js");

const yard = (baseid: string, type: string, housed: Record<string, number>, housings: number[]): Row => ({
  baseid,
  basesaveid: Number(baseid),
  type,
  saveuserid: ME,
  attackid: 0,
  attacks: [],
  // A stored `space` that lies: the room must come from the buildings.
  monsters: { housed, space: 99_999 },
  buildingdata: Object.fromEntries(housings.map((level, i) => [String(i + 1), { id: i + 1, t: 15, l: level }])),
  buildinghealthdata: {},
});

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      find: async (entity: unknown, where: Row) => {
        if (entity === Save)
          return saves.filter((row) => row.saveuserid === where.saveuserid && (where.type as { $in: string[] }).$in.includes(row.type as string));
        return cells.filter((row) => (where.baseid as { $in: string[] }).$in.includes(row.baseid as string));
      },
      populate: async (user: Row) => {
        user.save = saves[0];
      },
    },
  },
  redis: {},
}));

const { ownArmies } = await import("./ownArmies.js");

const run = async () => {
  const ctx = { authUser: { userid: ME }, request: { body: {} } } as unknown as Context;
  await ownArmies(ctx, async () => {});
  return ctx.body as { yards: Row[] };
};

beforeEach(() => {
  saves = [
    yard("100", "main", { C1: 30 }, [6, 6, 6, 6]),
    yard("200", "outpost", { C1: 4 }, [6]),
    yard("300", "outpost", {}, [3]),
    yard("400", "outpost", { C1: 1 }, [6]),
    yard("500", "inferno", { IC1: 3 }, []),
  ];
  cells = [
    { baseid: "100", x: 10, y: 10, world: { uuid: "w" } },
    { baseid: "200", x: 11, y: 10, world: { uuid: "w" } },
    { baseid: "300", x: 12, y: 10, world: { uuid: "w" } },
    // On another world: left out.
    { baseid: "400", x: 13, y: 10, world: { uuid: "other" } },
  ];
});

describe("ownArmies", () => {
  test("lists the main yard first, then outposts on its world, room from the buildings", async () => {
    const { yards } = await run();
    expect(yards.map((y) => y.baseid)).toEqual(["100", "200", "300"]);
    expect(yards[0]).toMatchObject({ main: true, x: 10, y: 10, housed: { C1: 30 }, capacity: 2160, attack: false });
    expect(yards[1]).toMatchObject({ main: false, housed: { C1: 4 }, capacity: 540 });
    expect(yards[2]).toMatchObject({ housed: {}, capacity: 320 });
  });

  test("marks a yard with an attack running", async () => {
    Object.assign(saves[1]!, { attackid: 7, attacks: [{ starttime: Math.floor(Date.now() / 1000) - 30 }] });
    const { yards } = await run();
    expect(yards[1]!.attack).toBe(true);
  });

  test("Housing Expansion on the main yard boosts every outpost to 675", async () => {
    const until = Math.floor(Date.now() / 1000) + 3600;
    saves[0]!.storedata = { EXH: { q: 1, e: until } };
    const { yards } = await run();
    expect(yards[1]!.capacity).toBe(675);
  });
});

describe("ownArmies, Housing finished while the outpost was closed (patch, 24 Nov 2026)", () => {
  const now = () => Math.floor(Date.now() / 1000);
  const closed = (ago: number) =>
    Object.assign(saves[2]!, {
      savetime: now() - ago,
      buildingdata: {
        "1": { id: 1, t: 15, l: 1, cB: 1800, prefab: 6 },
        "2": { id: 2, t: 15, l: 5, cU: 1800 },
      },
    });

  test("a build and an upgrade whose time has passed count, at the new level", async () => {
    closed(3600);
    const { yards } = await run();
    expect(yards[2]!.capacity).toBe(540 + 540);
  });

  test("still running: the build does not count, the upgrade counts at its old level", async () => {
    closed(60);
    const { yards } = await run();
    expect(yards[2]!.capacity).toBe(450);
  });
});
