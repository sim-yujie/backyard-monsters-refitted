import type { ChatConfig, ChatLineWire, ChatServerMessage } from "@/api/chat";

/**
 * World chat's connection and what it has heard (#282), with no DOM: the chat
 * box (`ui/chat/ChatBox.ts`) only draws a {@link ChatState} and calls back.
 *
 * One session lives for the whole sign-in, not for one screen, so the room and
 * its lines survive a trip to the map and back. The own yard's load hands it
 * the token and the room (`configure`); signing out or the idle disconnect
 * ends it (`stop`).
 *
 * The socket comes back by itself when it drops, quietly: a status the box
 * shows as a dot, and the room's history again on the rejoin. Two cases wait
 * instead of retrying. A refused token waits for the next yard load to bring a
 * fresh one. A clean close from the server means this player connected
 * somewhere else (the server keeps one connection per player and closes the
 * older), and retrying would only throw that one off in turn; the box offers
 * to reconnect.
 */

/** A line someone said in the room. */
export interface ChatLine {
  readonly kind: "line";
  readonly id: number;
  readonly userId: number;
  /** `[level] name`, as the server stamped the line. */
  readonly name: string;
  readonly body: string;
  /** When it was said, ms since the epoch; with `userId`, what a report names. */
  readonly ts: number;
  /** Said by this player. */
  readonly own: boolean;
}

/** A word from the client itself, such as "slow down". */
export interface ChatNotice {
  readonly kind: "notice";
  readonly id: number;
  readonly text: string;
}

export type ChatEntry = ChatLine | ChatNotice;

export const ChatStatus = {
  /** Not started, or stopped. */
  OFF: "off",
  CONNECTING: "connecting",
  ONLINE: "online",
  /** Dropped; trying again on its own. */
  RECONNECTING: "reconnecting",
  /** The token was refused; waits for the next yard load. */
  SIGNED_OUT: "signedOut",
  /** Connected from somewhere else, which took over; waits for `reconnect`. */
  ELSEWHERE: "elsewhere",
} as const;
export type ChatStatus = (typeof ChatStatus)[keyof typeof ChatStatus];

export interface ChatState {
  readonly status: ChatStatus;
  /** The room's lines and the client's notices, oldest first; muted players' lines included. */
  readonly entries: readonly ChatEntry[];
  /** Who this player has muted (the server's ignore list). */
  readonly muted: ReadonlySet<number>;
  /** This player, once the server has said who they are. */
  readonly self: { readonly userId: number; readonly name: string } | null;
  /** The world room joined, or about to be. */
  readonly channel: string | null;
  /**
   * The words of a line the server turned away for coming too fast, for the
   * box to put back in the input; cleared by the next `say`.
   */
  readonly bounced: string | null;
}

/** The part of a `WebSocket` the session uses, so a test can stand in for it. */
export interface ChatSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
}

export type ChatSocketFactory = (url: string) => ChatSocket;

/** A browser `WebSocket` behind the {@link ChatSocket} face. */
const browserSocket: ChatSocketFactory = (url) => {
  const ws = new WebSocket(url);
  const socket: ChatSocket = {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (event) => socket.onmessage?.(event);
  ws.onclose = (event) => socket.onclose?.(event);
  return socket;
};

/** The room keeps this many entries; the server's history holds 100 lines too. */
export const MAX_ENTRIES = 100;
/** The longest line the server keeps (`chatRooms.ts` `MAX_MSG_LEN`). */
export const MAX_LINE_LENGTH = 200;
/** The server drops a socket that says nothing for 120 s; a ping well inside that. */
export const PING_INTERVAL_MS = 45_000;
/** The first retry's wait; each after doubles, up to {@link MAX_RETRY_MS}. */
export const FIRST_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 30_000;
/** What a clean close (`ws.close()` with no code) arrives as. */
const NORMAL_CLOSURE = 1000;

export const RATE_LIMITED_TEXT = "Easy there! Wait a moment before sending another message.";
export const UNAVAILABLE_TEXT = "World chat is not available right now.";

/** Visible lines: everything but the muted players' lines. */
export const visibleEntries = (state: ChatState): ChatEntry[] =>
  state.entries.filter((entry) => entry.kind === "notice" || !state.muted.has(entry.userId));

const sameConfig = (a: ChatConfig | null, b: ChatConfig): boolean =>
  !!a &&
  a.url === b.url &&
  a.userId === b.userId &&
  a.token === b.token &&
  a.channel === b.channel;

const parse = (data: unknown): ChatServerMessage | null => {
  if (typeof data !== "string") return null;
  try {
    const message: unknown = JSON.parse(data);
    return message && typeof message === "object" && "type" in message
      ? (message as ChatServerMessage)
      : null;
  } catch {
    return null;
  }
};

export class ChatSession {
  private config: ChatConfig | null = null;
  private socket: ChatSocket | null = null;
  private listeners = new Set<(state: ChatState) => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retries = 0;
  private nextId = 1;
  /** The last line said, for `bounced` if the server turns it away. */
  private lastSaid: string | null = null;
  private state: ChatState = {
    status: ChatStatus.OFF,
    entries: [],
    muted: new Set(),
    self: null,
    channel: null,
    bounced: null,
  };

  constructor(private readonly openSocket: ChatSocketFactory = browserSocket) {}

  get current(): ChatState {
    return this.state;
  }

  /** Calls `listener` now and on every change; returns the way to stop. */
  subscribe(listener: (state: ChatState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Takes the token and room from an own-yard load and connects if need be.
   *
   * The same settings again change nothing, so every yard load may call it. A
   * new token alone is kept for the next connect; a new room (a move between
   * Map Rooms) is changed over on the open socket.
   */
  configure(config: ChatConfig): void {
    const previous = this.config;
    if (sameConfig(previous, config) && this.state.status !== ChatStatus.SIGNED_OUT) {
      if (this.state.status === ChatStatus.OFF) this.connect();
      return;
    }
    this.config = config;

    const waiting =
      this.state.status === ChatStatus.OFF || this.state.status === ChatStatus.SIGNED_OUT;
    const moved = !previous || previous.url !== config.url || previous.userId !== config.userId;
    if (waiting || moved) {
      this.connect();
      return;
    }
    if (previous.channel !== config.channel) {
      this.update({ channel: config.channel, entries: [] });
      if (this.state.status === ChatStatus.ONLINE) {
        this.sendRaw({ type: "leave", channel: previous.channel });
        this.sendRaw({ type: "join", channel: config.channel });
      }
    }
  }

  /** Connects again after another connection took over (the box's "Reconnect"). */
  reconnect(): void {
    if (this.config && this.state.status !== ChatStatus.ONLINE) this.connect();
  }

  /** Closes the socket and forgets everything: signing out, or the idle disconnect. */
  stop(): void {
    this.config = null;
    this.drop();
    this.retries = 0;
    this.update({
      status: ChatStatus.OFF,
      entries: [],
      muted: new Set(),
      self: null,
      channel: null,
      bounced: null,
    });
  }

  /**
   * Says a line in the room. False, and nothing sent, when the line is empty
   * or the room is not joined.
   */
  say(text: string): boolean {
    const body = text.trim().slice(0, MAX_LINE_LENGTH);
    const channel = this.state.channel;
    if (!body || !channel || this.state.status !== ChatStatus.ONLINE) return false;
    this.lastSaid = body;
    if (this.state.bounced !== null) this.update({ bounced: null });
    this.sendRaw({ type: "say", channel, message: body });
    return true;
  }

  /** Mutes a player: their lines leave the box, here and on the server's list. */
  mute(userId: number): void {
    this.setMuted(userId, true);
  }

  unmute(userId: number): void {
    this.setMuted(userId, false);
  }

  private setMuted(userId: number, muted: boolean): void {
    const next = new Set(this.state.muted);
    if (muted) next.add(userId);
    else next.delete(userId);
    this.update({ muted: next });
    this.sendRaw({ type: muted ? "ignore" : "unignore", targetId: String(userId) });
  }

  private connect(): void {
    const config = this.config;
    if (!config) return;
    this.drop();
    this.update({
      status: this.retries > 0 ? ChatStatus.RECONNECTING : ChatStatus.CONNECTING,
      channel: config.channel,
    });

    let socket: ChatSocket;
    try {
      socket = this.openSocket(config.url);
    } catch {
      this.retryLater();
      return;
    }
    this.socket = socket;
    socket.onopen = () =>
      this.sendRaw({ type: "auth", userId: config.userId, token: config.token });
    socket.onmessage = (event) => {
      const message = parse(event.data);
      if (message) this.receive(message);
    };
    socket.onclose = (event) => this.closed(socket, event.code);
  }

  /** Lets go of the socket and the timers without touching the state. */
  private drop(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  private closed(socket: ChatSocket, code: number): void {
    if (socket !== this.socket) return;
    const wasOnline = this.state.status === ChatStatus.ONLINE;
    this.drop();
    if (this.state.status === ChatStatus.SIGNED_OUT) return;
    if (code === NORMAL_CLOSURE && wasOnline) {
      this.update({ status: ChatStatus.ELSEWHERE });
      return;
    }
    this.retryLater();
  }

  private retryLater(): void {
    const wait = Math.min(FIRST_RETRY_MS * 2 ** this.retries, MAX_RETRY_MS);
    this.retries += 1;
    this.update({ status: ChatStatus.RECONNECTING });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, wait);
  }

  private receive(message: ChatServerMessage): void {
    switch (message.type) {
      case "auth_ok": {
        const channel = this.config?.channel;
        this.update({ self: { userId: message.userId, name: message.displayName } });
        if (channel) this.sendRaw({ type: "join", channel });
        this.sendRaw({ type: "getignore" });
        this.pingTimer = setInterval(() => this.sendRaw({ type: "ping" }), PING_INTERVAL_MS);
        return;
      }
      case "auth_fail":
        this.drop();
        this.update({ status: ChatStatus.SIGNED_OUT });
        return;
      case "joined":
        if (message.channel !== this.state.channel) return;
        this.retries = 0;
        this.update({
          status: ChatStatus.ONLINE,
          entries: (Array.isArray(message.history) ? message.history : []).map((line) =>
            this.line(line),
          ),
        });
        return;
      case "message":
        if (message.channel !== this.state.channel) return;
        this.append(this.line(message));
        return;
      case "name_update":
        if (this.state.self && message.userId === this.state.self.userId) {
          this.update({ self: { userId: message.userId, name: message.displayName } });
        }
        return;
      case "ignore_list":
        this.update({
          muted: new Set(
            (Array.isArray(message.list) ? message.list : [])
              .map((entry) => Number(entry.target))
              .filter((id) => Number.isInteger(id)),
          ),
        });
        return;
      case "error":
        if (message.code === "rate_limited") {
          this.update({ bounced: this.lastSaid });
          this.notice(RATE_LIMITED_TEXT);
        } else if (message.code === "invalid_channel") {
          this.notice(UNAVAILABLE_TEXT);
        }
        return;
      default:
        return;
    }
  }

  private line(wire: ChatLineWire): ChatLine {
    const userId = Number(wire.userId);
    return {
      kind: "line",
      id: this.nextId++,
      userId,
      name: String(wire.displayName ?? ""),
      body: String(wire.body ?? ""),
      ts: Number(wire.ts) || 0,
      own: this.state.self?.userId === userId,
    };
  }

  private notice(text: string): void {
    this.append({ kind: "notice", id: this.nextId++, text });
  }

  private append(entry: ChatEntry): void {
    this.update({ entries: [...this.state.entries, entry].slice(-MAX_ENTRIES) });
  }

  private sendRaw(message: object): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // A socket mid-close; its onclose brings the retry.
    }
  }

  private update(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener(this.state);
  }
}

/** The one world chat of the signed-in player. */
export const worldChat = new ChatSession();
