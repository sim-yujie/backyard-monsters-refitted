/**
 * The live map's connection (beta 9, stages 1-2): one WebSocket to the chat
 * server's port, signed in with the game's own token (`live.auth`), so it
 * works with World chat switched off. It brings the changed cells themselves
 * (`live.cells`, cut by the server to the player's fog; `live.own`, the
 * player's own cells in full), zones to ask again (`live.zones` versions;
 * `live.redo`, the players whose relation to this one changed), and when the
 * player's fog of war changed (`live.sight`).
 *
 * - Catch-up: each push has an id; after a reconnect (or the tab coming back)
 *   the watch carries the last one the map took (`since`), and the server
 *   replays what it missed before the versions (`rp: 1`).
 * - Watch: the zones on screen (and the player's own), sent after a pan
 *   settles ({@link WATCH_DEBOUNCE_MS}) and only when the list changed.
 * - Version check: the same watch sent again every {@link CHECK_MS}; the
 *   answer holds every watched zone's version, so anything missed is asked.
 * - Down: reconnects quietly, 1 s doubling to 30 s (owner, 25 Nov 2026: no
 *   "not live" mark). The first watch answer after it is the catch-up. While
 *   down, the map falls back to re-asking every few minutes (`down`).
 *
 * No DOM and no game state here: the scene hands it what to watch and acts
 * on what it hears, so the rules are unit-tested with a fake socket.
 */

export const WATCH_DEBOUNCE_MS = 500;
export const CHECK_MS = 5 * 60_000;
export const PING_MS = 45_000;
export const FIRST_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 30_000;
/** Most zones one watch names (the server's cap). */
export const MAX_WATCH = 300;

export interface LiveSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type LiveSocketFactory = (url: string) => LiveSocketLike;

export interface LiveTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface LiveLinkOptions {
  url: string;
  /** The game session's token, read fresh on each sign-in. */
  token: () => string | null;
  /** The zones to watch now, own first (`ZoneStore.watchList`). */
  watchList: () => number[];
  /** Zone versions: `all` for a watch's answer (every watched zone), else a push of changed ones. */
  onVersions: (pairs: [number, number][], all: boolean) => void;
  /**
   * Changed cells (stage 2). Returns false when the map did not take them (a hidden tab): the push's
   * id is then not counted as seen, so the next catch-up replays it.
   */
  onCells?: (frame: LiveCellsFrame) => boolean;
  /** The player's own cells in full. */
  onOwn?: (cells: LiveCellsFrame["c"]) => void;
  /** Players whose relation to this one changed: ask again the zones holding their cells. */
  onRedo?: (owners: number[]) => void;
  /** The player's sight changed: ask `/worldmapv2/sight` again. */
  onSight: () => void;
  /** The connection came up or went down. */
  onStatus?: (up: boolean) => void;
  socket?: LiveSocketFactory;
  timers?: LiveTimers;
}

/** A `live.cells` frame: zones `[id, version, firstVersion?]`, cells `[x, y, payload]`. */
export interface LiveCellsFrame {
  id?: string;
  z: number[][];
  c: [number, number, unknown][];
  ad?: unknown;
  rz?: number[];
  rp?: 1;
}

const OPEN = 1;

/** `a` after `b` as push ids (`<ms>-<seq>`)? */
export const idAfter = (a: string, b: string | null): boolean => {
  if (!b) return true;
  const [am = 0, as = 0] = a.split("-").map(Number);
  const [bm = 0, bs = 0] = b.split("-").map(Number);
  return am > bm || (am === bm && as > bs);
};

const isPair = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length >= 2 && value.every((item) => typeof item === "number");

const isCell = (value: unknown): value is [number, number, unknown] =>
  Array.isArray(value) && value.length === 3 && typeof value[0] === "number" && typeof value[1] === "number";

const browserSocket: LiveSocketFactory = (url) => new WebSocket(url) as unknown as LiveSocketLike;

const browserTimers: LiveTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as number),
};

const sameList = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export class LiveLink {
  private socket: LiveSocketLike | null = null;
  private signedIn = false;
  private stopped = true;
  private retryMs = FIRST_RETRY_MS;
  private retryTimer: unknown = null;
  private watchTimer: unknown = null;
  private pingTimer: unknown = null;
  private checkTimer: unknown = null;
  private lastSent: number[] = [];
  /** The last push id the map took; sent as `since` to catch up after a break. */
  private lastId: string | null = null;
  private readonly open: LiveSocketFactory;
  private readonly timers: LiveTimers;

  constructor(private readonly options: LiveLinkOptions) {
    this.open = options.socket ?? browserSocket;
    this.timers = options.timers ?? browserTimers;
  }

  /** True while signed in and listening. */
  get up(): boolean {
    return this.signedIn;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  /** The map closed: no more reconnects. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    this.setSignedIn(false);
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.close();
    }
  }

  /** The view moved: watch the new zones once the pan settles. */
  viewChanged(): void {
    if (!this.signedIn) return;
    if (this.watchTimer !== null) this.timers.clearTimeout(this.watchTimer);
    this.watchTimer = this.timers.setTimeout(() => {
      this.watchTimer = null;
      this.sendWatch(false);
    }, WATCH_DEBOUNCE_MS);
  }

  /** The last push id taken (tests). */
  get seenId(): string | null {
    return this.lastId;
  }

  /** A version check now (tab back in focus: with a replay of what it skipped); a reconnect at once when down. */
  check(): void {
    if (this.signedIn) {
      this.sendWatch(true, true);
      return;
    }
    if (!this.stopped && this.retryTimer !== null) {
      this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.connect();
    }
  }

  private connect(): void {
    if (this.stopped) return;
    let socket: LiveSocketLike;
    try {
      socket = this.open(this.options.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      const token = this.options.token();
      if (!token) {
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ type: "live.auth", token }));
    };
    socket.onmessage = (event) => this.receive(event.data);
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setSignedIn(false);
      this.clearTimers();
      this.scheduleRetry();
    };
  }

  private receive(raw: unknown): void {
    let message: { type?: unknown; z?: unknown; u?: unknown; all?: unknown; c?: unknown; id?: unknown; ad?: unknown; rz?: unknown; rp?: unknown };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (message.type) {
      case "live.ok":
        this.retryMs = FIRST_RETRY_MS;
        this.setSignedIn(true);
        this.lastSent = [];
        // Back after a break: the server replays what this map missed since its last push.
        this.sendWatch(true, true);
        this.pingTimer = this.timers.setInterval(() => this.send({ type: "live.ping" }), PING_MS);
        this.checkTimer = this.timers.setInterval(() => this.sendWatch(true), CHECK_MS);
        return;
      case "live.zones": {
        if (!Array.isArray(message.z)) return;
        const pairs = message.z.filter(
          (pair): pair is [number, number] =>
            Array.isArray(pair) && typeof pair[0] === "number" && typeof pair[1] === "number",
        );
        this.options.onVersions(pairs, message.all === 1);
        return;
      }
      case "live.cells": {
        if (!Array.isArray(message.z) || !Array.isArray(message.c)) return;
        const frame: LiveCellsFrame = {
          z: message.z.filter(isPair),
          c: message.c.filter(isCell),
          ...(typeof message.id === "string" && { id: message.id }),
          ...(message.ad !== undefined && { ad: message.ad }),
          ...(Array.isArray(message.rz) && { rz: message.rz.filter((id): id is number => typeof id === "number") }),
          ...(message.rp === 1 && { rp: 1 as const }),
        };
        const taken = this.options.onCells?.(frame) ?? false;
        if (taken && frame.id && idAfter(frame.id, this.lastId)) this.lastId = frame.id;
        return;
      }
      case "live.own":
        if (Array.isArray(message.c)) this.options.onOwn?.(message.c.filter(isCell));
        return;
      case "live.redo":
        if (Array.isArray(message.u)) this.options.onRedo?.(message.u.filter((id): id is number => typeof id === "number"));
        return;
      case "live.sight":
        this.options.onSight();
        return;
    }
  }

  private sendWatch(force: boolean, catchUp = false): void {
    const list = this.options.watchList().slice(0, MAX_WATCH);
    if (!force && sameList(list, this.lastSent)) return;
    this.lastSent = list;
    this.send({ type: "live.watch", z: list, ...(catchUp && this.lastId && { since: this.lastId }) });
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private setSignedIn(up: boolean): void {
    if (this.signedIn === up) return;
    this.signedIn = up;
    this.options.onStatus?.(up);
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, wait);
  }

  private clearTimers(): void {
    for (const handle of [this.retryTimer, this.watchTimer]) if (handle !== null) this.timers.clearTimeout(handle);
    for (const handle of [this.pingTimer, this.checkTimer]) if (handle !== null) this.timers.clearInterval(handle);
    this.retryTimer = this.watchTimer = this.pingTimer = this.checkTimer = null;
  }
}
