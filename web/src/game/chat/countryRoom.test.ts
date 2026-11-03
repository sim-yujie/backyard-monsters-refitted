import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatConfig } from "@/api/chat";
import { ChatSession, ChatStatus, UNAVAILABLE_TEXT, type ChatSocket } from "./chatSession";

/**
 * The country room beside Global (owner 3 Nov 2026): joined on the same
 * socket, shown one at a time, lines in the other marked unread, and joined
 * or left at once when the player's country changes.
 */

class FakeSocket implements ChatSocket {
  readonly sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {}

  hear(message: object): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(code = 1006): void {
    this.onclose?.({ code });
  }

  joins(): unknown[] {
    return this.sent.filter((message) => message["type"] === "join").map((message) => message["channel"]);
  }
}

const GLOBAL = "chat:mr2-global";
const PH = "chat:country:PH";
const CONFIG: ChatConfig = {
  url: "ws://localhost:3442",
  userId: 2503,
  token: "tok",
  channel: GLOBAL,
  countryChannel: PH,
  country: "PH",
};
const ME = { userId: 2503, displayName: "[30] yardtester" };

let sockets: FakeSocket[];
const latest = () => sockets[sockets.length - 1]!;

const newSession = () =>
  new ChatSession(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });

const line = (userId: number, body: string, ts = 1) => ({ userId, displayName: `[9] p${userId}`, body, ts });

/** Through auth, with both rooms joined. */
const online = (config: ChatConfig = CONFIG) => {
  const session = newSession();
  session.configure(config);
  latest().onopen?.();
  latest().hear({ type: "auth_ok", ...ME });
  latest().hear({ type: "joined", channel: GLOBAL, history: [line(5, "hello all")] });
  if (config.countryChannel) {
    latest().hear({ type: "joined", channel: config.countryChannel, history: [line(6, "kumusta")] });
  }
  return session;
};

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a player with a country room", () => {
  it("joins Global and the country room, and shows Global first", () => {
    const session = online();
    expect(latest().joins()).toEqual([GLOBAL, PH]);
    expect(session.current.status).toBe(ChatStatus.ONLINE);
    expect(session.current.rooms).toEqual([
      { channel: GLOBAL, kind: "global", country: null },
      { channel: PH, kind: "country", country: "PH" },
    ]);
    expect(session.current.channel).toBe(GLOBAL);
    expect(session.current.entries.map((entry) => (entry.kind === "line" ? entry.body : ""))).toEqual([
      "hello all",
    ]);
  });

  it("shows the country room's own lines when switched to it", () => {
    const session = online();
    session.showRoom(PH);
    expect(session.current.channel).toBe(PH);
    expect(session.current.entries.map((entry) => (entry.kind === "line" ? entry.body : ""))).toEqual([
      "kumusta",
    ]);
  });

  it("marks the room not shown unread when a line comes in there, until it is shown", () => {
    const session = online();
    latest().hear({ type: "message", channel: PH, ...line(6, "musta kayo") });
    expect(session.current.unread.has(PH)).toBe(true);
    expect(session.current.entries).toHaveLength(1);

    session.showRoom(PH);
    expect(session.current.unread.size).toBe(0);
    expect(session.current.entries).toHaveLength(2);
  });

  it("says a line in the room shown", () => {
    const session = online();
    session.showRoom(PH);
    expect(session.say("kumusta po")).toBe(true);
    expect(latest().sent.at(-1)).toEqual({ type: "say", channel: PH, message: "kumusta po" });
  });

  it("will not say a line in a country room the server has not let it into yet", () => {
    const session = newSession();
    session.configure(CONFIG);
    latest().onopen?.();
    latest().hear({ type: "auth_ok", ...ME });
    latest().hear({ type: "joined", channel: GLOBAL, history: [] });
    session.showRoom(PH);
    expect(session.say("hello")).toBe(false);
  });

  it("drops the tab, quietly, when the server turns the country room down", () => {
    const session = newSession();
    session.configure(CONFIG);
    latest().onopen?.();
    latest().hear({ type: "auth_ok", ...ME });
    latest().hear({ type: "joined", channel: GLOBAL, history: [] });
    session.showRoom(PH);
    latest().hear({ type: "error", code: "invalid_channel" });

    expect(session.current.rooms.map((room) => room.channel)).toEqual([GLOBAL]);
    expect(session.current.channel).toBe(GLOBAL);
    expect(session.current.entries.some((entry) => entry.kind === "notice")).toBe(false);
  });

  it("still says Global is unavailable when Global itself is turned down", () => {
    const session = newSession();
    session.configure(CONFIG);
    latest().onopen?.();
    latest().hear({ type: "auth_ok", ...ME });
    latest().hear({ type: "error", code: "invalid_channel" });
    expect(session.current.entries).toEqual([{ kind: "notice", id: expect.any(Number), text: UNAVAILABLE_TEXT }]);
  });

  it("rejoins both rooms after a dropped socket, on the room it was showing", () => {
    const session = online();
    session.showRoom(PH);
    latest().drop();
    vi.advanceTimersByTime(1_000);
    latest().onopen?.();
    latest().hear({ type: "auth_ok", ...ME });
    expect(latest().joins()).toEqual([GLOBAL, PH]);
    expect(session.current.channel).toBe(PH);
  });
});

describe("a country change", () => {
  it("away from the Philippines leaves its room and its tab, back on Global", () => {
    const session = online();
    session.showRoom(PH);
    session.setCountryRoom(null, "SG");

    expect(latest().sent.at(-1)).toEqual({ type: "leave", channel: PH });
    expect(session.current.rooms.map((room) => room.channel)).toEqual([GLOBAL]);
    expect(session.current.channel).toBe(GLOBAL);
    expect(sockets).toHaveLength(1);
  });

  it("to the Philippines joins its room on the open socket", () => {
    const session = online({ ...CONFIG, countryChannel: null, country: null });
    expect(session.current.rooms).toHaveLength(1);

    session.setCountryRoom(PH, "PH");
    expect(latest().sent.at(-1)).toEqual({ type: "join", channel: PH });
    expect(session.current.rooms.map((room) => room.kind)).toEqual(["global", "country"]);
    expect(session.current.channel).toBe(GLOBAL);

    latest().hear({ type: "joined", channel: PH, history: [line(6, "kumusta")] });
    session.showRoom(PH);
    expect(session.current.entries).toHaveLength(1);
  });

  it("before chat started changes nothing", () => {
    const session = newSession();
    session.setCountryRoom(PH, "PH");
    expect(sockets).toHaveLength(0);
    expect(session.current.rooms).toEqual([]);
  });

  it("a later yard load naming the same rooms opens nothing new", () => {
    const session = online();
    session.configure({ ...CONFIG });
    expect(sockets).toHaveLength(1);
  });

  it("a move between Map Rooms changes Global and keeps the country room", () => {
    const session = online();
    session.configure({ ...CONFIG, channel: "chat:mr3-global" });
    const sent = latest().sent.slice(-2);
    expect(sent).toEqual([
      { type: "leave", channel: GLOBAL },
      { type: "join", channel: "chat:mr3-global" },
    ]);
    expect(session.current.rooms.map((room) => room.channel)).toEqual(["chat:mr3-global", PH]);
  });
});
