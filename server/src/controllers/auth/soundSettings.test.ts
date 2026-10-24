import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The sound switches' routes (beta.5): read with the defaults filled in, and
 * a change written onto the main yard's `stats.other` under a row lock.
 */

type Row = Record<string, unknown>;

let save: Row | null;
let lookups: Row[];
let locked: unknown[];
let flushes: number;

const em = {
  findOne: async (_entity: unknown, where: Row, options?: { lockMode?: unknown }) => {
    lookups.push(where);
    locked.push(options?.lockMode);
    return save;
  },
  persist: () => {},
  flush: async () => {
    flushes += 1;
  },
};

mock.module("../../server.js", () => ({
  postgres: {
    em: { ...em, transactional: async (work: (inner: typeof em) => Promise<unknown>) => work(em) },
  },
}));

const { getSoundSettings, updateSoundSettings } = await import("./soundSettings.js");

const user = (basesaveid: number | null = 41): Row => ({ userid: 7, save: basesaveid === null ? null : { basesaveid } });

const call = async (controller: typeof getSoundSettings, body: unknown, who = user()) => {
  const ctx = { request: { body }, authUser: who } as unknown as Context & { body: Row };
  try {
    await controller(ctx, async () => {});
    return { status: ctx.status, body: ctx.body };
  } catch (caught) {
    const error = caught as { status?: number; name?: string };
    return { status: error.status ?? error.name, body: undefined };
  }
};

beforeEach(() => {
  save = { basesaveid: 41, userid: 7, type: "main", stats: { other: { wmi_wave: 2 } } };
  lookups = [];
  locked = [];
  flushes = 0;
});

describe("GET /player/sound", () => {
  test("answers the switches with the defaults filled in", async () => {
    expect(await call(getSoundSettings, undefined)).toEqual({
      status: 200,
      body: { error: 0, sound: { music: true, effects: true } },
    });
    expect(lookups[0]).toEqual({ basesaveid: 41, type: "main", userid: 7 });
  });

  test("a brand-new yard answers music off", async () => {
    save = { ...save, onboarding: { v: 1, guide: { state: "pending" } } };
    expect((await call(getSoundSettings, undefined)).body).toEqual({ error: 0, sound: { music: false, effects: true } });
  });

  test("an account with no yard yet is a brand-new one", async () => {
    expect((await call(getSoundSettings, undefined, user(null))).body).toEqual({
      error: 0,
      sound: { music: false, effects: true },
    });
    expect(lookups).toEqual([]);
  });
});

describe("POST /player/sound", () => {
  test("writes the change under a lock, keeps the other stats, answers the whole block", async () => {
    const answer = await call(updateSoundSettings, { music: false });
    expect(answer).toEqual({ status: 200, body: { error: 0, sound: { music: false, effects: true } } });
    expect(save?.stats).toEqual({ other: { wmi_wave: 2, mutemusic: 1 } });
    expect(locked[0]).toBeDefined();
    expect(flushes).toBe(1);
  });

  test("both switches at once", async () => {
    await call(updateSoundSettings, { music: true, effects: false });
    expect(save?.stats).toEqual({ other: { wmi_wave: 2, mutemusic: 0, mute: 1 } });
  });

  test("refuses an empty body, a stringified boolean and an unknown switch, writing nothing", async () => {
    for (const body of [{}, { music: "false" }, { volume: 0.5 }, { music: true, volume: 1 }]) {
      const answer = await call(updateSoundSettings, body);
      expect(answer.status).toBe("ZodError");
    }
    expect(flushes).toBe(0);
  });

  test("an account without a main yard gets a 404", async () => {
    expect((await call(updateSoundSettings, { music: true }, user(null))).status).toBe(404);
    save = null;
    expect((await call(updateSoundSettings, { music: true })).status).toBe(404);
    expect(flushes).toBe(0);
  });
});
