import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import type { User } from "../../../database/models/user.model.js";
import type { AbandonedOutcome } from "./abandonedAttack.js";

/**
 * `COMBAT_SAVE_VALIDATION` over the replay's mismatches (issue #23, C7): `off`
 * says nothing, `log` warns and writes one `Report` row, `reject` does both
 * and refuses. An honest save says nothing in any mode.
 */

const warn = mock((..._args: unknown[]) => {});
const error = mock((..._args: unknown[]) => {});
const reports: string[] = [];
let reportFails = false;

mock.module("../../../utils/logger.js", () => ({
  logger: { warn, error, info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../reportManager.js", () => ({
  logReport: async (_user: unknown, message: string) => {
    if (reportFails) throw new Error("database gone");
    reports.push(message);
  },
  logAttackViolation: async () => {},
  logBanReport: async () => {},
}));

const { recordBattleMismatches } = await import("./saveBattle.js");
const { DEFAULT_COMBAT_VALIDATION_MODE } = await import("../../../config/CombatConfig.js");

const ctx = { ip: "127.0.0.1" } as unknown as Context;
const user = { userid: 2505, username: "agenttester" } as unknown as User;
const base = { baseid: "1234", basesaveid: 9 };

const battle: AbandonedOutcome = {
  tick: 2_000,
  buildinghealthdata: { "1": 400 },
  damage: 12.5,
  destroyed: 0,
  firedTraps: [],
  attackloot: { r1: 40, r2: 0, r3: 0, r4: 0 },
  defenderDelta: { r1: -40, r2: 0, r3: 0, r4: 0 },
  flung: { C1: 4 },
  attackerchampion: undefined,
  championsFlung: [],
  attackersiege: undefined,
  attackreport: "",
  bunkerLosses: {},
  bunkerGarrisons: {},
  defenderChampions: [],
};

/** What an honest client sends for that battle. */
const honest = {
  damage: 12.5,
  destroyed: 0,
  buildinghealthdata: { "1": 400 },
  buildingdata: { "1": { id: 1, t: 14 } },
  attackloot: { r1: 40, r2: 0, r3: 0, r4: 0 },
};
const crafted = { ...honest, damage: 100, attackloot: { r1: 1e9, r2: 0, r3: 0, r4: 0 } };
const stored = { "1": { id: 1, t: 14 } };
/** An honest save but for a siege stock the replay did not end with. */
const otherSiege = { ...honest, attackersiege: { jars: { quantity: 3 } } };

const mismatchLines = () =>
  warn.mock.calls.filter((call) => (call[1] as { event?: string })?.event === "attack-replay-mismatch");

beforeEach(() => {
  warn.mockClear();
  error.mockClear();
  reports.length = 0;
  reportFails = false;
});

describe("recordBattleMismatches", () => {
  test("says nothing about an honest save, in any mode", async () => {
    for (const mode of ["off", "log", "reject"] as const) {
      await recordBattleMismatches(ctx, user, base, honest, battle, stored, mode);
    }
    expect(mismatchLines()).toEqual([]);
    expect(reports).toEqual([]);
  });

  test("off: a crafted save goes unremarked", async () => {
    await recordBattleMismatches(ctx, user, base, crafted, battle, stored, "off");
    expect(mismatchLines()).toEqual([]);
    expect(reports).toEqual([]);
  });

  test("log: one warning and one Report row, and the save goes on", async () => {
    await recordBattleMismatches(ctx, user, base, crafted, battle, stored, "log");

    expect(mismatchLines()).toHaveLength(1);
    expect(mismatchLines()[0]![1]).toMatchObject({ outcome: "flagged", mode: "log", fields: ["damage", "attackloot"] });
    expect(reports).toEqual(["Attack save on base 1234 flagged (log): disagrees with the replay on damage, attackloot"]);
  });

  test("reject: the same warning and row, then the save is refused", async () => {
    const caught = await recordBattleMismatches(ctx, user, base, crafted, battle, stored, "reject").catch(
      (err: unknown) => err as { data?: { reason?: string; fields?: string[] } }
    );

    expect(caught?.data).toEqual({ reason: "replayMismatch", fields: ["damage", "attackloot"] });
    expect(mismatchLines()[0]![1]).toMatchObject({ outcome: "rejected", mode: "reject" });
    expect(reports).toHaveLength(1);
  });

  test("the default mode refuses a crafted save, with the message the client words alike (#201)", async () => {
    const caught = await recordBattleMismatches(
      ctx,
      user,
      base,
      crafted,
      battle,
      stored,
      DEFAULT_COMBAT_VALIDATION_MODE
    ).catch((err: unknown) => err as { message?: string; data?: { reason?: string } });

    expect(caught?.data?.reason).toBe("replayMismatch");
    expect(caught?.message).toBe(
      "The server replayed this battle and got a different result, so it did not take this save."
    );
    expect(mismatchLines()[0]![1]).toMatchObject({ outcome: "rejected", mode: "reject" });
  });

  test("reject: a siege stock alone is logged, never refused (#201)", async () => {
    await recordBattleMismatches(ctx, user, base, otherSiege, battle, stored, "reject");

    expect(mismatchLines()).toHaveLength(1);
    expect(mismatchLines()[0]![1]).toMatchObject({ outcome: "flagged", mode: "reject", fields: ["attackersiege"] });
    expect(reports).toEqual(["Attack save on base 1234 flagged (reject): disagrees with the replay on attackersiege"]);
  });

  test("reject: a siege stock beside a real mismatch is refused for the real one only", async () => {
    const caught = await recordBattleMismatches(
      ctx,
      user,
      base,
      { ...crafted, attackersiege: otherSiege.attackersiege },
      battle,
      stored,
      "reject"
    ).catch((err: unknown) => err as { data?: { fields?: string[] } });

    expect(caught?.data?.fields).toEqual(["damage", "attackloot"]);
    expect(mismatchLines()[0]![1]).toMatchObject({
      outcome: "rejected",
      fields: ["damage", "attackloot", "attackersiege"],
    });
  });

  test("a Report row that cannot be written never fails the save", async () => {
    reportFails = true;
    await recordBattleMismatches(ctx, user, base, crafted, battle, stored, "log");
    expect(mismatchLines()).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
