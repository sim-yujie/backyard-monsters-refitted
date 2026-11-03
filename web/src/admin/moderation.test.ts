// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { ChatReportView, PlayerModeration } from "./api";
import {
  DEFAULT_WARNING,
  ModerationView,
  actionForm,
  banStatus,
  roomLabel,
  untilWords,
} from "./moderation";

/**
 * The Moderation section: chat reports newest first, a player's state and
 * history, and the warn, pause, ban and lift forms (a ban asks once more).
 */

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
let routes: Record<string, unknown> = {};

const answerFor = (method: string, path: string): unknown => {
  const key = Object.keys(routes).find((k) => {
    const [m, end] = k.split(" ");
    return m === method && path.endsWith(end!);
  });
  return key === undefined ? undefined : routes[key];
};

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 9 }));
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url, "http://localhost");
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, path: parsed.pathname, query: parsed.searchParams, body });
      const found = answerFor(method, parsed.pathname);
      if (found === undefined) return new Response("Not Found", { status: 404 });
      const [status, answer] = Array.isArray(found) ? (found as [number, unknown]) : [200, found];
      return Response.json(answer, { status });
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

const player = (over: Partial<PlayerModeration> = {}): PlayerModeration => ({
  userid: 42,
  username: "MonsterMash",
  lastSeenAt: "2026-11-03T08:00:00Z",
  banned: false,
  banUntil: null,
  banReason: null,
  muteUntil: null,
  gameTeam: false,
  reportsAgainst: 2,
  log: [],
  ...over,
});

const report = (over: Partial<ChatReportView> = {}): ChatReportView => ({
  id: 5,
  reporter: { userid: 7, username: "Tattler" },
  reported: { userid: 42, username: "MonsterMash", banned: false, muted: false },
  channel: "chat:mr2-global",
  message: "you are all noobs",
  messageTs: Date.parse("2026-11-03T07:59:00Z"),
  verified: true,
  reportsAgainst: 2,
  actions: [],
  at: "2026-11-03T08:00:00Z",
  ...over,
});

const click = (el: Element | null | undefined) => (el as HTMLElement).click();

describe("words", () => {
  it("names rooms", () => {
    expect(roomLabel("chat:mr2-global")).toBe("Map Room 2");
    expect(roomLabel("chat:inferno-global")).toBe("Inferno");
    expect(roomLabel("chat:country:PH")).toBe("Philippines");
    expect(roomLabel("chat:alliance:12")).toBe("Alliance");
  });

  it("says how long a ban lasts", () => {
    expect(banStatus({ banned: false, banUntil: null })).toBeNull();
    expect(banStatus({ banned: true, banUntil: null })).toBe("Banned for good");
    expect(banStatus({ banned: true, banUntil: "2026-11-10T08:00:00Z" })).toMatch(/^Banned until 10 Nov/);
    expect(untilWords({ action: "ban", until: null })).toBe("for good");
    expect(untilWords({ action: "warn", until: null })).toBeNull();
  });
});

describe("the chat reports list", () => {
  it("lists reports newest first and opens the player with the report linked", async () => {
    routes = {
      "GET /chatreports": {
        reports: [report({ id: 6, verified: false, actions: ["warn"] }), report()],
        nextBefore: null,
      },
      "GET /players/42/moderation": { player: player() },
    };
    const view = new ModerationView({ say: () => {} });
    document.body.append(view.element);
    await view.refresh();
    const rows = view.element.querySelectorAll(".report-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Not matched");
    expect(rows[0]!.textContent).toContain("done: Warning");
    expect(rows[1]!.textContent).toContain("Matched");
    expect(rows[1]!.textContent).toContain("“you are all noobs”");
    expect(rows[1]!.textContent).toContain("reported by Tattler · Map Room 2");

    click(rows[0]);
    await settle();
    expect(view.element.querySelector(".mod-card")?.textContent).toContain("from chat report #6");

    routes["POST /players/42/warn"] = { player: player({ log: [] }) };
    click(view.element.querySelector("[data-kind='warn']"));
    click(view.element.querySelector(".mod-form button[type='submit']"));
    await settle();
    const sent = calls.find((c) => c.method === "POST");
    expect(sent?.path).toMatch(/\/admin\/players\/42\/warn$/);
    expect(sent?.body).toEqual({ reason: DEFAULT_WARNING, chatReportId: 6 });
  });

  it("says when there are none", async () => {
    routes = { "GET /chatreports": { reports: [], nextBefore: null } };
    const view = new ModerationView({ say: () => {} });
    await view.refresh();
    expect(view.element.textContent).toContain("No chat reports");
  });
});

describe("a player's card", () => {
  it("shows state, history and only the steps that make sense", async () => {
    routes = {
      "GET /chatreports": { reports: [], nextBefore: null },
      "GET /players/42/moderation": {
        player: player({
          banned: true,
          banUntil: null,
          banReason: "Spam",
          muteUntil: "2026-11-04T08:00:00Z",
          log: [
            {
              id: 2,
              action: "ban",
              reason: "Spam",
              until: null,
              by: 9,
              byName: "Owner",
              chatReportId: 5,
              seenAt: null,
              at: "2026-11-03T09:00:00Z",
            },
            {
              id: 1,
              action: "warn",
              reason: DEFAULT_WARNING,
              until: null,
              by: 9,
              byName: "Owner",
              chatReportId: null,
              seenAt: "2026-11-03T08:30:00Z",
              at: "2026-11-03T08:10:00Z",
            },
          ],
        }),
      },
    };
    const view = new ModerationView({ say: () => {} });
    await view.open(42);
    const card = view.element.querySelector(".mod-card")!;
    expect(card.textContent).toContain("Banned for good");
    expect(card.textContent).toContain("Reason: Spam");
    expect(card.textContent).toContain("Chat paused until");
    const kinds = [...card.querySelectorAll<HTMLElement>("[data-kind]")].map((b) => b.dataset["kind"]);
    expect(kinds).toEqual(["warn", "mute", "ban", "unmute", "unban"]);
    const entries = card.querySelectorAll(".mod-entry");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.textContent).toContain("for good · by Owner · from chat report #5");
    expect(entries[1]!.textContent).toContain("seen");
  });

  it("offers a game team account only the lifts", async () => {
    routes = { "GET /players/42/moderation": { player: player({ gameTeam: true }) } };
    const view = new ModerationView({ say: () => {} });
    await view.open(42);
    expect(view.element.querySelectorAll("[data-kind]")).toHaveLength(0);
    expect(view.element.textContent).toContain("cannot be warned, paused or banned");
  });
});

describe("the forms", () => {
  const mount = (kind: "warn" | "mute" | "ban" | "unban", onDone = vi.fn()) => {
    const form = actionForm({ player: { userid: 42, username: "MonsterMash" }, kind, onDone, onCancel: () => {} });
    document.body.append(form);
    return { form, onDone };
  };

  it("needs a reason for a warning, and starts with the friendly one", () => {
    const { form } = mount("warn");
    const reason = form.querySelector("textarea")!;
    expect(reason.value).toBe(DEFAULT_WARNING);
    reason.value = "  ";
    reason.dispatchEvent(new Event("input"));
    click(form.querySelector("button[type='submit']"));
    expect(form.querySelector(".form-error")?.textContent).toBe("Write a reason: the player sees it.");
    expect(calls).toHaveLength(0);
  });

  it("pauses chat for the picked hours", async () => {
    routes = { "POST /players/42/mute": { player: player({ muteUntil: "2026-11-06T08:00:00Z" }) } };
    const { form, onDone } = mount("mute");
    form.querySelector("textarea")!.value = "Shouting";
    click([...form.querySelectorAll(".seg")].find((b) => b.textContent === "3 days"));
    click(form.querySelector("button[type='submit']"));
    await settle();
    expect(calls[0]!.body).toEqual({ reason: "Shouting", hours: 72 });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("asks once more before a ban, with the length in words", async () => {
    routes = { "POST /players/42/ban": { player: player({ banned: true }) } };
    const { form, onDone } = mount("ban");
    form.querySelector("textarea")!.value = "Cheating";
    click(form.querySelector("button[type='submit']"));
    expect(form.querySelector(".form-error")?.textContent).toBe("Pick how long the ban lasts.");

    click([...form.querySelectorAll(".seg")].find((b) => b.textContent === "7 days"));
    click(form.querySelector("button[type='submit']"));
    const confirm = form.querySelector<HTMLElement>(".confirm")!;
    expect(confirm.hidden).toBe(false);
    expect(confirm.textContent).toContain("Ban MonsterMash for 7 days?");
    expect(calls).toHaveLength(0);

    click([...confirm.querySelectorAll("button")].find((b) => b.textContent === "Yes, ban"));
    await settle();
    expect(calls[0]!.body).toEqual({ reason: "Cheating", days: 7 });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("sends null days for a ban for good", async () => {
    routes = { "POST /players/42/ban": { player: player({ banned: true }) } };
    const { form } = mount("ban");
    form.querySelector("textarea")!.value = "Threats";
    click([...form.querySelectorAll(".seg")].find((b) => b.textContent === "For good"));
    click(form.querySelector("button[type='submit']"));
    expect(form.querySelector(".confirm")?.textContent).toContain("Ban MonsterMash for good?");
    click([...form.querySelectorAll(".confirm button")].find((b) => b.textContent === "Yes, ban"));
    await settle();
    expect(calls[0]!.body).toEqual({ reason: "Threats", days: null });
  });

  it("lifts a ban without a reason and shows the server's refusal", async () => {
    routes = { "POST /players/42/unban": [409, { error: "This player is not banned." }] };
    const { form, onDone } = mount("unban");
    click(form.querySelector("button[type='submit']"));
    await settle();
    expect(calls[0]!.body).toEqual({ reason: "" });
    expect(onDone).not.toHaveBeenCalled();
    expect(form.querySelector(".form-error")?.textContent).toContain("Not done:");
  });
});
