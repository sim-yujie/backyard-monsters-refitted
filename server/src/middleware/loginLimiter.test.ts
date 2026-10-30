import { describe, expect, test } from "bun:test";
import { loginLimiter } from "./rateLimiters.js";

/**
 * The per-address login limit counts an IPv6 address by its /64 (security
 * audit 2026-10-29, L2), so one connection cannot dodge it by switching to
 * another address in its own /64.
 */

const request = async (ip: string) => {
  const ctx = {
    ip,
    request: { ip, body: {} },
    state: {} as Record<string, unknown>,
    status: undefined as number | undefined,
    body: undefined as unknown,
    set: () => {},
  };
  let passed = false;
  await loginLimiter(ctx as never, async () => {
    passed = true;
  });
  return { status: ctx.status, passed };
};

describe("login limit per address", () => {
  test("thirty tries from one /64, whichever of its addresses, then 429", async () => {
    for (let at = 0; at < 30; at++) {
      expect((await request(`2001:db8:77:1::${(at + 1).toString(16)}`)).passed).toBe(true);
    }
    const over = await request("2001:db8:77:1:ffff:ffff:ffff:ffff");
    expect(over.passed).toBe(false);
    expect(over.status).toBe(429);

    expect((await request("2001:db8:77:2::1")).passed).toBe(true);
  });

  test("IPv4 addresses are counted one by one", async () => {
    for (let at = 0; at < 30; at++) await request("198.51.100.77");
    expect((await request("198.51.100.77")).passed).toBe(false);
    expect((await request("198.51.100.78")).passed).toBe(true);
  });
});
