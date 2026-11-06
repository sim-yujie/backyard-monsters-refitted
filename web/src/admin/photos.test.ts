// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { PhotoCaseView } from "./api";
import { closedWords, PhotosView, reporterWords } from "./photos";

/**
 * The dashboard's Photo reports: the cards from the server, the buttons that
 * act on a photo, and the words for who reported and how a case closed.
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

const photoCase = (over: Partial<PhotoCaseView> = {}): PhotoCaseView => ({
  userid: 42,
  username: "Snapper",
  banned: false,
  photo: "data:image/jpeg;base64,AAAA",
  photoVersion: 2,
  hidden: true,
  blocked: false,
  kept: false,
  reporters: [
    { userid: 5, username: "a", at: "2026-11-06T10:00:00Z", version: 2 },
    { userid: 6, username: null, at: "2026-11-06T09:00:00Z", version: 1 },
  ],
  firstReportAt: "2026-11-06T09:00:00Z",
  lastReportAt: "2026-11-06T10:00:00Z",
  closed: null,
  ...over,
});

const build = () => {
  const say = vi.fn();
  const onCount = vi.fn();
  const openPlayer = vi.fn();
  const view = new PhotosView({ say, onCount, openPlayer });
  document.body.append(view.element);
  return { view, say, onCount, openPlayer };
};

describe("Photo reports", () => {
  it("lists open cases with the photo, a Hidden mark and the reporters", async () => {
    answer = (call) =>
      call.path.endsWith("/photoreports") ? { error: 0, cases: [photoCase()], open: 1, nextOffset: null, hideAt: 3 } : undefined;
    const { view, onCount } = build();
    await view.refresh();
    expect(onCount).toHaveBeenCalledWith(1);
    const card = document.querySelector('[data-userid="42"]')!;
    expect(card.querySelector("img")?.getAttribute("src")).toContain("data:image/jpeg");
    expect(card.textContent).toContain("Hidden");
    expect(card.textContent).toContain("2 reports: a, #6 (older photo)");
    expect([...card.querySelectorAll("[data-action]")].map((b) => b.getAttribute("data-action"))).toEqual([
      "keep",
      "remove",
      "block",
    ]);
  });

  it("acts on a photo and loads the list again", async () => {
    let open = [photoCase()];
    answer = (call) => {
      if (call.method === "POST" && call.path.endsWith("/photoreports/42/act")) {
        open = [];
        return { error: 0, case: photoCase({ closed: { outcome: "kept", at: "2026-11-06T11:00:00Z", by: 9, byName: "owner" } }) };
      }
      if (call.path.endsWith("/photoreports")) return { error: 0, cases: open, open: open.length, nextOffset: null, hideAt: 3 };
      return undefined;
    };
    const { view, say } = build();
    await view.refresh();
    document.querySelector<HTMLButtonElement>('[data-action="keep"]')!.click();
    await settle();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ action: "keep" });
    expect(say).toHaveBeenCalledWith("Kept: Snapper");
    expect(document.querySelector('[data-userid="42"]')).toBeNull();
    expect(view.element.textContent).toContain("No photo reports to look at.");
  });

  it("offers Unblock for a blocked player", () => {
    const { view } = build();
    const card = view.item(photoCase({ photo: null, blocked: true, hidden: false }));
    expect([...card.querySelectorAll("[data-action]")].map((b) => b.getAttribute("data-action"))).toEqual(["unblock"]);
  });

  it("says when the list will not load", async () => {
    answer = () => undefined;
    const { view, onCount } = build();
    await view.refresh();
    expect(onCount).toHaveBeenCalledWith(null);
    expect(view.element.textContent).toContain("could not be loaded");
  });

  it("words the reporters and the outcome", () => {
    expect(reporterWords(photoCase())).toBe("a, #6 (older photo)");
    expect(closedWords({ outcome: "blocked", at: new Date().toISOString(), by: 9, byName: "owner" })).toMatch(
      /^Removed \+ blocked by owner, /,
    );
  });
});
