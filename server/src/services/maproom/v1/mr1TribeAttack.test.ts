import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Issue #161: a Map Room 1 tribe attack can only start on one of the four
 * tribes the player's map shows them, and not while it is wrecked.
 */

let maproom: { userid: number; tribedata: Record<string, unknown>[] } | null;
const persisted: unknown[] = [];

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      findOne: async () => maproom,
      persist: (entity: unknown) => persisted.push(entity),
      flush: async () => {},
    },
  },
  redis: {},
}));

const { requireAttackableMR1Tribe } = await import("./mr1TribeAttack.js");
const { MR1_TRIBE_RESPAWN_SECONDS } = await import("./mr1TribeRules.js");

const NOW = 1_800_000_000;

const userOn = (mapversion: number, townHall = 1) =>
  ({
    userid: 1,
    save: {
      mapversion,
      tutorialstage: 0,
      buildingdata: { 0: { t: 14, l: townHall } },
      wmstatus: [[2, 1, 1]],
    },
  }) as never;

const refusal = async (user: never, baseid: string): Promise<string | undefined> => {
  try {
    await requireAttackableMR1Tribe(user, baseid, NOW);
    return undefined;
  } catch (caught) {
    return (caught as { data?: { reason?: string } }).data?.reason ?? String(caught);
  }
};

beforeEach(() => {
  maproom = { userid: 1, tribedata: [] };
  persisted.length = 0;
});

describe("requireAttackableMR1Tribe", () => {
  test("one of the player's four tribes, standing, may be attacked", async () => {
    expect(await refusal(userOn(1), "2")).toBeUndefined();
  });

  test("a player who moved to Map Room 2 cannot attack Map Room 1 tribes", async () => {
    expect(await refusal(userOn(2), "2")).toBe("notMapRoom1");
  });

  test("another tier's tribe or the tutorial camp is not on the player's map, at any tutorial stage", async () => {
    // Base 4 is the Legionnaire at a higher Town Hall tier than 1-2.
    expect(await refusal(userOn(1), "4")).toBe("notYourTribe");
    expect(await refusal(userOn(1), "1")).toBe("notYourTribe");
  });

  test("a wrecked tribe is refused until it is back", async () => {
    maproom!.tribedata = [{ baseid: "2", tribeHealthData: {}, destroyed: 1, destroyedAt: NOW - 60 }];
    expect(await refusal(userOn(1), "2")).toBe("tribeDestroyed");
    expect(persisted).toEqual([]);
  });

  test("a wrecked tribe whose time is up is stood back up and may be attacked", async () => {
    const tribe = { baseid: "2", tribeHealthData: { 1: 0 }, destroyed: 1, destroyedAt: NOW - MR1_TRIBE_RESPAWN_SECONDS, looted: { r1: 9 } };
    maproom!.tribedata = [tribe];
    const user = userOn(1);

    expect(await refusal(user, "2")).toBeUndefined();
    expect(tribe).toMatchObject({ destroyed: 0, tribeHealthData: {}, looted: undefined });
    expect((user as { save: { wmstatus: number[][] } }).save.wmstatus[0]).toEqual([2, 1, 0]);
  });
});
