// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { BugReportDetail, BugReportSummary, ShinyAwardView } from "./api";
import { BugsView, threadView } from "./bugs";
import { amountProblem, awardForm, needsConfirm, ShinyView } from "./shiny";
import { THEME_STORAGE_KEY, applyTheme, readTheme, themePicker } from "./theme";

/**
 * The dashboard's support tools: messages with a report's player, giving
 * Shiny (with the check for big gifts, and one gift per press), the Shiny
 * section's search and log, and the light/dark switch.
 */

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
/** The test's answers: by "METHOD path-end", a body or a [status, body]. */
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
  document.documentElement.removeAttribute("data-theme");
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
      const value = typeof answer === "function" ? (answer as (b: unknown) => unknown)(body) : answer;
      return Response.json(value, { status });
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

const summary = (over: Partial<BugReportSummary> = {}): BugReportSummary => ({
  id: 7,
  createdAt: "2026-10-23T08:00:00Z",
  userid: 42,
  username: "MonsterMash",
  preview: "My Octo-ooze walked through the wall",
  gameVersion: "v2.0.0-beta.3",
  screen: "yard",
  device: "Phone",
  hasScreenshot: false,
  hasPicture: false,
  emailed: false,
  status: "fixed",
  statusChangedAt: null,
  hasNotes: false,
  unreadReplies: 0,
  ...over,
});

const award = (over: Partial<ShinyAwardView> = {}): ShinyAwardView => ({
  id: 1,
  userid: 42,
  username: "MonsterMash",
  amount: 250,
  reason: "Sorry for the lost troops",
  bugReportId: 7,
  by: 9,
  at: "2026-10-23T09:00:00Z",
  ...over,
});

const detail = (over: Partial<BugReportDetail> = {}): BugReportDetail => {
  const { preview: _preview, unreadReplies: _unread, ...rest } = summary();
  return {
    ...rest,
    message: "My Octo-ooze walked through the wall",
    contactEmail: null,
    userAgent: "test",
    browser: "Chrome",
    screenSize: "390x844",
    errors: [],
    screenshotType: null,
    pictureType: null,
    emailedAt: null,
    ownerNotes: "",
    notesChangedAt: null,
    changes: [],
    thread: [],
    cannotReply: null,
    awards: [],
    ...over,
  };
};

const button = (root: ParentNode, text: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`No button "${text}"`);
  return found;
};

const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input"));
};

describe("how much Shiny", () => {
  it("takes a whole number from 1 to 10,000, and asks again over 500", () => {
    expect(amountProblem("")).toBe("Type how much Shiny to give.");
    expect(amountProblem("2.5")).toBe("Give a whole number of Shiny, like 250.");
    expect(amountProblem("-3")).toBe("Give a whole number of Shiny, like 250.");
    expect(amountProblem("0")).toBe("Give at least 1 Shiny.");
    expect(amountProblem("10001")).toBe("One gift can be at most 10,000 Shiny.");
    expect(amountProblem(" 10000 ")).toBeNull();
    expect(needsConfirm(500)).toBe(false);
    expect(needsConfirm(501)).toBe(true);
  });
});

describe("the messages with a player", () => {
  it("puts the player on the left, the team on the right, and marks unread answers", () => {
    const list = threadView(
      [
        { id: "1", from: "team", text: "Thanks! Which wall?", at: "2026-10-23T08:10:00Z", unread: false },
        { id: "2", from: "player", text: "The left one", at: "2026-10-23T08:20:00Z", unread: true },
      ],
      "MonsterMash",
    );
    const bubbles = [...list.querySelectorAll("li")];
    expect(bubbles.map((b) => b.className)).toEqual(["bubble bubble-team", "bubble bubble-player"]);
    expect(bubbles[0]!.textContent).toContain("You, as The game team");
    expect(bubbles[1]!.textContent).toContain("MonsterMash");
    expect(bubbles[1]!.querySelector(".chip")?.textContent).toBe("New");
    expect(bubbles[0]!.querySelector(".chip")).toBeNull();
  });

  it("says how it works when nothing has been written yet", () => {
    expect(threadView([], "MonsterMash").textContent).toMatch(/^No messages yet\./);
  });
});

describe("a bug report", () => {
  const open = async (report: BugReportDetail, list: BugReportSummary[] = [summary()]) => {
    routes["GET /admin/bugreports"] = { error: 0, reports: list, nextBefore: null };
    routes[`GET /admin/bugreports/${report.id}`] = { error: 0, report };
    const said: string[] = [];
    const view = new BugsView({
      onRoute: () => {},
      onError: (m) => said.push(m),
      onSay: (m) => said.push(m),
      onAward: () => said.push("award"),
    });
    document.body.append(view.element);
    await view.show(null);
    return { view, said };
  };

  it("tags a report with answers not read yet in the list", async () => {
    const { view } = await open(detail(), [summary({ unreadReplies: 1 }), summary({ id: 8, unreadReplies: 3 })]);
    const tags = [...view.element.querySelectorAll(".bug-row .chip")].map((c) => c.textContent);
    expect(tags).toEqual(["New reply", "3 new replies"]);
  });

  it("sends a message to the player and shows it in the thread", async () => {
    const { view, said } = await open(detail());
    await view.show(7);
    routes["POST /admin/bugreports/7/reply"] = (body: { message: string }) => ({
      error: 0,
      report: detail({
        thread: [{ id: "5", from: "team", text: body.message, at: "2026-10-23T09:00:00Z", unread: false }],
      }),
    });
    const box = view.element.querySelector<HTMLTextAreaElement>("#reply-text")!;
    const send = button(view.element, "Send");
    expect(send.disabled).toBe(true);
    type(box, "  Which wall was it?  ");
    expect(view.element.querySelector("#reply-count")?.textContent).toBe("22 / 580");
    send.click();
    await settle();
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: { message: "Which wall was it?" } });
    expect(view.element.querySelector(".bubble-team")?.textContent).toContain("Which wall was it?");
    expect(view.element.querySelector<HTMLTextAreaElement>("#reply-text")?.value).toBe("");
    expect(said).toContain("Sent to MonsterMash's Mail in the game");
  });

  it("keeps a half-written message when the status is changed", async () => {
    const { view } = await open(detail());
    await view.show(7);
    type(view.element.querySelector<HTMLTextAreaElement>("#reply-text")!, "Half a thought");
    routes["POST /admin/bugreports/7/ticket"] = { error: 0, report: detail({ status: "working" }) };
    view.element.querySelector<HTMLButtonElement>(".status-working")!.click();
    await settle();
    expect(view.element.querySelector(".status-working")?.getAttribute("aria-pressed")).toBe("true");
    expect(view.element.querySelector<HTMLTextAreaElement>("#reply-text")?.value).toBe("Half a thought");
  });

  it("says why a signed-out report cannot be answered in the game, with the email", async () => {
    const { view } = await open(
      detail({ userid: null, username: null, cannotReply: "signedOut", contactEmail: "pat@example.com" }),
    );
    await view.show(7);
    expect(view.element.querySelector("#reply-text")).toBeNull();
    expect(view.element.textContent).toContain("Sent while signed out");
    expect(view.element.querySelector("a[href='mailto:pat@example.com']")).not.toBeNull();
    // No player, so no Shiny either.
    expect(view.element.querySelector("form.award")).toBeNull();
  });

  it("gives Shiny from the report, shows it there and tells the Shiny log", async () => {
    const { view, said } = await open(detail());
    await view.show(7);
    routes["POST /admin/shiny"] = { error: 0, award: award(), already: false, report: detail({ awards: [award()] }) };
    const form = view.element.querySelector<HTMLFormElement>("form.award")!;
    type(form.querySelector<HTMLInputElement>(".amount-input")!, "250");
    type(form.querySelectorAll<HTMLInputElement>("input")[1]!, "Sorry for the lost troops");
    form.requestSubmit();
    await settle();
    expect(calls.at(-1)?.body).toMatchObject({ userid: 42, amount: 250, bugReportId: 7, reason: "Sorry for the lost troops" });
    expect(view.element.querySelector(".award-row")?.textContent).toContain("+250");
    expect(said).toEqual(["Gave 250 Shiny to MonsterMash", "award"]);
  });
});

describe("the Give Shiny form", () => {
  const mount = () => {
    const given: number[] = [];
    const form = awardForm({
      player: { userid: 42, username: "MonsterMash" },
      onGiven: (a) => given.push(a.amount),
    });
    document.body.append(form);
    const [amount, reason] = [...form.querySelectorAll<HTMLInputElement>("input")] as [HTMLInputElement, HTMLInputElement];
    return { form, amount, reason, given };
  };

  it("asks once more over 500, in place, and Cancel goes back", async () => {
    const { form, amount, reason } = mount();
    type(amount, "1500");
    type(reason, "Lost a whole yard to the wall bug");
    form.requestSubmit();
    const confirm = form.querySelector<HTMLElement>(".confirm")!;
    expect(confirm.hidden).toBe(false);
    expect(confirm.textContent).toContain("Give 1,500 Shiny to MonsterMash?");
    expect(document.activeElement?.textContent).toBe("Yes, give 1,500");
    expect(calls).toEqual([]);
    button(form, "Cancel").click();
    expect(confirm.hidden).toBe(true);
    expect(calls).toEqual([]);
  });

  it("gives once per press: a retry after a failure sends the same id, a new gift a new one", async () => {
    const { form, amount, reason, given } = mount();
    routes["POST /admin/shiny"] = [503, { error: "The server is busy." }];
    type(amount, "1500");
    type(reason, "Lost a whole yard");
    form.requestSubmit();
    button(form, "Yes, give 1,500").click();
    await settle();
    expect(form.querySelector(".form-error")?.textContent).toBe("Not given: The server is busy.");
    const first = calls.at(-1)!.body!["requestId"];
    expect(first).toMatch(/^[A-Za-z0-9-]{8,64}$/);

    routes["POST /admin/shiny"] = { error: 0, award: award({ amount: 1500 }), already: false };
    button(form, "Yes, give 1,500").click();
    await settle();
    expect(calls.at(-1)!.body!["requestId"]).toBe(first);
    expect(given).toEqual([1500]);
    expect(amount.value).toBe("");

    type(amount, "100");
    type(reason, "Thanks for the report");
    form.requestSubmit();
    await settle();
    expect(calls.at(-1)!.body!["requestId"]).not.toBe(first);
  });

  it("says what is missing before sending anything", () => {
    const { form, amount } = mount();
    type(amount, "50");
    form.requestSubmit();
    expect(form.querySelector(".form-error")?.textContent).toBe("Say why: the player sees it in the mail.");
    expect(calls).toEqual([]);
  });
});

describe("the Shiny section", () => {
  it("finds a player by name, gives, and lists every gift with the total", async () => {
    routes["GET /admin/shiny"] = {
      error: 0,
      awards: [award(), award({ id: 2, amount: 1000, bugReportId: null, username: "Zed", userid: 5 })],
      nextBefore: null,
      total: { awards: 2, shiny: 1250 },
    };
    routes["GET /admin/players"] = {
      error: 0,
      players: [
        { userid: 42, username: "MonsterMash", formerName: null, bot: false, lastSeenAt: null },
        { userid: 43, username: "NewName", formerName: "Monster_Masher", bot: false, lastSeenAt: null },
        { userid: 44, username: "monster_smash", formerName: null, bot: true, lastSeenAt: null },
      ],
    };
    const opened: number[] = [];
    const view = new ShinyView({ openReport: (id) => opened.push(id), say: () => {} });
    document.body.append(view.element);
    await view.refresh();
    expect(view.element.querySelector(".log-head")?.textContent).toContain("2 gifts · 1,250 Shiny in all");
    const rows = view.element.querySelectorAll(".award-log .award-row");
    expect(rows).toHaveLength(2);
    rows[0]!.querySelector("a")!.click();
    expect(opened).toEqual([7]);
    expect(rows[1]!.querySelector("a")).toBeNull();

    const search = view.element.querySelector<HTMLInputElement>("#player-search")!;
    search.value = "mons";
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await settle();
    expect(calls.find((c) => c.path.endsWith("/admin/players"))?.query.get("q")).toBe("mons");
    // A player found by a name they had before says so.
    expect(button(view.element, "NewName#43 · was called Monster_Masher · never played")).toBeDefined();
    // A bot is shown, marked, so it is never given to by mistake.
    expect(button(view.element, "monster_smash#44 · bot · never played")).toBeDefined();
    button(view.element, "MonsterMash#42 · never played").click();
    expect(view.element.querySelector(".picked-card")?.textContent).toContain("Giving to");
    expect(view.element.querySelector("form.award")).not.toBeNull();
  });
});

describe("light or dark", () => {
  it("follows the device until a choice is made, and remembers it on this device", () => {
    expect(readTheme()).toBe("auto");
    const picker = themePicker();
    document.body.append(picker);
    const select = picker.querySelector("select")!;
    select.value = "dark";
    select.dispatchEvent(new Event("change"));
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(picker.querySelector(".theme-word")?.textContent).toBe("Dark");
    select.value = "auto";
    select.dispatchEvent(new Event("change"));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("still switches when the browser blocks storage", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTheme()).toBe("auto");
    applyTheme("light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(spy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
