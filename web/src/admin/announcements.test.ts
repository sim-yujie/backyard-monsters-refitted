// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAnnouncement } from "./api";
import {
  AnnouncementsView,
  draftProblem,
  formOf,
  fromLocalInput,
  pictureProblem,
  standing,
  toLocalInput,
  type Draft,
} from "./announcements";

/**
 * The dashboard's Announcements section: the form's checks, what Save sends,
 * where each announcement stands, and the preview drawn by the game's code.
 */

const LIMITS = { titleMax: 80, bodyMax: 2000, images: 3, imageBytesMax: 1_000_000 };

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
let items: AdminAnnouncement[] = [];

const saved = (over: Partial<AdminAnnouncement> = {}): AdminAnnouncement => ({
  id: 4,
  title: "The game is free",
  body: "Free to play.\nAlways.",
  status: "published",
  startsAt: null,
  endsAt: null,
  publishedAt: "2026-10-28T09:00:00Z",
  createdAt: "2026-10-28T09:00:00Z",
  updatedAt: "2026-10-28T09:00:00Z",
  imageIds: [],
  live: true,
  dismissals: 12,
  ...over,
});

const draft = (over: Partial<Draft> = {}): Draft => ({
  title: "Hello",
  body: "Words",
  status: "draft",
  startsAt: "",
  endsAt: "",
  pictures: [],
  ...over,
});

beforeEach(() => {
  document.body.replaceChildren();
  calls = [];
  items = [];
  // jsdom has no blob URLs.
  URL.createObjectURL = () => "blob:picture";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, "http://localhost").pathname;
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, path, body });
      if (path.includes("/images/")) return new Response(new Blob(["png"], { type: "image/png" }));
      if (method === "GET") return Response.json({ error: 0, announcements: items, limits: LIMITS });
      if (method === "DELETE") return Response.json({ error: 0, id: 4 });
      return Response.json({ error: 0, announcement: saved({ ...(body as Partial<AdminAnnouncement>), imageIds: [] }) });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const button = (root: ParentNode, text: string): HTMLButtonElement =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;

describe("the form's checks", () => {
  it("needs a title and text within the limits, and an end after the start", () => {
    expect(draftProblem(draft(), LIMITS)).toBeNull();
    expect(draftProblem(draft({ title: " " }), LIMITS)).toBe("Give it a title.");
    expect(draftProblem(draft({ body: "" }), LIMITS)).toBe("Write what it says.");
    expect(draftProblem(draft({ title: "x".repeat(81) }), LIMITS)).toContain("80");
    expect(draftProblem(draft({ startsAt: "2026-11-02T10:00", endsAt: "2026-11-01T10:00" }), LIMITS)).toBe(
      "The end time must be after the start time.",
    );
  });

  it("takes PNG, JPEG and WebP pictures only", () => {
    expect(pictureProblem({ type: "image/png", size: 5_000 })).toBeNull();
    expect(pictureProblem({ type: "image/webp", size: 5_000 })).toBeNull();
    expect(pictureProblem({ type: "image/gif", size: 5_000 })).toBe("Pick a PNG, JPEG or WebP picture.");
    expect(pictureProblem({ type: "image/jpeg", size: 50_000_000 })).toContain("too big");
  });

  it("turns the owner's local times into ISO and back", () => {
    const iso = fromLocalInput("2026-11-01T18:30")!;
    expect(toLocalInput(iso)).toBe("2026-11-01T18:30");
    expect(fromLocalInput("")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });

  it("sends kept pictures by id and new ones as data, in order", () => {
    const form = formOf(
      draft({
        title: "  Hi ",
        status: "published",
        pictures: [
          { kind: "new", data: "data:image/png;base64,AAAA", src: "data:image/png;base64,AAAA" },
          { kind: "saved", id: 9, src: "blob:x" },
        ],
      }),
    );
    expect(form).toEqual({
      title: "Hi",
      body: "Words",
      status: "published",
      startsAt: null,
      endsAt: null,
      images: [{ data: "data:image/png;base64,AAAA" }, { keep: 9 }],
    });
  });
});

describe("standing", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  it("says Draft, Live, Starts or Ended", () => {
    expect(standing(saved({ status: "draft", live: false }), now).word).toBe("Draft");
    expect(standing(saved(), now)).toEqual({ word: "Live", tone: "good" });
    expect(standing(saved({ live: false, startsAt: "2026-11-05T12:00:00Z" }), now).word).toMatch(/^Starts /);
    expect(standing(saved({ live: false, endsAt: "2026-10-30T12:00:00Z" }), now).word).toBe("Ended");
  });
});

describe("AnnouncementsView", () => {
  it("lists the announcements with where they stand and how many pressed Got it", async () => {
    items = [saved(), saved({ id: 5, title: "Patch on Friday", status: "draft", live: false, dismissals: 0 })];
    const view = new AnnouncementsView({ say: vi.fn() });
    document.body.append(view.element);
    await view.refresh();
    const rows = [...view.element.querySelectorAll(".ann-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Live");
    expect(rows[0]!.textContent).toContain("12 pressed Got it");
    expect(rows[1]!.textContent).toContain("Draft");
    expect(rows[1]!.textContent).not.toContain("pressed Got it");
  });

  it("writes a new one: the preview follows the typing, text as text with links, and Save posts it", async () => {
    const say = vi.fn();
    const view = new AnnouncementsView({ say });
    document.body.append(view.element);
    await view.refresh();
    button(view.element, "New announcement").click();
    await settle();

    const title = view.element.querySelector<HTMLInputElement>("input[id^='ann-title']")!;
    const body = view.element.querySelector<HTMLTextAreaElement>("textarea")!;
    title.value = "The game is free";
    title.dispatchEvent(new Event("input"));
    body.value = "<b>Free</b> forever.\n\nJoin us: https://discord.gg/wthryBRZHz";
    body.dispatchEvent(new Event("input"));

    const preview = view.element.querySelector(".ann-preview")!;
    expect(preview.querySelector(".ann-preview-title")?.textContent).toBe("The game is free");
    expect(preview.querySelector("b")).toBeNull();
    expect(preview.querySelectorAll(".announcement__paragraph")).toHaveLength(2);
    expect(preview.querySelector("a")?.getAttribute("href")).toBe("https://discord.gg/wthryBRZHz");

    button(view.element, "Published").click();
    view.element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toMatch(/\/admin\/announcements$/);
    expect(post.body).toMatchObject({ title: "The game is free", status: "published", images: [], startsAt: null });
    expect(say).toHaveBeenCalledWith("Saved. Players see it now.");
    expect(view.element.querySelector("form")).toBeNull();
  });

  it("refuses to save an empty form and says why", async () => {
    const view = new AnnouncementsView({ say: vi.fn() });
    await view.refresh();
    await view.edit(null);
    view.element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(view.element.querySelector(".form-error")?.textContent).toBe("Give it a title.");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("edits a saved one with its pictures and sends a change with PUT", async () => {
    items = [saved({ imageIds: [9] })];
    const view = new AnnouncementsView({ say: vi.fn() });
    await view.refresh();
    await view.edit(4);
    await settle();
    expect(view.element.querySelector<HTMLImageElement>(".ann-thumb img")?.getAttribute("src")).toBe("blob:picture");
    expect(view.element.querySelector<HTMLImageElement>(".ann-preview .announcement__image")?.getAttribute("src")).toBe(
      "blob:picture",
    );
    view.element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.path).toMatch(/\/admin\/announcements\/4$/);
    expect(put.body).toMatchObject({ title: "The game is free", images: [{ keep: 9 }] });
  });

  it("asks once more before deleting", async () => {
    items = [saved()];
    const say = vi.fn();
    const view = new AnnouncementsView({ say });
    await view.refresh();
    button(view.element, "Delete").click();
    expect(view.element.textContent).toContain("Delete for everyone?");
    button(view.element, "Keep").click();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    button(view.element, "Delete").click();
    view.element.querySelector<HTMLButtonElement>(".button.danger")!.click();
    await settle();
    expect(calls.find((c) => c.method === "DELETE")?.path).toMatch(/\/admin\/announcements\/4$/);
    expect(say).toHaveBeenCalledWith("Deleted. Players no longer see it.");
  });
});
