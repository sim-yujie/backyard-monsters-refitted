import { beforeEach, describe, expect, mock, test } from "bun:test";
import bcrypt from "bcrypt";
import { UniqueConstraintViolationException } from "@mikro-orm/core";
import type { Context } from "koa";
import { matchesWhere } from "../../testing/matchesWhere.js";
import { AccountMessage } from "../../game-rules/account/accountRules.js";

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
