import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The sign-up bot check (issue #213) against a stand-in for Cloudflare's
 * `siteverify`, which answers as Cloudflare documents its test secret keys:
 * `1x...AA` passes every token, `2x...AA` fails every one, `3x...AA` says the
 * token was already spent. No request leaves the machine.
 */

mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { TURNSTILE_VERIFY_URL, turnstileSecretKey, verifyTurnstileToken } = await import("./turnstile.js");

const ALWAYS_PASSES = "1x0000000000000000000000000000000AA";
const ALWAYS_FAILS = "2x0000000000000000000000000000000AA";
const ALREADY_SPENT = "3x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

interface Sent {
  url: string;
  body: URLSearchParams;
}

let sent: Sent[];

/** Cloudflare's siteverify, as it answers the test secret keys. */
const cloudflare = mock(async (url: string | URL | Request, init?: RequestInit) => {
  const body = init?.body as URLSearchParams;
  sent.push({ url: String(url), body });

  const answers: Record<string, object> = {
    [ALWAYS_PASSES]: { success: true, "error-codes": [] },
    [ALWAYS_FAILS]: { success: false, "error-codes": ["invalid-input-response"] },
    [ALREADY_SPENT]: { success: false, "error-codes": ["timeout-or-duplicate"] },
  };
  const answer = answers[body.get("secret") ?? ""] ?? { success: false, "error-codes": ["invalid-input-secret"] };
  return new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;

const verify = (token: unknown, secret: string | null, fetcher: typeof fetch = cloudflare) =>
  verifyTurnstileToken(token, "203.0.113.7", { secret, fetcher });

let savedSecret: string | undefined;

beforeEach(() => {
  sent = [];
  savedSecret = process.env.TURNSTILE_SECRET_KEY;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = savedSecret;
});

describe("verifyTurnstileToken", () => {
  test("skips the check entirely when the server has no secret key", async () => {
    expect(await verify(undefined, null)).toBe("skipped");
    expect(await verify(DUMMY_TOKEN, null)).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  test("passes a token Cloudflare's always-pass test secret accepts", async () => {
    expect(await verify(DUMMY_TOKEN, ALWAYS_PASSES)).toBe("passed");
  });

  test("fails a token Cloudflare's always-fail test secret refuses", async () => {
    expect(await verify(DUMMY_TOKEN, ALWAYS_FAILS)).toBe("failed");
  });

  test("fails a token that was already spent", async () => {
    expect(await verify(DUMMY_TOKEN, ALREADY_SPENT)).toBe("failed");
  });

  test("sends the secret, the token and the player's address as a form to siteverify", async () => {
    await verify(DUMMY_TOKEN, ALWAYS_PASSES);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(TURNSTILE_VERIFY_URL);
    expect(sent[0].body.get("secret")).toBe(ALWAYS_PASSES);
    expect(sent[0].body.get("response")).toBe(DUMMY_TOKEN);
    expect(sent[0].body.get("remoteip")).toBe("203.0.113.7");
  });

  test("fails a missing, empty, non-string or oversized token without asking Cloudflare", async () => {
    for (const token of [undefined, "", 42, { token: DUMMY_TOKEN }, "x".repeat(2049)]) {
      expect(await verify(token, ALWAYS_PASSES)).toBe("failed");
    }
    expect(sent).toHaveLength(0);
  });

  test("is unavailable when Cloudflare cannot be reached or answers with an error page", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const broken = (async () => new Response("Bad gateway", { status: 502 })) as unknown as typeof fetch;
    const garbled = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;

    expect(await verify(DUMMY_TOKEN, ALWAYS_PASSES, down)).toBe("unavailable");
    expect(await verify(DUMMY_TOKEN, ALWAYS_PASSES, broken)).toBe("unavailable");
    expect(await verify(DUMMY_TOKEN, ALWAYS_PASSES, garbled)).toBe("unavailable");
  });

  test("blames the server, not the player, for a wrong secret key", async () => {
    expect(await verify(DUMMY_TOKEN, "not-a-real-secret")).toBe("unavailable");
  });

  test("reads the secret key from TURNSTILE_SECRET_KEY, blank meaning none", () => {
    process.env.TURNSTILE_SECRET_KEY = `  ${ALWAYS_PASSES} `;
    expect(turnstileSecretKey()).toBe(ALWAYS_PASSES);
    process.env.TURNSTILE_SECRET_KEY = "   ";
    expect(turnstileSecretKey()).toBeNull();
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileSecretKey()).toBeNull();
  });
});
