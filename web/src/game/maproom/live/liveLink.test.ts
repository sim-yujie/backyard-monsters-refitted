import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_MS, FIRST_RETRY_MS, LiveLink, MAX_RETRY_MS, PING_MS, WATCH_DEBOUNCE_MS, type LiveSocketLike } from "./liveLink";

/** The live map's connection (beta 9): sign-in, watch, version check, quiet reconnects. */

class FakeSocket implements LiveSocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  opened() {
    this.readyState = 1;
    this.onopen?.();
  }
  hear(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

let sockets: FakeSocket[];
let watch: number[];
let versions: { pairs: [number, number][]; all: boolean }[];
let sights: number;
let status: boolean[];

const make = (token: string | null = "tok") =>
  new LiveLink({
    url: "ws://x",
    token: () => token,
    watchList: () => watch,
    onVersions: (pairs, all) => versions.push({ pairs, all }),
    onSight: () => (sights += 1),
    onStatus: (up) => status.push(up),
    socket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: { setTimeout, clearTimeout, setInterval, clearInterval },
  });

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  watch = [1, 2];
  versions = [];
  sights = 0;
  status = [];
});
afterEach(() => vi.useRealTimers());

const signIn = (link: LiveLink) => {
  link.start();
  const socket = sockets.at(-1)!;
  socket.opened();
  socket.hear({ type: "live.ok" });
  return socket;
};

describe("LiveLink", () => {
  it("signs in with the game token and watches at once", () => {
    const link = make();
    const socket = signIn(link);
    expect(socket.sent[0]).toEqual({ type: "live.auth", token: "tok" });
    expect(socket.sent[1]).toEqual({ type: "live.watch", z: [1, 2] });
    expect(link.up).toBe(true);
    expect(status).toEqual([true]);
  });

  it("passes on pushes and watch answers, and sight nudges", () => {
    const socket = signIn(make());
    socket.hear({ type: "live.zones", z: [[1, 4]] });
    socket.hear({ type: "live.zones", all: 1, z: [[1, 4], [2, 0], ["x", 1]] });
    socket.hear({ type: "live.sight" });
    expect(versions).toEqual([
      { pairs: [[1, 4]], all: false },
      { pairs: [[1, 4], [2, 0]], all: true },
    ]);
    expect(sights).toBe(1);
  });

  it("a pan sends one watch once it settles, and none when the list did not change", () => {
    const link = make();
    const socket = signIn(link);
    socket.sent.length = 0;
    link.viewChanged();
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS);
    expect(socket.sent).toEqual([]);
    watch = [3];
    link.viewChanged();
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS / 2);
    link.viewChanged();
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS);
    expect(socket.sent).toEqual([{ type: "live.watch", z: [3] }]);
  });

  it("checks versions every 5 minutes and pings inside the idle timeout", () => {
    const socket = signIn(make());
    socket.sent.length = 0;
    vi.advanceTimersByTime(CHECK_MS);
    expect(socket.sent.filter((m) => m.type === "live.watch")).toHaveLength(1);
    expect(socket.sent.filter((m) => m.type === "live.ping").length).toBe(Math.floor(CHECK_MS / PING_MS));
  });

  it("reconnects quietly with growing waits, and watches again (the catch-up) once back", () => {
    const link = make();
    signIn(link);
    sockets.at(-1)!.drop();
    expect(link.up).toBe(false);
    expect(status).toEqual([true, false]);
    vi.advanceTimersByTime(FIRST_RETRY_MS);
    expect(sockets).toHaveLength(2);
    sockets.at(-1)!.drop();
    vi.advanceTimersByTime(FIRST_RETRY_MS);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(FIRST_RETRY_MS);
    expect(sockets).toHaveLength(3);
    for (let i = 0; i < 10; i++) {
      sockets.at(-1)!.drop();
      vi.advanceTimersByTime(MAX_RETRY_MS);
    }
    const back = sockets.at(-1)!;
    back.opened();
    back.hear({ type: "live.ok" });
    expect(back.sent.at(-1)).toEqual({ type: "live.watch", z: [1, 2] });
    expect(link.up).toBe(true);
  });

  it("a check while down reconnects at once; stop ends everything", () => {
    const link = make();
    signIn(link);
    sockets.at(-1)!.drop();
    link.check();
    expect(sockets).toHaveLength(2);
    link.stop();
    vi.advanceTimersByTime(MAX_RETRY_MS * 4);
    expect(sockets).toHaveLength(2);
  });

  it("no token: the socket closes and tries again later", () => {
    const link = make(null);
    link.start();
    sockets[0]!.opened();
    expect(sockets[0]!.sent).toEqual([]);
    vi.advanceTimersByTime(FIRST_RETRY_MS);
    expect(sockets).toHaveLength(2);
    link.stop();
  });
});
