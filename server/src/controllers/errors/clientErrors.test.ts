import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * Who sent a browser error (owner 3 Nov 2026): the account comes from the
 * request's login (`ctx.authUser`) and the address from `ctx.ip`, never from
 * the body, so a player cannot put someone else's name on an error.
 */

const calls: { sql: string; params: unknown[] }[] = [];

const em = {
  execute: async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return sql.includes("INSERT INTO bym.app_error AS e") ? [{ id: 7 }] : [];
  },
};

mock.module("../../server.js", () => ({ postgres: { em: { fork: () => em } } }));

const { clientErrors, guestClientErrors } = await import("./clientErrors.js");

const BODY = {
  errors: [{ kind: "error", message: "boom", place: "/static/index.js:1:2", stack: "", count: 1 }],
  gameVersion: "v",
  screen: "yard",
  // A client trying to name someone else: ignored.
  userid: 1,
  username: "SomeoneElse",
  ip: "1.2.3.4",
};

const call = async (controller: typeof clientErrors, authUser?: { userid: number; username: string }) => {
  const ctx = { request: { body: BODY }, authUser, ip: "203.0.113.7" } as unknown as Context;
  await controller(ctx, async () => {});
  return ctx;
};

/** The sender row written for the error: [error_id, userid, username, ip, at]. */
const reporterRow = () => calls.find((c) => c.sql.includes("INSERT INTO bym.app_error_reporter"))?.params;
const useridsParam = () => calls.find((c) => c.sql.includes("INSERT INTO bym.app_error AS e"))?.params[10];

beforeEach(() => {
  calls.length = 0;
});

describe("browser errors keep their sender from the request", () => {
  test("signed in: account number and name from the login, address from the request", async () => {
    const ctx = await call(clientErrors, { userid: 2503, username: "yardtester" });
    expect(ctx.body).toEqual({ error: 0, kept: 1 });
    expect(reporterRow()?.slice(0, 4)).toEqual([7, 2503, "yardtester", "203.0.113.7"]);
    expect(useridsParam()).toBe("{2503}");
  });

  test("a name, number or address in the body is ignored", async () => {
    await call(clientErrors, { userid: 2503, username: "yardtester" });
    const sent = JSON.stringify(calls.map((c) => c.params));
    expect(sent).not.toContain("SomeoneElse");
    expect(sent).not.toContain("1.2.3.4");
  });

  test("signed out: no account, only the address", async () => {
    await call(guestClientErrors);
    expect(reporterRow()?.slice(0, 4)).toEqual([7, 0, "", "203.0.113.7"]);
    expect(useridsParam()).toBe("{}");
  });
});
