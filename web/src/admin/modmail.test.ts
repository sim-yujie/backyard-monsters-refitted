// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { ModConversation, ModConversationMessage, ModConversationSummary } from "./api";
import { ModMailSection, writtenText } from "./modmail";

/**
 * The Moderator mail section (owner, beta 7; conversations 8 Nov): one row
 * per moderator-player conversation, newest first, searched by moderator or
 * player, paged back with "Load more"; a row opens the whole conversation as
 * a chat, both sides in order.
 */

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
}

let calls: Call[] = [];
/** List answers by the `before` asked: "" for the first page. */
let pages: Record<string, unknown>;
/** Conversation answers by thread. */
let threads: Record<string, ModConversation>;
let failing = false;

const summary = (threadid: number, extra: Partial<ModConversationSummary> = {}): ModConversationSummary => ({
  threadid,
  moderatorId: 30,
  moderatorName: "Alpha",
  playerId: 2503,
  playerName: "yardtester",
  messages: 6,
  fromModerator: 3,
  startedAt: "2026-11-07T08:00:00.000Z",
  lastAt: "2026-11-07T09:00:00.000Z",
  lastSender: "player",
  lastSubject: "About chat",
  lastMessage: `Last words in ${threadid}`,
  lastType: "message",
  lastId: threadid * 10,
  ...extra,
});

const message = (id: number, extra: Partial<ModConversationMessage> = {}): ModConversationMessage => ({
  id,
  sentAt: "2026-11-07T08:00:00.000Z",
  sender: "moderator",
  senderId: 30,
  senderName: "Alpha",
  newThread: false,
  messagetype: "message",
  subject: "",
  message: `Words ${id}`,
  written: null,
  ...extra,
});

const conversation = (threadid: number, messages: ModConversationMessage[]): ModConversation => ({
  threadid,
  moderatorId: 30,
  moderatorName: "Alpha",
  playerId: 2503,
  playerName: "yardtester",
  messages,
  cut: false,
});

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 9 }));
  calls = [];
  failing = false;
  pages = {
    "": {
      error: 0,
      conversations: [summary(5), summary(4, { lastSender: "moderator", lastMessage: "Line one\nline two", messages: 1, fromModerator: 1 })],
      next: 40,
    },
  };
  threads = {
    "5": conversation(5, [
      message(1, { newThread: true, subject: "About chat", message: "Please stop spamming chat." }),
      message(2, { sender: "player", senderId: 2503, senderName: "yardtester", subject: "Re: About chat", message: "Sorry, I will." }),
      message(3, { subject: "Something else", message: "Thanks!", written: "Thanks d*mn | Thanks!" }),
    ]),
    "4": conversation(4, [message(1, { messagetype: "trucerequest", newThread: true })]),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url, "http://localhost");
      const query = Object.fromEntries(parsed.searchParams);
      calls.push({ method: init.method ?? "GET", path: parsed.pathname, query });
      if (failing) return Response.json({ error: "Server down" }, { status: 500 });
      const one = /\/admin\/modmail\/(\d+)$/.exec(parsed.pathname);
      if (one) {
        const found = threads[one[1]!];
        return found
          ? Response.json({ error: 0, conversation: found })
          : Response.json({ error: "No moderator mail in that conversation." }, { status: 404 });
      }
      if (!parsed.pathname.endsWith("/admin/modmail")) return new Response("Not Found", { status: 404 });
      return Response.json(pages[query.before ?? ""] ?? { error: 0, conversations: [], next: null });
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

const viewChanges: number[] = [];
const mount = async () => {
  const said: string[] = [];
  const view = new ModMailSection({ say: (message) => said.push(message), onViewChange: () => viewChanges.push(1) });
  document.body.append(view.element);
  await view.refresh();
  return { view, said };
};

const rows = (view: ModMailSection) => [...view.element.querySelectorAll<HTMLButtonElement>(".modmail-convo")];
const more = (view: ModMailSection) => view.element.querySelector<HTMLButtonElement>(".modmail-more")!;
const listShown = (view: ModMailSection) => !view.element.querySelector<HTMLElement>(".modmail-view:not(.modmail-open)")!.hidden;
const openView = (view: ModMailSection) => view.element.querySelector<HTMLElement>(".modmail-open")!;
const bubbles = (view: ModMailSection) => [...openView(view).querySelectorAll(".bubble")];

describe("the Moderator mail list", () => {
  it("shows one row per conversation: moderator to player, the count, the last time and a line of the last message", async () => {
    const { view } = await mount();
    expect(rows(view)).toHaveLength(2);
    const [first, second] = rows(view);
    expect(first!.querySelector(".modmail-between")?.textContent).toBe("ModAlpha→yardtester");
    expect(first!.querySelector(".modmail-convo__preview")?.textContent).toBe("yardtester: Last words in 5");
    expect(first!.querySelector(".row-meta")?.textContent).toMatch(
      /^6 messages · 3 from the moderator, 3 from the player · started /,
    );
    expect(first!.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-07T09:00:00.000Z");
    // A multi-line message is one line in the list, said by whoever wrote it.
    expect(second!.querySelector(".modmail-convo__preview")?.textContent).toBe("Alpha: Line one line two");
    expect(second!.querySelector(".row-meta")?.textContent).toMatch(/^1 message · 1 from the moderator, 0 from the player/);
  });

  it("pages back with Load more, and hides it at the end", async () => {
    pages["40"] = { error: 0, conversations: [summary(3)], next: null };
    const { view } = await mount();
    expect(more(view).hidden).toBe(false);
    more(view).click();
    await settle();
    expect(calls.at(-1)!.query).toEqual({ before: "40" });
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
    expect(calls.at(-1)!.query).toEqual({ moderator: "alpha", recipient: "#2503", before: "40" });
  });

  it("says so when nothing was sent, or nothing matches", async () => {
    pages[""] = { error: 0, conversations: [], next: null };
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

describe("an opened conversation", () => {
  it("shows both sides in order as a chat: sender, time and words, and what the filter changed", async () => {
    const { view } = await mount();
    rows(view)[0]!.click();
    await settle();
    expect(calls.at(-1)!.path).toMatch(/\/admin\/modmail\/5$/);
    expect(listShown(view)).toBe(false);
    expect(openView(view).hidden).toBe(false);
    expect(openView(view).querySelector(".modmail-thread__title")?.textContent).toBe("ModAlpha→yardtester");
    expect(openView(view).querySelector(".modmail-thread__head .row-meta")?.textContent).toBe(
      "#30 and #2503 · 3 messages · thread 5",
    );
    const [first, second, third] = bubbles(view);
    expect(bubbles(view)).toHaveLength(3);
    expect(first!.classList.contains("bubble-mod")).toBe(true);
    expect(first!.querySelector(".bubble-who")?.textContent).toMatch(/^ModAlpha · .+started the conversation$/);
    // The subject is said once, in the header; a bubble shows one only when it differs ("Re: " ignored).
    expect(openView(view).querySelector(".modmail-thread__subject")?.textContent).toBe("About chat");
    expect(first!.querySelector(".modmail-subject")).toBeNull();
    expect(second!.querySelector(".modmail-subject")).toBeNull();
    expect(third!.querySelector(".modmail-subject")?.textContent).toBe("Something else");
    expect(first!.querySelector(".bubble-text")?.textContent).toBe("Please stop spamming chat.");
    expect(first!.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-07T08:00:00.000Z");
    expect(second!.classList.contains("bubble-player")).toBe(true);
    expect(second!.querySelector(".bubble-who")?.textContent).toMatch(/^yardtester · /);
    expect(second!.querySelector(".bubble-text")?.textContent).toBe("Sorry, I will.");
    expect(second!.querySelector(".modmail-written")).toBeNull();
    expect(third!.querySelector(".modmail-written")?.textContent).toBe("Written as Thanks!");
    // Answered: no note about missing answers.
    expect(openView(view).querySelector(".note")).toBeNull();
  });

  it("names a truce request, and says when the player's side is missing", async () => {
    const { view } = await mount();
    rows(view)[1]!.click();
    await settle();
    expect(bubbles(view)[0]!.querySelector(".bubble-who")?.textContent).toContain("Truce request");
    expect(openView(view).querySelector(".note")?.textContent).toMatch(/^No answer from the player is logged/);
  });

  it("tells the page when the view switches, so the sidebar highlight can follow", async () => {
    viewChanges.length = 0;
    const { view } = await mount();
    rows(view)[0]!.click();
    await settle();
    const opened = viewChanges.length;
    expect(opened).toBeGreaterThanOrEqual(2);
    openView(view).querySelector<HTMLButtonElement>(".back")!.click();
    expect(viewChanges.length).toBe(opened + 1);
  });

  it("goes back to the list as it was, without asking again, the row in focus", async () => {
    const { view } = await mount();
    rows(view)[0]!.click();
    await settle();
    const asked = calls.length;
    openView(view).querySelector<HTMLButtonElement>(".back")!.click();
    expect(listShown(view)).toBe(true);
    expect(openView(view).hidden).toBe(true);
    expect(rows(view)).toHaveLength(2);
    expect(calls.length).toBe(asked);
    expect(document.activeElement).toBe(rows(view)[0]);
  });

  it("says when a conversation cannot load, and the way back still works", async () => {
    const { view } = await mount();
    delete threads["5"];
    rows(view)[0]!.click();
    await settle();
    expect(openView(view).querySelector(".note")?.textContent).toMatch(/^Could not load this conversation: /);
    openView(view).querySelector<HTMLButtonElement>(".back")!.click();
    expect(listShown(view)).toBe(true);
  });

  it("refresh reloads the open conversation too", async () => {
    const { view } = await mount();
    rows(view)[0]!.click();
    await settle();
    threads["5"] = conversation(5, [...threads["5"]!.messages, message(4, { sender: "player", senderName: "yardtester", message: "One more" })]);
    await view.refresh();
    expect(bubbles(view)).toHaveLength(4);
    expect(openView(view).hidden).toBe(false);
  });
});

describe("writtenText", () => {
  it("drops the stored 'subject | ' prefix and keeps the uncensored text", () => {
    expect(writtenText("Re: About world chat | this is so f*ck unfair")).toBe("this is so f*ck unfair");
    expect(writtenText("no separator")).toBe("no separator");
    expect(writtenText("S | a | b")).toBe("a | b");
  });
});
