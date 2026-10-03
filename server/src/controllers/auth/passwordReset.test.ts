import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import JWT from "jsonwebtoken";
import type { Context } from "koa";

/**
 * A bot's account cannot be entered (issue #235,
 * `docs/design/bot-neighbours.md` §4.1): forgot-password fails for it as for
 * an unknown email, and a reset is refused, so neither says the account is a
 * bot.
 */

type Row = Record<string, unknown>;

let user: Row | null;
let botIds: number[];
let mailsSent: number;

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

mock.module("../../server.js", () => ({ postgres: { em }, redis: { get: async () => null } }));
mock.module("../../config/MailConfig.js", () => ({
  transporter: { sendMail: async () => void mailsSent++ },
}));
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { forgotPassword } = await import("./forgotPassword.js");
const { resetPassword } = await import("./resetPassword.js");

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

beforeEach(() => {
  savedSecret = process.env.SECRET_KEY;
  process.env.SECRET_KEY = "test-secret";
  user = { userid: 7, email: EMAIL, password: "old-hash", resetToken: "" };
  botIds = [];
  mailsSent = 0;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.SECRET_KEY;
  else process.env.SECRET_KEY = savedSecret;
});

describe("forgot password and bot accounts", () => {
  test("a bot's email gets the unknown-email answer and no mail", async () => {
    const real = await call(forgotPassword, { email: EMAIL });
    expect(real.status).toBe(200);
    expect(mailsSent).toBe(1);

    user = null;
    const unknown = await call(forgotPassword, { email: EMAIL });

    user = { userid: 7, email: EMAIL, password: "old-hash", resetToken: "" };
    botIds = [7];
    const bot = await call(forgotPassword, { email: EMAIL });

    expect(bot).toEqual(unknown);
    expect(user.resetToken).toBe("");
    expect(mailsSent).toBe(1);
  });
});

describe("reset password and bot accounts", () => {
  const resetWith = async () => {
    const token = JWT.sign({ user: { email: EMAIL } }, process.env.SECRET_KEY!, { expiresIn: "20m" });
    user!.resetToken = token;
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
