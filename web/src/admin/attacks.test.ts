// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { AttackLogView, AttackRow, PlayerMatch } from "./api";
import {
  AttackLogSection,
  hasContent,
  lootWords,
  readAttackParams,
  resultWords,
  shortNumber,
  yardWord,
} from "./attacks";

/**
 * The Attack log section: finding a player (one clear match opens, several
 * give a pick list), the summary and the most-attacked lists, the rows
 * (direction, bots marked, map spot, the stored record when a row opens),
 * the period and side switches and names going to the address, and Load
 * older. Read-only: it only ever sends GETs.
 */

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
}

let calls: Call[] = [];
let answers: Record<string, [number, unknown] | ((query: URLSearchParams) => [number, unknown])> = {};

const NOW = Date.now();

const match = (userid: number, username: string, extra: Partial<PlayerMatch> = {}): PlayerMatch => ({
  userid,
  username,
  formerName: null,
  bot: false,
  lastSeenAt: null,
  look: null,
  ...extra,
});

const row = (id: number, over: Partial<AttackRow> = {}): AttackRow => ({
  id,
  time: new Date(NOW - id * 3600_000).toISOString(),
  direction: "received",
  other: { userid: 30, username: "Bully", bot: false, gone: false },
  otherLoggedName: null,
  type: "main",
  x: null,
  y: null,
  loot: {},
  report: {},
  ...over,
});

const log = (over: Partial<AttackLogView> = {}): AttackLogView => ({
  player: { userid: 2503, username: "yardtester", bot: false, gone: false },
  side: "both",
  range: "7d",
  since: new Date(NOW - 7 * 86400_000).toISOString(),
  retentionDays: 365,
  summary: {
    made: 2,
    received: 7,
    targets: 2,
    attackers: 2,
    topTargets: [{ userid: 40, username: "Friend", bot: false, gone: false, count: 1 }],
    topAttackers: [
      { userid: 30, username: "Bully", bot: false, gone: false, count: 6 },
      { userid: 77, username: "Mr Robot", bot: true, gone: false, count: 1 },
    ],
  },
  attacks: [
    row(1),
    row(2, { direction: "made", other: { userid: 40, username: "Friend", bot: false, gone: false }, type: "outpost", x: 120, y: 45 }),
    row(3, { other: { userid: 77, username: "Mr Robot", bot: true, gone: false } }),
    row(4, { loot: { r1: 12500, r4: 900 }, report: { damage: 64.2, destroyed: true } }),
  ],
  next: null,
  ...over,
});

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 9 }));
  calls = [];
  answers = {
    "GET /admin/players": [200, { error: 0, players: [match(2503, "yardtester")] }],
    "GET /admin/players/2503/attacks": [200, { error: 0, log: log() }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url, "http://localhost");
      const method = init.method ?? "GET";
      calls.push({ method, path: parsed.pathname, query: parsed.searchParams });
      // The longest key that fits, so `/players/2503/attacks` beats `/players`.
      const key = Object.keys(answers)
        .filter((k) => {
          const [m, end] = k.split(" ");
          return m === method && parsed.pathname.endsWith(end!);
        })
        .sort((a, b) => b.length - a.length)[0];
      if (key === undefined) return new Response("Not Found", { status: 404 });
      const answer = answers[key]!;
      const [status, body] = typeof answer === "function" ? answer(parsed.searchParams) : answer;
      return Response.json(body, { status });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const mount = () => {
  const said: string[] = [];
  const went: { player: number; side: string; range: string }[] = [];
  const opened: number[] = [];
  const view = new AttackLogSection({
    say: (message) => said.push(message),
    navigate: (params) => {
      went.push(params);
      void view.show({ player: String(params.player), side: params.side, range: params.range });
    },
    openPlayer: (userid) => opened.push(userid),
  });
  document.body.append(view.element);
  return { view, said, went, opened };
};

const type = async (view: AttackLogSection, text: string) => {
  const input = view.element.querySelector<HTMLInputElement>("#attack-search")!;
  input.value = text;
  await view.find();
  await settle();
};

describe("the Attack log section", () => {
  it("opens the one clear match straight away and shows the summary", async () => {
    const { view, went } = mount();
    await type(view, "yardtester");
    expect(went).toEqual([{ player: 2503, side: "both", range: "7d" }]);
    const text = view.element.textContent!;
    expect(text).toContain("yardtester");
    expect(view.element.querySelectorAll(".figure-value")[0]!.textContent).toBe("2");
    expect(view.element.querySelectorAll(".figure-value")[1]!.textContent).toBe("7");
    expect(text).toContain("Attack them most");
    const tops = [...view.element.querySelectorAll(".attack-top")].map((el) => el.textContent);
    expect(tops[1]).toContain("Bully");
    expect(tops[1]).toContain("×6");
    expect(tops[1]).toContain("Bot");
  });

  it("gives a pick list when several players match", async () => {
    answers["GET /admin/players"] = [200, { error: 0, players: [match(2503, "yardtester"), match(2504, "yardtester2", { bot: true })] }];
    const { view, went } = mount();
    await type(view, "yard");
    expect(went).toEqual([]);
    const picks = view.element.querySelectorAll<HTMLButtonElement>(".results .player-row");
    expect(picks).toHaveLength(2);
    expect(picks[1]!.textContent).toContain("bot");
    picks[0]!.click();
    await settle();
    expect(went).toEqual([{ player: 2503, side: "both", range: "7d" }]);
  });

  it("says so when nobody matches", async () => {
    answers["GET /admin/players"] = [200, { error: 0, players: [] }];
    const { view } = mount();
    await type(view, "nobody");
    expect(view.element.querySelector(".results")!.textContent).toContain("No player called");
  });

  it("lists each attack with its direction, the other player, the yard and spot; bots marked", async () => {
    const { view } = mount();
    await view.show({ player: "2503" });
    await settle();
    const rows = [...view.element.querySelectorAll<HTMLDetailsElement>(".attack-row")];
    expect(rows).toHaveLength(4);
    expect(rows[0]!.dataset["direction"]).toBe("received");
    expect(rows[0]!.textContent).toContain("Bully");
    expect(rows[0]!.textContent).toContain("1 h ago");
    expect(rows[1]!.dataset["direction"]).toBe("made");
    expect(rows[1]!.textContent).toContain("Outpost");
    expect(rows[1]!.textContent).toContain("120, 45");
    expect(rows[2]!.querySelector(".chip-warn:not(.attack-dir)")!.textContent).toBe("Bot");
    expect(rows[3]!.textContent).toContain("Twigs 12.5k · Goo 900");
    expect(rows[3]!.textContent).toContain("Damage 64% · Destroyed");
    // Opening a row shows the stored record when there is one, and says so when there is not.
    expect(rows[3]!.querySelector("pre.code")!.textContent).toContain('"damage": 64.2');
    expect(rows[0]!.querySelector("pre.code")).toBeNull();
    expect(rows[0]!.querySelector(".row-more")!.textContent).toContain("no loot or battle report");
  });

  it("a name opens that player's log; the period and side go to the address", async () => {
    const { view, went } = mount();
    await view.show({ player: "2503" });
    await settle();
    answers["GET /admin/players/30/attacks"] = [200, { error: 0, log: log({ player: { userid: 30, username: "Bully", bot: false, gone: false } }) }];
    view.element.querySelector<HTMLButtonElement>('.attack-row .link-button[data-player="30"]')!.click();
    await settle();
    expect(went.at(-1)).toEqual({ player: 30, side: "both", range: "7d" });
    expect(view.element.querySelector(".attack-head")!.textContent).toContain("Bully");

    view.element.querySelector<HTMLButtonElement>('.seg[data-value="30d"]')!.click();
    await settle();
    expect(went.at(-1)).toEqual({ player: 30, side: "both", range: "30d" });
    expect(calls.at(-1)!.query.get("range")).toBe("30d");

    view.element.querySelector<HTMLButtonElement>('.seg[data-value="made"]')!.click();
    await settle();
    expect(went.at(-1)).toEqual({ player: 30, side: "made", range: "30d" });
    expect(calls.at(-1)!.query.get("side")).toBe("made");
  });

  it("loads older attacks with the cursor and appends them", async () => {
    answers["GET /admin/players/2503/attacks"] = (query) =>
      query.get("beforeId")
        ? [200, { error: 0, log: log({ attacks: [row(50), row(51)], next: null }) }]
        : [200, { error: 0, log: log({ next: { time: "2026-11-08T08:00:00.123456Z", id: 4 } }) }];
    const { view } = mount();
    await view.show({ player: "2503" });
    await settle();
    const more = view.element.querySelector<HTMLButtonElement>(".modmail-more")!;
    expect(more.hidden).toBe(false);
    more.click();
    await settle();
    expect(calls.at(-1)!.query.get("beforeTime")).toBe("2026-11-08T08:00:00.123456Z");
    expect(calls.at(-1)!.query.get("beforeId")).toBe("4");
    expect(view.element.querySelectorAll(".attack-row")).toHaveLength(6);
    expect(more.hidden).toBe(true);
  });

  it("Find a player opens them in moderation; only GETs are ever sent", async () => {
    const { view, opened } = mount();
    await view.show({ player: "2503" });
    await settle();
    [...view.element.querySelectorAll<HTMLButtonElement>(".attack-head .button")].find((b) => b.textContent === "Find a player")!.click();
    expect(opened).toEqual([2503]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("shows the server's refusal", async () => {
    answers["GET /admin/players/2503/attacks"] = [400, { error: "There is no player with that account number.", reason: "noPlayer" }];
    const { view } = mount();
    await view.show({ player: "2503" });
    await settle();
    expect(view.element.querySelector(".form-error")!.textContent).toContain("Could not load the attack log of #2503");
  });
});

describe("the Attack log's words", () => {
  it("reads the address with defaults", () => {
    expect(readAttackParams({})).toEqual({ player: null, side: "both", range: "7d" });
    expect(readAttackParams({ player: "12", side: "received", range: "all" })).toEqual({ player: 12, side: "received", range: "all" });
    expect(readAttackParams({ player: "x", side: "nope", range: "1y" })).toEqual({ player: null, side: "both", range: "7d" });
  });

  it("short numbers", () => {
    expect(shortNumber(950)).toBe("950");
    expect(shortNumber(12_500)).toBe("12.5k");
    expect(shortNumber(250_000)).toBe("250k");
    expect(shortNumber(3_200_000)).toBe("3.2M");
  });

  it("names yards, loot and results, and nothing for an empty record", () => {
    expect(yardWord("main")).toBe("Main yard");
    expect(yardWord("weird")).toBe("weird");
    expect(lootWords({})).toBeNull();
    expect(lootWords({ resources: { r2: 4000 } })).toBe("Pebbles 4k");
    expect(resultWords({})).toBeNull();
    expect(resultWords({ monsters: { C1: 10, C2: 2 } })).toBe("12 monsters");
    expect(hasContent({})).toBe(false);
    expect(hasContent({ a: 1 })).toBe(true);
  });
});
