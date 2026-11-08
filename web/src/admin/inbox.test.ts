// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { ChatCaseView, FlaggedPlayer, InboxList, InboxPlayer, PlayerModeration } from "./api";
import { InboxView, banLabel, closedPreview, closedWords, inboxLabel, shortLength, stepLabel } from "./inbox";

/**
 * The moderation inbox: one row per player across player reports and the
 * word filter, a player opened with all the evidence, and one step that
 * closes everything shown, refused when something new came in.
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

const troll = (over: Partial<InboxPlayer> = {}): InboxPlayer => ({
  userid: 42,
  username: "TrollKing88",
  banned: false,
  muted: false,
  gameTeam: false,
  caseId: 7,
  reportedMessages: 2,
  reports: 4,
  uniqueReporters: 4,
  filterLines: 3,
  slurs: 0,
  flagsUpTo: 905,
  previousActions: 1,
  lastAction: { action: "warn", at: "2026-11-01T10:00:00Z" },
  oldestAt: "2026-11-04T10:00:00Z",
  latestAt: "2026-11-04T12:00:00Z",
  preview: { text: "you are all trash", source: "report" },
  suggest: { action: "mute", hours: 24 },
  ...over,
});

const swearer = (): InboxPlayer =>
  troll({
    userid: 50,
    username: "Potty",
    caseId: null,
    reportedMessages: 0,
    reports: 0,
    uniqueReporters: 0,
    filterLines: 1,
    flagsUpTo: 910,
    previousActions: 0,
    lastAction: null,
    preview: { text: "darn it", source: "filter" },
    suggest: { action: "warn", hours: null },
  });

const theCase: ChatCaseView = {
  id: 7,
  status: "open",
  reported: { userid: 42, username: "TrollKing88", banned: false, muted: false, gameTeam: false },
  messages: [
    {
      id: 70,
      channel: "chat:mr1-global",
      message: "you are all trash",
      ts: Date.parse("2026-11-04T10:00:00Z"),
      verified: true,
      reporters: [5, 6],
      snapshot: { source: "none", lines: [] },
    },
  ],
  reporters: [
    { userid: 5, username: "GooGirl", at: "2026-11-04T10:01:00Z", first: true, late: false, award: null },
    { userid: 6, username: "PuttyPal", at: "2026-11-04T10:02:00Z", first: false, late: false, award: null },
  ],
  reports: 4,
  firstReportAt: "2026-11-04T10:01:00Z",
  lastReportAt: "2026-11-04T10:03:00Z",
  history: { cases: 0, flags: 3, warnings: 1, mutes: 0, bans: 0 },
  suggest: { action: "mute", hours: 24 },
  closed: null,
};

const flags: FlaggedPlayer = {
  userid: 42,
  username: "TrollKing88",
  banned: false,
  muted: false,
  count: 3,
  slurs: 0,
  lastId: 905,
  latestAt: "2026-11-04T12:00:00Z",
  lines: [
    { id: 905, channel: "chat:mr1-global", message: "what the heck", shown: "what the ****", words: ["heck"], severity: "swear", rule: "word", at: "2026-11-04T12:00:00Z" },
  ],
};

const record: PlayerModeration = {
  userid: 42,
  username: "TrollKing88",
  lastSeenAt: null,
  banned: false,
  banUntil: null,
  banReason: null,
  muteUntil: null,
  gameTeam: false,
  reportsAgainst: 4,
  log: [
    { id: 1, action: "warn", reason: "Be nice", until: null, by: 9, byName: "owner", chatReportId: null, seenAt: null, at: "2026-11-01T10:00:00Z" },
  ],
};

const ok = <T extends object>(value: T) => ({ ok: true, ...value });
const list = (players: InboxPlayer[]): InboxList => ({ players, nextOffset: null, counts: { all: 2, reports: 1, filter: 2 } });

/** A test server: the inbox with these players, and what one step answers. */
const server = (players: InboxPlayer[], act: (call: Call) => unknown = () => undefined) => {
  answer = (call) => {
    if (call.path.endsWith("/admin/inbox")) {
      const userid = call.query.get("userid");
      return ok(userid ? list(players.filter((p) => String(p.userid) === userid)) : list(players));
    }
    if (call.path.endsWith("/admin/chatcases/7")) return ok({ case: theCase });
    if (call.path.endsWith("/admin/chatflags")) return ok({ players: [flags], nextOffset: null });
    if (call.path.endsWith("/moderation")) return ok({ player: record });
    if (call.path.endsWith("/act")) return act(call);
    return undefined;
  };
};

const mount = async () => {
  const said: string[] = [];
  const counts: (InboxList["counts"] | null)[] = [];
  const moves: { source: string; player: number | null }[] = [];
  const awards: number[] = [];
  const changed = vi.fn();
  const view = new InboxView({
    say: (message) => said.push(message),
    onCount: (c) => counts.push(c),
    onChanged: changed,
    openAward: (id) => awards.push(id),
    openPlayer: () => undefined,
    navigate: (params) => {
      moves.push(params);
      void view.show({ ...(params.source === "all" ? {} : { source: params.source }), ...(params.player ? { player: String(params.player) } : {}) });
    },
  });
  document.body.append(view.element);
  await view.show({});
  await settle();
  return { view, said, counts, moves, awards, changed };
};

const button = (root: Element, text: string | RegExp) =>
  [...root.querySelectorAll("button")].find((b) => (typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent ?? "")));
const detail = () => document.querySelector<HTMLElement>(".inbox-detail")!;

describe("the words", () => {
  it("counts in plain words, and says the real step", () => {
    expect(inboxLabel(troll())).toBe("2 reported messages · 4 reports · 4 unique reporters · 3 word-filter lines · 1 previous action");
    expect(inboxLabel(swearer())).toBe("1 word-filter line");
    expect(closedWords({ caseId: 7, reports: 4, filterLines: 3 })).toBe("1 chat case (4 reports), 3 word-filter lines");
    expect(closedPreview(troll())).toBe("1 chat case (4 reports) and 3 word-filter lines");
    expect(stepLabel(null)).toBe("Warn");
    expect(stepLabel(24)).toBe("Warn + pause 24 h");
    expect(shortLength(72)).toBe("3 d");
    expect(shortLength(48)).toBe("2 d");
    expect(banLabel(7)).toBe("Ban 7 days");
    expect(banLabel(null)).toBe("Ban for good");
  });
});

describe("the list", () => {
  it("shows one row per player with the counts per source, and filters by source", async () => {
    server([troll(), swearer()]);
    const { counts, moves } = await mount();
    const rows = [...document.querySelectorAll(".inbox-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("TrollKing88");
    expect(rows[0]!.textContent).toContain("4 unique reporters");
    expect(counts.at(-1)).toEqual({ all: 2, reports: 1, filter: 2 });
    const filter = document.querySelector<HTMLButtonElement>("[data-source='filter']")!;
    expect(filter.textContent).toBe("Word filter · 2");
    filter.click();
    await settle();
    expect(moves.at(-1)).toEqual({ source: "filter", player: null });
    expect(calls.filter((c) => c.path.endsWith("/admin/inbox")).at(-1)!.query.get("source")).toBe("filter");
    expect(filter.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("a player opened", () => {
  it("shows every piece of evidence, with the suggested step's length on the button", async () => {
    server([troll(), swearer()]);
    await mount();
    document.querySelector<HTMLButtonElement>(".inbox-row[data-player='42']")!.click();
    await settle();
    expect(document.querySelector(".inbox")!.classList.contains("has-open")).toBe(true);
    expect(document.querySelector(".inbox-row[data-player='42']")!.getAttribute("aria-current")).toBe("true");
    const text = detail().textContent ?? "";
    expect(text).toContain("you are all trash");
    expect(text).toContain("GooGirl");
    expect(text).toContain("what the heck");
    expect(text).toContain("Be nice");
    expect(button(detail(), "Warn + pause 24 h")).toBeDefined();
    expect(button(detail(), "Ban…")).toBeDefined();
    expect(button(detail(), "Dismiss")).toBeDefined();
  });

  it("closes everything shown in one step, says what closed, and offers the reporters' Shiny", async () => {
    server([troll()], (call) => ok({ closed: { caseId: 7, reports: 4, filterLines: 3 }, player: null, echo: call.body }));
    const { changed, awards } = await mount();
    document.querySelector<HTMLButtonElement>(".inbox-row[data-player='42']")!.click();
    await settle();
    button(detail(), "Warn + pause 24 h")!.click();
    // The panel's button says the step picked; a longer one changes it.
    button(detail(), "3 d")!.click();
    button(detail(), "Warn + pause 3 d…")!.click();
    expect(detail().querySelector(".confirm-question")?.textContent).toBe(
      "Warn TrollKing88, pause their chat for 3 d, and close 1 chat case (4 reports) and 3 word-filter lines?",
    );
    // Afterwards nothing is open for them any more.
    server([], (call) => ok({ closed: { caseId: 7, reports: 4, filterLines: 3 }, player: null, echo: call.body }));
    button(detail(), "Yes, do it")!.click();
    await settle();
    const act = calls.find((c) => c.path.endsWith("/admin/inbox/42/act"))!;
    expect(act.body).toMatchObject({ action: "mute", hours: 72, caseId: 7, reports: 4, flagsUpTo: 905 });
    expect(act.body!["reason"]).toBeTruthy();
    expect(detail().querySelector(".inbox-result")?.textContent).toContain("Closed: 1 chat case (4 reports), 3 word-filter lines.");
    expect(detail().textContent).toContain("Nothing is open against this player now.");
    expect(changed).toHaveBeenCalled();
    button(detail(), "Give 2 reporters Shiny")!.click();
    expect(awards).toEqual([7]);
    expect(document.querySelectorAll(".inbox-row")).toHaveLength(0);
  });

  it("does nothing when new reports came in, and shows them first", async () => {
    server([troll()], () =>
      Response.json({ error: "New reports came in.", reason: "changed" }, { status: 409 }),
    );
    const { changed } = await mount();
    document.querySelector<HTMLButtonElement>(".inbox-row[data-player='42']")!.click();
    await settle();
    button(detail(), "Dismiss")!.click();
    button(detail(), "Dismiss…")!.click();
    server([troll({ reports: 5, uniqueReporters: 5 })], () => Response.json({ error: "x", reason: "changed" }, { status: 409 }));
    button(detail(), "Yes, dismiss")!.click();
    await settle();
    expect(changed).not.toHaveBeenCalled();
    expect(detail().textContent).toContain("Not done: new reports or lines came in since you opened this.");
    expect(detail().textContent).toContain("5 reports");
  });

  it("asks how long before a ban, and says it on the button", async () => {
    server([swearer()], () => ok({ closed: { caseId: null, reports: 0, filterLines: 1 }, player: null }));
    await mount();
    document.querySelector<HTMLButtonElement>(".inbox-row[data-player='50']")!.click();
    await settle();
    expect(button(detail(), "Warn")).toBeDefined();
    button(detail(), "Ban…")!.click();
    const panelBox = detail().querySelector(".case-form")!;
    detail().querySelector<HTMLTextAreaElement>(".case-form textarea")!.value = "Slurs";
    button(panelBox, "Ban…")!.click();
    expect(detail().querySelector(".form-error")?.textContent).toBe("Pick how long the ban lasts.");
    button(panelBox, "7 days")!.click();
    button(panelBox, "Ban 7 days…")!.click();
    button(panelBox, "Yes, ban")!.click();
    await settle();
    const act = calls.find((c) => c.path.endsWith("/admin/inbox/50/act"))!;
    expect(act.body).toMatchObject({ action: "ban", days: 7, reason: "Slurs", caseId: null, flagsUpTo: 910 });
  });

  it("goes back to the list", async () => {
    server([troll()]);
    const { moves } = await mount();
    document.querySelector<HTMLButtonElement>(".inbox-row[data-player='42']")!.click();
    await settle();
    button(detail(), "Back to list")!.click();
    await settle();
    expect(moves.at(-1)).toEqual({ source: "all", player: null });
    expect(detail().hidden).toBe(true);
  });
});
