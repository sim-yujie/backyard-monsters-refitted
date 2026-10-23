import { describe, expect, test } from "bun:test";

import { alertConfig, dashboardLink } from "../../config/AlertConfig.js";
import { recentTelegramChats, sendTelegram, TELEGRAM_MAX_LENGTH, type FetchLike } from "./telegram.js";

/** The Telegram sender and the settings; the network is always a fake. */

const TOKEN = "123456:SECRET-token";
const on = alertConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: " 42 ", WEB_URL: "https://play.example.test/" });

const fakeFetch = (status: number, body: unknown) => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { calls, fetch };
};

describe("alert settings", () => {
  test("off unless both the token and the chat are set", () => {
    expect(alertConfig({}).telegram).toBeNull();
    expect(alertConfig({ TELEGRAM_BOT_TOKEN: TOKEN }).telegram).toBeNull();
    expect(alertConfig({ TELEGRAM_CHAT_ID: "42" }).telegram).toBeNull();
    expect(on.telegram).toEqual({ token: TOKEN, chatId: "42" });
  });

  test("links go to the dashboard page on the game page, or to ADMIN_DASHBOARD_URL", () => {
    expect(dashboardLink("health", on)).toBe("https://play.example.test/admin#health");
    expect(dashboardLink("bugs", alertConfig({ ADMIN_DASHBOARD_URL: "https://x.test/admin.html" }))).toBe(
      "https://x.test/admin.html#bugs"
    );
    expect(dashboardLink("health", alertConfig({}))).toBeNull();
  });

  test("limits: defaults, and nonsense falls back to them", () => {
    expect(alertConfig({})).toMatchObject({ diskPercent: 90, backupHours: 26, errorsMin: 20, errorsFactor: 5 });
    expect(alertConfig({ ALERT_DISK_PERCENT: "80", ALERT_BACKUP_HOURS: "50" })).toMatchObject({ diskPercent: 80, backupHours: 50 });
    expect(alertConfig({ ALERT_DISK_PERCENT: "lots", ALERT_ERRORS_MIN: "-3" })).toMatchObject({ diskPercent: 90, errorsMin: 20 });
    expect(alertConfig({ ALERT_DISK_PERCENT: "150" }).diskPercent).toBe(100);
  });
});

describe("sending", () => {
  test("posts plain text to the chat, without link previews", async () => {
    const { calls, fetch } = fakeFetch(200, { ok: true });
    expect(await sendTelegram("hello <b>", { config: on, fetch })).toEqual({ sent: true });
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(calls[0].body)).toEqual({ chat_id: "42", text: "hello <b>", disable_web_page_preview: true });
  });

  test("off: nothing is sent", async () => {
    const { calls, fetch } = fakeFetch(200, {});
    const result = await sendTelegram("x", { config: alertConfig({}), fetch });
    expect(result.sent).toBe(false);
    expect(calls.length).toBe(0);
  });

  test("a long message is cut to Telegram's limit", async () => {
    const { calls, fetch } = fakeFetch(200, {});
    await sendTelegram("x".repeat(5000), { config: on, fetch });
    expect(JSON.parse(calls[0].body).text.length).toBe(TELEGRAM_MAX_LENGTH);
  });

  test("a refusal says why, and never shows the token", async () => {
    const { fetch } = fakeFetch(400, { ok: false, description: "Bad Request: chat not found" });
    const result = await sendTelegram("x", { config: on, fetch });
    expect(result).toEqual({ sent: false, reason: "Telegram answered 400: Bad Request: chat not found" });
  });

  test("a network error does not throw, and the token is blanked out of it", async () => {
    const fetch: FetchLike = async (url) => {
      throw new Error(`connect failed: ${url}`);
    };
    const result = await sendTelegram("x", { config: on, fetch });
    expect(result.sent).toBe(false);
    if (!result.sent) {
      expect(result.reason).not.toContain("SECRET");
      expect(result.reason).toContain("<token>");
    }
  });
});

describe("finding the chat id", () => {
  test("lists each chat that messaged the bot once", async () => {
    const { calls, fetch } = fakeFetch(200, {
      ok: true,
      result: [
        { message: { chat: { id: 42, type: "private", first_name: "Sim", last_name: "Y" } } },
        { message: { chat: { id: 42, type: "private", first_name: "Sim", last_name: "Y" } } },
        { my_chat_member: { chat: { id: -100, type: "group", title: "Ops" } } },
        { edited_message: {} },
      ],
    });
    expect(await recentTelegramChats(TOKEN, fetch)).toEqual([
      { id: "42", kind: "private", name: "Sim Y" },
      { id: "-100", kind: "group", name: "Ops" },
    ]);
    expect(calls[0].url).toEndWith("/getUpdates");
  });

  test("needs the token; a refusal does not show it", async () => {
    await expect(recentTelegramChats("")).rejects.toThrow("TELEGRAM_BOT_TOKEN is not set");
    const { fetch } = fakeFetch(401, { ok: false, description: "Unauthorized" });
    await expect(recentTelegramChats(TOKEN, fetch)).rejects.toThrow("Telegram answered 401: Unauthorized");
  });
});
