import { describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The web presence ping (#242) refreshes the player's own "online" key with
 * the same 120-second life as a yard load, and nothing else.
 */

const writes: [string, number, string][] = [];

mock.module("../../server.js", () => ({
  postgres: { em: {} },
  redis: {
    setex: async (key: string, ttl: number, value: string) => {
      writes.push([key, ttl, value]);
      return "OK";
    },
  },
}));

const { presence, PRESENCE_TTL_SECONDS } = await import("./presence.js");

describe("presence", () => {
  test("refreshes last-seen:main for the caller, as a yard load does", async () => {
    const before = Math.floor(Date.now() / 1000);
    const ctx = { request: { body: {} }, authUser: { userid: 2505 } } as unknown as Context;
    await presence(ctx, async () => {});

    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ error: 0 });
    expect(writes).toHaveLength(1);
    const [key, ttl, value] = writes[0]!;
    expect(key).toBe("last-seen:main:2505");
    expect(ttl).toBe(120);
    expect(PRESENCE_TTL_SECONDS).toBe(120);
    expect(Number(value)).toBeGreaterThanOrEqual(before);
    expect(Number(value)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});
