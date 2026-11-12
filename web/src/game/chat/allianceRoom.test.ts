import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatConfig } from "@/api/chat";
import { ALLIANCE_ROOM, ChatSession, ChatStatus, UNAVAILABLE_TEXT, type ChatSocket } from "./chatSession";

/**
 * The Alliance room between Global and the country room (design v5 §7c):
 * asked for by the server's alias, said in by its real name, its automatic
 * lines marked, and closed at once when the player leaves the alliance.
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
const GANG = { id: 7, name: "Goo Gang", image: 12 };
const KEY = "chat:alliance:7";
const CONFIG: ChatConfig = {
  url: "ws://localhost:3442",
  userId: 2503,
  token: "tok",
  channel: GLOBAL,
  countryChannel: PH,
  country: "PH",
  alliance: GANG,
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

const line = (userId: number, body: string, extra: object = {}) => ({
  userId,
  displayName: `[9] p${userId}`,
  body,
  ts: 1,
  ...extra,
});

const bodies = (session: ChatSession) =>
  session.current.entries.map((entry) => (entry.kind === "line" ? entry.body : ""));

/** Through auth, with every room joined. */
const online = (config: ChatConfig = CONFIG) => {
  const session = newSession();
  session.configure(config);
  latest().onopen?.();
  latest().hear({ type: "auth_ok", ...ME });
  latest().hear({ type: "joined", channel: GLOBAL, history: [line(5, "hello all")] });
  if (config.alliance) {
    latest().hear({ type: "joined", channel: KEY, history: [line(8, "hi gang", { messageType: "message" })] });
  }
  if (config.countryChannel) latest().hear({ type: "joined", channel: PH, history: [line(6, "kumusta")] });
  return session;
};

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a player in an alliance", () => {
  it("joins Global, the Alliance room by the server's alias, then the country room", () => {
    const session = online();
    expect(latest().joins()).toEqual([GLOBAL, ALLIANCE_ROOM, PH]);
    expect(session.current.status).toBe(ChatStatus.ONLINE);
    expect(session.current.rooms).toEqual([
      { channel: GLOBAL, kind: "global", country: null },
      { channel: ALLIANCE_ROOM, kind: "alliance", country: null, alliance: GANG },
      { channel: PH, kind: "country", country: "PH" },
    ]);
    expect(session.current.channel).toBe(GLOBAL);
  });

  it("files the server's real room name under the Alliance tab, history and live lines", () => {
    const session = online();
    latest().hear({ type: "message", channel: KEY, ...line(9, "need help", { messageType: "message" }) });
    expect(session.current.unread.has(ALLIANCE_ROOM)).toBe(true);

    session.showRoom(ALLIANCE_ROOM);
    expect(bodies(session)).toEqual(["hi gang", "need help"]);
    expect(session.current.unread.size).toBe(0);
  });

  it("says a line by the room's real name", () => {
    const session = online();
    session.showRoom(ALLIANCE_ROOM);
    expect(session.say("on my way")).toBe(true);
    expect(latest().sent.at(-1)).toEqual({ type: "say", channel: KEY, message: "on my way" });
  });

  it("marks automatic lines, and keeps an under-attack alert's map cell", () => {
    const session = online();
    session.showRoom(ALLIANCE_ROOM);
    latest().hear({
      type: "message",
      channel: KEY,
      ...line(0, "Ana's outpost (12, 40) is under attack by Bob!", { messageType: "under_attack", cell: { x: 12, y: 40 } }),
    });
    latest().hear({ type: "message", channel: KEY, ...line(0, "Cy joined.", { messageType: "join" }) });
    const [said, alert, joined] = session.current.entries;
    expect(said).toMatchObject({ kind: "line", auto: false, cell: null });
    expect(alert).toMatchObject({ kind: "line", auto: true, cell: { x: 12, y: 40 } });
    expect(joined).toMatchObject({ kind: "line", auto: true, cell: null });
  });

  it("ignores a cell that is not two whole numbers", () => {
    const session = online();
    session.showRoom(ALLIANCE_ROOM);
    latest().hear({
      type: "message",
      channel: KEY,
      ...line(0, "x", { messageType: "under_attack", cell: { x: "12", y: 1.5 } }),
    });
    expect(session.current.entries.at(-1)).toMatchObject({ auto: true, cell: null });
  });

  it("a Global line is never automatic", () => {
    const session = online();
    expect(session.current.entries[0]).toMatchObject({ auto: false, cell: null });
  });
});

describe("leaving the alliance", () => {
  it("the server's 'left' takes the tab away and shows Global", () => {
    const session = online();
    session.showRoom(ALLIANCE_ROOM);
    latest().hear({ type: "left", channel: KEY });
    expect(session.current.rooms.map((room) => room.kind)).toEqual(["global", "country"]);
    expect(session.current.channel).toBe(GLOBAL);
    expect(bodies(session)).toEqual(["hello all"]);
  });

  it("a 'left' for another room changes nothing", () => {
    const session = online();
    latest().hear({ type: "left", channel: "chat:alliance:99" });
    expect(session.current.rooms).toHaveLength(3);
  });

  it("a refused Alliance room drops its tab quietly; Global carries on", () => {
    const session = newSession();
    session.configure(CONFIG);
    latest().onopen?.();
    latest().hear({ type: "auth_ok", ...ME });
    latest().hear({ type: "joined", channel: GLOBAL, history: [] });
    latest().hear({ type: "error", code: "invalid_channel", channel: ALLIANCE_ROOM });
    expect(session.current.rooms.map((room) => room.kind)).toEqual(["global", "country"]);
    expect(session.current.entries.some((entry) => entry.kind === "notice")).toBe(false);
  });

  it("a refused country room named by the server drops only that tab", () => {
    const session = newSession();
    session.configure(CONFIG);
    latest().onopen?.();
    latest().hear({ type: "auth_ok", ...ME });
    latest().hear({ type: "joined", channel: GLOBAL, history: [] });
    latest().hear({ type: "error", code: "invalid_channel", channel: PH });
    expect(session.current.rooms.map((room) => room.kind)).toEqual(["global", "alliance"]);
  });

  it("Global refused still says chat is unavailable", () => {
    const session = newSession();
    session.configure(CONFIG);
    latest().onopen?.();
    latest().hear({ type: "auth_ok", ...ME });
    latest().hear({ type: "error", code: "invalid_channel", channel: GLOBAL });
    expect(session.current.entries).toEqual([{ kind: "notice", id: expect.any(Number), text: UNAVAILABLE_TEXT }]);
  });

  it("setAllianceRoom(null) leaves by the real name and closes the tab", () => {
    const session = online();
    session.setAllianceRoom(null);
    expect(latest().sent.at(-1)).toEqual({ type: "leave", channel: KEY });
    expect(session.current.rooms.map((room) => room.kind)).toEqual(["global", "country"]);
    expect(sockets).toHaveLength(1);
  });
});

describe("joining or changing alliance", () => {
  it("setAllianceRoom opens the room on the open socket, between Global and the country room", () => {
    const session = online({ ...CONFIG, alliance: null });
    expect(session.current.rooms.map((room) => room.kind)).toEqual(["global", "country"]);

    session.setAllianceRoom(GANG);
    expect(latest().sent.at(-1)).toEqual({ type: "join", channel: ALLIANCE_ROOM });
    expect(session.current.rooms.map((room) => room.kind)).toEqual(["global", "alliance", "country"]);
    expect(sockets).toHaveLength(1);
  });

  it("the same alliance again sends nothing", () => {
    const session = online();
    const sent = latest().sent.length;
    session.setAllianceRoom({ ...GANG });
    expect(latest().sent).toHaveLength(sent);
  });

  it("another alliance leaves the old room and joins the new one", () => {
    const session = online();
    session.setAllianceRoom({ id: 9, name: "Mud Men", image: 3 });
    expect(latest().sent.slice(-2)).toEqual([
      { type: "leave", channel: KEY },
      { type: "join", channel: ALLIANCE_ROOM },
    ]);
    latest().hear({ type: "joined", channel: "chat:alliance:9", history: [line(4, "welcome")] });
    session.showRoom(ALLIANCE_ROOM);
    expect(bodies(session)).toEqual(["welcome"]);
    expect(session.current.rooms[1]).toMatchObject({ alliance: { id: 9, name: "Mud Men" } });
  });

  it("a load that does not say (an outpost's) keeps the Alliance room", () => {
    const session = online();
    session.configure({ ...CONFIG, alliance: undefined });
    expect(session.current.rooms.map((room) => room.kind)).toEqual(["global", "alliance", "country"]);
    expect(sockets).toHaveLength(1);
  });

  it("a main-yard load naming no alliance closes the room", () => {
    const session = online();
    session.configure({ ...CONFIG, alliance: null });
    expect(latest().sent.at(-1)).toEqual({ type: "leave", channel: KEY });
    expect(session.current.rooms.map((room) => room.kind)).toEqual(["global", "country"]);
  });

  it("rejoins the Alliance room by its alias after a dropped socket", () => {
    const session = online();
    session.showRoom(ALLIANCE_ROOM);
    latest().drop();
    vi.advanceTimersByTime(1_000);
    latest().onopen?.();
    latest().hear({ type: "auth_ok", ...ME });
    expect(latest().joins()).toEqual([GLOBAL, ALLIANCE_ROOM, PH]);
    expect(session.current.channel).toBe(ALLIANCE_ROOM);
  });
});
