import { afterEach, describe, expect, it, vi } from "vitest";
import { chatApi, chatConfigFrom, chatSocketUrl } from "./chat";

afterEach(() => {
  vi.unstubAllGlobals();
});

const answer = (body: unknown, status = 200) =>
  vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );

describe("chatSocketUrl", () => {
  it("adds ws: to the server's host:port, wss: on an https page", () => {
    expect(chatSocketUrl("localhost:3010", false)).toBe("ws://localhost:3010");
    expect(chatSocketUrl("chat.example.com", true)).toBe("wss://chat.example.com");
  });

  it("keeps a scheme the server already gave", () => {
    expect(chatSocketUrl("wss://chat.example.com/ws", false)).toBe("wss://chat.example.com/ws");
  });
});

describe("chatConfigFrom", () => {
  const load = {
    chatservers: ["localhost:3010"],
    chattoken: "tok",
    chatchannel: "chat:mr2-global",
  };

  it("reads the owner's load", () => {
    expect(chatConfigFrom(load, 2505, false)).toEqual({
      url: "ws://localhost:3010",
      userId: 2505,
      token: "tok",
      channel: "chat:mr2-global",
    });
  });

  it("is null for a load without a token or room, or with no player", () => {
    expect(chatConfigFrom({ chatservers: ["localhost:3010"] }, 2505, false)).toBeNull();
    expect(chatConfigFrom({ ...load, chatchannel: "" }, 2505, false)).toBeNull();
    expect(chatConfigFrom({ ...load, chatservers: [] }, 2505, false)).toBeNull();
    expect(chatConfigFrom(load, 0, false)).toBeNull();
  });
});

describe("chatApi", () => {
  it("reports a line by who said it, where and when", async () => {
    const fetch = answer({ error: 0, stored: true, verified: true });
    vi.stubGlobal("fetch", fetch);
    await chatApi.report({
      userId: 77,
      channel: "chat:mr2-global",
      body: "rude words",
      ts: 1_700_000_000_123,
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toMatch(/\/api\/[^/]+\/bm\/chat\/report$/);
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      userid: "77",
      channel: "chat:mr2-global",
      message: "rude words",
      ts: "1700000000123",
    });
  });

  it("passes on the server's refusal of too many reports", async () => {
    vi.stubGlobal(
      "fetch",
      answer({ error: "You have sent a lot of reports.", reason: "rateLimited" }, 429),
    );
    await expect(
      chatApi.report({ userId: 77, channel: "c", body: "b", ts: 1 }),
    ).rejects.toMatchObject({
      status: 429,
    });
  });

  it("finds a player's main yard", async () => {
    const fetch = answer({ error: 0, baseid: "1234", name: "Rex" });
    vi.stubGlobal("fetch", fetch);
    expect(await chatApi.yardOf(77)).toEqual({ baseid: "1234", name: "Rex" });
    expect(fetch.mock.calls[0]![0]).toMatch(/\/bm\/chat\/yard\?userid=77$/);
  });
});
