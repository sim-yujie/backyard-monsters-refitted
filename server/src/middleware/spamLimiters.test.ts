import { describe, expect, test } from "bun:test";
import { SPAM_LIMITS } from "../config/SpamLimitConfig.js";
import {
  allianceCreateEditLimiter,
  mailTruceRequestLimiter,
  playerMailLimiter,
  threadReportLimiter,
  truceRequestLimiter,
} from "./rateLimiters.js";

/**
 * Spam limits on mail, truces, thread reports and alliances (issue #323):
 * per player, counted apart from each other, with a refusal the clients show.
 */

type Limiter = typeof playerMailLimiter;

const request = async (
  limiter: Limiter,
  userid: number,
  body: Record<string, unknown> = {}
): Promise<{ status?: number; body: unknown; passed: boolean }> => {
  const ctx = {
    authUser: { userid },
    ip: "127.0.0.1",
    request: { ip: "127.0.0.1", body },
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

/** A `sendmessage` request, as the route runs both its limiters. */
const sendMessage = async (userid: number, type: string) => {
  const body = { type };
  const mail = await request(playerMailLimiter, userid, body);
  if (!mail.passed) return mail;
  return await request(mailTruceRequestLimiter, userid, body);
};

describe("playerMailLimiter", () => {
  const { max } = SPAM_LIMITS.playerMail;

  test("lets the hourly limit through, then answers 429 with words for both clients", async () => {
    for (let at = 0; at < max; at++) expect((await sendMessage(9301, "message")).passed).toBe(true);
    const over = await sendMessage(9301, "message");
    expect(over.passed).toBe(false);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ error: expect.any(String), message: expect.any(String), reason: "rateLimited" });
  });

  test("counts each player apart", async () => {
    for (let at = 0; at < max; at++) await sendMessage(9302, "message");
    expect((await sendMessage(9302, "message")).passed).toBe(false);
    expect((await sendMessage(9303, "message")).passed).toBe(true);
  });

  test("does not count truce requests, which have their own limit", async () => {
    for (let at = 0; at < SPAM_LIMITS.truceRequest.max; at++) await sendMessage(9304, "trucerequest");
    expect((await sendMessage(9304, "message")).passed).toBe(true);
  });
});

describe("truce request limiters", () => {
  const { max } = SPAM_LIMITS.truceRequest;

  test("count a truce from a yard and one in a thread together", async () => {
    for (let at = 0; at < max / 2; at++) expect((await request(truceRequestLimiter, 9311, { baseid: "1" })).passed).toBe(true);
    for (let at = max / 2; at < max; at++) expect((await sendMessage(9311, "trucerequest")).passed).toBe(true);
    const fromYard = await request(truceRequestLimiter, 9311, { baseid: "1" });
    expect(fromYard.passed).toBe(false);
    expect(fromYard.status).toBe(429);
    expect(fromYard.body).toMatchObject({ message: expect.any(String), reason: "rateLimited" });
    expect((await sendMessage(9311, "trucerequest")).passed).toBe(false);
  });

  test("leave plain mail and truce answers alone", async () => {
    for (let at = 0; at < max; at++) await request(truceRequestLimiter, 9312, { baseid: "1" });
    expect((await sendMessage(9312, "message")).passed).toBe(true);
    expect((await sendMessage(9312, "truceaccept")).passed).toBe(true);
  });
});

describe("threadReportLimiter", () => {
  test("lets the hourly limit through, then answers 429", async () => {
    const { max } = SPAM_LIMITS.threadReport;
    for (let at = 0; at < max; at++) expect((await request(threadReportLimiter, 9321)).passed).toBe(true);
    const over = await request(threadReportLimiter, 9321);
    expect(over.passed).toBe(false);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ message: expect.any(String), reason: "rateLimited" });
  });
});

describe("allianceCreateEditLimiter", () => {
  test("lets the hourly limit through, then answers 429 with an error Flash shows", async () => {
    const { max } = SPAM_LIMITS.allianceCreateEdit;
    for (let at = 0; at < max; at++) expect((await request(allianceCreateEditLimiter, 9331)).passed).toBe(true);
    const over = await request(allianceCreateEditLimiter, 9331);
    expect(over.passed).toBe(false);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ error: expect.any(String), reason: "rateLimited" });
    expect((await request(allianceCreateEditLimiter, 9332)).passed).toBe(true);
  });
});

describe("SPAM_LIMITS", () => {
  test("stay generous: at least ten an hour each", () => {
    for (const limit of Object.values(SPAM_LIMITS)) {
      expect(limit.max).toBeGreaterThanOrEqual(10);
      expect(limit.minutes).toBeLessThanOrEqual(60);
    }
  });
});
