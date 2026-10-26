// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import fixture from "../../test/fixtures/admin-dashboard.json";
import { boot, readRoute, sectionLevels } from "./main";
import type { TopItem } from "./problems";

/**
 * Who sees the dashboard: only the owner. Without a session, or when the
 * server's owner check answers 404, the page says "Not found" and nothing else.
 */

const notFoundResponse = () =>
  new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });

describe("the address", () => {
  it("reads a section and a bug report", () => {
    expect(readRoute("", "#errors")).toEqual({ bug: null, section: "errors" });
    expect(readRoute("?bug=41", "#bugs")).toEqual({ bug: 41, section: "bugs" });
    expect(readRoute("?bug=41", "")).toEqual({ bug: 41, section: "bugs" });
    expect(readRoute("?bug=x", "#nothing")).toEqual({ bug: null, section: null });
    expect(readRoute("?bug=-3", "#health")).toEqual({ bug: null, section: "health" });
  });
});

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
    return null;
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
    expect(box.querySelector("h2")?.textContent).toBe("1 problem needs you");
    expect(box.textContent).toContain("Last night's backup did not happen");
    expect(box.textContent).toContain("Telegram alerts are off");
    // The first real problem opens its "What to do" by itself, with a command to copy.
    const fix = box.querySelector<HTMLDetailsElement>("details.fix");
    expect(fix?.open).toBe(true);
    expect(fix?.querySelector("code")?.textContent).toBe("deploy/prod.sh exec backup bash /backup.sh");
    expect(fix?.querySelector("button.copy")?.getAttribute("aria-label")).toMatch(/^Copy: /);
  });

  it("has the Shiny section in the links, and the light or dark switch in the header", async () => {
    await boot();
    await settle();
    expect(document.querySelector(".nav a[href='#shiny']")?.textContent).toBe("Shiny");
    expect(document.getElementById("shiny")?.querySelector("#player-search")).not.toBeNull();
    const select = document.querySelector<HTMLSelectElement>(".top .theme-pick select")!;
    expect([...select.options].map((o) => o.value)).toEqual(["auto", "light", "dark"]);
    expect(select.value).toBe("auto");
  });

  it("keeps the technical words behind Technical details", async () => {
    await boot();
    await settle();
    const health = document.getElementById("health")!;
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
    expect(box().querySelector("h2")?.textContent).toBe("1 problem needs you");

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

    expect(box().querySelector("h2")?.textContent).toBe("1 problem needs you");
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
    expect(box().querySelector("h2")?.textContent).toBe("1 problem needs you");
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
