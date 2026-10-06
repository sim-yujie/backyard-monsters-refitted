import { describe, expect, test } from "bun:test";
import { forgotPasswordEmailLimiter, forgotPasswordIpLimiter, resetPasswordLimiter } from "./rateLimiters.js";

/**
 * Forgot-password sends an email per request (issue #316): ten requests an
 * hour from one address, three emails an hour to one email whoever asks, and
 * ten new passwords per 15 minutes from one address.
 */

type Limiter = typeof forgotPasswordIpLimiter;

const request = async (limiter: Limiter, ip: string, email?: unknown) => {
  const ctx = {
    ip,
    request: { ip, body: email === undefined ? {} : { email } },
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

describe("forgot-password rate limits", () => {
  test("one address may ask ten times, then gets 429", async () => {
    for (let at = 0; at < 10; at++) {
      expect((await request(forgotPasswordIpLimiter, "10.9.0.1", `p${at}@example.com`)).passed).toBe(true);
    }
    const over = await request(forgotPasswordIpLimiter, "10.9.0.1", "other@example.com");
    expect(over.passed).toBe(false);
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ message: expect.any(String) });
    expect((await request(forgotPasswordIpLimiter, "10.9.0.2", "other@example.com")).passed).toBe(true);
  });

  test("one email gets three, from any address, whatever its case or spacing", async () => {
    expect((await request(forgotPasswordEmailLimiter, "10.9.1.1", "victim@example.com")).passed).toBe(true);
    expect((await request(forgotPasswordEmailLimiter, "10.9.1.2", "Victim@Example.com")).passed).toBe(true);
    expect((await request(forgotPasswordEmailLimiter, "10.9.1.3", " victim@example.com ")).passed).toBe(true);
    const over = await request(forgotPasswordEmailLimiter, "10.9.1.4", "VICTIM@example.com");
    expect(over.passed).toBe(false);
    expect(over.status).toBe(429);
    expect((await request(forgotPasswordEmailLimiter, "10.9.1.4", "someone@example.com")).passed).toBe(true);
  });

  test("a body without an email is counted, not thrown on", async () => {
    expect((await request(forgotPasswordEmailLimiter, "10.9.2.1")).passed).toBe(true);
    expect((await request(forgotPasswordEmailLimiter, "10.9.2.1", 42)).passed).toBe(true);
  });

  test("setting a new password: ten per address", async () => {
    for (let at = 0; at < 10; at++) expect((await request(resetPasswordLimiter, "10.9.3.1")).passed).toBe(true);
    expect((await request(resetPasswordLimiter, "10.9.3.1")).status).toBe(429);
  });
});
