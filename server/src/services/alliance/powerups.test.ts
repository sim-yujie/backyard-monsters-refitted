import { beforeEach, describe, expect, mock, test } from "bun:test";
import { LockMode } from "@mikro-orm/core";
import { Save } from "../../database/models/save.model.js";
import { AlliancePowerup } from "../../database/models/alliancepowerup.model.js";
import { POWERUP_RULES } from "../../config/AllianceConfig.js";

/**
 * Buying power-up hours with Shiny is safe against two requests sent at once
 * (security audit 2026-10-29, M1): both used to pass the balance check and
 * only one charge stuck. Drives `reducePowerupCharge` over a stand-in
 * database whose transactions each work on their own copies of the rows,
 * write every row they read back whole on flush (as an absolute write does),
 * and wait on a row another transaction holds `FOR UPDATE`.
 */

type Row = Record<string, unknown>;

const ALLIANCE = 11;
const BASESAVEID = 2526;
const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);

let saveRow: Row;
let powerupRows: Row[];
let shouts: string[];

/** Row locks: key -> the promise that settles when its holder lets go. */
const locks = new Map<string, Promise<void>>();

const acquire = async (key: string): Promise<() => void> => {
  while (locks.has(key)) await locks.get(key);
  let release!: () => void;
  locks.set(key, new Promise<void>((resolve) => (release = resolve)));
  return () => {
    locks.delete(key);
    release();
  };
};

/** A turn of the event loop, so two requests interleave at every query. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

const makeEm = () => {
  const held: Array<() => void> = [];
  const loaded: Array<[Row, Row]> = [];
  const load = (row: Row): Row => {
    const copy = { ...row };
    loaded.push([row, copy]);
    return copy;
  };
  const lockIf = async (options: { lockMode?: LockMode } | undefined, key: string) => {
    if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) held.push(await acquire(key));
  };

  const em = {
    findOne: async (entity: unknown, where: Row, options?: { lockMode?: LockMode }) => {
      if (entity !== Save) throw new Error("Unexpected findOne");
      await lockIf(options, `save:${where.basesaveid}`);
      await tick();
      return where.basesaveid === saveRow.basesaveid ? load(saveRow) : null;
    },
    find: async (entity: unknown, where: Row, options?: { lockMode?: LockMode }) => {
      if (entity !== AlliancePowerup) throw new Error("Unexpected find");
      await lockIf(options, `powerups:${where.alliance_id}`);
      await tick();
      return powerupRows.filter((row) => row.alliance_id === where.alliance_id).map(load);
    },
    create: (_entity: unknown, data: Row) => {
      powerupRows.push(data);
      return load(data);
    },
    persist: () => {},
    flush: async () => {
      await tick();
      for (const [row, copy] of loaded) Object.assign(row, copy);
    },
    transactional: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
      const fork = makeEm();
      try {
        return await run(fork.em);
      } finally {
        fork.releaseAll();
      }
    },
  };

  return { em, releaseAll: () => held.splice(0).forEach((release) => release()) };
};

mock.module("../../server.js", () => ({
  postgres: { em: makeEm().em },
  redis: { del: async () => 0 },
}));

mock.module("./allianceMessages.js", () => ({
  announceShout: async ({ body }: { body: string }) => {
    shouts.push(body);
  },
}));

const { reducePowerupCharge } = await import("./powerups.js");

const ARMAMENT = POWERUP_RULES[0]!;

const buy = (hours: number) =>
  reducePowerupCharge({
    allianceId: ALLIANCE,
    author: { userid: 1 } as never,
    basesaveid: BASESAVEID,
    powerupId: ARMAMENT.powerup_id,
    hours,
  }).then(
    (outcome) => ({ ok: true as const, credits: outcome.credits }),
    (error: Error) => ({ ok: false as const, message: error.message })
  );

let chargedUntil: number;

beforeEach(() => {
  shouts = [];
  chargedUntil = now() + 10 * HOUR;
  saveRow = { basesaveid: BASESAVEID, credits: 100 };
  powerupRows = POWERUP_RULES.map((rules) => ({
    alliance_id: ALLIANCE,
    powerup: rules.type,
    active: false,
    end_time: rules === ARMAMENT ? chargedUntil : now() + rules.recharge_time,
    updated_at: new Date(),
  }));
});

const armament = () => powerupRows.find((row) => row.powerup === ARMAMENT.type)!;

describe("buying power-up hours with Shiny (security audit 2026-10-29, M1)", () => {
  test("one purchase spends the hours' Shiny and brings the charge closer", async () => {
    expect(await buy(2)).toEqual({ ok: true, credits: 100 - 2 * ARMAMENT.hourly_cost });
    expect(saveRow.credits).toBe(100 - 2 * ARMAMENT.hourly_cost);
    expect(armament().end_time).toBe(chargedUntil - 2 * HOUR);
    expect(shouts).toHaveLength(1);
  });

  test("two purchases at once with Shiny for one: one goes through, the other is refused", async () => {
    const cost = 4 * ARMAMENT.hourly_cost;
    expect(cost * 2).toBeGreaterThan(100);

    const outcomes = await Promise.all([buy(4), buy(4)]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, message: "You do not have enough Shiny for that." },
    ]);
    expect(saveRow.credits).toBe(100 - cost);
    expect(armament().end_time).toBe(chargedUntil - 4 * HOUR);
    expect(shouts).toHaveLength(1);
  });

  test("two purchases at once with Shiny for both: both are charged and both hours count", async () => {
    saveRow.credits = 200;

    const outcomes = await Promise.all([buy(3), buy(2)]);

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(saveRow.credits).toBe(200 - 5 * ARMAMENT.hourly_cost);
    expect(armament().end_time).toBe(chargedUntil - 5 * HOUR);
  });

  test("a balance spent elsewhere meanwhile is the one checked, not a stale copy", async () => {
    // A yard action holding the save's lock spends Shiny and commits; the
    // purchase waits for it and reads the balance it left.
    const release = await acquire(`save:${BASESAVEID}`);
    const purchase = buy(4);
    await tick();
    saveRow.credits = 50;
    release();

    expect(await purchase).toEqual({ ok: false, message: "You do not have enough Shiny for that." });
    expect(saveRow.credits).toBe(50);
    expect(armament().end_time).toBe(chargedUntil);
  });
});
