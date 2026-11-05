// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { CaseList, ChatCaseView } from "./api";
import {
  CASE_STEPS,
  CasesView,
  defaultAward,
  historyWords,
  lengthWords,
  outcomeWords,
  suggestedStep,
} from "./cases";
import { DEFAULT_WARNING } from "./moderation";

/**
 * Chat cases: one row per player with every report of their lines, the room
 * copy with the reported line marked, and warn / pause, award and dismiss,
 * each asked once more before it is sent.
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

const T = Date.parse("2026-11-04T10:00:00Z");

const troll = (over: Partial<ChatCaseView> = {}): ChatCaseView => ({
  id: 7,
  status: "open",
  reported: { userid: 42, username: "TrollKing88", banned: false, muted: false, gameTeam: false },
  messages: [
    {
      id: 70,
      channel: "chat:mr1-global",
      message: "you are all trash",
      ts: T,
      verified: true,
      reporters: [5, 6, 8],
      snapshot: {
        source: "log",
        lines: [
          { userid: 5, name: "GooGirl", text: "anyone up for a raid?", at: T - 60_000 },
          { userid: 42, name: "TrollKing88", text: "you are all trash", at: T, reported: true },
          { userid: 6, name: "PuttyPal", text: "rude", at: T + 30_000 },
        ],
      },
    },
    {
      id: 71,
      channel: "chat:mr1-global",
      message: "uninstall the game",
      ts: T + 60_000,
      verified: false,
      reporters: [6],
      snapshot: { source: "none", lines: [] },
    },
  ],
  reporters: [
    { userid: 5, username: "GooGirl", at: "2026-11-04T10:01:00Z", first: true, late: false, award: null },
    { userid: 6, username: "PuttyPal", at: "2026-11-04T10:02:00Z", first: false, late: false, award: null },
    {
      userid: 8,
      username: "Octo",
      at: "2026-11-04T10:03:00Z",
      first: false,
      late: false,
      award: { amount: 10, at: "2026-11-04T11:00:00Z" },
    },
  ],
  reports: 4,
  firstReportAt: "2026-11-04T10:01:00Z",
  lastReportAt: "2026-11-04T10:03:00Z",
  history: { cases: 1, flags: 2, warnings: 1, mutes: 0, bans: 0 },
  suggest: { action: "mute", hours: 72 },
  closed: null,
  ...over,
});

const list = (cases: ChatCaseView[], over: Partial<CaseList> = {}): CaseList => ({
  cases,
  nextOffset: null,
  open: cases.length,
  award: { each: 10, first: 10 },
  ...over,
});

const ok = <T extends object>(value: T) => ({ ok: true, ...value });

const mount = async () => {
  const counts: (number | null)[] = [];
  const said: string[] = [];
  const opened: number[] = [];
  const changed = vi.fn();
  const view = new CasesView({
    say: (message) => said.push(message),
    onCount: (open) => counts.push(open),
    openPlayer: (userid) => opened.push(userid),
    onChanged: changed,
  });
  document.body.append(view.element);
  await view.refresh();
  await settle();
  return { view, counts, said, opened, changed };
};

const caseEl = (id = 7) => document.querySelector<HTMLDetailsElement>(`details.case[data-case='${id}']`)!;
const click = (el: Element | null | undefined) => (el as HTMLElement).click();
const button = (root: Element, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("the words", () => {
  it("names lengths, steps and outcomes", () => {
    expect(lengthWords(1)).toBe("1 hour");
    expect(lengthWords(24)).toBe("1 day");
    expect(lengthWords(168)).toBe("7 days");
    expect(outcomeWords({ outcome: "mute", hours: 24, note: null, by: 1, byName: "o", at: "" })).toBe(
      "Warned + paused 1 day",
    );
    expect(outcomeWords({ outcome: "dismiss", hours: null, note: null, by: 1, byName: "o", at: "" })).toBe("Dismissed");
    expect(historyWords({ cases: 0, flags: 0, warnings: 0, mutes: 0, bans: 0 })).toBe("Clean record");
    expect(historyWords({ cases: 1, flags: 2, warnings: 1, mutes: 0, bans: 0 })).toBe(
      "1 warning, 2 lines caught by the filter, 1 earlier case",
    );
  });

  it("starts the picker on the suggestion: 24 h first, warn alone for one line and a clean record", () => {
    expect(CASE_STEPS[suggestedStep({ action: "mute", hours: 24 })]![0]).toBe(24);
    expect(CASE_STEPS[suggestedStep({ action: "mute", hours: 72 })]![0]).toBe(72);
    expect(CASE_STEPS[suggestedStep({ action: "warn", hours: null })]![0]).toBeNull();
    // A length not on the picker: the next longer one.
    expect(CASE_STEPS[suggestedStep({ action: "mute", hours: 48 })]![0]).toBe(72);
  });

  it("offers the configured Shiny, the first reporter's own amount when it differs", () => {
    const [first, other] = troll().reporters;
    expect(defaultAward(first!, { each: 10, first: 10 })).toBe(10);
    expect(defaultAward(first!, { each: 10, first: 30 })).toBe(30);
    expect(defaultAward(other!, { each: 10, first: 30 })).toBe(10);
  });
});

describe("the open cases", () => {
  it("lists one compact row per player with icons and numbers, and tells the count", async () => {
    answer = (call) => (call.path.endsWith("/chatcases") ? ok(list([troll()], { open: 3 })) : undefined);
    const { counts } = await mount();
    expect(calls[0]!.query.get("status")).toBe("open");
    expect(counts).toEqual([3]);
    expect(document.querySelector(".case-count")?.textContent).toBe("3");
    const row = caseEl().querySelector("summary")!;
    expect(row.textContent).toContain("TrollKing88");
    expect(row.textContent).toContain("“you are all trash”");
    expect(row.textContent).toContain("+1 more");
    const stats = [...row.querySelectorAll(".case-stat")].map((s) => s.getAttribute("title"));
    expect(stats).toEqual([
      "2 lines reported",
      "4 reports",
      "1 earlier warnings, pauses or bans",
      "2 lines caught by the word filter",
    ]);
    expect(row.textContent).toContain("Map Room 1");
    expect(caseEl().open).toBe(false);
  });

  it("shows the room copy with the reported line marked, the reporters and the record", async () => {
    answer = () => ok(list([troll()]));
    const { opened } = await mount();
    const card = caseEl().querySelector(".case-card")!;
    const lines = [...card.querySelectorAll(".snap-line")];
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.classList.contains("is-reported")).map((l) => l.textContent)).toEqual([
      expect.stringContaining("you are all trash"),
    ]);
    expect(card.textContent).toContain("their own words");
    // The second line had no copy: its words, and "Not matched".
    expect(card.textContent).toContain("“uninstall the game”");
    expect(card.textContent).toContain("No copy of the room was found.");
    expect(card.textContent).toContain("Not matched");
    expect([...card.querySelectorAll(".case-reporter")].map((r) => r.textContent)).toEqual([
      "GooGirl1st",
      "PuttyPal",
      "Octo+10",
    ]);
    expect(card.textContent).toContain("Before: 1 warning, 2 lines caught by the filter, 1 earlier case.");
    expect(card.textContent).toContain("Suggested: Warn + pause 3 days");
    click(button(card, "Open TrollKing88"));
    expect(opened).toEqual([42]);
  });

  it("says so when there are none", async () => {
    answer = () => ok(list([]));
    const { counts } = await mount();
    expect(counts).toEqual([0]);
    expect(document.querySelector(".empty")?.textContent).toContain("No open cases");
  });
});

describe("the steps", () => {
  it("warns and pauses for the suggested length after asking once more, then offers the award", async () => {
    const closed = troll({
      status: "actioned",
      closed: { outcome: "mute", hours: 72, note: null, by: 9, byName: "owner", at: "2026-11-04T12:00:00Z" },
    });
    let acted = false;
    answer = (call) => {
      if (call.path.endsWith("/chatcases/7/act")) {
        acted = true;
        return ok({ case: closed });
      }
      return ok(list(acted ? [] : [troll()], { open: acted ? 0 : 1 }));
    };
    const { said, changed, counts } = await mount();
    const card = caseEl().querySelector(".case-card")!;
    click(button(card, "Warn + pause"));
    const form = card.querySelector("form.case-form")!;
    expect(form.querySelector("[aria-pressed='true']")?.textContent).toBe("3 d");
    expect(form.querySelector("textarea")?.value).toBe(DEFAULT_WARNING);
    click(button(form, "Next"));
    expect(form.querySelector(".confirm-question")?.textContent).toBe(
      "Warn TrollKing88 and pause their chat for 3 days?",
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    click(button(form, "Yes, do it"));
    await settle();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toMatch(/\/admin\/chatcases\/7\/act$/);
    expect(post.body).toEqual({ action: "mute", reason: DEFAULT_WARNING, hours: 72 });
    expect(changed).toHaveBeenCalled();
    expect(said[0]).toBe("TrollKing88 warned, chat paused. Now the reporters?");
    expect(counts.at(-1)).toBe(0);
    // Still on show, closed, with the award step open.
    const after = caseEl();
    expect(after.open).toBe(true);
    expect(after.querySelector("summary")?.textContent).toContain("Warned + paused 3 days");
    expect(after.querySelector(".case-award-list")).not.toBeNull();
    expect(button(after, "Warn + pause")).toBeUndefined();
  });

  it("can warn alone", async () => {
    answer = (call) =>
      call.path.endsWith("/act") ? ok({ case: troll({ status: "actioned" }) }) : ok(list([troll()]));
    await mount();
    const card = caseEl().querySelector(".case-card")!;
    click(button(card, "Warn + pause"));
    const form = card.querySelector("form.case-form")!;
    click(button(form, "Warn only"));
    click(button(form, "Next"));
    expect(form.querySelector(".confirm-question")?.textContent).toBe("Warn TrollKing88?");
    click(button(form, "Yes, do it"));
    await settle();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "warn", reason: DEFAULT_WARNING });
  });

  it("gives Shiny to the ticked reporters only, never again to one already given", async () => {
    answer = (call) =>
      call.path.endsWith("/award")
        ? ok({ case: troll(), given: [{ userid: 5, amount: 15 }], already: [], failed: [] })
        : ok(list([troll()]));
    const { said } = await mount();
    const card = caseEl().querySelector(".case-card")!;
    click(button(card, "Award 2"));
    const form = card.querySelector("form.case-form")!;
    const rows = [...form.querySelectorAll<HTMLLIElement>(".case-award")];
    const [goo, putty, octo] = rows.map((row) => ({
      tick: row.querySelector<HTMLInputElement>("input[type='checkbox']")!,
      amount: row.querySelector<HTMLInputElement>("input[type='number']")!,
    }));
    expect([goo!.amount.value, putty!.amount.value]).toEqual(["10", "10"]);
    expect(octo!.tick.disabled && octo!.amount.disabled).toBe(true);
    expect(form.querySelector(".case-total")?.textContent).toBe("20 Shiny to 2 players");
    putty!.tick.checked = false;
    putty!.tick.dispatchEvent(new Event("change"));
    goo!.amount.value = "15";
    goo!.amount.dispatchEvent(new Event("input"));
    expect(form.querySelector(".case-total")?.textContent).toBe("15 Shiny to 1 player");
    click(button(form, "Next"));
    expect(form.querySelector(".confirm-question")?.textContent).toBe("Give 15 Shiny to 1 reporter?");
    click(button(form, "Yes, give"));
    await settle();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toMatch(/\/admin\/chatcases\/7\/award$/);
    expect(post.body).toEqual({ awards: [{ userid: 5, amount: 15 }] });
    expect(said).toEqual(["Gave 15 Shiny to 1 reporter"]);
  });

  it("refuses an empty award before asking", async () => {
    answer = () => ok(list([troll()]));
    await mount();
    const card = caseEl().querySelector(".case-card")!;
    click(button(card, "Award 2"));
    const form = card.querySelector("form.case-form")!;
    for (const tick of form.querySelectorAll<HTMLInputElement>("input[type='checkbox']:not(:disabled)")) {
      tick.checked = false;
      tick.dispatchEvent(new Event("change"));
    }
    click(button(form, "Next"));
    expect(form.querySelector(".form-error")?.textContent).toBe("Tick at least one reporter.");
    expect(form.querySelector<HTMLElement>(".confirm")?.hidden).toBe(true);
  });

  it("dismisses with a note, and shows the server's refusal", async () => {
    let refuse = true;
    answer = (call) => {
      if (call.path.endsWith("/act")) {
        if (refuse) return { ok: false, error: "This case is already closed." };
        return ok({ case: troll({ status: "dismissed" }) });
      }
      return ok(list([troll()]));
    };
    await mount();
    const card = caseEl().querySelector(".case-card")!;
    click(button(card, "Dismiss"));
    const form = card.querySelector("form.case-form")!;
    form.querySelector("textarea")!.value = "banter between friends";
    click(button(form, "Dismiss…"));
    expect(form.querySelector(".confirm-question")?.textContent).toBe(
      "Close this case with nothing done to TrollKing88?",
    );
    click(button(form, "Yes, dismiss"));
    await settle();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      action: "dismiss",
      note: "banter between friends",
    });
    expect(form.querySelector(".form-error")?.textContent).toMatch(/^Not done: /);
    refuse = false;
  });
});

describe("the closed cases", () => {
  it("are folded, and load when opened", async () => {
    const done = troll({
      id: 3,
      status: "dismissed",
      closed: { outcome: "dismiss", hours: null, note: "fine", by: 9, byName: "owner", at: "2026-11-03T12:00:00Z" },
    });
    answer = (call) => ok(list(call.query.get("status") === "closed" ? [done] : [], { open: 0 }));
    await mount();
    expect(calls.map((c) => c.query.get("status"))).toEqual(["open"]);
    const fold = document.querySelector<HTMLDetailsElement>("details.cases-closed")!;
    fold.open = true;
    fold.dispatchEvent(new Event("toggle"));
    await settle();
    expect(calls.map((c) => c.query.get("status"))).toEqual(["open", "closed"]);
    const row = caseEl(3);
    expect(row.querySelector("summary")?.textContent).toContain("Dismissed");
    expect(row.querySelector(".case-done")?.textContent).toContain("“fine”");
    // A closed case can still give its reporters Shiny, but not be acted on again.
    expect(button(row, "Award 2")).toBeDefined();
    expect(button(row, "Dismiss")).toBeUndefined();
  });
});
