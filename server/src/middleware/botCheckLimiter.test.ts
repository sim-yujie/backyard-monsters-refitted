import { describe, expect, test } from "bun:test";
import { botCheckAnswerLimiter, botCheckReadLimiter } from "./rateLimiters.js";

/**
 * The in-game check's own limits (#273): twenty reads and twenty answers a
 * minute per player, each counted apart from the other, from every other
 * player and from every other limiter.
 */

type Limiter = typeof botCheckReadLimiter;

const request = async (
  limiter: Limiter,
  userid: number
): Promise<{ status?: number; body: unknown; passed: boolean }> => {
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
  await limiter(ctx as never, async () => {
    passed = true;
  });
  return { status: ctx.status, body: ctx.body, passed };
};

describe("botCheckReadLimiter and botCheckAnswerLimiter", () => {
  test("let twenty reads through in a minute, then answer 429 with a reason the client can read", async () => {
    for (let at = 0; at < 20; at++) expect((await request(botCheckReadLimiter, 9101)).passed).toBe(true);
    const over = await request(botCheckReadLimiter, 9101);
    expect(over.passed).toBe(false);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ error: expect.any(String), data: { reason: "rateLimited" } });
  });

  test("count answers apart from reads", async () => {
    for (let at = 0; at < 20; at++) await request(botCheckReadLimiter, 9102);
    expect((await request(botCheckReadLimiter, 9102)).passed).toBe(false);
    for (let at = 0; at < 20; at++) expect((await request(botCheckAnswerLimiter, 9102)).passed).toBe(true);
    const over = await request(botCheckAnswerLimiter, 9102);
    expect(over.passed).toBe(false);
    expect(over.status).toBe(429);
  });

  test("count each player apart", async () => {
    for (let at = 0; at < 20; at++) await request(botCheckAnswerLimiter, 9103);
    expect((await request(botCheckAnswerLimiter, 9103)).passed).toBe(false);
    expect((await request(botCheckAnswerLimiter, 9104)).passed).toBe(true);
  });
});
