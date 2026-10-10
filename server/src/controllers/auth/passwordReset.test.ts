import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import JWT from "jsonwebtoken";
import type { Context } from "koa";

/**
 * Forgot-password answers the same for every well-formed request (issue #317),
 * so it does not say which emails have an account, and a bot's account
 * (issue #235, `docs/design/bot-neighbours.md` §4.1) is treated as no account.
 * A reset is refused for a bot.
 */

type Row = Record<string, unknown>;

let user: Row | null;
let botIds: number[];
let mailsSent: number;
let mailFails: boolean;

const em = {
  global: true,
  getContext: () => em,
  findOne: async (entity: { name?: string }) =>
    entity?.name === "Bot"
      ? user && botIds.includes(user.userid as number) ? { userid: user.userid } : null
      : user,
  persist: () => {},
  flush: async () => {},
};

let deletedKeys: string[];

mock.module("../../server.js", () => ({
  postgres: { em },
  redis: {
    get: async () => null,
    del: async (...keys: string[]) => {
      deletedKeys.push(...keys);
      return keys.length;
    },
  },
}));
mock.module("../../config/MailConfig.js", () => ({
  transporter: {
    sendMail: async () => {
      if (mailFails) throw new Error("mail server down");
      mailsSent++;
    },
  },
}));
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { forgotPassword, FORGOT_PASSWORD_SENT } = await import("./forgotPassword.js");
const { resetPassword } = await import("./resetPassword.js");
const { hashResetToken } = await import("../../services/auth/resetToken.js");

const EMAIL = "player@example.com";
let savedSecret: string | undefined;

const call = async (controller: typeof forgotPassword, body: Row) => {
  const ctx = { request: { body } } as unknown as Context & { body: Row };
  try {
    await controller(ctx, async () => {});
    return { status: ctx.status, body: ctx.body, error: undefined };
  } catch (caught) {
    const error = caught as { status?: number; message: string };
    return { status: error.status, body: undefined, error: error.message };
  }
};

/** The email goes out after the answer; give it time to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const realUser = (): Row => ({ userid: 7, email: EMAIL, password: "old-hash", resetToken: "" });

beforeEach(() => {
  savedSecret = process.env.SECRET_KEY;
  process.env.SECRET_KEY = "test-secret";
  user = realUser();
  botIds = [];
  mailsSent = 0;
  mailFails = false;
  deletedKeys = [];
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.SECRET_KEY;
  else process.env.SECRET_KEY = savedSecret;
});

describe("forgot password answers the same whether or not the account exists", () => {
  test("a known email, an unknown one and a bot's all get the one generic success", async () => {
    const known = await call(forgotPassword, { email: EMAIL });
    await settle();
    expect(known).toEqual({ status: 200, body: FORGOT_PASSWORD_SENT, error: undefined });
    expect(mailsSent).toBe(1);

    user = null;
    const unknown = await call(forgotPassword, { email: EMAIL });

    user = realUser();
    botIds = [7];
    const bot = await call(forgotPassword, { email: EMAIL });
    await settle();

    expect(unknown).toEqual(known);
    expect(bot).toEqual(known);
    expect(user.resetToken).toBe("");
    expect(mailsSent).toBe(1);
  });

  test("a mail server failure is logged, not shown", async () => {
    mailFails = true;
    const failed = await call(forgotPassword, { email: EMAIL });
    await settle();
    expect(failed).toEqual({ status: 200, body: FORGOT_PASSWORD_SENT, error: undefined });
  });

  test("a dev sandbox keeps the link in the log and sends no email", async () => {
    const saved = { env: process.env.ENV, sandbox: process.env.DEV_SANDBOX };
    process.env.ENV = "local";
    process.env.DEV_SANDBOX = "true";
    try {
      const answer = await call(forgotPassword, { email: EMAIL });
      await settle();
      expect(answer).toEqual({ status: 200, body: FORGOT_PASSWORD_SENT, error: undefined });
      expect(mailsSent).toBe(0);
      expect(user?.resetToken).not.toBe("");
    } finally {
      if (saved.env === undefined) delete process.env.ENV;
      else process.env.ENV = saved.env;
      if (saved.sandbox === undefined) delete process.env.DEV_SANDBOX;
      else process.env.DEV_SANDBOX = saved.sandbox;
    }
  });

  test("a malformed email is still refused", async () => {
    const bad = await call(forgotPassword, { email: "not-an-email" });
    expect(bad.status).toBe(400);
    expect(mailsSent).toBe(0);
  });
});

describe("reset password and bot accounts", () => {
  const resetWith = async () => {
    const token = JWT.sign({ user: { email: EMAIL } }, process.env.SECRET_KEY!, { expiresIn: "20m" });
    user!.resetToken = hashResetToken(token);
    return call(resetPassword, { password: "NewPassword1!", token });
  };

  test("a real player's reset goes through", async () => {
    expect((await resetWith()).status).toBe(200);
    expect(user!.password).not.toBe("old-hash");
  });

  test("a bot's reset is refused and its password kept", async () => {
    botIds = [7];
    const bot = await resetWith();
    expect(bot.status).toBe(401);
    expect(bot.error).toBe("Could not authenticate");
    expect(user!.password).toBe("old-hash");
  });
});

describe("a reset logs the account out everywhere (issue #318)", () => {
  test("the game, launcher and chat tokens are dropped", async () => {
    const token = JWT.sign({ user: { email: EMAIL } }, process.env.SECRET_KEY!, { expiresIn: "20m" });
    user!.resetToken = hashResetToken(token);
    expect((await call(resetPassword, { password: "NewPassword1!", token })).status).toBe(200);
    expect(deletedKeys.sort()).toEqual([`chat-token:7`, `user-token:game:${EMAIL}`, `user-token:launcher:${EMAIL}`]);
  });

  test("a refused reset logs no one out", async () => {
    botIds = [7];
    const token = JWT.sign({ user: { email: EMAIL } }, process.env.SECRET_KEY!, { expiresIn: "20m" });
    user!.resetToken = hashResetToken(token);
    expect((await call(resetPassword, { password: "NewPassword1!", token })).status).toBe(401);
    expect(deletedKeys).toEqual([]);
  });
});

describe("reset tokens are stored hashed (issue #321)", () => {
  test("forgot-password stores the token's hash, never the token", async () => {
    await call(forgotPassword, { email: EMAIL });
    const stored = user!.resetToken as string;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.startsWith("eyJ")).toBe(false);
  });

  test("the emailed token resets the password once; the stored hash itself does not", async () => {
    const token = JWT.sign({ user: { email: EMAIL } }, process.env.SECRET_KEY!, { expiresIn: "20m" });
    user!.resetToken = hashResetToken(token);

    const leaked = await call(resetPassword, { password: "NewPassword1!", token: user!.resetToken as string });
    expect(leaked.status).toBe(401);

    expect((await call(resetPassword, { password: "NewPassword1!", token })).status).toBe(200);
    expect(user!.resetToken).toBe("");
    expect((await call(resetPassword, { password: "Another1!", token })).status).toBe(401);
  });

  test("a token stored in plain text before the change no longer works", async () => {
    const token = JWT.sign({ user: { email: EMAIL } }, process.env.SECRET_KEY!, { expiresIn: "20m" });
    user!.resetToken = token;
    expect((await call(resetPassword, { password: "NewPassword1!", token })).status).toBe(401);
  });
});

describe("an expired reset link says so", () => {
  const expiredToken = (secret = process.env.SECRET_KEY!) =>
    JWT.sign({ user: { email: EMAIL }, exp: Math.floor(Date.now() / 1000) - 60 }, secret);

  test("an expired link gets the expired message and changes nothing", async () => {
    const token = expiredToken();
    user!.resetToken = hashResetToken(token);
    const expired = await call(resetPassword, { password: "NewPassword1!", token });
    expect(expired.status).toBe(401);
    expect((expired.body as { message: string }).message).toMatch(/expired/);
    expect(user!.password).toBe("old-hash");
    expect(deletedKeys).toEqual([]);
  });

  test("answers the same whether or not the account exists", async () => {
    const token = expiredToken();
    user!.resetToken = hashResetToken(token);
    const known = await call(resetPassword, { password: "NewPassword1!", token });
    user = null;
    const unknown = await call(resetPassword, { password: "NewPassword1!", token });
    expect(unknown).toEqual(known);
  });

  test("an expired link that was never ours is just refused", async () => {
    const forged = await call(resetPassword, { password: "NewPassword1!", token: expiredToken("another-secret") });
    expect(forged.status).toBe(401);
    expect(forged.error).toBe("Could not authenticate");
  });
});
