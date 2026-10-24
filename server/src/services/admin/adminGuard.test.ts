import { describe, expect, test } from "bun:test";
import type { Context, Next } from "koa";

import { makeAdminGuard, type Authenticate } from "./adminGuard.js";

/** A stand-in for `verifyUserAuth`: signs in user `userid`, refuses with a 401 body, or throws. */
const signIn =
  (outcome: number | "refuse" | "throw"): Authenticate =>
  async (ctx: Context, next: Next) => {
    if (outcome === "throw") throw new Error("bad token");
    if (outcome === "refuse") {
      ctx.status = 401;
      ctx.body = { error: "Unauthorized" };
      return;
    }
    ctx.authUser = { userid: outcome, username: `u${outcome}` } as Context["authUser"];
    await next();
  };

const run = async (outcome: number | "refuse" | "throw", admins: number[]) => {
  const ctx = { method: "GET", path: "/api/v1/admin/me" } as Context;
  const refused: Context[] = [];
  let reached = false;
  const guard = makeAdminGuard(signIn(outcome), (userid) => admins.includes(userid as number), (c) => refused.push(c));
  await guard(ctx, async () => {
    reached = true;
    ctx.status = 200;
  });
  return { ctx, reached, refused: refused.length };
};

describe("the owner-only check (adminGuard.ts)", () => {
  test("an owner gets through", async () => {
    const { ctx, reached, refused } = await run(5, [5]);
    expect(reached).toBe(true);
    expect(ctx.status).toBe(200);
    expect(refused).toBe(0);
  });

  test("a signed-in player who is not an owner gets a plain 404", async () => {
    const { ctx, reached, refused } = await run(6, [5]);
    expect(reached).toBe(false);
    expect(ctx.status).toBe(404);
    expect(ctx.body).toBe("Not Found");
    expect(refused).toBe(1);
  });

  test("signed out, or a failed sign-in, gets the same 404, not the sign-in's own answer", async () => {
    for (const outcome of ["refuse", "throw"] as const) {
      const { ctx, reached } = await run(outcome, [5]);
      expect(reached).toBe(false);
      expect(ctx.status).toBe(404);
      expect(ctx.body).toBe("Not Found");
    }
  });

  test("with no owners set, nobody gets through", async () => {
    expect((await run(5, [])).reached).toBe(false);
  });
});
