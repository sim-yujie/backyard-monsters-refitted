import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import type { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import type { EconomyVerdict, EconomyViolation } from "./auditEconomySave.js";

/**
 * What the mode does with a verdict.
 *
 * `recordVerdict` is the only file under `economy/` that talks to the logger
 * and the database, so both are replaced here before it is loaded: the real
 * logger configures sinks and writes files at import time, and `logReport`
 * pulls in `server.ts` and with it the whole ORM. The contract under test is
 * the one the controller depends on — `off` is silent, `log` records and
 * returns, `reject` records and throws — and the shape of the refusal, which
 * the Flash client can only read as an HTTP 200 with `error` set.
 */

const warn = mock(() => {});
const error = mock(() => {});
const info = mock(() => {});
const logReport = mock(async (_user: User, _message: string) => {});

mock.module("../../../utils/logger.js", () => ({
  logger: { warn, error, info, debug: mock(() => {}) },
}));

mock.module("../reportManager.js", () => ({ logReport }));

const { applyDerivedFields, recordEconomyVerdict } = await import("./recordVerdict.js");
const { ClientSafeError } = await import("../../../middleware/clientSafeError.js");

const ctx = { ip: "127.0.0.1" } as unknown as Context;
const user = { userid: 2503, username: "yardtester" } as unknown as User;

const save = (): Save => ({ baseid: 0, basesaveid: 77, resources: {} }) as unknown as Save;

const budget = { r1: 0, r2: 0, r3: 0, r4: 0 };

const verdictOf = (violations: EconomyViolation[]): EconomyVerdict => ({
  violations,
  derived: { r1max: 23_050_000, r2max: 23_050_000, r3max: 23_050_000, r4max: 23_050_000, basevalue: "4321" },
  charged: { r1: 0, r2: 0, r3: 0, r4: 0 },
  budget,
  elapsed: 61,
});

const overBudget: EconomyViolation = {
  rule: "resourceBudget",
  detail: { resource: "r1", delta: 1_000_000_000, budget: 43_200 },
  enforced: true,
};

const capMismatch: EconomyViolation = {
  rule: "capMismatch",
  detail: { resource: "r1", sent: 11_163_050_000, derived: 23_050_000 },
  enforced: false,
};

/** Runs the call and hands back whatever it threw, or null. */
const capture = async (mode: "off" | "log" | "reject", verdict: EconomyVerdict) => {
  try {
    await recordEconomyVerdict(ctx, user, save(), verdict, mode);
    return null;
  } catch (err) {
    return err;
  }
};

beforeEach(() => {
  warn.mockClear();
  error.mockClear();
  info.mockClear();
  logReport.mockClear();
  logReport.mockImplementation(async () => {});
});

describe("recordEconomyVerdict", () => {
  test("off writes nothing and refuses nothing, even for an enforced violation", async () => {
    const thrown = await capture("off", verdictOf([overBudget]));

    expect(thrown).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(logReport).not.toHaveBeenCalled();
  });

  test("a clean verdict is silent in every mode", async () => {
    for (const mode of ["log", "reject"] as const) {
      expect(await capture(mode, verdictOf([]))).toBeNull();
    }

    expect(warn).not.toHaveBeenCalled();
    expect(logReport).not.toHaveBeenCalled();
  });

  test("log writes one warning and one report row per save, and never throws", async () => {
    const thrown = await capture("log", verdictOf([overBudget, capMismatch]));

    expect(thrown).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logReport).toHaveBeenCalledTimes(1);
  });

  test("the warning carries the rule list, the user and the verdict as properties", async () => {
    await capture("log", verdictOf([overBudget, capMismatch]));

    const [message, properties] = warn.mock.calls[0] as unknown as [string, Record<string, unknown>];

    expect(message).toContain("{rules}");
    expect(properties).toMatchObject({
      event: "economy-save-audit",
      outcome: "flagged",
      mode: "log",
      userid: 2503,
      username: "yardtester",
      baseid: 0,
      elapsed: 61,
      rules: ["resourceBudget", "capMismatch"],
      enforcedRules: ["resourceBudget"],
    });
    expect(properties.violations).toEqual([overBudget, capMismatch]);
  });

  test("the report row names every rule and says which were recorded only", async () => {
    await capture("log", verdictOf([overBudget, capMismatch]));

    const [reported, message] = logReport.mock.calls[0] as unknown as [User, string];

    expect(reported).toBe(user);
    expect(message).toContain("FLAGGED");
    expect(message).toContain("mode=log");
    expect(message).toContain("resourceBudget");
    expect(message).toContain("capMismatch");
    expect(message).toContain("(recorded only)");
  });

  test("log mode survives a report row it could not write", async () => {
    logReport.mockImplementation(async () => {
      throw new Error("database is on fire");
    });

    const thrown = await capture("log", verdictOf([overBudget]));

    expect(thrown).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  test("reject refuses a save carrying an enforced violation", async () => {
    const thrown = await capture("reject", verdictOf([overBudget, capMismatch]));

    expect(thrown).toBeInstanceOf(ClientSafeError);

    const err = thrown as InstanceType<typeof ClientSafeError>;
    expect(err.status).toBe(409);
    expect(err.isClientFriendly).toBe(false);
    expect(err.message).toBe("This save does not add up (resourceBudget). Reload your yard.");
    expect(err.data).toEqual({ violations: [overBudget], elapsed: 61 });
  });

  test("the refusal reaches the client as an HTTP 200 with error set", async () => {
    const thrown = (await capture("reject", verdictOf([overBudget]))) as InstanceType<
      typeof ClientSafeError
    >;
    const body = thrown.toSafeJson();

    // `isClientFriendly: false` is what makes the interceptor answer 200 with
    // `error` set, the one failure shape the Flash client shows the player;
    // the real status still travels in `errorDetails.status`.
    expect(body.error).toBe(thrown.message);
    expect(body.status).toBe(409);
    expect((body.data as { violations: EconomyViolation[] }).violations[0]?.rule).toBe(
      "resourceBudget"
    );
  });

  test("reject still records the save it refuses", async () => {
    await capture("reject", verdictOf([overBudget]));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(logReport).toHaveBeenCalledTimes(1);

    const [, properties] = warn.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(properties.outcome).toBe("rejected");

    const [, message] = logReport.mock.calls[0] as unknown as [User, string];
    expect(message).toContain("REJECTED");
  });

  test("reject lets a verdict through when nothing in it is enforced", async () => {
    const thrown = await capture("reject", verdictOf([capMismatch]));

    expect(thrown).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logReport).toHaveBeenCalledTimes(1);
  });
});

describe("applyDerivedFields", () => {
  test("writes the derived caps and base value onto the save", () => {
    const row = {
      resources: { r1: 5, r1max: 11_163_050_000, r2max: 1, r3max: 1, r4max: 1 },
      basevalue: "1",
      points: "0",
    } as unknown as Save;

    applyDerivedFields(row, {
      r1max: 23_050_000,
      r2max: 23_050_000,
      r3max: 23_050_000,
      r4max: 23_050_000,
      basevalue: "4321",
    });

    expect(row.resources).toEqual({
      r1: 5,
      r1max: 23_050_000,
      r2max: 23_050_000,
      r3max: 23_050_000,
      r4max: 23_050_000,
    });
    expect(row.basevalue).toBe("4321");
    // points is checked, never derived.
    expect(row.points).toBe("0");
  });

  test("copes with a save row that has no resources object yet", () => {
    const row = { basevalue: "0" } as unknown as Save;

    applyDerivedFields(row, {
      r1max: 10,
      r2max: 10,
      r3max: 10,
      r4max: 10,
      basevalue: "7",
    });

    expect(row.resources).toEqual({ r1max: 10, r2max: 10, r3max: 10, r4max: 10 });
  });
});
