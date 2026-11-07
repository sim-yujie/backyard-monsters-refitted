import { chatSocketUrl, type ChatLineWire, type ChatServerMessage } from "@/api/chat";
import { fetchChatSession, type AdminChatSession } from "./api";
import { h, replace } from "./dom";
import { roomLabel } from "./moderation";
import { errorWords } from "./shiny";

/**
 * The Chat section: the owner chats as the game team, from the dashboard.
 *
 * It signs in to the chat server with the owner's own account (the server
 * hands out the chat token), joins every world room and the owner's country
 * room, and shows each room's history and new lines. The server marks the
 * owner's lines with the GM badge. Clicking a name opens that player in the
 * Moderation section.
 *
 * One chat connection per account: joining here closes the chat in the
 * owner's own game, and the game opening chat closes this one. So it only
 * connects when the owner presses Join, and does not fight back when the
 * game takes over.
 */

/** The browser socket, or a test's stand-in. */
export interface PanelSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
}

export type PanelSocketFactory = (url: string) => PanelSocket;

const browserSocket: PanelSocketFactory = (url) => {
  const ws = new WebSocket(url);
  const socket: PanelSocket = {
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

/** The server drops a quiet socket after 120 s. */
export const PING_MS = 45_000;
/** Each room keeps this many lines, as the server's history does. */
export const MAX_LINES = 100;
/** The longest line the server keeps. */
export const MAX_LINE = 200;
const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;
const NORMAL_CLOSURE = 1000;

type Status = "off" | "connecting" | "online" | "retrying" | "elsewhere";

const STATUS_WORDS: Record<Status, string> = {
  off: "Not in chat",
  connecting: "Joining…",
  online: "In chat as the game team",
  retrying: "Connection lost, trying again…",
  elsewhere: "Chat was opened somewhere else",
};

interface Room {
  channel: string;
  label: string;
  lines: ChatLineWire[];
  joined: boolean;
  unread: number;
}

/** "14:05", the viewer's own time. */
const clock = (ts: number): string => {
  const at = new Date(ts);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
};

/** "[12] Name" → "Name": the level is shown apart. */
export const splitName = (displayName: string): { level: string | null; name: string } => {
  const match = /^\[(\d+)\]\s*(.*)$/.exec(displayName);
  return match ? { level: match[1]!, name: match[2]! } : { level: null, name: displayName };
};

export interface ChatPanelOptions {
  openPlayer(userid: number): void;
  say(message: string): void;
  socket?: PanelSocketFactory;
  secure?: boolean;
}

export class ChatPanel {
  readonly element = h("div", { class: "admin-chat" });
  private readonly statusText = h("span", { class: "chat-status-text" });
  private readonly statusDot = h("span", { class: "chat-dot", attrs: { "aria-hidden": "true" } });
  private readonly joinButton = h("button", { class: "button primary", attrs: { type: "button" } }, "Join chat");
  private readonly tabs = h("div", { class: "segmented chat-tabs", attrs: { role: "tablist", "aria-label": "Rooms" } });
  private readonly log = h("ol", { class: "chat-log", attrs: { "aria-live": "polite" } });
  private readonly input = h("input", {
    class: "field-input",
    attrs: {
      type: "text",
      maxlength: String(MAX_LINE),
      autocomplete: "off",
      enterkeyhint: "send",
      placeholder: "Write to the room",
      "aria-label": "Your line",
    },
  });
  private readonly sendButton = h("button", { class: "button primary", attrs: { type: "submit" } }, "Send");
  private readonly problem = h("p", { class: "form-error", attrs: { role: "alert", hidden: "" } });
  private readonly makeSocket: PanelSocketFactory;
  private readonly secure: boolean;
  private status: Status = "off";
  private rooms: Room[] = [];
  private current: string | null = null;
  private session: AdminChatSession | null = null;
  private socket: PanelSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  /** The owner pressed Leave: no retry. */
  private leaving = false;

  constructor(private readonly options: ChatPanelOptions) {
    this.makeSocket = options.socket ?? browserSocket;
    this.secure = options.secure ?? (typeof location !== "undefined" && location.protocol === "https:");
    this.joinButton.addEventListener("click", () => {
      if (this.status === "off" || this.status === "elsewhere") void this.join();
      else this.leave();
    });
    const form = h(
      "form",
      { class: "chat-send", attrs: { "aria-label": "Write in chat" } },
      this.input,
      this.sendButton,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.sendLine();
    });
    replace(
      this.element,
      h(
        "p",
        { class: "lede" },
        "Your lines carry the GM badge. Joining here closes the chat in your own game: " +
          "one account has one chat at a time. Click a name to open that player in Moderation.",
      ),
      h(
        "div",
        { class: "chat-bar" },
        h("span", { class: "chat-status" }, this.statusDot, this.statusText),
        this.joinButton,
      ),
      this.problem,
      h("div", { class: "chat-box" }, this.tabs, this.log, form),
    );
    this.render();
  }

  /** Signs in to the chat server and joins the rooms. */
  async join(): Promise<void> {
    this.leaving = false;
    this.setProblem(null);
    this.setStatus("connecting");
    try {
      this.session = await fetchChatSession();
    } catch (err) {
      this.setStatus("off");
      this.setProblem(`Could not join chat: ${errorWords(err)}`);
      return;
    }
    if (this.leaving) return;
    const known = new Map(this.rooms.map((room) => [room.channel, room]));
    this.rooms = this.session.rooms.map((room) => ({
      channel: room.channel,
      // A country room's label is its code ("PH"): show the country's name.
      label: room.channel.startsWith("chat:country:") ? roomLabel(room.channel) : room.label,
      lines: known.get(room.channel)?.lines ?? [],
      joined: false,
      unread: 0,
    }));
    if (!this.current || !known.has(this.current)) this.current = this.rooms[0]?.channel ?? null;
    this.connect();
  }

  /** Leaves chat; the game can have it back. */
  leave(): void {
    this.leaving = true;
    this.drop();
    this.setStatus("off");
  }

  private connect(): void {
    const session = this.session;
    if (!session) return;
    this.drop();
    const socket = this.makeSocket(chatSocketUrl(session.server, this.secure));
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "auth", userId: session.userId, token: session.token }));
    socket.onmessage = (event) => {
      if (socket !== this.socket || typeof event.data !== "string") return;
      let message: ChatServerMessage;
      try {
        message = JSON.parse(event.data) as ChatServerMessage;
      } catch {
        return;
      }
      this.receive(message);
    };
    socket.onclose = (event) => this.closed(socket, event.code);
  }

  private drop(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
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

  private closed(socket: PanelSocket, code: number): void {
    if (socket !== this.socket) return;
    const wasOnline = this.status === "online";
    this.drop();
    if (this.leaving) return;
    for (const room of this.rooms) room.joined = false;
    if (code === NORMAL_CLOSURE && wasOnline) {
      // The game (or another tab) opened chat on this account: let it have it.
      this.setStatus("elsewhere");
      return;
    }
    const wait = Math.min(FIRST_RETRY_MS * 2 ** this.retries, MAX_RETRY_MS);
    this.retries += 1;
    this.setStatus("retrying");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.join();
    }, wait);
  }

  private receive(message: ChatServerMessage): void {
    switch (message.type) {
      case "auth_ok":
        for (const room of this.rooms) this.raw({ type: "join", channel: room.channel });
        this.pingTimer = setInterval(() => this.raw({ type: "ping" }), PING_MS);
        return;
      case "auth_fail":
        this.leave();
        this.setProblem("The chat server did not accept the sign-in. Press Join chat to try again.");
        return;
      case "joined": {
        const room = this.rooms.find((r) => r.channel === message.channel);
        if (!room) return;
        room.joined = true;
        room.lines = (Array.isArray(message.history) ? message.history : []).slice(-MAX_LINES);
        this.retries = 0;
        this.setStatus("online");
        return;
      }
      case "message": {
        const room = this.rooms.find((r) => r.channel === message.channel);
        if (!room) return;
        const { userId, displayName, body, ts, gm, mod } = message;
        room.lines = [...room.lines, { userId, displayName, body, ts, ...(gm && { gm }), ...(mod && { mod }) }].slice(-MAX_LINES);
        if (room.channel !== this.current) room.unread += 1;
        this.render();
        return;
      }
      case "error":
        if (message.code === "rate_limited") this.setProblem("Too fast: wait a moment, then send again.");
        else if (message.code === "muted") this.setProblem("This account's chat is paused.");
        else if (message.code === "invalid_channel") this.setProblem("One of the rooms could not be joined.");
        else this.setProblem(`Chat said: ${message.code}`);
        return;
      case "kicked":
        this.leave();
        this.setProblem(message.text);
        return;
      default:
        return;
    }
  }

  private raw(message: object): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // The close handler takes over.
    }
  }

  private sendLine(): void {
    const text = this.input.value.trim().slice(0, MAX_LINE);
    if (!text || this.status !== "online" || !this.current) return;
    this.setProblem(null);
    this.raw({ type: "say", channel: this.current, message: text });
    this.input.value = "";
    this.input.focus();
  }

  private setProblem(text: string | null): void {
    this.problem.hidden = text === null;
    this.problem.textContent = text ?? "";
  }

  private setStatus(status: Status): void {
    this.status = status;
    if (status === "off") for (const room of this.rooms) room.joined = false;
    this.render();
  }

  private pick(channel: string): void {
    this.current = channel;
    const room = this.rooms.find((r) => r.channel === channel);
    if (room) room.unread = 0;
    this.render();
    this.log.scrollTop = this.log.scrollHeight;
  }

  private render(): void {
    this.statusText.textContent = STATUS_WORDS[this.status];
    this.statusDot.className = `chat-dot chat-dot-${this.status}`;
    const on = this.status === "online" || this.status === "connecting" || this.status === "retrying";
    this.joinButton.textContent = on ? "Leave chat" : this.status === "elsewhere" ? "Join again" : "Join chat";
    this.joinButton.className = on ? "button quiet" : "button primary";
    this.input.disabled = this.status !== "online";
    this.sendButton.disabled = this.status !== "online";

    replace(
      this.tabs,
      ...this.rooms.map((room) =>
        h(
          "button",
          {
            class: "seg chat-tab",
            attrs: {
              type: "button",
              role: "tab",
              "aria-selected": String(room.channel === this.current),
              "aria-pressed": String(room.channel === this.current),
              "data-channel": room.channel,
            },
            onClick: () => this.pick(room.channel),
          },
          room.label,
          room.unread ? h("span", { class: "chat-unread" }, String(room.unread)) : null,
        ),
      ),
    );

    const room = this.rooms.find((r) => r.channel === this.current);
    const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 60;
    if (!room) {
      replace(this.log, h("li", { class: "chat-empty" }, "Press Join chat to see the rooms."));
      return;
    }
    replace(
      this.log,
      ...(room.lines.length
        ? room.lines.map((line) => this.lineRow(line))
        : [h("li", { class: "chat-empty" }, room.joined ? "Nobody has said anything here lately." : "Not joined yet.")]),
    );
    if (nearBottom) this.log.scrollTop = this.log.scrollHeight;
  }

  private lineRow(line: ChatLineWire): HTMLElement {
    const { level, name } = splitName(line.displayName);
    return h(
      "li",
      { class: line.gm ? "chat-line is-gm" : line.mod ? "chat-line is-mod" : "chat-line" },
      h("time", { class: "chat-time", attrs: { datetime: new Date(line.ts).toISOString() } }, clock(line.ts)),
      h(
        "span",
        { class: "chat-body" },
        line.gm ? h("span", { class: "chip chip-good chat-gm", attrs: { title: "Game team" } }, "GM") : null,
        !line.gm && line.mod ? h("span", { class: "chip chip-info chat-gm chat-mod", attrs: { title: "Moderator" } }, "Mod") : null,
        level ? h("span", { class: "chat-level" }, level) : null,
        h(
          "button",
          {
            class: "chat-name",
            attrs: { type: "button", title: `Open ${name} in Moderation`, "data-user": String(line.userId) },
            onClick: () => this.options.openPlayer(line.userId),
          },
          name,
        ),
        " ",
        line.body,
      ),
    );
  }
}
