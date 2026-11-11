// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import fixture from "../../test/fixtures/admin-dashboard.json";
import { boot, sectionLevels } from "./main";
import type { TopItem } from "./problems";
import { routeNames } from "./views";

/**
 * Who sees the dashboard: only the owner. Without a session, or when the
 * server's owner check answers 404, the page says "Not found" and nothing else.
 */

const notFoundResponse = () =>
  new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });

describe("the section links", () => {
  it("take the worst state of each section's problems", () => {
    const item = (level: TopItem["level"], section: TopItem["section"]): TopItem => ({
      level,
      section,
      key: `${section}-${level}`,
      title: "",
      detail: "",
      steps: [],
    });
    expect(sectionLevels([])).toEqual({});
    expect(
      sectionLevels([item("warn", "health"), item("bad", "health"), item("warn", "health"), item("warn", "backups")]),
    ).toEqual({ health: "bad", backups: "warn" });
  });
});

describe("who sees the dashboard", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows only Not found without a session, and asks the server nothing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await boot();
    expect(document.title).toBe("Not found");
    expect(document.body.textContent).toBe(
      "Not foundThere is nothing at this address.Go to the game",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows only Not found when the server says the player is not the owner", async () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: "player-token", userId: 2 }),
    );
    const fetch = vi.fn(async () => notFoundResponse());
    vi.stubGlobal("fetch", fetch);
    await boot();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/admin\/me$/);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer player-token");
    expect(document.title).toBe("Not found");
    expect(document.body.textContent).not.toMatch(/dashboard|admin|health|bug/i);
  });
});

describe("the owner's first look", () => {
  /** The server's answers, by route, from a test server with made-up data. */
  const answer = (url: string): unknown => {
    const path = new URL(url, "http://localhost").pathname;
    if (path.endsWith("/admin/me")) return fixture.me;
    if (path.endsWith("/admin/health")) return fixture.health;
    if (path.endsWith("/admin/stats/overview")) return fixture.overview;
    if (path.endsWith("/admin/bugreports")) return fixture.bugReports;
    if (path.endsWith("/admin/errors")) return fixture.errors;
    if (path.endsWith("/admin/inbox")) return inbox;
    if (path.endsWith("/admin/inbox/closed")) return { ok: true, decisions: [], nextOffset: null, count: 2 };
    return null;
  };

  /**
   * Three players waiting: TrollKing88 has 2 reported lines, one of them also
   * caught by the word filter, and 2 lines only the filter caught (4 lines,
   * counted once each).
   */
  const inbox = {
    ok: true,
    players: [
      {
        userid: 42, username: "TrollKing88", banned: false, muted: false, gameTeam: false, caseId: 7,
        reportedMessages: 2, reports: 4, uniqueReporters: 4, filterLines: 3, alsoReported: 1, filterOnlyLines: 2,
        messages: 4, slurs: 0, flagsUpTo: 905,
        previousActions: 1, lastAction: null, oldestAt: "2026-11-04T10:00:00Z", latestAt: "2026-11-04T12:00:00Z",
        preview: { text: "you are all trash", source: "report" }, suggest: { action: "mute", hours: 24 },
      },
    ],
    nextOffset: null,
    counts: { all: 3, reports: 2, filter: 1 },
  };

  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: "owner-token", userId: 2505 }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = answer(url);
        return body === null ? notFoundResponse() : Response.json(body);
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

  it("says in one sentence what is wrong, and what to do about it", async () => {
    await boot();
    await settle();
    const box = document.getElementById("problems")!;
    expect(box.querySelector("h2")?.textContent).toBe("1 problem needs you, 1 warning");
    expect(box.textContent).toContain("Last night's backup did not happen");
    expect(box.textContent).toContain("Telegram alerts are off");
    // The first real problem opens its "What to do" by itself, with a command to copy.
    const fix = box.querySelector<HTMLDetailsElement>("details.fix");
    expect(fix?.open).toBe(true);
    expect(fix?.querySelector("code")?.textContent).toBe("deploy/prod.sh exec backup bash /backup.sh");
    expect(fix?.querySelector("button.copy")?.getAttribute("aria-label")).toMatch(/^Copy: /);
  });

  it("keeps the server to one line, with its problems a tap away, and puts the waiting work below", async () => {
    await boot();
    await settle();
    const box = document.getElementById("problems")!;
    const list = box.querySelector<HTMLElement>(".issues")!;
    expect(list.hidden).toBe(true);
    const toggle = box.querySelector<HTMLButtonElement>(".verdict-toggle")!;
    expect(toggle.textContent).toBe("What to do");
    toggle.click();
    expect(list.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // "What needs you now": each player once, split by where they came from (2 + 1 = 3).
    const needs = document.getElementById("home-needs")!;
    const cards = needs.querySelectorAll("a.needs-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.getAttribute("href")).toBe("#moderation");
    expect(cards[0]!.textContent).toContain("3 players to review");
    expect(cards[0]!.textContent).toContain("2 reported by players · 1 caught by the word filter");
    // Moderation's menu link carries the players waiting, counted once.
    const link = document.querySelector(".nav a[data-page='moderation']")!;
    expect(link.textContent).toContain("Moderation");
    expect(link.querySelector(".count")?.textContent).toContain("3");
    // The list's filters count players too, Closed from the last 30 days.
    const segs = [...document.querySelectorAll<HTMLButtonElement>("#view-moderation .filter-grid .seg")].map((b) => b.textContent);
    expect(segs).toEqual(["All 3", "Player reports 2", "Word filter 1", "Closed 2"]);
    // A row counts each line once: 4 messages, 4 reports, 2 lines only the filter caught.
    const row = document.querySelector("#view-moderation a.q-row[data-player='42']")!;
    expect(row.textContent).toContain("4 messages · 4 reports from 4 players · 2 word-filter catches");
    expect(row.textContent).toContain("Player reports");
    expect(row.textContent).toContain("Word filter");
  });

  it("has the six pages in the menu, each part a tab under its title, and the light or dark switch on top", async () => {
    await boot();
    await settle();
    expect([...document.querySelectorAll(".nav a .nav-label")].map((l) => l.textContent)).toEqual([
      "Home",
      "Moderation",
      "Player support",
      "Announcements",
      "Game activity",
      "Server health",
    ]);
    expect(document.querySelector("#view-shiny .subnav a[href='#shiny']")?.textContent).toBe("Give Shiny");
    expect(document.getElementById("view-shiny")?.querySelector("#player-search")).not.toBeNull();
    expect(document.querySelector("#view-find .subnav a[href='#find']")?.textContent).toBe("Find a player");
    expect(document.getElementById("view-find")?.querySelector("#mod-search")).not.toBeNull();
    expect(document.querySelector("#view-chat .subnav a[href='#chat']")?.textContent).toBe("Game chat");
    expect(document.getElementById("view-chat")?.textContent).toContain("Join chat");
    expect(document.querySelector("#view-chat h1")?.textContent).toContain("Player support");
    const select = document.querySelector<HTMLSelectElement>(".topbar .theme-pick select")!;
    expect([...select.options].map((o) => o.value)).toEqual(["auto", "light", "dark"]);
    expect(select.value).toBe("auto");
  });

  it("shows beta 7's Photo reports as a Moderation tab and Weekend events as an Announcements tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (new URL(url, "http://localhost").pathname.endsWith("/admin/photoreports")) {
          return Response.json({ ok: true, cases: [], open: 2, nextOffset: null, hideAt: 3 });
        }
        const body = answer(url);
        return body === null ? notFoundResponse() : Response.json(body);
      }),
    );
    await boot();
    await settle();
    const tabs = (view: string) =>
      [...document.querySelectorAll(`#view-${view} .subnav a .nav-state`)].map((s) => s.previousElementSibling?.textContent);
    expect(tabs("photos")).toEqual(["Review", "Photo reports", "Find a player", "Attack log", "Moderators", "Moderator mail"]);
    expect(tabs("events")).toEqual(["Announcements", "Events"]);
    // The tab and the heading count the players with open photo reports.
    expect(document.querySelector("#view-moderation .subnav a[href='#photos'] .count")?.textContent).toContain("2");
    expect(document.querySelector("#view-photos h1")?.textContent).toContain("2 photo reports");
    // Moderation's menu link counts them with the 3 players in the list.
    expect(document.querySelector(".nav a[data-page='moderation'] .count")?.textContent).toContain("5");
    expect(document.getElementById("home-needs")?.textContent).toContain("Also 2 reported profile photos");
    const shown = () => [...document.querySelectorAll<HTMLElement>(".page > .view")].filter((v) => !v.hidden).map((v) => v.dataset.view);
    const current = () => document.querySelector(".nav a[aria-current]")?.getAttribute("data-page");
    location.hash = "#photos";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(shown()).toEqual(["photos"]);
    expect(current()).toBe("moderation");
    expect(document.getElementById("view-photos")?.querySelector(".photos")).not.toBeNull();
    // `#weekend` was the Weekend events view's address before it became a tab.
    location.hash = "#weekend";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(shown()).toEqual(["events"]);
    expect(current()).toBe("announcements");
    expect(document.getElementById("view-events")?.querySelector(".weekend-admin")).not.toBeNull();
    location.hash = "";
  });

  it("gives no element an id the address can name, so a direct link opens at the top", async () => {
    await boot();
    await settle();
    // Open every view, so ids that only appear once a view has drawn are checked too.
    for (const name of routeNames()) {
      location.hash = `#${name}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    await settle();
    const ids = new Set([...document.querySelectorAll("[id]")].map((e) => e.id));
    expect(routeNames().filter((name) => ids.has(name))).toEqual([]);
    expect(document.getElementById("view-chat")?.dataset.view).toBe("chat");
    location.hash = "";
  });

  it("opens on Home, shows one view at a time, and follows the address", async () => {
    await boot();
    await settle();
    const shown = () => [...document.querySelectorAll<HTMLElement>(".page > .view")].filter((v) => !v.hidden).map((v) => v.dataset.view);
    const current = () => document.querySelector(".nav a[aria-current]")?.getAttribute("data-page");
    expect(shown()).toEqual(["home"]);
    expect(current()).toBe("home");
    location.hash = "#errors";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    // Server health is one page: the old Errors tab's address (Telegram alerts) lands on it, with no tabs.
    expect(shown()).toEqual(["health"]);
    expect(current()).toBe("server");
    expect(document.querySelector("#view-health .subnav")).toBeNull();
    // On a phone, Menu opens the six pages; picking one closes it.
    const menu = document.querySelector<HTMLButtonElement>(".menu-toggle")!;
    menu.click();
    expect(document.querySelector(".side")!.classList.contains("is-open")).toBe(true);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    location.hash = "#bugs";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(shown()).toEqual(["bugs"]);
    expect(document.querySelector(".side")!.classList.contains("is-open")).toBe(false);
    expect(current()).toBe("support");
    // Older links still land: the inbox is now Moderation's list.
    location.hash = "#inbox";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(shown()).toEqual(["moderation"]);
    expect(current()).toBe("moderation");
    location.hash = "";
  });

  it("shows Server health as one page of six cards, each with when it was last checked, and the error list below", async () => {
    await boot();
    await settle();
    const page = document.getElementById("view-health")!;
    const cards = [...page.querySelectorAll<HTMLElement>(".server-card")];
    expect(cards.map((c) => c.querySelector("h2")?.textContent)).toEqual([
      "Game server",
      "Database",
      "Disk",
      "Backups",
      "Recorded errors",
      "Machine health report",
    ]);
    for (const card of cards) expect(card.querySelector(".last-checked")?.textContent).toMatch(/^Last checked \d+ \w+ \d\d:\d\d$/);
    const card = (id: string) => page.querySelector<HTMLElement>(`.server-card[data-card='${id}']`)!;
    expect(card("server").querySelector(".badge")?.textContent).toBe("Running");
    expect(card("database").textContent).toContain("Game data can be read and saved.");
    // 86% full is worth a look; a backup 31 hours old is overdue.
    expect(card("disk").querySelector(".badge")?.textContent).toBe("86% used");
    expect(card("disk").classList.contains("is-warn")).toBe(true);
    expect(card("backups").querySelector(".badge")?.textContent).toBe("Overdue");
    expect(card("backups").classList.contains("is-bad")).toBe(true);
    expect(card("backups").textContent).toContain("1 half-written file");
    // The error totals come from the list's own answer (311 in browsers + 16 on the server).
    expect(card("errors").querySelector(".badge")?.textContent).toBe("327 recorded");
    expect(card("errors").textContent).toContain("311 in players' browsers, 16 on the game server");
    expect(card("machine").querySelector(".badge")?.textContent).toBe("Received");
    // The server's parts, Telegram and the error list stay on the page.
    expect(page.textContent).toContain("The server's parts");
    expect(page.textContent).toContain("Telegram alerts");
    expect(page.querySelector("#health-errors .errors")).not.toBeNull();
    // The menu marks Server health with its worst problem (the missed backup).
    expect(document.querySelector(".nav a[data-page='server'] .mark-bad")).not.toBeNull();
  });

  it("keeps what was typed in a view while another is on show", async () => {
    await boot();
    await settle();
    location.hash = "#moderation";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const search = document.querySelector<HTMLInputElement>("#mod-search")!;
    search.value = "Mud";
    location.hash = "#errors";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(document.getElementById("view-moderation")!.hidden).toBe(true);
    location.hash = "#moderation";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(document.querySelector<HTMLInputElement>("#mod-search")!.value).toBe("Mud");
    location.hash = "";
  });

  it("shows Game activity as the mock-up's panels: players with big numbers, gameplay as a table with honest gaps", async () => {
    await boot();
    await settle();
    const titles = (id: string) => [...document.querySelectorAll(`#view-${id} .activity-panel h2`)].map((t) => t.textContent);
    expect(titles("players")).toEqual(["Players", "Players each day", "Player preferences"]);
    expect([...document.querySelectorAll("#view-players .metric span:not(.metric-sub)")].map((t) => t.textContent)).toEqual([
      "played today",
      "new today",
      "played in the last 7 days",
      "players in all",
    ]);
    expect(document.querySelector("#view-players .activity-head .small")?.textContent).toMatch(/^Last updated /);
    expect(titles("activity")).toEqual(["Gameplay today", "Gameplay each day"]);
    const row = (name: string) =>
      [...document.querySelectorAll<HTMLTableRowElement>("#view-activity .data-table tbody tr")].find(
        (tr) => tr.querySelector("th")?.textContent === name,
      )!;
    expect(row("Bug reports").querySelectorAll("td")[0]!.textContent).toBe("3");
    expect(row("Player reports").querySelectorAll("td")[0]!.textContent).toBe("Not counted per day");
    expect(row("Goo and other resources spent").querySelectorAll("td")[0]!.textContent).toBe("Not recorded");
    // On a phone each row stacks; the numbers carry their column's name with them.
    expect([...row("Attacks").querySelectorAll("td")].map((td) => td.dataset.label ?? td.className)).toEqual([
      "Today",
      "Yesterday",
      "means",
    ]);
  });

  it("keeps the technical words behind Technical details", async () => {
    await boot();
    await settle();
    const health = document.getElementById("view-health")!;
    expect(health.textContent).toContain("Game server");
    for (const word of ["f8304513abead896", "bun 1.4.2", "bymr-sgp1"]) {
      const places = [...document.querySelectorAll("body *")].filter(
        (el) => el.childElementCount === 0 && el.textContent?.includes(word),
      );
      expect(places.length, word).toBeGreaterThan(0);
      for (const place of places) expect(place.closest("details.tech"), word).not.toBeNull();
    }
  });
});

describe("when the health cannot be read (26 Oct)", () => {
  /**
   * The game keeps one sign-in per account: opening it again makes a new
   * token, and the server then answers the dashboard's old one with the same
   * 404 it gives anyone it does not let in. That is the sign-in running out,
   * not the server being down.
   */
  let accepted: string;
  let fetch: ReturnType<typeof vi.fn>;

  const answer = (url: string, init?: RequestInit): Response => {
    const path = new URL(url, "http://localhost").pathname;
    if (new Headers(init?.headers).get("Authorization") !== `Bearer ${accepted}`) {
      return notFoundResponse();
    }
    if (path.endsWith("/admin/me")) return Response.json(fixture.me);
    if (path.endsWith("/admin/health")) return Response.json(fixture.health);
    if (path.endsWith("/admin/stats/overview")) return Response.json(fixture.overview);
    if (path.endsWith("/admin/bugreports")) return Response.json(fixture.bugReports);
    if (path.endsWith("/admin/errors")) return Response.json(fixture.errors);
    return notFoundResponse();
  };

  const saveSession = (token: string) =>
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token, userId: 2505 }));

  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const box = () => document.getElementById("problems")!;
  /** The header's refresh button: checks everything again now. */
  const refresh = () => document.querySelector<HTMLButtonElement>(".top-actions button")!.click();

  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    accepted = "first-token";
    saveSession("first-token");
    fetch = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));
    vi.stubGlobal("fetch", fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("says the sign-in ran out, not that the server may be down, and offers to sign in again", async () => {
    await boot();
    await settle();
    expect(box().querySelector("h2")?.textContent).toBe("1 problem needs you, 1 warning");

    // The game signs in again on another device: this browser keeps the old token.
    accepted = "other-device-token";
    refresh();
    await settle();

    expect(box().querySelector("h2")?.textContent).toBe("Your dashboard sign-in has run out");
    expect(box().textContent).toContain("The server is up");
    expect(box().textContent).not.toMatch(/down|restarting/);
    const signIn = [...box().querySelectorAll("a")].find((a) => a.textContent === "Sign in again");
    expect(signIn?.getAttribute("href")).toBe("/");
  });

  it("takes up the game's newer sign-in from this browser by itself and carries on", async () => {
    await boot();
    await settle();

    // The game opens in another tab of this browser and saves its new token.
    accepted = "game-token";
    saveSession("game-token");
    refresh();
    await settle();

    expect(box().querySelector("h2")?.textContent).toBe("1 problem needs you, 1 warning");
    const last = fetch.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(new Headers(last[1].headers).get("Authorization")).toBe("Bearer game-token");
  });

  it("recovers as soon as the game signs in again in another tab", async () => {
    await boot();
    await settle();
    accepted = "other-device-token";
    refresh();
    await settle();
    expect(box().querySelector("h2")?.textContent).toBe("Your dashboard sign-in has run out");

    accepted = "game-token";
    saveSession("game-token");
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_STORAGE_KEY }));
    await settle();
    expect(box().querySelector("h2")?.textContent).toBe("1 problem needs you, 1 warning");
  });

  it("says the server could not be reached only when nothing answers", async () => {
    await boot();
    await settle();
    fetch.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    refresh();
    await settle();
    expect(box().querySelector("h2")?.textContent).toBe("The server could not be reached");
    expect(box().textContent).toContain("may be down or restarting");
    expect(box().textContent).not.toContain("Sign in again");
  });

  it("counts a proxy's 502 as the server not being reached", async () => {
    await boot();
    await settle();
    fetch.mockImplementation(async () => new Response("Bad Gateway", { status: 502 }));
    refresh();
    await settle();
    expect(box().querySelector("h2")?.textContent).toBe("The server could not be reached");
  });
});
