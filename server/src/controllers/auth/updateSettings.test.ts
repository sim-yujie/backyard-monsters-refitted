import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * `/player/settings` with Map Room 2's tilted-map choice (MR2 look plan
 * step 4): stored on the account as `user.map_flat`, echoed as `tiltedMap`,
 * next to whether the server's `MR2_TILT` switch lets the map tilt at all.
 */

let flushes = 0;

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      flush: async () => {
        flushes += 1;
      },
    },
  },
}));

const { updateSettings, settingsOf } = await import("./updateSettings.js");

type Row = Record<string, unknown>;

const account = (): Row => ({
  userid: 7,
  shiny_locked: false,
  hide_online: false,
  friend_requests_off: false,
  map_flat: false,
});

const call = async (body: unknown, who: Row) => {
  const ctx = { request: { body }, authUser: who } as unknown as Context & { body: Row };
  await updateSettings(ctx, async () => {});
  return { status: ctx.status, body: ctx.body };
};

const saved = process.env.MR2_TILT;

const restore = (): void => {
  if (saved === undefined) delete process.env.MR2_TILT;
  else process.env.MR2_TILT = saved;
};

beforeEach(() => {
  flushes = 0;
  restore();
});

afterAll(restore);

describe("the tilted map setting", () => {
  test("is on for every account until the player turns it off", () => {
    expect(settingsOf(account() as never).tiltedMap).toBe(true);
  });

  test("stores a flat map on the account and echoes it back", async () => {
    const who = account();
    const answer = await call({ tiltedMap: false }, who);
    expect(who.map_flat).toBe(true);
    expect(answer.status).toBe(200);
    expect((answer.body.settings as Row).tiltedMap).toBe(false);
    expect(flushes).toBe(1);

    await call({ tiltedMap: true }, who);
    expect(who.map_flat).toBe(false);
  });

  test("leaves the choice alone when a save names other settings", async () => {
    const who: Row = { ...account(), map_flat: true };
    await call({ shinyLocked: true }, who);
    expect(who.map_flat).toBe(true);
    expect(who.shiny_locked).toBe(true);
  });

  test("refuses a choice that is not a real boolean", async () => {
    await expect(call({ tiltedMap: "no" }, account())).rejects.toThrow();
  });

  test("says whether the server lets the map tilt at all (MR2_TILT, off by default)", () => {
    delete process.env.MR2_TILT;
    expect(settingsOf(account() as never).mapTiltAllowed).toBe(false);
    process.env.MR2_TILT = "on";
    expect(settingsOf(account() as never).mapTiltAllowed).toBe(true);
    process.env.MR2_TILT = "off";
    expect(settingsOf(account() as never).mapTiltAllowed).toBe(false);
  });

  test("says the world's hex shape (MR2_HEX_SHAPE, flat by default)", () => {
    delete process.env.MR2_HEX_SHAPE;
    expect(settingsOf(account() as never).mapHexShape).toBe("flat");
    process.env.MR2_HEX_SHAPE = " Pointy ";
    expect(settingsOf(account() as never).mapHexShape).toBe("pointy");
    process.env.MR2_HEX_SHAPE = "round";
    expect(settingsOf(account() as never).mapHexShape).toBe("flat");
    delete process.env.MR2_HEX_SHAPE;
  });
});
