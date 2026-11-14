import type { ChatAlliance, ChatConfig, ChatLineWire, ChatServerMessage } from "@/api/chat";
import { photoVersionOf } from "@/game/playerPicture";
import { onWorldChatChange, worldChatOn } from "./worldChatSetting";

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
 *
 * The player's "World chat" switch (`worldChatSetting.ts`) turns it off: no
 * socket at all, whatever the yard loads hand it, until it is turned on again
 * and connects with the last settings it was handed.
 *
 * Besides Global, a player whose country has a room (owner 3 Nov 2026) is in
 * that room too, on the same socket: the yard load names it, the server lets
 * them in only from their stored country. The box shows one room at a time
 * (`channel`); lines in the other are kept and marked unread.
 *
 * A player in an alliance (beta 7) has a third room between the two: the
 * Alliance room (design v5 §7c). The client asks for it by the server's alias
 * ({@link ALLIANCE_ROOM}); the server picks the player's own alliance's room
 * and answers with its real name, which this session keeps for saying lines
 * there. Leaving or being kicked from the alliance closes the tab: the server
 * says "left", or the next yard load names no alliance. Its automatic lines
 * (joins, leaves, under-attack alerts) are marked `auto`, an alert with its cell.
 */

/** A line someone said in the room. */
export interface ChatLine {
  readonly kind: "line";
  readonly id: number;
  readonly userId: number;
  /** `[level] name`, as the server stamped the line. */
  readonly name: string;
  /** The speaker's critter (`pic_square`), null for their default; with `photo`, their picture. */
  readonly pic: string | null;
  /** The speaker's visible photo's upload number; undefined for their critter (`game/playerPicture.ts`). */
  readonly photo: number | undefined;
  readonly body: string;
  /** When it was said, ms since the epoch; with `userId`, what a report names. */
  readonly ts: number;
  /** Said by this player. */
  readonly own: boolean;
  /** Said by the game team (the server's mark). */
  readonly gm: boolean;
  /** Said by a chat moderator (the server's mark); false whenever `gm` is true. */
  readonly mod: boolean;
  /** An Alliance room's automatic line (a join, a leave, an under-attack alert), not something a member said. */
  readonly auto: boolean;
  /** The map cell an automatic line is about (an under-attack alert), for Show on map; else null. */
  readonly cell: { readonly x: number; readonly y: number } | null;
  /** A trade request line's request, for Give (design v5 §7c); else null. */
  readonly tradeRequest: number | null;
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

/** A room the player is in: Global, their alliance's room, or their country's room. */
export interface ChatRoom {
  readonly channel: string;
  readonly kind: "global" | "alliance" | "country";
  /** The country's ISO code, for a country room's tab. */
  readonly country: string | null;
  /** The alliance, for the Alliance room's tab; absent on the others. */
  readonly alliance?: ChatAlliance;
}

/**
 * The Alliance room's channel in {@link ChatState}: the server's alias for
 * "my alliance's room" (`ALLIANCE_CHANNEL_ALIAS`), so the room keeps one name
 * whichever alliance it is.
 */
export const ALLIANCE_ROOM = "alliance";
/** How the server names alliance rooms (`chatChannels.ts` `allianceChannelKey`). */
const ALLIANCE_KEY_PREFIX = "chat:alliance:";
/** How the server names country rooms (`ChatConfig.ts` `COUNTRY_CHANNEL_PREFIX`). */
const COUNTRY_PREFIX = "chat:country:";

export interface ChatState {
  readonly status: ChatStatus;
  /** The shown room's lines and the client's notices, oldest first; muted players' lines included. */
  readonly entries: readonly ChatEntry[];
  /** Who this player has muted (the server's ignore list). */
  readonly muted: ReadonlySet<number>;
  /** This player, once the server has said who they are. */
  readonly self: { readonly userId: number; readonly name: string } | null;
  /** The room shown: Global, the Alliance room ({@link ALLIANCE_ROOM}) or the country room. */
  readonly channel: string | null;
  /** Global first, then the Alliance room and the country room when the player has them. */
  readonly rooms: readonly ChatRoom[];
  /** Rooms not shown that have new lines since they were last shown. */
  readonly unread: ReadonlySet<string>;
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

/** What a muted player is told when a line is turned away. */
export const mutedText = (until: number | undefined): string => {
  if (!until || !Number.isFinite(until)) return "Your chat is paused by the game team.";
  const when = new Date(until).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Your chat is paused until ${when}.`;
};

/** Word from the game team on the chat connection: a ban (signed out), or a warning to show. */
export type TeamEvent =
  | {
      readonly kind: "banned";
      readonly text: string;
      readonly until: number | null;
      /** The game team's reason alone. */
      readonly reason: string;
    }
  | { readonly kind: "notice" };

/** Visible lines: everything but the muted players' lines. */
export const visibleEntries = (state: ChatState): ChatEntry[] =>
  state.entries.filter((entry) => entry.kind === "notice" || !state.muted.has(entry.userId));

const sameConfig = (a: ChatConfig | null, b: ChatConfig): boolean =>
  !!a &&
  a.url === b.url &&
  a.userId === b.userId &&
  a.token === b.token &&
  a.channel === b.channel &&
  (a.countryChannel ?? null) === (b.countryChannel ?? null) &&
  sameAlliance(a.alliance ?? null, b.alliance ?? null);

const sameAlliance = (a: ChatAlliance | null, b: ChatAlliance | null): boolean =>
  a === b || (!!a && !!b && a.id === b.id && a.name === b.name && a.image === b.image);

/** The rooms a config puts the player in: Global | Alliance | Country (design v5 §7c). */
const roomsOf = (config: ChatConfig): ChatRoom[] => {
  const rooms: ChatRoom[] = [{ channel: config.channel, kind: "global", country: null }];
  if (config.alliance) {
    rooms.push({ channel: ALLIANCE_ROOM, kind: "alliance", country: null, alliance: config.alliance });
  }
  if (config.countryChannel && config.countryChannel !== config.channel) {
    rooms.push({ channel: config.countryChannel, kind: "country", country: config.country ?? null });
  }
  return rooms;
};

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

/** Stopped or switched off: no room, nobody, nothing heard. */
const OFF_STATE: ChatState = {
  status: ChatStatus.OFF,
  entries: [],
  muted: new Set(),
  self: null,
  channel: null,
  rooms: [],
  unread: new Set(),
  bounced: null,
};

export class ChatSession {
  private config: ChatConfig | null = null;
  private socket: ChatSocket | null = null;
  private listeners = new Set<(state: ChatState) => void>();
  private teamListeners = new Set<(event: TeamEvent) => void>();
  private mailListeners = new Set<() => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Mutes and unmutes the server has not confirmed yet: a change made while
   * the socket was down (or mid-close) would otherwise be lost, and the
   * server's old list would bring a lifted mute back on the next connect.
   */
  private pendingMutes = new Map<number, boolean>();
  private retries = 0;
  /** The player's "World chat" switch; off, nothing connects. */
  private enabled = true;
  private nextId = 1;
  /** The last line said, for `bounced` if the server turns it away. */
  private lastSaid: string | null = null;
  /** Every room's entries, the shown one's included. */
  private roomEntries = new Map<string, readonly ChatEntry[]>();
  /** Rooms the server said "joined" for on this socket. */
  private joined = new Set<string>();
  /** The Alliance room's real name on the server (`chat:alliance:<id>`), once it said "joined". */
  private allianceKey: string | null = null;
  private state: ChatState = {
    status: ChatStatus.OFF,
    entries: [],
    muted: new Set(),
    self: null,
    channel: null,
    rooms: [],
    unread: new Set(),
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

  /** Calls `listener` on each word from the game team (ban, warning); returns the way to stop. */
  /**
   * New mail for the player (owner, beta 7): the server says only that some
   * came; the listener asks the mail routes what (`game/mail/mailWatch.ts`).
   */
  onMail(listener: () => void): () => void {
    this.mailListeners.add(listener);
    return () => {
      this.mailListeners.delete(listener);
    };
  }

  /** Connected and in a room: the server's mail news arrives here, so no need to ask on a timer. */
  get online(): boolean {
    return this.state.status === ChatStatus.ONLINE;
  }

  onTeam(listener: (event: TeamEvent) => void): () => void {
    this.teamListeners.add(listener);
    return () => {
      this.teamListeners.delete(listener);
    };
  }

  /**
   * Takes the token and room from an own-yard load and connects if need be.
   *
   * The same settings again change nothing, so every yard load may call it. A
   * new token alone is kept for the next connect; a new room (a move between
   * Map Rooms) is changed over on the open socket.
   */
  configure(next: ChatConfig): void {
    // No word on the alliance (a load other than the main yard's): it stays as it was.
    const config: ChatConfig = next.alliance === undefined ? { ...next, alliance: this.config?.alliance ?? null } : next;
    if (!this.enabled) {
      // Kept for when the player turns world chat back on.
      this.config = config;
      return;
    }
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
    // A move between Map Rooms changes Global; a country change, the country
    // room; joining, leaving or changing alliance, the Alliance room.
    const before = this.state.rooms;
    const after = roomsOf(config);
    const online = this.state.status === ChatStatus.ONLINE;
    // Another alliance keeps the room's name but is another room on the server.
    const otherAlliance = (previous?.alliance?.id ?? null) !== (config.alliance?.id ?? null);
    const kept = (room: ChatRoom, rooms: readonly ChatRoom[]): boolean =>
      rooms.some((other) => other.channel === room.channel) && !(room.kind === "alliance" && otherAlliance);
    for (const room of before) {
      if (kept(room, after)) continue;
      this.roomEntries.delete(room.channel);
      this.joined.delete(room.channel);
      if (online) this.sendRaw({ type: "leave", channel: this.wireOf(room.channel) });
      if (room.kind === "alliance") this.allianceKey = null;
    }
    for (const room of after) {
      if (kept(room, before)) continue;
      this.roomEntries.set(room.channel, []);
      if (online) this.sendRaw({ type: "join", channel: room.channel });
    }
    const shown = after.some((room) => room.channel === this.state.channel)
      ? this.state.channel
      : config.channel;
    const unread = new Set(
      [...this.state.unread].filter((channel) => after.some((room) => room.channel === channel)),
    );
    this.show({ rooms: after, channel: shown, unread });
  }

  /**
   * The player's country changed in Account settings or the prompt: the
   * country room the server now gives them (null: none), joined or left at
   * once, without waiting for the next yard load.
   */
  setCountryRoom(countryChannel: string | null, country: string | null): void {
    const config = this.config;
    if (!config) return;
    this.configure({ ...config, countryChannel, country });
  }

  /**
   * The player joined, made, left or changed alliance (the Alliance window
   * found out): the Alliance room opens or closes at once, without waiting for
   * the next yard load.
   */
  setAllianceRoom(alliance: ChatAlliance | null): void {
    const config = this.config;
    if (!config || sameAlliance(config.alliance ?? null, alliance)) return;
    this.configure({ ...config, alliance });
  }

  /** Shows another of the player's rooms in the box. */
  showRoom(channel: string): void {
    if (channel === this.state.channel || !this.state.rooms.some((room) => room.channel === channel)) return;
    const unread = new Set(this.state.unread);
    unread.delete(channel);
    this.show({ channel, unread });
  }

  /** Connects again after another connection took over (the box's "Reconnect"). */
  reconnect(): void {
    if (this.enabled && this.config && this.state.status !== ChatStatus.ONLINE) this.connect();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * The player's "World chat" switch. Off closes the socket and empties the
   * room, keeping the last yard load's settings; On connects with them again
   * (or waits for the next yard load when there are none).
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      if (this.config) this.connect();
      return;
    }
    this.drop();
    this.retries = 0;
    this.update(OFF_STATE);
  }

  /** Closes the socket and forgets everything: signing out, or the idle disconnect. */
  stop(): void {
    this.config = null;
    this.drop();
    this.retries = 0;
    this.update(OFF_STATE);
    this.roomEntries.clear();
    this.joined.clear();
  }

  /**
   * Says a line in the shown room. False, and nothing sent, when the line is
   * empty or the room is not joined.
   */
  say(text: string): boolean {
    const body = text.trim().slice(0, MAX_LINE_LENGTH);
    const channel = this.state.channel;
    if (!body || !channel || this.state.status !== ChatStatus.ONLINE || !this.joined.has(channel)) {
      return false;
    }
    this.lastSaid = body;
    if (this.state.bounced !== null) this.update({ bounced: null });
    this.sendRaw({ type: "say", channel: this.wireOf(channel), message: body });
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
    this.pendingMutes.set(userId, muted);
    this.sendMute(userId, muted);
  }

  private sendMute(userId: number, muted: boolean): void {
    this.sendRaw({ type: muted ? "ignore" : "unignore", targetId: String(userId) });
  }

  private connect(): void {
    const config = this.config;
    if (!config) return;
    this.drop();
    const rooms = roomsOf(config);
    const kept = rooms.some((room) => room.channel === this.state.channel) ? this.state.channel : config.channel;
    for (const channel of [...this.roomEntries.keys()]) {
      if (!rooms.some((room) => room.channel === channel)) this.roomEntries.delete(channel);
    }
    for (const room of rooms) if (!this.roomEntries.has(room.channel)) this.roomEntries.set(room.channel, []);
    this.show({
      status: this.retries > 0 ? ChatStatus.RECONNECTING : ChatStatus.CONNECTING,
      rooms,
      channel: kept,
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
    this.joined.clear();
    this.allianceKey = null;
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
        this.update({ self: { userId: message.userId, name: message.displayName } });
        for (const room of this.state.rooms) this.sendRaw({ type: "join", channel: room.channel });
        for (const [userId, muted] of this.pendingMutes) this.sendMute(userId, muted);
        this.sendRaw({ type: "getignore" });
        this.pingTimer = setInterval(() => this.sendRaw({ type: "ping" }), PING_INTERVAL_MS);
        return;
      }
      case "auth_fail":
        this.drop();
        this.update({ status: ChatStatus.SIGNED_OUT });
        return;
      case "joined": {
        const channel = this.roomOf(message.channel);
        const room = this.state.rooms.find((candidate) => candidate.channel === channel);
        if (!room) return;
        if (room.kind === "alliance") this.allianceKey = message.channel;
        this.joined.add(room.channel);
        this.roomEntries.set(
          room.channel,
          (Array.isArray(message.history) ? message.history : []).map((line) => this.line(line)),
        );
        if (room.kind === "global") {
          this.retries = 0;
          this.show({ status: ChatStatus.ONLINE });
        } else {
          this.show({});
        }
        return;
      }
      case "message": {
        const channel = this.roomOf(message.channel);
        if (!this.roomEntries.has(channel)) return;
        this.append(this.line(message), channel);
        return;
      }
      case "left":
        if (this.roomOf(message.channel) === ALLIANCE_ROOM) this.dropAllianceRoom();
        return;
      case "name_update":
        if (this.state.self && message.userId === this.state.self.userId) {
          this.update({ self: { userId: message.userId, name: message.displayName } });
        }
        return;
      case "ignore_list": {
        const muted = new Set(
          (Array.isArray(message.list) ? message.list : [])
            .map((entry) => Number(entry.target))
            .filter((id) => Number.isInteger(id)),
        );
        // A change the server has not taken yet still wins; one it has is settled.
        for (const [userId, want] of this.pendingMutes) {
          if (muted.has(userId) === want) this.pendingMutes.delete(userId);
          else if (want) muted.add(userId);
          else muted.delete(userId);
        }
        this.update({ muted });
        return;
      }
      case "error":
        if (message.code === "rate_limited") {
          this.update({ bounced: this.lastSaid });
          this.notice(RATE_LIMITED_TEXT);
        } else if (message.code === "invalid_channel") {
          this.refused(message.channel);
        } else if (message.code === "muted") {
          this.update({ bounced: this.lastSaid });
          this.notice(mutedText(message.until));
        }
        return;
      case "kicked": {
        this.drop();
        this.update({ status: ChatStatus.SIGNED_OUT });
        const event: TeamEvent = {
          kind: "banned",
          text: String(message.text ?? ""),
          until: typeof message.until === "number" ? message.until : null,
          reason: String(message.banReason ?? ""),
        };
        for (const listener of [...this.teamListeners]) listener(event);
        return;
      }
      case "notice":
        for (const listener of [...this.teamListeners]) listener({ kind: "notice" });
        return;
      case "mail":
        for (const listener of [...this.mailListeners]) listener();
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
      pic: typeof wire.picSquare === "string" && wire.picSquare ? wire.picSquare : null,
      photo: photoVersionOf(wire.photo),
      body: String(wire.body ?? ""),
      ts: Number(wire.ts) || 0,
      own: this.state.self?.userId === userId,
      gm: wire.gm === true,
      mod: wire.mod === true && wire.gm !== true,
      auto: typeof wire.messageType === "string" && wire.messageType !== "message",
      cell:
        wire.cell && Number.isInteger(wire.cell.x) && Number.isInteger(wire.cell.y)
          ? { x: wire.cell.x, y: wire.cell.y }
          : null,
      tradeRequest: Number.isInteger(wire.tradeRequest) && Number(wire.tradeRequest) > 0 ? Number(wire.tradeRequest) : null,
    };
  }

  /** The room a channel the server names belongs to: the Alliance room for its real name. */
  private roomOf(wire: string): string {
    if (wire === this.allianceKey) return ALLIANCE_ROOM;
    const alliance = this.state.rooms.some((room) => room.kind === "alliance");
    return alliance && this.allianceKey === null && wire.startsWith(ALLIANCE_KEY_PREFIX) ? ALLIANCE_ROOM : wire;
  }

  /** What to name a room to the server: the Alliance room by its real name once known. */
  private wireOf(channel: string): string {
    return channel === ALLIANCE_ROOM ? (this.allianceKey ?? ALLIANCE_ROOM) : channel;
  }

  /** The player is no longer in an alliance: its tab goes, and Global shows if it was showing. */
  private dropAllianceRoom(): void {
    if (this.config) this.config = { ...this.config, alliance: null };
    this.allianceKey = null;
    this.dropRoom("alliance");
  }

  /** Takes a room's tab and lines away; Global shows instead if it was the one showing. */
  private dropRoom(kind: "alliance" | "country"): void {
    const room = this.state.rooms.find((candidate) => candidate.kind === kind);
    if (!room) return;
    const global = this.state.rooms.find((candidate) => candidate.kind === "global");
    this.roomEntries.delete(room.channel);
    this.joined.delete(room.channel);
    const unread = new Set(this.state.unread);
    unread.delete(room.channel);
    this.show({
      rooms: this.state.rooms.filter((candidate) => candidate !== room),
      channel: this.state.channel === room.channel ? (global?.channel ?? null) : this.state.channel,
      unread,
    });
  }

  /**
   * The server turned a join down. It names the room it refused: the Alliance
   * room (the player left the alliance elsewhere) or a country room (the
   * country changed elsewhere, or its room closed) loses its tab and Global
   * carries on. An older server names none: with Global joined and the country
   * room not, it was the country room. Otherwise it was Global.
   */
  private refused(channel?: string): void {
    if (channel === ALLIANCE_ROOM) {
      this.dropAllianceRoom();
      return;
    }
    if (channel?.startsWith(COUNTRY_PREFIX) && this.state.rooms.some((room) => room.channel === channel)) {
      if (this.config) this.config = { ...this.config, countryChannel: null, country: null };
      this.dropRoom("country");
      return;
    }
    const country = this.state.rooms.find((room) => room.kind === "country");
    const global = this.state.rooms.find((room) => room.kind === "global");
    if (!country || !global || !this.joined.has(global.channel) || this.joined.has(country.channel)) {
      this.notice(UNAVAILABLE_TEXT);
      return;
    }
    if (this.config) this.config = { ...this.config, countryChannel: null, country: null };
    this.roomEntries.delete(country.channel);
    const unread = new Set(this.state.unread);
    unread.delete(country.channel);
    this.show({
      rooms: this.state.rooms.filter((room) => room !== country),
      channel: this.state.channel === country.channel ? global.channel : this.state.channel,
      unread,
    });
  }

  private notice(text: string): void {
    const channel = this.state.channel;
    if (channel) this.append({ kind: "notice", id: this.nextId++, text }, channel);
  }

  private append(entry: ChatEntry, channel: string): void {
    const before = this.roomEntries.get(channel) ?? [];
    this.roomEntries.set(channel, [...before, entry].slice(-MAX_ENTRIES));
    if (channel === this.state.channel || entry.kind !== "line" || this.state.unread.has(channel)) {
      this.show({});
      return;
    }
    this.show({ unread: new Set([...this.state.unread, channel]) });
  }

  /** Updates the state, the shown room's entries brought in from {@link roomEntries}. */
  private show(patch: Partial<ChatState>): void {
    const channel = patch.channel !== undefined ? patch.channel : this.state.channel;
    this.update({ ...patch, entries: (channel && this.roomEntries.get(channel)) || [] });
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

/** The one world chat of the signed-in player, on or off with the player's switch. */
export const worldChat = new ChatSession();
worldChat.setEnabled(worldChatOn());
onWorldChatChange((on) => worldChat.setEnabled(on));
