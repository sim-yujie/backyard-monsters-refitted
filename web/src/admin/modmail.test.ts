// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { ModMailView } from "./api";
import { ModMailSection } from "./modmail";

/**
 * The Moderator mail section (owner, beta 7): every message a moderator
 * sent, newest first, searched by moderator or player, paged back with
 * "Load more".
 */

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
}

let calls: Call[] = [];
/** Answers by the `before` asked: "" for the first page. */
let pages: Record<string, unknown>;
let failing = false;

const mail = (id: number, extra: Partial<ModMailView> = {}): ModMailView => ({
  id,
  sentAt: "2026-11-07T09:00:00.000Z",
  moderatorId: 30,
  moderatorName: "Alpha",
  recipientId: 2503,
  recipientName: "yardtester",
  threadid: 400 + id,
  newThread: true,
  messagetype: "message",
  subject: `Subject ${id}`,
  message: `Hello ${id}`,
  written: null,
  ...extra,
});

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 9 }));
  calls = [];
  failing = false;
  pages = { "": { error: 0, mails: [mail(5), mail(4, { written: "Hello d*mn", newThread: false })], next: 4 } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url, "http://localhost");
      const query = Object.fromEntries(parsed.searchParams);
      calls.push({ method: init.method ?? "GET", path: parsed.pathname, query });
      if (!parsed.pathname.endsWith("/admin/modmail")) return new Response("Not Found", { status: 404 });
      if (failing) return Response.json({ error: "Server down" }, { status: 500 });
      return Response.json(pages[query.before ?? ""] ?? { error: 0, mails: [], next: null });
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

const mount = async () => {
  const said: string[] = [];
  const view = new ModMailSection({ say: (message) => said.push(message) });
  document.body.append(view.element);
  await view.refresh();
  return { view, said };
};

const rows = (view: ModMailSection) => [...view.element.querySelectorAll(".modmail-row")];
const more = (view: ModMailSection) => view.element.querySelector<HTMLButtonElement>(".modmail-more")!;

describe("the Moderator mail section", () => {
  it("lists each message: moderator to player, the subject, the words, and what the filter changed", async () => {
    const { view } = await mount();
    expect(rows(view)).toHaveLength(2);
    const [first, second] = rows(view);
    expect(first!.querySelector(".row-title")?.textContent).toBe("ModAlpha→yardtester");
    expect(first!.querySelector(".row-meta")?.textContent).toBe("#30 → #2503 · new thread · thread 405");
    expect(first!.querySelector(".modmail-row__subject")?.textContent).toBe("Subject 5");
    expect(first!.querySelector(".modmail-row__text")?.textContent).toBe("Hello 5");
    expect(first!.querySelector(".modmail-row__written")).toBeNull();
    expect(second!.querySelector(".row-meta")?.textContent).toContain("reply");
    expect(second!.querySelector(".modmail-row__written")?.textContent).toBe("Written as Hello d*mn");
    expect(first!.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-07T09:00:00.000Z");
  });

  it("names a truce request as one", async () => {
    pages[""] = { error: 0, mails: [mail(7, { messagetype: "trucerequest" })], next: null };
    const { view } = await mount();
    expect(rows(view)[0]!.querySelector(".row-meta")?.textContent).toContain("Truce request");
  });

  it("pages back with Load more, and hides it at the end", async () => {
    pages["4"] = { error: 0, mails: [mail(3)], next: null };
    const { view } = await mount();
    expect(more(view).hidden).toBe(false);
    more(view).click();
    await settle();
    expect(calls.at(-1)!.query).toEqual({ before: "4" });
    expect(rows(view)).toHaveLength(3);
    expect(more(view).hidden).toBe(true);
  });

  it("searches by moderator and player, and keeps the search when paging", async () => {
    const { view } = await mount();
    view.element.querySelector<HTMLInputElement>("#modmail-moderator")!.value = " alpha ";
    view.element.querySelector<HTMLInputElement>("#modmail-recipient")!.value = "#2503";
    view.element.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await settle();
    expect(calls.at(-1)!.query).toEqual({ moderator: "alpha", recipient: "#2503" });
    more(view).click();
    await settle();
    expect(calls.at(-1)!.query).toEqual({ moderator: "alpha", recipient: "#2503", before: "4" });
  });

  it("says so when nothing was sent, or nothing matches", async () => {
    pages[""] = { error: 0, mails: [], next: null };
    const { view } = await mount();
    expect(view.element.querySelector(".modmail-list")?.textContent).toBe("No moderator mail yet.");
    expect(more(view).hidden).toBe(true);
    view.element.querySelector<HTMLInputElement>("#modmail-moderator")!.value = "nobody";
    view.element.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await settle();
    expect(view.element.querySelector(".modmail-list")?.textContent).toBe("No moderator mail matches.");
  });

  it("says when the list cannot load", async () => {
    failing = true;
    const { view } = await mount();
    expect(view.element.querySelector(".modmail-list")?.textContent).toMatch(/^Could not load moderator mail: /);
  });
});
