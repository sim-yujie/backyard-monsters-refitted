import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { TribeScale } from "../../enums/Tribes.js";
import { abunaki, dreadnaught, kozu, legionnaire } from "../../game-data/tribes/v1/index.js";

/**
 * The Map Room 1 read (issue #132): the four tribes of the player's Town Hall
 * tier with level, damage and respawn time, the neighbours, and the player's
 * own protection, in one call.
 */

const now = () => Math.floor(Date.now() / 1000);

let save: Record<string, any>;
let maproom: Record<string, any>;
let neighbourRows: { users: Record<string, any>[]; saves: Record<string, any>[] } = { users: [], saves: [] };

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = save;
      },
      findOne: async () => maproom,
      find: async (entity: { name?: string }) =>
        entity?.name === "User" ? neighbourRows.users : entity?.name === "Save" ? neighbourRows.saves : [],
      persist: () => {},
      flush: async () => {},
    },
  },
  redis: { mget: async (...keys: string[]) => keys.map(() => null) },
}));

const { getMapRoom1 } = await import("./getMapRoom1.js");
const { MR1_TRIBE_RESPAWN_SECONDS } = await import("../../services/maproom/v1/mr1TribeRules.js");

const LEGIONNAIRE = legionnaire[TribeScale.TH3].baseid as string;
const KOZU = kozu[TribeScale.TH3].baseid as string;

const read = async () => {
  const ctx = { authUser: { userid: 7, username: "p" }, request: { body: {} } } as unknown as Context & { body: any };
  await getMapRoom1(ctx, async () => {});
  return ctx.body;
};

beforeEach(() => {
  save = {
    userid: 7,
    mapversion: 1,
    points: "0",
    basevalue: "0",
    level: 1,
    protected: now() + 3600,
    tutorialstage: 0,
    buildingdata: { 0: { t: 14, l: 3 } },
    wmstatus: [[1, 1, 0]],
  };
  maproom = {
    userid: 7,
    neighbors: [],
    neighborsLastCalculated: new Date(),
    tribedata: [
      { baseid: LEGIONNAIRE, tribeHealthData: {}, destroyed: 1, destroyedAt: now() - 60, damage: 95 },
      { baseid: KOZU, tribeHealthData: { 3: 10 }, damage: 40 },
    ],
  };
});

describe("GET bm/maproom1", () => {
  test("the four tribes of the player's tier, in order, with level, damage and respawn time", async () => {
    const body = await read();

    expect(body.error).toBe(0);
    expect(body.protectedUntil).toBe(save.protected);
    expect(body.neighbours).toEqual([]);
    expect(body.tribes.map((tribe: any) => [tribe.tribe, tribe.baseid, tribe.tier])).toEqual([
      ["Legionnaire", LEGIONNAIRE, TribeScale.TH3],
      ["Kozu", KOZU, TribeScale.TH3],
      ["Abunakki", abunaki[TribeScale.TH3].baseid, TribeScale.TH3],
      ["Dreadnaut", dreadnaught[TribeScale.TH3].baseid, TribeScale.TH3],
    ]);
    expect(body.tribes.map((tribe: any) => tribe.level)).toEqual([1, 1, 2, 3]);

    const [wrecked, damaged, fresh] = body.tribes;
    expect(wrecked).toMatchObject({ destroyed: 1, damage: 95, respawnAt: maproom.tribedata[0].destroyedAt + MR1_TRIBE_RESPAWN_SECONDS });
    expect(damaged).toMatchObject({ destroyed: 0, damage: 40, respawnAt: 0 });
    expect(fresh).toMatchObject({ destroyed: 0, damage: 0, respawnAt: 0 });
  });

  test("the tribes are written into wmstatus beside what was there", async () => {
    await read();
    expect(save.wmstatus).toContainEqual([1, 1, 0]);
    expect(save.wmstatus).toContainEqual([Number(LEGIONNAIRE), 1, 0]);
  });

  test("a wrecked tribe whose time is up comes back on the read", async () => {
    maproom.tribedata[0].destroyedAt = now() - MR1_TRIBE_RESPAWN_SECONDS;
    const body = await read();
    expect(body.tribes[0]).toMatchObject({ destroyed: 0, damage: 0, respawnAt: 0 });
  });

  test("no protection reads as 0", async () => {
    save.protected = now() - 5;
    expect((await read()).protectedUntil).toBe(0);
  });

  test("a player on Map Room 2 is refused", async () => {
    save.mapversion = 2;
    const caught = await read().catch((error) => error);
    expect(caught.data?.reason).toBe("notMapRoom1");
  });
});

describe("GET bm/maproom1 neighbours", () => {
  test("lists the neighbours as bm/neighbours/get does, with when their protection ends", async () => {
    const until = now() + 7200;
    maproom.neighbors = [{ userid: 9, baseid: "0", level: 1, username: "old", attacksTodayCount: 0, attacksTodayDate: 0 }];
    neighbourRows = {
      users: [{ userid: 9, username: "Nine", pic_square: "" }],
      saves: [{ userid: 9, baseid: "9000", protected: until, createtime: 0, attackid: 0, attacks: [], damage: 0, points: "0", basevalue: "0" }],
    };

    const [neighbour] = (await read()).neighbours;
    expect(neighbour).toMatchObject({ userid: 9, baseid: "9000", username: "Nine", attackpermitted: 5, protectedUntil: until });
  });
});
