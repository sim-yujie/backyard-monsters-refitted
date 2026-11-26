import { beforeEach, describe, expect, mock, test } from "bun:test";

import { ChannelType } from "../enums/Chat.js";
import { memoryRedis } from "../testing/memoryRedis.js";

/**
 * The chat filter's flags (owner, 24 Nov 2026): every public room, whatever
 * `CHAT_FLAG_ROOMS` says; stored with the filter's tags; told on Telegram;
 * capped per player like every flag, while hit counts are never capped.
 */

const executed: { sql: string; params: unknown[] }[] = [];
const alerts: { userid: number; channel: string; text: string; why: string }[] = [];
const redis = memoryRedis();

process.env.CHAT_FLAG_ROOMS = "";

mock.module("../server.js", () => ({
  postgres: {
    orm: { em: { fork: () => ({ execute: async (sql: string, params: unknown[]) => (executed.push({ sql, params }), []) }) } },
  },
  redis,
}));

mock.module("../services/alerts/moderationAlerts.js", () => ({
  alertChatFlag: async (flag: (typeof alerts)[number]) => {
    alerts.push(flag);
    return true;
  },
}));

const { watchLine, flushChatLog } = await import("./chatWatch.js");
const { compileWatchList, DEFAULT_WATCH_WORDS, filterLine } = await import("../services/chat/chatFilter.js");
const { makeWordFilter } = await import("../services/chat/badWords.js");
const { checkLine } = await import("../services/chat/chatFlags.js");
const { hitsKey, readHits } = await import("../services/chat/watchWords.js");

const list = compileWatchList(DEFAULT_WATCH_WORDS);
const words = makeWordFilter();
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const flags = () => executed.filter((e) => e.sql.includes("INSERT INTO bym.chat_flag"));

let nextUser = 8100;

const watch = (message: string, speaker: { isNew: boolean; staff: boolean }, userid = nextUser++, channel = "chat:country:US", ts = Date.now()) => {
  const filter = filterLine(message, speaker, list);
  watchLine({
    userid,
    username: `player${userid}`,
    channel,
    channelType: channel.startsWith("chat:country:")
      ? ChannelType.Country
      : channel.startsWith("chat:alliance:")
        ? ChannelType.Alliance
        : ChannelType.Global,
    message,
    check: checkLine(words, message),
    ts,
    filter,
    shown: filter.hidden ? "" : filter.shown,
    lineId: "abc123",
    yardAgeHours: speaker.isNew ? 30 : null,
  });
  return userid;
};

beforeEach(async () => {
  await flushChatLog();
  await settle();
  executed.length = 0;
  alerts.length = 0;
  redis.clear();
});

describe("chat filter flags", () => {
  test("a filter flag from an unmonitored country room is stored with its tags, and told on Telegram", async () => {
    const userid = watch("Hi sino papasok sa private server bmy", { isNew: true, staff: false });
    await settle();
    const [flag] = flags();
    expect(flag?.params).toEqual([
      userid,
      "chat:country:US",
      "Hi sino papasok sa private server bmy",
      "",
      "private server",
      "filter",
      "word",
      expect.any(Number),
      expect.any(Date),
      "watched,hidden",
      true,
      "abc123",
      30,
    ]);
    expect(alerts).toEqual([
      { userid, username: `player${userid}`, channel: "chat:country:US", text: "Hi sino papasok sa private server bmy", why: "watched word: private server; hidden from others (new player)" } as never,
    ]);
  });

  test("an older player's invite link flags with what others saw", async () => {
    watch("join facebook.com/groups/1", { isNew: false, staff: false }, undefined, "chat:mr2-global");
    await settle();
    expect(flags()[0]?.params.slice(2, 6)).toEqual(["join facebook.com/groups/1", "join [link removed]", "", "filter"]);
    expect(flags()[0]?.params[9]).toBe("invite");
  });

  test("no flag for staff or a clean line, and alliance chat is never watched", async () => {
    watch("private server t.me/x", { isNew: true, staff: true });
    watch("gg sa raid kanina", { isNew: true, staff: false });
    watch("private server", { isNew: true, staff: false }, undefined, "chat:alliance:9");
    await settle();
    expect(flags()).toEqual([]);
    expect(alerts).toEqual([]);
  });

  test("flags are capped at 5 per player in 10 minutes; hit counts are not", async () => {
    const userid = nextUser++;
    const now = Date.now();
    for (let i = 0; i < 8; i += 1) watch(`private server ${i}`, { isNew: true, staff: false }, userid, "chat:country:PH", now + i * 1000);
    await settle();
    expect(flags()).toHaveLength(5);
    expect(alerts).toHaveLength(5);
    expect(await redis.send("HGET", [hitsKey(now), "private server"])).toBe("8");
    expect(await readHits(redis as never, now)).toMatchObject({ "private server": 8 });
  });
});
