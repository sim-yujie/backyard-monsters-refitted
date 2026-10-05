import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatConfig, ChatLineWire } from "@/api/chat";
import {
  ChatSession,
  ChatStatus,
  FIRST_RETRY_MS,
  MAX_ENTRIES,
  MAX_RETRY_MS,
  PING_INTERVAL_MS,
  RATE_LIMITED_TEXT,
  visibleEntries,
  type ChatSocket,
} from "./chatSession";

/** A socket the test drives: what the client sent, and the server's side. */
class FakeSocket implements ChatSocket {
  readonly sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.closed = true;
  }

  /** The server's side. */
  open(): void {
    this.onopen?.();
  }

  hear(message: object): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(code = 1006): void {
    this.onclose?.({ code });
  }

  types(): unknown[] {
    return this.sent.map((message) => message["type"]);
  }
}

const CONFIG: ChatConfig = {
  url: "ws://localhost:3010",
  userId: 2505,
  token: "tok",
  channel: "chat:mr2-global",
};
const ME = { userId: 2505, displayName: "[27] agenttester" };

const wire = (
  userId: number,
  body: string,
  ts: number,
  displayName = `[12] p${userId}`,
): ChatLineWire => ({
  userId,
  displayName,
  body,
  ts,
});

let sockets: FakeSocket[];
const latest = () => sockets[sockets.length - 1]!;

const newSession = () =>
  new ChatSession((url) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  });

/** A session through auth and join, with `history` as the room's. */
const joined = (history: ChatLineWire[] = []) => {
  const session = newSession();
  session.configure(CONFIG);
  latest().open();
  latest().hear({ type: "auth_ok", ...ME });
  latest().hear({ type: "joined", channel: CONFIG.channel, history });
  return session;
};

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("connecting", () => {
  it("authenticates with the load's token, joins the room and asks for the ignore list", () => {
    const session = newSession();
    session.configure(CONFIG);
    expect(session.current.status).toBe(ChatStatus.CONNECTING);
    expect(latest().url).toBe("ws://localhost:3010");

    latest().open();
    expect(latest().sent[0]).toEqual({ type: "auth", userId: 2505, token: "tok" });

    latest().hear({ type: "auth_ok", ...ME });
    expect(latest().sent.slice(1)).toEqual([
      { type: "join", channel: "chat:mr2-global" },
      { type: "getignore" },
    ]);
    expect(session.current.self).toEqual({ userId: 2505, name: "[27] agenttester" });

    latest().hear({ type: "joined", channel: CONFIG.channel, history: [] });
    expect(session.current.status).toBe(ChatStatus.ONLINE);
  });

  it("the same settings again open nothing new", () => {
    const session = joined();
    session.configure({ ...CONFIG });
    expect(sockets).toHaveLength(1);
  });

  it("pings well inside the server's idle limit", () => {
    joined();
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(
      latest()
        .types()
        .filter((type) => type === "ping"),
    ).toHaveLength(1);
  });

  it("changes rooms on the open socket when the player's Map Room changes", () => {
    const session = joined([wire(77, "hello", 1)]);
    session.configure({ ...CONFIG, channel: "chat:mr1-global" });
    expect(sockets).toHaveLength(1);
    expect(latest().sent.slice(-2)).toEqual([
      { type: "leave", channel: "chat:mr2-global" },
      { type: "join", channel: "chat:mr1-global" },
    ]);
    expect(session.current.entries).toEqual([]);
    expect(session.current.channel).toBe("chat:mr1-global");
  });
});

describe("the message list", () => {
  it("starts from the room's history, oldest first, and marks the player's own lines", () => {
    const session = joined([wire(77, "first", 1), wire(2505, "mine", 2, ME.displayName)]);
    expect(session.current.entries).toMatchObject([
      { kind: "line", userId: 77, name: "[12] p77", body: "first", ts: 1, own: false },
      { kind: "line", userId: 2505, name: "[27] agenttester", body: "mine", ts: 2, own: true },
    ]);
  });

  it("adds live lines from the room and ignores other rooms'", () => {
    const session = joined();
    latest().hear({ type: "message", channel: CONFIG.channel, ...wire(77, "hi all", 5) });
    latest().hear({ type: "message", channel: "chat:alliance:4", ...wire(78, "secret", 6) });
    expect(
      session.current.entries.map((entry) => (entry.kind === "line" ? entry.body : entry.text)),
    ).toEqual(["hi all"]);
  });

  it(`keeps the newest ${MAX_ENTRIES}`, () => {
    const session = joined();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      latest().hear({ type: "message", channel: CONFIG.channel, ...wire(77, `line ${i}`, i) });
    }
    expect(session.current.entries).toHaveLength(MAX_ENTRIES);
    expect(session.current.entries[0]).toMatchObject({ body: "line 5" });
  });

  it("says a trimmed line in the room and refuses an empty one", () => {
    const session = joined();
    expect(session.say("  hello world  ")).toBe(true);
    expect(latest().sent.at(-1)).toEqual({
      type: "say",
      channel: CONFIG.channel,
      message: "hello world",
    });
    expect(session.say("   ")).toBe(false);
    expect(
      latest()
        .types()
        .filter((type) => type === "say"),
    ).toHaveLength(1);
  });

  it("says nothing before the room is joined", () => {
    const session = newSession();
    session.configure(CONFIG);
    expect(session.say("too soon")).toBe(false);
  });

  it("answers a rate limit with a friendly line and hands the words back", () => {
    const session = joined();
    session.say("spam");
    latest().hear({ type: "error", code: "rate_limited" });
    expect(session.current.entries.at(-1)).toMatchObject({
      kind: "notice",
      text: RATE_LIMITED_TEXT,
    });
    expect(session.current.bounced).toBe("spam");
    session.say("later");
    expect(session.current.bounced).toBeNull();
  });

  it("takes a level change's new name for the player's own lines still to come (#232)", () => {
    const session = joined();
    latest().hear({
      type: "name_update",
      channel: CONFIG.channel,
      userId: 2505,
      displayName: "[28] agenttester",
    });
    expect(session.current.self?.name).toBe("[28] agenttester");
    latest().hear({
      type: "name_update",
      channel: CONFIG.channel,
      userId: 77,
      displayName: "[13] p77",
    });
    expect(session.current.self?.name).toBe("[28] agenttester");
  });

  it("ignores what it cannot read", () => {
    const session = joined();
    latest().onmessage?.({ data: "not json" });
    latest().onmessage?.({ data: JSON.stringify({ type: "something_new" }) });
    expect(session.current.entries).toEqual([]);
  });
});

describe("mute", () => {
  it("takes the server's ignore list", () => {
    const session = joined();
    latest().hear({ type: "ignore_list", list: [{ target: "77", displayname: "" }] });
    expect([...session.current.muted]).toEqual([77]);
  });

  it("muting hides the player's lines and tells the server; unmuting brings them back", () => {
    const session = joined([wire(77, "noise", 1), wire(78, "fine", 2)]);
    session.mute(77);
    expect(latest().sent.at(-1)).toEqual({ type: "ignore", targetId: "77" });
    expect(
      visibleEntries(session.current).map((entry) => entry.kind === "line" && entry.body),
    ).toEqual(["fine"]);

    session.unmute(77);
    expect(latest().sent.at(-1)).toEqual({ type: "unignore", targetId: "77" });
    expect(visibleEntries(session.current)).toHaveLength(2);
  });
});

describe("reconnecting", () => {
  it("comes back by itself after a drop, waiting longer each time, and rejoins with the history", () => {
    const session = joined([wire(77, "before", 1)]);
    latest().drop();
    expect(session.current.status).toBe(ChatStatus.RECONNECTING);
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(FIRST_RETRY_MS);
    expect(sockets).toHaveLength(2);
    latest().drop();
    vi.advanceTimersByTime(FIRST_RETRY_MS);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(FIRST_RETRY_MS);
    expect(sockets).toHaveLength(3);

    latest().open();
    expect(latest().sent[0]).toMatchObject({ type: "auth", token: "tok" });
    latest().hear({ type: "auth_ok", ...ME });
    latest().hear({
      type: "joined",
      channel: CONFIG.channel,
      history: [wire(77, "before", 1), wire(78, "during", 2)],
    });
    expect(session.current.status).toBe(ChatStatus.ONLINE);
    expect(session.current.entries.map((entry) => entry.kind === "line" && entry.body)).toEqual(
      ["before", "during"],
    );
  });

  it(`never waits more than ${MAX_RETRY_MS / 1000} s, and starts again from a second once back`, () => {
    joined();
    for (let i = 0; i < 10; i++) {
      latest().drop();
      vi.advanceTimersByTime(MAX_RETRY_MS);
    }
    const count = sockets.length;
    expect(count).toBe(11);

    latest().open();
    latest().hear({ type: "auth_ok", ...ME });
    latest().hear({ type: "joined", channel: CONFIG.channel, history: [] });
    latest().drop();
    vi.advanceTimersByTime(FIRST_RETRY_MS);
    expect(sockets).toHaveLength(count + 1);
  });

  it("a refused token waits for the next yard load's", () => {
    const session = newSession();
    session.configure(CONFIG);
    latest().open();
    latest().hear({ type: "auth_fail", reason: "invalid_token" });
    expect(session.current.status).toBe(ChatStatus.SIGNED_OUT);
    vi.advanceTimersByTime(MAX_RETRY_MS * 2);
    expect(sockets).toHaveLength(1);

    session.configure({ ...CONFIG, token: "fresh" });
    expect(sockets).toHaveLength(2);
    latest().open();
    expect(latest().sent[0]).toMatchObject({ token: "fresh" });
  });

  it("a clean close from the server (another window took over) waits for Reconnect", () => {
    const session = joined();
    latest().drop(1000);
    expect(session.current.status).toBe(ChatStatus.ELSEWHERE);
    vi.advanceTimersByTime(MAX_RETRY_MS * 2);
    expect(sockets).toHaveLength(1);

    session.reconnect();
    expect(sockets).toHaveLength(2);
  });

  it("stop closes the socket, forgets everything and retries nothing", () => {
    const session = joined([wire(77, "hi", 1)]);
    const socket = latest();
    session.stop();
    expect(socket.closed).toBe(true);
    expect(session.current).toMatchObject({
      status: ChatStatus.OFF,
      entries: [],
      self: null,
      channel: null,
    });
    socket.drop();
    vi.advanceTimersByTime(MAX_RETRY_MS * 2);
    expect(sockets).toHaveLength(1);
  });
});
