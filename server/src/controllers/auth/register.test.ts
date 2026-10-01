import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import bcrypt from "bcrypt";
import { UniqueConstraintViolationException } from "@mikro-orm/core";
import type { Context } from "koa";
import { matchesWhere } from "../../testing/matchesWhere.js";
import { AccountMessage } from "../../game-rules/account/accountRules.js";
import { devConfig } from "../../config/GameConfig.js";

/**
 * `POST /player/register` from the web client's sign-up form (issue #213),
 * driven over an in-memory stand-in for the user table. Every refusal is a
 * ClientSafeError with a reason the form can place: a broken rule is a 400
 * naming its field, a taken username (without case) or email a 409.
 */

type Row = Record<string, unknown>;

let users: Row[];
let flushError: Error | null;

const em = {
  findOne: async (_entity: unknown, where: Row) => users.find((row) => matchesWhere(row, where)) ?? null,
  create: (entity: new () => object, data: Row) => Object.assign(new entity(), { userid: 0, ...data }) as Row,
  persist: (row: Row) => {
    users.push(row);
  },
  flush: async () => {
    if (flushError) {
      users.pop();
      throw flushError;
    }
    const row = users.at(-1);
    if (row && !row.userid) row.userid = users.length + 1000;
  },
};

// Bun's module mocks outlive this file, so the stand-in carries a Redis too.
mock.module("../../server.js", () => ({
  postgres: { em },
  redis: {
    get: async () => null,
    set: async () => "OK",
    setex: async () => "OK",
    del: async () => 0,
    sadd: async () => 1,
    srem: async () => 1,
    smembers: async () => [],
  },
}));
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { register } = await import("./register.js");

const VALID = { username: "zz_signup", email: "New.Player@Example.com", password: "hunter22!" };

const run = async (body: unknown) => {
  const ctx = { request: { body }, ip: "127.0.0.1" } as unknown as Context & { body: Row };
  try {
    await register(ctx, async () => {});
    return { status: ctx.status, body: ctx.body, reason: undefined, field: undefined, message: undefined };
  } catch (caught) {
    const error = caught as { status?: number; message: string; data?: { reason?: string; field?: string } };
    return {
      status: error.status,
      body: undefined,
      reason: error.data?.reason,
      field: error.data?.field,
      message: error.message,
    };
  }
};

beforeEach(() => {
  users = [{ userid: 1, username: "Bob_1", email: "bob@example.com", password: "x" }];
  flushError = null;
});

describe("register", () => {
  test("creates the account with a trimmed name, a lower-case email and a hashed password", async () => {
    const result = await run({ username: "  zz_signup ", email: "  New.Player@Example.com ", password: " hunter22! " });

    expect(result.status).toBe(200);
    const stored = users.at(-1)!;
    expect(stored.username).toBe("zz_signup");
    expect(stored.email).toBe("new.player@example.com");
    expect(await bcrypt.compare("hunter22!", stored.password as string)).toBe(true);
    expect((result.body as { user: Row }).user.username).toBe("zz_signup");
  });

  test("never sends the password hash back", async () => {
    const result = await run(VALID);
    expect(JSON.stringify(result.body)).not.toContain("password");
  });

  test("a username taken in another case is refused as taken", async () => {
    const result = await run({ ...VALID, username: "BOB_1" });
    expect(result).toMatchObject({ status: 409, reason: "usernameTaken" });
    expect(users).toHaveLength(1);
  });

  test("an underscore is not a wildcard: bobx1 is free while Bob_1 exists", async () => {
    expect((await run({ ...VALID, username: "bobx1" })).status).toBe(200);
  });

  test("an email taken in another case is refused as taken", async () => {
    const result = await run({ ...VALID, email: "BOB@Example.com" });
    expect(result).toMatchObject({ status: 409, reason: "emailTaken" });
    expect(users).toHaveLength(1);
  });

  test("a missing password is a 400 on the password field, not a crash", async () => {
    const result = await run({ username: VALID.username, email: VALID.email });
    expect(result).toMatchObject({ status: 400, reason: "invalidAccount", field: "password" });
    expect((await run({ ...VALID, password: "" })).field).toBe("password");
  });

  test("each broken rule answers with the shared message for its field", async () => {
    expect(await run({ ...VALID, username: "a" })).toMatchObject({
      status: 400,
      field: "username",
      message: AccountMessage.usernameLength,
    });
    expect(await run({ ...VALID, username: "bad name" })).toMatchObject({
      field: "username",
      message: AccountMessage.usernameCharset,
    });
    expect(await run({ ...VALID, email: "not-an-email" })).toMatchObject({
      field: "email",
      message: AccountMessage.email,
    });
    expect(await run({ ...VALID, password: "longenough" })).toMatchObject({
      field: "password",
      message: AccountMessage.passwordSymbol,
    });
    expect(await run({ ...VALID, password: " a!b " })).toMatchObject({
      field: "password",
      message: AccountMessage.passwordLength,
    });
  });

  test("an empty or missing body is a 400, not a crash", async () => {
    expect((await run(undefined)).status).toBe(400);
    expect((await run({})).status).toBe(400);
  });

  test("a sign-up that loses a race for the same email is refused as taken", async () => {
    flushError = new UniqueConstraintViolationException(
      new Error('duplicate key value violates unique constraint "user_email_unique"')
    );
    expect(await run(VALID)).toMatchObject({ status: 409, reason: "emailTaken" });
  });

  test("a sign-up that loses a race for the same username is refused as taken", async () => {
    flushError = new UniqueConstraintViolationException(
      new Error('duplicate key value violates unique constraint "user_username_unique"')
    );
    expect(await run(VALID)).toMatchObject({ status: 409, reason: "usernameTaken" });
  });
});

describe("register: launch checks", () => {
  const realFetch = globalThis.fetch;
  let savedSecret: string | undefined;
  let siteverifyCalls: number;

  /** Cloudflare's siteverify for its test secrets: 1x... passes, 2x... fails. */
  const stubSiteverify = () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      siteverifyCalls += 1;
      const secret = (init?.body as URLSearchParams).get("secret");
      const success = secret === "1x0000000000000000000000000000000AA";
      return new Response(
        JSON.stringify({ success, "error-codes": success ? [] : ["invalid-input-response"] })
      );
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    savedSecret = process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    siteverifyCalls = 0;
    stubSiteverify();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = savedSecret;
  });

  test("a reserved name is a 400 on the username field with the shared message", async () => {
    for (const username of ["admin", "Mod_2", "bymr_help"]) {
      expect(await run({ ...VALID, username })).toMatchObject({
        status: 400,
        field: "username",
        message: AccountMessage.usernameReserved,
      });
    }
    expect(users).toHaveLength(1);
  });

  test("a name the chat word filter catches is a 400 on the username field", async () => {
    expect(await run({ ...VALID, username: "big_shit" })).toMatchObject({
      status: 400,
      reason: "invalidAccount",
      field: "username",
      message: AccountMessage.usernameBlocked,
    });
    expect(users).toHaveLength(1);
  });

  test("without a secret key there is no bot check, and no call to Cloudflare", async () => {
    expect((await run(VALID)).status).toBe(200);
    expect(siteverifyCalls).toBe(0);
  });

  test("with the always-pass test secret the account is made", async () => {
    process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
    expect((await run({ ...VALID, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" })).status).toBe(200);
    expect(siteverifyCalls).toBe(1);
    expect(users).toHaveLength(2);
    expect(users.at(-1)).not.toHaveProperty("turnstileToken");
  });

  test("with the always-fail test secret nothing is made", async () => {
    process.env.TURNSTILE_SECRET_KEY = "2x0000000000000000000000000000000AA";
    expect(await run({ ...VALID, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" })).toMatchObject({
      status: 400,
      reason: "botCheckFailed",
    });
    expect(users).toHaveLength(1);
  });

  test("with a secret key, a sign-up with no token is refused without asking Cloudflare", async () => {
    process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
    expect(await run(VALID)).toMatchObject({ status: 400, reason: "botCheckFailed" });
    expect(siteverifyCalls).toBe(0);
    expect(users).toHaveLength(1);
  });

  test("when Cloudflare cannot be reached nothing is made, and the player is told to retry", async () => {
    process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await run({ ...VALID, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" })).toMatchObject({
      status: 503,
      reason: "botCheckUnavailable",
    });
    expect(users).toHaveLength(1);
  });

  test("a broken rule is refused before the bot check spends the token", async () => {
    process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
    await run({ ...VALID, username: "a", turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" });
    await run({ ...VALID, username: "big_shit", turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" });
    expect(siteverifyCalls).toBe(0);
  });

  test("records when the terms were accepted, and nothing when the client did not show them", async () => {
    const before = Date.now();
    expect((await run({ ...VALID, termsAccepted: true })).status).toBe(200);
    const stamped = users.at(-1)!.terms_accepted_at as Date;
    expect(stamped).toBeInstanceOf(Date);
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
    expect(users.at(-1)).not.toHaveProperty("termsAccepted");

    expect((await run({ ...VALID, username: "zz_other", email: "other@example.com" })).status).toBe(200);
    expect(users.at(-1)!.terms_accepted_at).toBeNull();
  });

  test("takes termsAccepted as a form field's string too", async () => {
    expect((await run({ ...VALID, termsAccepted: "true" })).status).toBe(200);
    expect(users.at(-1)!.terms_accepted_at).toBeInstanceOf(Date);
  });
});

describe("register — the dev-only test yard choice (#217)", () => {
  const sandbox = devConfig.devSandbox;
  afterEach(() => {
    devConfig.devSandbox = sandbox;
  });

  test("with DEV_SANDBOX on, an account that asks for the test yard is marked for it", async () => {
    devConfig.devSandbox = true;
    expect((await run({ ...VALID, sandboxStart: true })).status).toBe(200);
    expect(users.at(-1)!.sandbox_start).toBe(true);
    expect(users.at(-1)).not.toHaveProperty("sandboxStart");
  });

  test("an account that does not ask is not, even with DEV_SANDBOX on", async () => {
    devConfig.devSandbox = true;
    await run(VALID);
    expect(users.at(-1)!.sandbox_start).toBe(false);
    await run({ ...VALID, username: "zz_other", email: "other@example.com", sandboxStart: "false" });
    expect(users.at(-1)!.sandbox_start).toBe(false);
  });

  test("takes sandboxStart as a form field's string too", async () => {
    devConfig.devSandbox = true;
    await run({ ...VALID, sandboxStart: "true" });
    expect(users.at(-1)!.sandbox_start).toBe(true);
  });

  test("a server without DEV_SANDBOX (production included) ignores the request", async () => {
    devConfig.devSandbox = false;
    expect((await run({ ...VALID, sandboxStart: true })).status).toBe(200);
    expect(users.at(-1)!.sandbox_start).toBe(false);
  });

  test("anything but true or false is refused as a broken field", async () => {
    expect(await run({ ...VALID, sandboxStart: "yes" })).toMatchObject({ status: 400, field: "sandboxStart" });
    expect(users).toHaveLength(1);
  });
});
