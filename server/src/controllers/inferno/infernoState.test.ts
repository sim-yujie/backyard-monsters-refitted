import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

import type { InfernoProgress } from "../../database/models/infernoprogress.model.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { NO_INFERNO_PROGRESS, progressRecordOf } from "../../services/inferno/infernoProgress.js";

/**
 * `GET /bm/inferno/state`: the answer from a player's progress and main yard,
 * and the route itself, refused before it reads anything while the new
 * Inferno is switched off.
 */

/** What the route's entity manager was asked, and the row it hands back. */
let row: Partial<InfernoProgress> | null = null;
const calls: string[] = [];
const em = {
  populate: async () => {
    calls.push("populate");
  },
  findOne: async () => {
    calls.push("findOne");
    return row;
  },
};
mock.module("../../server.js", () => ({ postgres: { em }, redis: {} }));

const { infernoLoadState, infernoState, infernoStateAnswer } = await import("./infernoState.js");

const NOW = 1_800_000_000;
const hall = (level: number): BuildingDataMap => ({ "1": { id: 1, t: 14, l: level, x: 0, y: 0 } as BuildingData });
const yard = (level: number, tutorialstage = 205) => ({ buildingdata: hall(level), tutorialstage });

describe("the Inferno state answer", () => {
  test("a new player below Town Hall 5 sees no cave", () => {
    const body = infernoStateAnswer(NO_INFERNO_PROGRESS, yard(4), NOW, false);
    expect(body.cave).toEqual({ shown: false, level: 0, maxLevel: 5 });
    expect(body.emergence).toEqual({ lastAt: null, nextAt: 0, done: false });
    expect(body.descent).toEqual({ level: 1, destroyed: Array(13).fill(0), passed: false });
    expect(body.hasYard).toBe(false);
    expect(body.korathNotice).toBe(false);
    expect(body.now).toBe(NOW);
  });

  test("the cave shows at Town Hall 5 once the tutorial is over (Flash: stage above 200)", () => {
    expect(infernoStateAnswer(NO_INFERNO_PROGRESS, yard(5), NOW, false).cave.shown).toBe(true);
    expect(infernoStateAnswer(NO_INFERNO_PROGRESS, yard(5, 200), NOW, false).cave.shown).toBe(false);
    expect(infernoStateAnswer(NO_INFERNO_PROGRESS, yard(5, 200), NOW, true).cave.shown).toBe(true);
  });

  test("a cave that has gone up a level shows below Town Hall 5 too", () => {
    const progress = { ...NO_INFERNO_PROGRESS, emergenceLevel: 2, emergenceLastAt: NOW - 100 };
    const body = infernoStateAnswer(progress, yard(4), NOW, false);
    expect(body.cave).toEqual({ shown: true, level: 2, maxLevel: 5 });
    expect(body.emergence).toEqual({ lastAt: NOW - 100, nextAt: NOW - 100 + 43_200, done: false });
  });

  test("after the fifth raid there is no next one", () => {
    const progress = { ...NO_INFERNO_PROGRESS, emergenceLevel: 5, emergenceLastAt: NOW - 100 };
    expect(infernoStateAnswer(progress, yard(5), NOW, false).emergence).toEqual({
      lastAt: NOW - 100,
      nextAt: null,
      done: true,
    });
  });

  test("the Descent counter is 1 + yards beaten, 14 once passed", () => {
    const beaten = { ...NO_INFERNO_PROGRESS, emergenceLevel: 5, descentDestroyed: [1, 1, 1] };
    expect(infernoStateAnswer(beaten, yard(5), NOW, false).descent).toEqual({
      level: 4,
      destroyed: [1, 1, 1, ...Array(10).fill(0)],
      passed: false,
    });
    const passed = { ...beaten, descentDestroyed: Array(13).fill(1), descentPassedAt: NOW, infernoBaseid: "123" };
    const body = infernoStateAnswer(passed, yard(5), NOW, false);
    expect(body.descent.level).toBe(14);
    expect(body.descent.passed).toBe(true);
    expect(body.hasYard).toBe(true);
  });

  test("Korath's notice is due once unlocked and not yet told", () => {
    const unlocked = { ...NO_INFERNO_PROGRESS, korathUnlockedAt: NOW };
    expect(infernoStateAnswer(unlocked, yard(5), NOW, false).korathNotice).toBe(true);
    expect(infernoStateAnswer({ ...unlocked, korathNoticeAt: NOW }, yard(5), NOW, false).korathNotice).toBe(false);
  });

  test("no main yard, no cave", () => {
    expect(infernoStateAnswer(NO_INFERNO_PROGRESS, null, NOW, true).cave.shown).toBe(false);
  });
});

describe("the load answer's infernostate", () => {
  test("the state without `error`, and the level the cave just went up to", () => {
    const progress = { ...NO_INFERNO_PROGRESS, emergenceLevel: 1, emergenceLastAt: NOW };
    const raid = {
      id: "r_moloch",
      phase: "warning",
      tribe: "moloch",
      plan: {
        army: { IC1: 2 },
        log: {
          v: 1,
          seed: 7,
          events: [
            { kind: "raid", t: 0, x: -995, y: -105, r: 200, monsters: { IC1: 1 } },
            { kind: "raid", t: 0, x: -995, y: -105, r: 200, monsters: { IC1: 1 } },
          ],
        },
      },
      seed: 7,
      attackAt: NOW,
      warned: 0,
    } as const;
    const state = infernoLoadState({ progress, raised: 1, notDue: null, raid }, yard(5), NOW);
    expect(state).not.toHaveProperty("error");
    expect(state.raised).toBe(1);
    expect(state.cave.level).toBe(1);
    expect(state.emergence.nextAt).toBe(NOW + 43_200);
    // Moloch's raid, as the raid routes show it (never its plan's log or
    // outcome), with its groups one card each for the warning screen.
    expect(state.raid).toEqual({
      id: "r_moloch",
      phase: "warning",
      tribe: "moloch",
      monsters: { IC1: 2 },
      attackAt: NOW,
      warned: 0,
      groups: [
        { monster: "IC1", count: 1 },
        { monster: "IC1", count: 1 },
      ],
    });
  });

  test("raised and raid are null when no raid came on this load", () => {
    const state = infernoLoadState({ progress: NO_INFERNO_PROGRESS, raised: null, notDue: "tooSoon", raid: null }, yard(5), NOW);
    expect(state.raised).toBeNull();
    expect(state.raid).toBeNull();
  });
});

describe("a stored progress row", () => {
  test("reads times as unix seconds and clamps what it holds", () => {
    const record = progressRecordOf({
      userid: 1,
      emergence_level: 9,
      emergence_last_at: new Date(NOW * 1000),
      descent_destroyed: [1, "x", -3, ...Array(20).fill(1)] as unknown as number[],
      descent_best: [95.5],
      descent_passed_at: null,
      inferno_baseid: null,
      korath_unlocked_at: null,
      korath_notice_at: null,
      popups_seen: { intro: NOW },
    } as unknown as InfernoProgress);
    expect(record.emergenceLevel).toBe(5);
    expect(record.emergenceLastAt).toBe(NOW);
    expect(record.descentDestroyed).toEqual([1, 0, 0, ...Array(10).fill(1)]);
    expect(record.descentBest).toEqual([95]);
    expect(record.popupsSeen).toEqual({ intro: NOW });
  });

  test("no row reads as no progress", () => {
    expect(progressRecordOf(null)).toBe(NO_INFERNO_PROGRESS);
  });
});

describe("GET /bm/inferno/state", () => {
  const saved = process.env.INFERNO_ENABLED;
  const user = { userid: 7, save: yard(5) };
  const ctxOf = () => ({ authUser: user, status: 0, body: undefined }) as unknown as Context;

  beforeEach(() => {
    calls.length = 0;
    row = null;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.INFERNO_ENABLED;
    else process.env.INFERNO_ENABLED = saved;
  });

  test("switched off, it is refused with 403 infernoOff before reading anything", async () => {
    delete process.env.INFERNO_ENABLED;
    const ctx = ctxOf();
    const refusal = await infernoState(ctx).then(
      () => null,
      (err) => err
    );
    expect(refusal?.status).toBe(403);
    expect(refusal?.data).toEqual({ reason: "infernoOff" });
    expect(calls).toEqual([]);
    expect(ctx.body).toBeUndefined();
  });

  test("switched on, it answers the player's state", async () => {
    process.env.INFERNO_ENABLED = "on";
    row = { userid: 7, emergence_level: 3, emergence_last_at: new Date(NOW * 1000) } as Partial<InfernoProgress>;
    const ctx = ctxOf();
    await infernoState(ctx);
    expect(ctx.status).toBe(200);
    const body = ctx.body as ReturnType<typeof infernoStateAnswer>;
    expect(body.error).toBe(0);
    expect(body.cave.level).toBe(3);
    expect(body.emergence.lastAt).toBe(NOW);
    expect(calls).toEqual(["populate", "findOne"]);
  });

  test("switched on with no row, it answers a fresh start", async () => {
    process.env.INFERNO_ENABLED = "true";
    const ctx = ctxOf();
    await infernoState(ctx);
    const body = ctx.body as ReturnType<typeof infernoStateAnswer>;
    expect(body.cave.level).toBe(0);
    expect(body.emergence.nextAt).toBe(0);
  });
});
