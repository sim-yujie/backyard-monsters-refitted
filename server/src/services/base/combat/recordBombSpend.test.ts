import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import type { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";

/**
 * What the mode does with an attack's bombs (issue #90).
 *
 * The real logger configures sinks and writes files at import time, so it is
 * replaced before the module is loaded, as `economy/recordVerdict.test.ts`
 * does. The contract the controller depends on: every bomb the table knows is
 * charged in every mode, `off` is silent, `log` warns and returns, `reject`
 * warns and throws before anything is applied.
 */

const warn = mock((_message: string, _properties: Record<string, unknown>) => {});

mock.module("../../../utils/logger.js", () => ({
  logger: { warn, error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { recordBombSpend } = await import("./recordBombSpend.js");
const { chargeBombSpend } = await import("./bombSpend.js");
const { ClientSafeError } = await import("../../../middleware/clientSafeError.js");

const ctx = { ip: "127.0.0.1" } as unknown as Context;
const user = { userid: 2503, username: "yardtester" } as unknown as User;
const defender = { baseid: "1234", basesaveid: 77 } as unknown as Save;

/** The attacker's main save: a level-3 Catapult and the given pool. */
const attackerSave = (resources: Record<string, number>): Save =>
  ({ catapult: 3, buildingdata: {}, resources }) as unknown as Save;

const logOf = (...ids: string[]) => ({
  v: 1,
  seed: 7,
  events: ids.map((id, index) => ({ kind: "bomb", t: 100 * (index + 1), x: 0, y: 0, id })),
});

/** Runs the call and hands back whatever it threw, or null. */
const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
    return null;
  } catch (caught) {
    return caught;
  }
};

beforeEach(() => warn.mockClear());

describe("recordBombSpend", () => {
  test("no log, nothing to charge and nothing said", () => {
    const save = attackerSave({ r1: 50_000 });

    for (const mode of ["off", "log", "reject"] as const) {
      expect(recordBombSpend(ctx, user, save, defender, undefined, mode)).toBeNull();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  test("an affordable tw0 is charged in every mode, silently", () => {
    for (const mode of ["off", "log", "reject"] as const) {
      const save = attackerSave({ r1: 50_000, r2: 1, r3: 2, r4: 3 });
      const spend = recordBombSpend(ctx, user, save, defender, logOf("tw0"), mode);

      expect(spend?.spend).toEqual({ r1: 10_000, r2: 0, r3: 0 });
      expect(chargeBombSpend(spend!.spend, save.resources)).toEqual({ r1: 40_000, r2: 1, r3: 2, r4: 3 });
    }
    expect(warn).not.toHaveBeenCalled();
  });

  test("a log with no bombs charges nothing", () => {
    const save = attackerSave({ r1: 50_000 });
    expect(recordBombSpend(ctx, user, save, defender, logOf(), "reject")).toBeNull();
  });

  describe("an unaffordable bomb", () => {
    const poor = () => attackerSave({ r1: 4_000, r2: 0, r3: 0, r4: 0 });

    test("off: charged down to zero, nothing logged", () => {
      const save = poor();
      const spend = recordBombSpend(ctx, user, save, defender, logOf("tw0"), "off");

      expect(warn).not.toHaveBeenCalled();
      expect(chargeBombSpend(spend!.spend, save.resources).r1).toBe(0);
    });

    test("log: charged down to zero, one warning naming the bomb", () => {
      const save = poor();
      const spend = recordBombSpend(ctx, user, save, defender, logOf("tw0"), "log");

      expect(chargeBombSpend(spend!.spend, save.resources).r1).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      const properties = warn.mock.calls[0]![1];
      expect(properties.event).toBe("attack-bomb-audit");
      expect(properties.outcome).toBe("flagged");
      expect(properties.userid).toBe(2503);
      expect(properties.violations).toEqual([
        {
          rule: "bombSpend",
          enforced: true,
          detail: { reason: "unaffordable", id: "tw0", t: 100, resource: "r1", cost: 10_000, pool: 4_000 },
        },
      ]);
    });

    test("reject: refused with a 409 carrying the reason, the pool untouched", () => {
      const save = poor();
      const caught = thrownBy(() => recordBombSpend(ctx, user, save, defender, logOf("tw0"), "reject"));

      expect(caught).toBeInstanceOf(ClientSafeError);
      const error = caught as InstanceType<typeof ClientSafeError>;
      expect(error.status).toBe(409);
      expect(error.isClientFriendly).toBe(false);
      expect((error.data as { reason: string }).reason).toBe("bombSpend");
      expect(save.resources).toEqual({ r1: 4_000, r2: 0, r3: 0, r4: 0 });
      expect(warn.mock.calls[0]![1].outcome).toBe("rejected");
    });
  });

  test("several bombs of different resources, all affordable, pass reject mode", () => {
    const save = attackerSave({ r1: 200_000, r2: 3_000_000, r3: 20_000, r4: 5 });
    const spend = recordBombSpend(ctx, user, save, defender, logOf("tw1", "pb2", "pu0"), "reject");

    expect(chargeBombSpend(spend!.spend, save.resources)).toEqual({
      r1: 100_000,
      r2: 1_000_000,
      r3: 10_000,
      r4: 5,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
