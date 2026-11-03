// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import { ChatPanel, splitName, type PanelSocket } from "./chat";

/**
 * The Chat section: the owner joins every room as the game team, sees
 * history and new lines (GM-marked), writes, and opens a player by name.
 */

class FakeSocket implements PanelSocket {
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.closed = true;
  }
  serve(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const SESSION = {
  server: "localhost:3010",
  userId: 9,
  token: "chat-token",
  rooms: [
    { channel: "chat:mr2-global", label: "Map Room 2" },
    { channel: "chat:country:PH", label: "PH" },
  ],
};

let sockets: FakeSocket[] = [];

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 9 }));
  sockets = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/admin/chat/session") ? Response.json(SESSION) : new Response("Not Found", { status: 404 }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const panel = (openPlayer = vi.fn()) => {
  const view = new ChatPanel({
    openPlayer,
    say: () => {},
    secure: false,
    socket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  document.body.append(view.element);
  return view;
};

const joinUp = async (view: ChatPanel) => {
  await view.join();
  const socket = sockets.at(-1)!;
  socket.onopen?.();
  socket.serve({ type: "auth_ok", userId: 9, displayName: "[40] Owner" });
  socket.serve({
    type: "joined",
    channel: "chat:mr2-global",
    history: [{ userId: 42, displayName: "[12] MonsterMash", body: "hello all", ts: Date.now() - 60_000 }],
  });
  socket.serve({ type: "joined", channel: "chat:country:PH", history: [] });
  return socket;
};

describe("the chat panel", () => {
  it("splits the level off a name", () => {
    expect(splitName("[12] MonsterMash")).toEqual({ level: "12", name: "MonsterMash" });
    expect(splitName("Plain")).toEqual({ level: null, name: "Plain" });
  });

  it("waits for Join before connecting", () => {
    panel();
    expect(sockets).toHaveLength(0);
    expect(document.body.textContent).toContain("Not in chat");
  });

  it("signs in as the owner, joins every room and shows the history", async () => {
    const view = panel();
    const socket = await joinUp(view);
    expect(socket.url).toBe("ws://localhost:3010");
    expect(socket.sent.slice(0, 3)).toEqual([
      { type: "auth", userId: 9, token: "chat-token" },
      { type: "join", channel: "chat:mr2-global" },
      { type: "join", channel: "chat:country:PH" },
    ]);
    expect(view.element.textContent).toContain("In chat as the game team");
    const tabs = [...view.element.querySelectorAll(".chat-tab")].map((t) => t.textContent);
    expect(tabs).toEqual(["Map Room 2", "Philippines"]);
    expect(view.element.querySelector(".chat-line")?.textContent).toContain("MonsterMash");
    expect(view.element.querySelector(".chat-line")?.textContent).toContain("hello all");
  });

  it("sends a line to the room on show, and marks GM lines", async () => {
    const view = panel();
    const socket = await joinUp(view);
    const input = view.element.querySelector<HTMLInputElement>(".chat-send input")!;
    input.value = "Hi, it's the game team";
    view.element.querySelector<HTMLFormElement>(".chat-send")!.requestSubmit();
    expect(socket.sent.at(-1)).toEqual({ type: "say", channel: "chat:mr2-global", message: "Hi, it's the game team" });
    expect(input.value).toBe("");

    socket.serve({
      type: "message",
      channel: "chat:mr2-global",
      userId: 9,
      displayName: "[40] Owner",
      body: "Hi, it's the game team",
      ts: Date.now(),
      gm: true,
    });
    const last = [...view.element.querySelectorAll(".chat-line")].at(-1)!;
    expect(last.classList.contains("is-gm")).toBe(true);
    expect(last.querySelector(".chat-gm")?.textContent).toBe("GM");
  });

  it("counts new lines in a room not on show", async () => {
    const view = panel();
    const socket = await joinUp(view);
    socket.serve({ type: "message", channel: "chat:country:PH", userId: 50, displayName: "[3] Kabayan", body: "kumusta", ts: Date.now() });
    const ph = view.element.querySelector<HTMLElement>("[data-channel='chat:country:PH']")!;
    expect(ph.querySelector(".chat-unread")?.textContent).toBe("1");
    ph.click();
    expect(view.element.querySelector(".chat-line")?.textContent).toContain("kumusta");
    expect(view.element.querySelector(".chat-unread")).toBeNull();
  });

  it("opens a player by name", async () => {
    const openPlayer = vi.fn();
    const view = panel(openPlayer);
    await joinUp(view);
    view.element.querySelector<HTMLElement>(".chat-name")!.click();
    expect(openPlayer).toHaveBeenCalledWith(42);
  });

  it("lets the game have chat back when it takes over", async () => {
    const view = panel();
    const socket = await joinUp(view);
    socket.onclose?.({ code: 1000 });
    await settle();
    expect(view.element.textContent).toContain("Chat was opened somewhere else");
    expect(sockets).toHaveLength(1);
  });

  it("tries again when the connection drops", async () => {
    vi.useFakeTimers();
    const view = panel();
    const socket = await joinUp(view);
    socket.onclose?.({ code: 1006 });
    expect(view.element.textContent).toContain("trying again");
    await vi.advanceTimersByTimeAsync(2_100);
    expect(sockets).toHaveLength(2);
  });

  it("stops when the owner leaves", async () => {
    const view = panel();
    const socket = await joinUp(view);
    view.leave();
    expect(socket.closed).toBe(true);
    expect(view.element.textContent).toContain("Not in chat");
  });
});
