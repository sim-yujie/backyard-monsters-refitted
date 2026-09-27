import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";

/**
 * The retired owner save (issue #101). The logger is replaced before the
 * module loads, as `combat/recordBombSpend.test.ts` does, because the real one
 * opens its sinks at import time.
 */

const warn = mock((_message: string, _properties: Record<string, unknown>) => {});

mock.module("../../utils/logger.js", () => ({
  logger: { warn, error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { isRetiredOwnerSave, requireOwnerSaveAllowed } = await import("./ownerSave.js");
const { parseOwnerSaveMode, isOwnerSaveMode } = await import("../../config/OwnerSaveConfig.js");
const { ClientSafeError } = await import("../../middleware/clientSafeError.js");
const { BaseType } = await import("../../enums/Base.js");

const OWNER = 2503;
const ATTACKER = 77;

const ctx = { ip: "127.0.0.1", path: "/base/save" } as unknown as Context;
const userOf = (userid: number) => ({ userid, username: `u${userid}` }) as unknown as User;

/** A stored row owned by {@link OWNER}; an attack row carries an `attackid`. */
const rowOf = (type: string, attackid = 0) =>
  ({ saveuserid: OWNER, type, attackid, baseid: "1234", basesaveid: 9 }) as unknown as Save;

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

describe("OWNER_SAVE_MODE", () => {
  test("refuse and allow are the modes; anything else means refuse", () => {
    expect(parseOwnerSaveMode("refuse")).toBe("refuse");
    expect(parseOwnerSaveMode("allow")).toBe("allow");
    expect(parseOwnerSaveMode(undefined)).toBe("refuse");
    expect(parseOwnerSaveMode("ALLOW")).toBe("refuse");
    expect(parseOwnerSaveMode("")).toBe("refuse");
    expect(isOwnerSaveMode("log")).toBe(false);
  });
});

describe("isRetiredOwnerSave", () => {
  test("an owner save of a main yard is retired in refuse mode only", () => {
    expect(isRetiredOwnerSave(rowOf(BaseType.MAIN), OWNER, "refuse")).toBe(true);
    expect(isRetiredOwnerSave(rowOf(BaseType.MAIN), OWNER, "allow")).toBe(false);
  });

  test("the owner's main yard under attack is still the owner's save", () => {
    expect(isRetiredOwnerSave(rowOf(BaseType.MAIN, 4242), OWNER, "refuse")).toBe(true);
  });

  test("an attack save on a main yard is not the owner's, so it passes", () => {
    expect(isRetiredOwnerSave(rowOf(BaseType.MAIN, 4242), ATTACKER, "refuse")).toBe(false);
  });

  test("outpost, Inferno and tribe rows pass in refuse mode", () => {
    for (const type of [BaseType.OUTPOST, BaseType.INFERNO, BaseType.TRIBE, BaseType.INFERNO_TRIBE]) {
      expect(isRetiredOwnerSave(rowOf(type), OWNER, "refuse")).toBe(false);
    }
  });
});

describe("requireOwnerSaveAllowed", () => {
  test("refuse: an owner main-yard save throws 409 ownerSaveRetired and is logged", () => {
    const caught = thrownBy(() =>
      requireOwnerSaveAllowed(ctx, userOf(OWNER), rowOf(BaseType.MAIN), "refuse")
    );

    expect(caught).toBeInstanceOf(ClientSafeError);
    const error = caught as InstanceType<typeof ClientSafeError>;
    expect(error.status).toBe(409);
    expect(error.data).toEqual({ reason: "ownerSaveRetired" });
    // A real 409, not the HTTP 200 rewrite the Flash-era refusals use.
    expect(error.isClientFriendly).toBe(true);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ event: "owner-save-refused", userid: OWNER });
  });

  test("allow: the same save goes through silently", () => {
    expect(
      thrownBy(() => requireOwnerSaveAllowed(ctx, userOf(OWNER), rowOf(BaseType.MAIN), "allow"))
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test("refuse: an attack save and an outpost owner save go through silently", () => {
    expect(
      thrownBy(() =>
        requireOwnerSaveAllowed(ctx, userOf(ATTACKER), rowOf(BaseType.MAIN, 4242), "refuse")
      )
    ).toBeNull();
    expect(
      thrownBy(() => requireOwnerSaveAllowed(ctx, userOf(OWNER), rowOf(BaseType.OUTPOST), "refuse"))
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
