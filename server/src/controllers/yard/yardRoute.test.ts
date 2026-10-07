import { beforeEach, describe, expect, mock, test } from "bun:test";
import { LockMode } from "@mikro-orm/core";
import type { Context } from "koa";
import z from "zod";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";

/**
 * `yardRoute`'s own glue, over an in-memory stand-in for the row
 * (`yardAction.test.ts` drives `runYardAction` itself without a server; this
 * file is the thin Koa binding around it, so it is the one that actually
 * calls Redis — issue #329, #330 WP1's `invalidateSightIfFlingerChanged`).
 */

type Row = Record<string, unknown>;

const BASESAVEID = 7;
const USERID = 2503;

let row: Row;
/** Keys `invalidateSightIfFlingerChanged` dropped. */
const redisDel = mock(async (_key: string) => 0);

const txEm = {
  async findOne(_entity: unknown, where: Row, options?: { lockMode?: LockMode }) {
    if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) void 0;
    return row.basesaveid === where.basesaveid ? row : null;
  },
  async flush() {},
};

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      transactional: async (run: (em: typeof txEm) => Promise<unknown>) => run(txEm),
      // The real `notifyAndCount` (yardRoute's own, run after the
      // transaction, on the unmocked module — mocking it would leak into
      // every other file importing it in the same `bun test` process) reads
      // this for its unread count; none of this file's actions finish
      // anything, so it is always empty.
      count: async () => 0,
      insertMany: async () => {},
      nativeDelete: async () => 0,
    },
  },
  redis: { del: redisDel },
}));

const { yardRoute } = await import("./yardRoute.js");
const { defineYardAction } = await import("./yardAction.js");

const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: BASESAVEID,
  userid: USERID,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime() - 1000,
  credits: 100,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: { r1: 5000, r2: 5000, r3: 5000, r4: 5000 },
  buildingdata: {},
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...overrides,
});

const run = async (action: ReturnType<typeof defineYardAction>, body: Row = {}) => {
  const ctx = {
    authUser: { userid: USERID, shiny_locked: false, save: { basesaveid: BASESAVEID } },
    request: { body },
  } as unknown as Context;
  await yardRoute(action)(ctx, async () => {});
  return { status: ctx.status, body: ctx.body as Row };
};

beforeEach(() => {
  row = rowOf();
  redisDel.mockClear();
});

describe("sight cache invalidation (#329, #330 WP1)", () => {
  test("an action that finishes a Flinger upgrade drops the player's cached sight", async () => {
    const finishFlinger = defineYardAction({
      schema: z.object({}),
      run: () => ({
        report: { ok: true },
        slices: { buildingdata: { "9": { id: 9, t: 5, x: 0, y: 0, l: 4 } } },
      }),
    });

    const answer = await run(finishFlinger);

    expect(answer.status).toBe(200);
    expect(redisDel).toHaveBeenCalledWith(`sight:${USERID}`);
  });

  test("an action that never touches the Flinger does not invalidate", async () => {
    const noop = defineYardAction({ schema: z.object({}), run: () => ({ report: { ok: true } }) });

    await run(noop);

    expect(redisDel).not.toHaveBeenCalled();
  });

  test("a refused action does not invalidate", async () => {
    row = rowOf({ attackid: 42, attacks: [{ starttime: getCurrentDateTime() - 30 }] });
    const noop = defineYardAction({ schema: z.object({}), run: () => ({ report: { ok: true } }) });

    const answer = await run(noop);

    expect(answer.status).toBe(409);
    expect(redisDel).not.toHaveBeenCalled();
  });
});
