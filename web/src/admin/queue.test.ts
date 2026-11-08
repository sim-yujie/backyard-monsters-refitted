// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { ChatCaseView, ClosedDecision, FlaggedPlayer, InboxPlayer, PlayerModeration } from "./api";
import { QueueView, doneWords, readQueueParams, type QueueFilter } from "./queue";

/**
 * The Moderation list: one row per player across player reports and the word
 * filter, a player record where a line both reported and caught shows ONCE
 * with both sources, and one action bar whose every action is confirmed.
 */

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
let answer: (call: Call) => unknown;

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 9 }));
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url, "http://localhost");
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call = { method: init.method ?? "GET", path: parsed.pathname, query: parsed.searchParams, body };
      calls.push(call);
      const found = answer(call);
      if (found === undefined) return new Response("Not Found", { status: 404 });
      if (found instanceof Response) return found;
      return Response.json(found);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const BOTH_TS = 1_762_590_000_000;

/** Maze: 2 reported lines (one also caught by the filter) and 1 line only the filter caught. */
const maze = (over: Partial<InboxPlayer> = {}): InboxPlayer => ({
  userid: 42,
  username: "Maze",
  banned: false,
  muted: false,
  gameTeam: false,
  caseId: 7,
  reportedMessages: 2,
  reports: 4,
  uniqueReporters: 3,
  filterLines: 2,
  alsoReported: 1,
  filterOnlyLines: 1,
  messages: 3,
  slurs: 0,
  flagsUpTo: 905,
  previousActions: 0,
  lastAction: null,
  oldestAt: "2026-11-08T06:00:00Z",
  latestAt: "2026-11-08T08:00:00Z",
  preview: { text: "you are all trash", source: "report" },
  suggest: { action: "warn", hours: null },
  ...over,
});

const chatCase: ChatCaseView = {
  id: 7,
  status: "open",
  reported: { userid: 42, username: "Maze", banned: false, muted: false, gameTeam: false },
  messages: [
    { id: 1, channel: "chat:mr2-global", message: "you are all trash", ts: BOTH_TS - 60_000, verified: true, reporters: [1], snapshot: { source: "log", lines: [{ userid: 42, name: "Maze", text: "you are all trash", at: BOTH_TS - 60_000, reported: true }] } },
    { id: 2, channel: "chat:mr2-global", message: "damn noobs", ts: BOTH_TS, verified: false, reporters: [1, 2, 3], snapshot: { source: "none", lines: [] } },
  ],
  reporters: [
    { userid: 1, username: "Kozu", at: "2026-11-08T07:00:00Z", first: true, late: false, award: null },
    { userid: 2, username: "Twig", at: "2026-11-08T07:01:00Z", first: false, late: false, award: null },
    { userid: 3, username: "Pebble", at: "2026-11-08T07:02:00Z", first: false, late: false, award: null },
  ],
  reports: 4,
  firstReportAt: "2026-11-08T07:00:00Z",
  lastReportAt: "2026-11-08T07:02:00Z",
  history: { cases: 1, flags: 2, warnings: 0, mutes: 0, bans: 0 },
  suggest: { action: "warn", hours: null },
  closed: null,
};

const flagLine = (id: number, ts: number, message: string) => ({
  id,
  channel: "chat:mr2-global",
  message,
  shown: "**** noobs",
  words: ["damn"],
  severity: "swear" as const,
  rule: "word" as const,
  at: new Date(ts).toISOString(),
  ts,
});

const flags: FlaggedPlayer = {
  userid: 42,
  username: "Maze",
  banned: false,
  muted: false,
  count: 2,
  slurs: 0,
  lastId: 905,
  latestAt: new Date(BOTH_TS + 60_000).toISOString(),
  lines: [flagLine(905, BOTH_TS + 60_000, "damn it all"), flagLine(904, BOTH_TS, "damn noobs")],
};

const record: PlayerModeration = {
  userid: 42,
  username: "Maze",
  lastSeenAt: "2026-11-08T08:00:00Z",
  banned: false,
  banUntil: null,
  banReason: null,
  muteUntil: null,
  gameTeam: false,
  reportsAgainst: 4,
  log: [],
};

const closedDecision: ClosedDecision = {
  userid: 50,
  username: "yardtester",
  closedAt: "2026-11-07T10:00:00Z",
  closedBy: 9,
  closedByName: "Owner",
  caseId: 3,
  outcome: "dismiss",
  hours: null,
  note: "Banter between friends",
  messages: 1,
  reportedMessages: 1,
  reports: 1,
  uniqueReporters: 1,
  alsoReported: 0,
  filterOnlyLines: 0,
  preview: { text: "gg ez", source: "report" },
  flagLines: [],
};

let open: InboxPlayer[];

const serve = (call: Call): unknown => {
  if (call.path.endsWith("/admin/inbox") && call.method === "GET") {
    const userid = call.query.get("userid");
    const players = userid ? open.filter((p) => String(p.userid) === userid) : open;
    return { ok: true, players, nextOffset: null, counts: { all: open.length, reports: open.filter((p) => p.caseId).length, filter: open.filter((p) => !p.caseId).length } };
  }
  if (call.path.endsWith("/admin/inbox/closed")) {
    const userid = call.query.get("userid");
    const decisions = userid ? [closedDecision].filter((d) => String(d.userid) === userid) : [closedDecision];
    return { ok: true, decisions, nextOffset: null, count: 1 };
  }
  if (call.path.endsWith("/admin/chatcases/7")) return { ok: true, case: chatCase };
  if (call.path.endsWith("/admin/chatflags")) return { ok: true, players: [flags], nextOffset: null };
  if (call.path.endsWith("/admin/players/42/moderation")) return { ok: true, player: record };
  if (call.path.endsWith("/admin/players/50/moderation")) return { ok: true, player: { ...record, userid: 50, username: "yardtester" } };
  return undefined;
};

const mount = async (params: Record<string, string> = {}) => {
  const moves: { filter: QueueFilter; player: number | null; act?: string | null }[] = [];
  const said: string[] = [];
  const view: QueueView = new QueueView({
    say: (m) => said.push(m),
    onCount: () => undefined,
    onChanged: () => undefined,
    openPlayer: () => undefined,
    navigate: (p) => {
      moves.push(p);
      void view.show(Object.fromEntries(Object.entries({ filter: p.filter, player: p.player, act: p.act, tab: p.tab }).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)])));
    },
  });
  document.body.append(view.element);
  await view.show(params);
  await settle();
  return { view, moves, said };
};

beforeEach(() => {
  open = [maze()];
  answer = serve;
});

describe("the address", () => {
  it("reads the filter, the player, the tab and a confirm step", () => {
    expect(readQueueParams({ filter: "closed", player: "42", act: "warn", tab: "mail" })).toEqual({ filter: "closed", player: 42, act: "warn", tab: "mail" });
    expect(readQueueParams({ filter: "nope", act: "warn" })).toEqual({ filter: "all", player: null, act: null, tab: "reports" });
  });

  it("says what was done in plain words", () => {
    expect(doneWords("Maze", { action: "mute", reason: "x", hours: 24 })).toBe("Maze’s chat restricted for 1 day");
    expect(doneWords("Maze", { action: "ban", reason: "x", days: null })).toBe("Maze banned until you lift it");
  });
});

describe("the list", () => {
  it("counts players per filter and each player's lines once", async () => {
    await mount();
    const segs = [...document.querySelectorAll(".filter-grid .seg")].map((s) => s.textContent);
    expect(segs).toEqual(["All 1", "Player reports 1", "Word filter 0", "Closed 1"]);
    const row = document.querySelector("a.q-row[data-player='42']")!;
    expect(row.textContent).toContain("3 messages · 4 reports from 3 players · 1 word-filter catch");
  });

  it("shows Closed decisions with their outcome and reason", async () => {
    await mount({ filter: "closed" });
    const row = document.querySelector("a.q-row[data-player='50']")!;
    expect(row.textContent).toContain("Dismissed");
    expect(row.textContent).toContain("Reason: Banter between friends");
  });

  it("filters the loaded rows as the owner types", async () => {
    await mount();
    const search = document.querySelector<HTMLInputElement>(".search-wrap input")!;
    search.value = "zzz";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector("a.q-row[data-player='42']")).toBeNull();
    search.value = "maz";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector("a.q-row[data-player='42']")).not.toBeNull();
  });
});

describe("a player's record", () => {
  it("shows a line both reported and caught once, with both sources and its reporters", async () => {
    await mount({ player: "42" });
    const lines = [...document.querySelectorAll<HTMLElement>("article.ev-line")];
    // 2 reported + 1 filter-only = 3 lines; the both-line is not shown twice.
    expect(lines).toHaveLength(3);
    const both = lines.filter((l) => l.dataset["ts"] === String(BOTH_TS));
    expect(both).toHaveLength(1);
    expect(both[0]!.dataset["sources"]).toBe("report filter");
    expect(both[0]!.textContent).toContain("Player report");
    expect(both[0]!.textContent).toContain("Word filter");
    expect(both[0]!.textContent).toContain("Reported by 3 players: Kozu, Twig, Pebble");
    expect(both[0]!.querySelector("time")?.getAttribute("datetime")).toBe(new Date(BOTH_TS).toISOString());
    const filterOnly = lines.find((l) => l.dataset["sources"] === "filter")!;
    expect(filterOnly.textContent).not.toContain("Reported by");
    expect(filterOnly.textContent).toContain("Show the chat around it");
  });

  it("shows one notice when a reported line has no chat copy", async () => {
    await mount({ player: "42" });
    expect(document.querySelectorAll(".notice")).toHaveLength(1);
    expect(document.querySelector(".notice")!.textContent).toContain("For 1 reported message the chat server kept no copy");
  });

  it("has one action bar that counts each line once and suggests nothing", async () => {
    await mount({ player: "42" });
    const bar = document.querySelectorAll(".action-bar");
    expect(bar).toHaveLength(1);
    expect(bar[0]!.textContent).toContain("Applies to all 3 messages, closes 4 reports and 1 word-filter catch");
    expect([...bar[0]!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Dismiss", "Warn", "Restrict chat", "Ban"]);
    expect(document.body.textContent).not.toMatch(/suggest/i);
    expect(document.querySelector(".action-buttons .primary")).toBeNull();
  });

  it("asks for a reason before a warning, then sends what was shown and closes it all", async () => {
    let acted: Call | null = null;
    answer = (call) => {
      if (call.path.endsWith("/admin/inbox/42/act")) {
        acted = call;
        open = [];
        return { ok: true, closed: { caseId: 7, reports: 4, filterLines: 2, filterOnlyLines: 1 }, player: null };
      }
      return serve(call);
    };
    const { moves, said } = await mount({ player: "42" });
    document.querySelector<HTMLButtonElement>(".action-buttons [data-act='warn']")!.click();
    await settle();
    expect(moves.at(-1)).toMatchObject({ player: 42, act: "warn" });
    const pane = document.querySelector<HTMLFormElement>("form.confirm-pane")!;
    expect(pane.querySelector("h3")?.textContent).toBe("Warn Maze?");
    expect(pane.querySelector(".scope")?.textContent).toBe("Applies to all 3 messages, closes 4 reports and 1 word-filter catch");
    pane.requestSubmit();
    await settle();
    expect(pane.querySelector(".form-error")?.textContent).toBe("Write a reason: the player sees it.");
    expect(acted).toBeNull();
    pane.querySelector<HTMLTextAreaElement>("textarea")!.value = "Keep chat friendly";
    pane.requestSubmit();
    await settle();
    expect(acted!.body).toEqual({ action: "warn", reason: "Keep chat friendly", caseId: 7, reports: 4, flagsUpTo: 905 });
    expect(said).toContain("Maze warned");
    expect(document.querySelector(".inbox-result")?.textContent).toContain("Closed 4 reports and 1 word-filter catch");
    expect(document.querySelector(".action-bar")).toBeNull();
  });

  it("restricts chat for the length picked", async () => {
    let acted: Call | null = null;
    answer = (call) => (call.path.endsWith("/act") ? ((acted = call), { ok: true, closed: { caseId: 7, reports: 4, filterLines: 2, filterOnlyLines: 1 }, player: null }) : serve(call));
    await mount({ player: "42", act: "restrict" });
    const pane = document.querySelector<HTMLFormElement>("form.confirm-pane")!;
    const lengths = [...pane.querySelectorAll<HTMLButtonElement>(".segments .seg")];
    expect(lengths.map((b) => b.textContent)).toEqual(["1 hour", "1 day", "3 days", "7 days"]);
    lengths[3]!.click();
    pane.querySelector<HTMLTextAreaElement>("textarea")!.value = "Cool off";
    pane.requestSubmit();
    await settle();
    expect(acted!.body).toMatchObject({ action: "mute", hours: 168, reason: "Cool off" });
  });

  it("needs a ban length, and does nothing when new reports came in", async () => {
    answer = (call) =>
      call.path.endsWith("/act") ? Response.json({ ok: false, reason: "changed", message: "changed" }, { status: 409 }) : serve(call);
    const { said } = await mount({ player: "42", act: "ban" });
    const pane = document.querySelector<HTMLFormElement>("form.confirm-pane")!;
    pane.querySelector<HTMLTextAreaElement>("textarea")!.value = "Slurs";
    pane.requestSubmit();
    await settle();
    expect(pane.querySelector(".form-error")?.textContent).toBe("Pick how long the ban lasts.");
    pane.querySelector<HTMLButtonElement>(".segments .seg")!.click();
    pane.requestSubmit();
    await settle();
    expect(said.at(-1)).toMatch(/Something new came in/);
    expect(document.querySelector(".form-error")?.textContent).toMatch(/Not done: new reports/);
  });

  it("opens a player with nothing open from search, with no action bar", async () => {
    await mount({ player: "50" });
    expect(document.querySelector(".detail")!.textContent).toContain("No open reports");
    expect(document.querySelector(".action-bar")).toBeNull();
    expect(document.querySelector(".history")!.textContent).toContain("Earlier decisions (last 30 days): 1");
  });
});
