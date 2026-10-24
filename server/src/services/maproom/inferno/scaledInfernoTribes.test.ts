import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The Inferno tribe save (`scaledInfernoTribes`) takes the attacker's
 * champions as any other attack does (`championsAfterAttack`): health only,
 * only downwards. Its client list once replaced the main yard's, so a
 * hand-made `POST /bm/base/save` could add a Krallen or raise any level.
 */

let tribeRow: Record<string, unknown> | null = null;
const flush = mock(async () => {});

mock.module("../../../server.js", () => ({
  postgres: { em: { findOne: async () => tribeRow, persist: () => {}, flush } },
}));

const { scaledInfernoTribes } = await import("./scaledInfernoTribes.js");

const GORGO = { t: 1, l: 2, hp: 1000, fd: 0, fb: 0, ft: 0, pl: 1, status: 0 };
const FLUNG_GORGO = { v: 1, seed: 5, events: [{ kind: "fling", t: 80, x: 400, y: 400, r: 200, monsters: {}, champion: { t: 1, l: 2 } }] };

const userWith = (champion: unknown[]) =>
  ({ userid: 9, username: "u", save: { champion, wmstatus: [], resources: {} }, infernosave: null }) as never;

const save = (user: never, body: Record<string, unknown>) =>
  scaledInfernoTribes(user, { baseid: "201", buildinghealthdata: {}, monsters: {}, destroyed: 0, ...body } as never);

describe("Inferno tribe save: the attacker's champions", () => {
  beforeEach(() => {
    tribeRow = { userid: 9, tribedata: [{ baseid: "201" }] };
    flush.mockClear();
  });

  test("a client list cannot add a Krallen or raise a level", async () => {
    const user = userWith([GORGO]);
    await save(user, {
      attackerchampion: [{ ...GORGO, l: 6, hp: 99_999 }, { t: 5, l: 5, hp: 99_999, status: 0 }],
      flinglog: FLUNG_GORGO,
    });
    const champions = (user as { save: { champion: unknown[] } }).save.champion;
    expect(champions).toEqual([GORGO]);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  test("a flung champion's health only goes down", async () => {
    const user = userWith([GORGO]);
    await save(user, { attackerchampion: [{ t: 1, l: 2, hp: 400 }], flinglog: FLUNG_GORGO });
    expect((user as { save: { champion: unknown[] } }).save.champion).toEqual([{ ...GORGO, hp: 400 }]);
  });
});
