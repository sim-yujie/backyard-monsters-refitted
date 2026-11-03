import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The player's country on `/player/settings` (country chat rooms, owner 3 Nov
 * 2026): stored on the account, echoed with the room it opens, and a change
 * tells the chat server to let go of the old room. "Not now" on the one-time
 * prompt only marks it asked.
 */

let flushes = 0;
const published: { channel: string; payload: string }[] = [];

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      flush: async () => {
        flushes += 1;
      },
    },
  },
  redis: {
    publish: async (channel: string, payload: string) => {
      published.push({ channel, payload });
      return 1;
    },
  },
}));

const { updateSettings, settingsOf } = await import("./updateSettings.js");

type Row = Record<string, unknown>;

const account = (country: string | null = null, asked = false): Row => ({
  userid: 2503,
  shiny_locked: false,
  hide_online: false,
  friend_requests_off: false,
  country,
  country_asked: asked,
});

const call = async (body: unknown, user: Row) => {
  const ctx = { request: { body }, authUser: user } as unknown as Context & { body: Row };
  await updateSettings(ctx, async () => {});
  return ctx.body;
};

beforeEach(() => {
  delete process.env.CHAT_COUNTRY_ROOMS;
  flushes = 0;
  published.length = 0;
});

describe("settingsOf: the country", () => {
  test("a fresh account has no country, has not been asked, and no country room", () => {
    expect(settingsOf(account() as never)).toMatchObject({ country: null, countryAsked: false, countryChannel: null });
  });

  test("the Philippines opens the Philippines room", () => {
    expect(settingsOf(account("PH") as never)).toMatchObject({
      country: "PH",
      countryAsked: true,
      countryChannel: "chat:country:PH",
    });
  });

  test("a country without a room in the config opens none", () => {
    expect(settingsOf(account("SG") as never)).toMatchObject({ country: "SG", countryChannel: null });
  });
});

describe("updateSettings: the country", () => {
  test("picking a country stores it, marks the prompt answered and evicts from any old room", async () => {
    const user = account();
    const body = await call({ country: "PH" }, user);

    expect(user.country).toBe("PH");
    expect(user.country_asked).toBe(true);
    expect(flushes).toBe(1);
    expect(body).toMatchObject({ error: 0, settings: { country: "PH", countryChannel: "chat:country:PH" } });
    expect(published).toHaveLength(1);
    expect(published[0]!.channel).toBe("chat:control");
    expect(JSON.parse(published[0]!.payload)).toEqual({
      type: "country_evict",
      userId: 2503,
      keep: "chat:country:PH",
    });
  });

  test("moving away from the Philippines closes its room (keep is null)", async () => {
    const user = account("PH", true);
    const body = await call({ country: "SG" }, user);

    expect(user.country).toBe("SG");
    expect(body).toMatchObject({ settings: { country: "SG", countryChannel: null } });
    expect(JSON.parse(published[0]!.payload)).toMatchObject({ type: "country_evict", keep: null });
  });

  test("Not set clears the country", async () => {
    const user = account("PH", true);
    const body = await call({ country: null }, user);

    expect(user.country).toBeNull();
    expect(body).toMatchObject({ settings: { country: null, countryAsked: true, countryChannel: null } });
    expect(published).toHaveLength(1);
  });

  test("the same country again changes nothing in chat", async () => {
    const user = account("PH", true);
    await call({ country: "PH" }, user);
    expect(published).toHaveLength(0);
  });

  test("Not now marks the prompt asked and leaves the country alone", async () => {
    const user = account();
    const body = await call({ countryAsked: true }, user);

    expect(user.country).toBeNull();
    expect(user.country_asked).toBe(true);
    expect(body).toMatchObject({ settings: { country: null, countryAsked: true } });
    expect(published).toHaveLength(0);
  });

  test("other settings leave the country alone", async () => {
    const user = account("PH", true);
    await call({ hideOnline: true }, user);
    expect(user.country).toBe("PH");
    expect(published).toHaveLength(0);
  });

  test("a code that is not a country is refused", async () => {
    const user = account();
    await expect(call({ country: "XX" }, user)).rejects.toThrow();
    await expect(call({ country: "ph" }, user)).rejects.toThrow();
    await expect(call({ country: "chat:country:PH" }, user)).rejects.toThrow();
    expect(user.country).toBeNull();
    expect(flushes).toBe(0);
  });
});
