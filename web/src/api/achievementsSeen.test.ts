import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unlockInbox } from "@/game/achievements/unlockInbox";
import { markAchievementsSeen } from "./achievementsSeen";
import { takeOverCell } from "./maproom";

/** `seen` on the wire, and a takeover's answer feeding the unlock pop-up (#204, WP6). */

const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (body: Record<string, unknown>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body ?? "")) });
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }),
  );
};

beforeEach(() => unlockInbox.reset());

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
  unlockInbox.reset();
});

describe("achievements/seen", () => {
  it("posts ids as a JSON array, with the outpost's baseid when given", async () => {
    stubFetch({ error: 0, savetime: 1, currenttime: 1, completed: [], report: { seen: [2, 5] } });
    await markAchievementsSeen([2, 5]);
    await markAchievementsSeen([7], "2001");
    expect(sent[0]!.url).toMatch(/\/bm\/yard\/achievements\/seen$/);
    expect(sent[0]!.body.get("ids")).toBe("[2,5]");
    expect(sent[0]!.body.has("baseid")).toBe(false);
    expect(sent[1]!.body.get("ids")).toBe("[7]");
    expect(sent[1]!.body.get("baseid")).toBe("2001");
  });
});

describe("takeOverCell", () => {
  it("queues the answer's unlocks for the next yard", async () => {
    stubFetch({ error: 0, achievements: [{ id: 3, name: "Squatter", shiny: 10 }] });
    await takeOverCell("1234", "resources");
    expect(unlockInbox.size).toBe(1);
    expect(unlockInbox.next()).toMatchObject({ unlocks: [{ id: 3, name: "Squatter", shiny: 10 }] });
  });

  it("queues nothing when the answer has no achievements (rewards off)", async () => {
    stubFetch({ error: 0 });
    await takeOverCell("1234", "shiny");
    expect(unlockInbox.size).toBe(0);
    expect(sent[0]!.body.get("shiny")).toBe("1");
  });
});
