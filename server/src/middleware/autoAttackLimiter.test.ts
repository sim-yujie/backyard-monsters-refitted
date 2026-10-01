import { describe, expect, test } from "bun:test";
import { autoAttackLimiter } from "./rateLimiters.js";

/**
 * Auto-attack's own limit (issue #221): ten a minute per player, counted
 * apart from every other player and every other limiter.
 */

const request = async (userid: number): Promise<{ status?: number; passed: boolean }> => {
  const ctx = {
    authUser: { userid },
    ip: "127.0.0.1",
    request: { ip: "127.0.0.1" },
    state: {} as Record<string, unknown>,
    status: undefined as number | undefined,
    body: undefined as unknown,
    set: () => {},
  };
  let passed = false;
  await autoAttackLimiter(ctx as never, async () => {
    passed = true;
  });
  return { status: ctx.status, passed };
};

describe("autoAttackLimiter", () => {
  test("lets ten through in a minute, then answers 429", async () => {
    for (let at = 0; at < 10; at++) expect((await request(9001)).passed).toBe(true);
    const eleventh = await request(9001);
    expect(eleventh.passed).toBe(false);
    expect(eleventh.status).toBe(429);
  });

  test("counts each player apart", async () => {
    for (let at = 0; at < 10; at++) await request(9002);
    expect((await request(9002)).passed).toBe(false);
    expect((await request(9003)).passed).toBe(true);
  });
});
