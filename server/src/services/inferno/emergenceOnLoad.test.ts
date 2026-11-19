import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";

import type { Save } from "../../database/models/save.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The emergence's load hook and its pause on wild raids, on a stand-in
 * entity manager: what each reads, and that the level-up is written only
 * when a raid is due, with the level it was read at (so two loads at once
 * raise it once: the statement itself is tested on a real database in
 * `infernoProgress.db.test.ts`).
 */

const redis = memoryRedis();
mock.module("../../server.js", () => ({ postgres: { em: {} }, redis }));

const { emergenceHoldsRaids, emergenceOnLoad } = await import("./emergenceOnLoad.js");
const { cancelRaidOnYardLoad, openRaid, readOpenRaid, updateOpenRaid } = await import("../raids/raidStore.js");
const { openEmergenceRaid } = await import("./emergenceRaid.js");

const USER = 41;
const NOW = 1_800_000_000;

/** The stored progress row, the reads made and the level-up statements sent. */
const db = {
  row: null as Record<string, unknown> | null,
  reads: 0,
  raises: [] as unknown[][],
  /** What the level-up statement answers: the new level, or none (another request won). */
  raiseAnswer: null as number | null,
};
const em = {
  findOne: async () => {
    db.reads++;
    return db.row;
  },
  execute: async (_sql: string, params: unknown[]) => {
    db.raises.push(params);
    return db.raiseAnswer === null ? [] : [{ emergence_level: db.raiseAnswer }];
  },
} as unknown as EntityManager;

const save = (extra: Record<string, unknown> = {}) =>
  ({
    type: "main",
    tutorialstage: 205,
    buildingdata: { "1": { id: 1, t: 14, l: 5, x: 0, y: 0 } },
    buildinghealthdata: {},
    attackid: 0,
    attacks: [],
    ...extra,
  }) as unknown as Save;

beforeEach(() => {
  redis.clear();
  db.row = null;
  db.reads = 0;
  db.raises = [];
  db.raiseAnswer = null;
});

describe("the emergence on a main-yard load", () => {
  test("switched off, it reads and writes nothing and answers nothing", async () => {
    expect(await emergenceOnLoad(em, USER, save(), NOW, false)).toBeUndefined();
    expect(db.reads).toBe(0);
    expect(db.raises).toEqual([]);
  });

  test("due: the cave goes from 0 to 1 at once, written before anything else", async () => {
    db.raiseAnswer = 1;
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result.raised).toBe(1);
    expect(result.notDue).toBeNull();
    expect(result.progress.emergenceLevel).toBe(1);
    expect(result.progress.emergenceLastAt).toBe(NOW);
    // userid, the new level, now, the stage left to play, the level it was read at, now - 23 h.
    expect(db.raises).toEqual([[USER, 1, NOW, 1, 0, NOW - 82_800]]);
    expect(result.progress.emergencePending).toBe(1);
  });

  test("QUIET_LOGIN on a test server: due, but nothing is raised and no raid opens", async () => {
    db.raiseAnswer = 1;
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true, true))!;
    expect(result.raised).toBeNull();
    expect(result.raid).toBeNull();
    expect(result.notDue).toBe("quiet");
    expect(result.progress.emergenceLevel).toBe(0);
    expect(db.raises).toEqual([]);
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("QUIET_LOGIN off (the default): the same load raises the cave as usual", async () => {
    db.raiseAnswer = 1;
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true, false))!;
    expect(result.raised).toBe(1);
    expect(db.raises).toHaveLength(1);
  });

  test("23 hours after the last, the next level", async () => {
    db.row = { userid: USER, emergence_level: 2, emergence_last_at: new Date((NOW - 82_800) * 1000) };
    db.raiseAnswer = 3;
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result.raised).toBe(3);
    expect(db.raises).toEqual([[USER, 3, NOW, 3, 2, NOW - 82_800]]);
  });

  test("too soon: nothing written, and the reason told", async () => {
    db.row = { userid: USER, emergence_level: 2, emergence_last_at: new Date((NOW - 3_600) * 1000) };
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result).toMatchObject({ raised: null, notDue: "tooSoon" });
    expect(result.progress.emergenceLevel).toBe(2);
    expect(db.raises).toEqual([]);
  });

  test("an open wild raid holds it back to the next load", async () => {
    await openRaid(USER, { id: "r1", phase: "warning", tribe: "kozu", plan: {}, seed: 1, attackAt: NOW + 300, warned: 0 } as never, NOW);
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result.notDue).toBe("raidOpen");
    expect(db.raises).toEqual([]);
  });

  test("from the second raid, a yard at 10% health or less waits, its cave as it was", async () => {
    db.row = { userid: USER, emergence_level: 1, emergence_last_at: new Date((NOW - 82_800) * 1000) };
    const result = (await emergenceOnLoad(em, USER, save({ buildinghealthdata: { "1": 0 } }), NOW, true))!;
    expect(result).toMatchObject({ raised: null, notDue: "damaged", raid: null });
    expect(db.raises).toEqual([]);
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("the first raise on a yard at 10% or less: the cave goes up to 1 and the stage counts, with no raid (Flash UpgradePortal :172-176)", async () => {
    db.raiseAnswer = 1;
    const result = (await emergenceOnLoad(em, USER, save({ buildinghealthdata: { "1": 0 } }), NOW, true))!;
    expect(result).toMatchObject({ raised: 1, notDue: null, raid: null });
    expect(result.progress).toMatchObject({ emergenceLevel: 1, emergenceLastAt: NOW });
    // No stage left to play: nothing comes again on the next load.
    expect(db.raises).toEqual([[USER, 1, NOW, null, 0, NOW - 82_800]]);
    expect(result.progress.emergencePending).toBeNull();
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("a raise opens Moloch's raid for the new level, in its warning and due at once", async () => {
    db.row = { userid: USER, emergence_level: 2, emergence_last_at: new Date((NOW - 82_800) * 1000) };
    db.raiseAnswer = 3;
    const result = (await emergenceOnLoad(em, USER, save({ points: "0", basevalue: "0" }), NOW, true))!;
    const open = await readOpenRaid(USER);
    expect(open).not.toBeNull();
    expect(result.raid).toEqual(open);
    expect(open).toMatchObject({ phase: "warning", tribe: "moloch", attackAt: NOW, warned: 0 });
    expect((open!.plan as { level: number }).level).toBe(3);
  });

  test("a Moloch warning with no stage pending (opened before patch 7.12) is called off; a wild one is not", async () => {
    db.row = { userid: USER, emergence_level: 2, emergence_last_at: new Date((NOW - 3_600) * 1000) };
    await openRaid(USER, { id: "m1", phase: "warning", tribe: "moloch", plan: {}, seed: 1, attackAt: NOW - 60, warned: 0 } as never, NOW - 60);
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result).toMatchObject({ raised: null, notDue: "tooSoon" });
    expect(result.progress.emergenceLevel).toBe(2);
    expect(await readOpenRaid(USER)).toBeNull();

    await openRaid(USER, { id: "w1", phase: "warning", tribe: "Kozu", plan: {}, seed: 1, attackAt: NOW + 300, warned: 0 } as never, NOW);
    await emergenceOnLoad(em, USER, save(), NOW, true);
    expect((await readOpenRaid(USER))?.id).toBe("w1");
  });

  test("another load raised it first: no level here, and the stored one is read back", async () => {
    db.raiseAnswer = null;
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result).toMatchObject({ raised: null, notDue: "race" });
    expect(db.reads).toBe(2);
  });
});

describe("a stage raised but not played yet (patch 7.12, owner's A + C)", () => {
  const DAY = 86_400;
  /** Level 3 raised at `raisedAt`, its raid not landed. */
  const pending = (raisedAt = NOW - 60, level = 3) => {
    db.row = { userid: USER, emergence_level: level, emergence_last_at: new Date(raisedAt * 1000), emergence_pending: level };
  };
  const yard = () => save({ points: "0", basevalue: "0" });

  test("its warning never seen: the next yard load answers the same raid again, and nothing is raised", async () => {
    pending();
    const warning = (await openEmergenceRaid(USER, yard(), 3, NOW - 60))!;
    const result = (await emergenceOnLoad(em, USER, yard(), NOW, true, false, "yard"))!;
    expect(result).toMatchObject({ raised: 3, notDue: null, replay: true });
    expect(result.raid?.id).toBe(warning.id);
    expect(result.progress).toMatchObject({ emergenceLevel: 3, emergencePending: 3 });
    expect(db.raises).toEqual([]);
    expect((await readOpenRaid(USER))?.id).toBe(warning.id);
  });

  test("raised on a map's load: the map's loads keep it, and the yard's load after them plays it", async () => {
    db.row = { userid: USER, emergence_level: 2, emergence_last_at: new Date((NOW - DAY) * 1000) };
    db.raiseAnswer = 3;
    const onMap = (await emergenceOnLoad(em, USER, yard(), NOW, true, false, "map"))!;
    expect(onMap).toMatchObject({ raised: 3, notDue: null });
    expect(db.raises).toHaveLength(1);
    // The row as the raise wrote it.
    pending(NOW);
    const again = (await emergenceOnLoad(em, USER, yard(), NOW + 30, true, false, "map"))!;
    expect(again.raid?.id).toBe(onMap.raid!.id);
    const home = (await emergenceOnLoad(em, USER, yard(), NOW + 60, true, false, "yard"))!;
    expect(home).toMatchObject({ raised: 3, replay: true });
    expect(home.raid?.id).toBe(onMap.raid!.id);
    expect(db.raises).toHaveLength(1);
  });

  test("its warning gone (15 minutes ran out, days away): opened afresh for the same level, still no new raise", async () => {
    pending(NOW - 3 * DAY);
    const result = (await emergenceOnLoad(em, USER, yard(), NOW, true))!;
    expect(result).toMatchObject({ raised: 3, notDue: null, replay: true });
    const open = await readOpenRaid(USER);
    expect(open).toMatchObject({ phase: "warning", tribe: "moloch", attackAt: NOW });
    expect((open!.plan as { level: number }).level).toBe(3);
    expect(result.raid).toEqual(open);
    expect(db.raises).toEqual([]);
  });

  test("seen, then the game reloaded or closed: the load after plays it again", async () => {
    pending();
    const first = (await openEmergenceRaid(USER, yard(), 3, NOW - 60))!;
    // A load after the game was closed calls the warning off first (`baseLoad.ts`).
    expect(await cancelRaidOnYardLoad(USER, true)).toBe(true);
    const result = (await emergenceOnLoad(em, USER, yard(), NOW, true))!;
    expect(result).toMatchObject({ raised: 3, replay: true });
    expect(result.raid?.id).not.toBe(first.id);
    expect((await readOpenRaid(USER))?.id).toBe(result.raid!.id);
  });

  test("its fight under way: left alone, nothing answered", async () => {
    pending();
    const warning = (await openEmergenceRaid(USER, yard(), 3, NOW - 60))!;
    await updateOpenRaid(USER, { ...warning, phase: "fighting", startedAt: NOW - 10, fightSeconds: 120 }, NOW - 10, "warning");
    const result = (await emergenceOnLoad(em, USER, yard(), NOW, true))!;
    expect(result).toMatchObject({ raised: null, notDue: "raidOpen", raid: null });
    expect(await readOpenRaid(USER)).toMatchObject({ id: warning.id, phase: "fighting" });
  });

  test("an attack running on the yard: it waits for a later load, nothing opened", async () => {
    pending();
    // Started just now by the real clock, which `isAttackActive` reads.
    const attacked = save({ points: "0", basevalue: "0", attackid: 7, attacks: [{ id: 7, starttime: Math.floor(Date.now() / 1000) }] });
    const held = (await emergenceOnLoad(em, USER, attacked, NOW, true))!;
    expect(held).toMatchObject({ raised: null, notDue: "underAttack", raid: null });
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("another stage's Moloch warning is dropped and this stage's opened", async () => {
    pending();
    const stale = (await openEmergenceRaid(USER, yard(), 2, NOW - 60))!;
    const result = (await emergenceOnLoad(em, USER, yard(), NOW, true))!;
    expect(result.raid?.id).not.toBe(stale.id);
    expect((result.raid!.plan as { level: number }).level).toBe(3);
  });

  test("the fifth stage pending is played too, and wild raids wait for it", async () => {
    pending(NOW - 60, 5);
    const result = (await emergenceOnLoad(em, USER, yard(), NOW, true))!;
    expect(result).toMatchObject({ raised: 5, replay: true });
    expect(await emergenceHoldsRaids(em, USER, { type: "main", thlevel: 5, tutorialstage: 205 }, true)).toBe(true);
  });

  test("QUIET_LOGIN on a test server: not played either", async () => {
    pending();
    const result = (await emergenceOnLoad(em, USER, yard(), NOW, true, true))!;
    expect(result).toMatchObject({ raised: null, notDue: "quiet", raid: null });
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("a stage raised before the patch (none pending) is not run again: no back-pay", async () => {
    db.row = { userid: USER, emergence_level: 3, emergence_last_at: new Date((NOW - 60) * 1000) };
    const result = (await emergenceOnLoad(em, USER, yard(), NOW, true))!;
    expect(result).toMatchObject({ raised: null, notDue: "tooSoon", raid: null });
    expect(await readOpenRaid(USER)).toBeNull();
  });
});

describe("the pause on wild raids, as the raid ping asks it", () => {
  const pinged = (extra: Record<string, unknown> = {}) => ({ type: "main", thlevel: 5, tutorialstage: 205, ...extra });

  test("below Town Hall 5 or with the Inferno off, no read at all", async () => {
    expect(await emergenceHoldsRaids(em, USER, pinged({ thlevel: 4 }), true)).toBe(false);
    expect(await emergenceHoldsRaids(em, USER, pinged(), false)).toBe(false);
    expect(db.reads).toBe(0);
  });

  test("at Town Hall 5 before the fifth raid, raids wait", async () => {
    db.row = { userid: USER, emergence_level: 3, emergence_last_at: new Date(NOW * 1000) };
    expect(await emergenceHoldsRaids(em, USER, pinged(), true)).toBe(true);
  });

  test("after the fifth, they come again", async () => {
    db.row = { userid: USER, emergence_level: 5, emergence_last_at: new Date(NOW * 1000) };
    expect(await emergenceHoldsRaids(em, USER, pinged(), true)).toBe(false);
  });
});
