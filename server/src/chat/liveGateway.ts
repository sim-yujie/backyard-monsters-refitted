import { CHAT_SOCKET_LIMITS } from "../config/SpamLimitConfig.js";
import type { SightMessage, ZonesMessage } from "../services/maproom/live/liveZones.js";
import type { SocketData } from "./chatState.js";

type ServerWebSocket<T> = import("bun").ServerWebSocket<T>;

/**
 * The live map's side of the chat socket server (beta 9, stage 1).
 *
 * The map opens its own connection to the chat port and signs in with
 * `live.auth` instead of chat's `auth`, so it works with World chat switched
 * off and never meets chat's one-connection-per-player rule. From then on
 * the socket only carries `live.*` frames:
 *
 * - `live.watch {z: [zoneId, ...]}`: the zones the map has on screen (at most
 *   {@link MAX_WATCHED}); replaces the last list, and is also the map's
 *   5-minute version check. Answered with `live.zones` holding every one of
 *   those zones' versions.
 * - `live.zones {z: [[zoneId, version], ...]}` pushed whenever zones the
 *   socket watches change (`liveZones.ts` publishes every half second), one frame
 *   per socket per bundle.
 * - `live.sight` pushed when the player's fog of war changed: the map asks
 *   `/worldmapv2/sight` again.
 * - `live.ping`: keeps the socket inside the server's idle timeout.
 *
 * The registry is this process's own (which socket watches what); zone
 * versions and every change come through Redis, so several socket servers
 * can run side by side (stage 3).
 */

/** Most zones one socket may watch: the map caches at most 300 (`ZoneStore.MAX_CACHED_ZONES`). */
export const MAX_WATCHED = 300;
/** Most live sockets per player (tabs); the load check raises it. */
export const maxSocketsPerPlayer = (): number => Number(process.env.LIVE_MAP_MAX_PER_USER) || 4;
/** Watch answers (a read of every watched zone's version) are at most this often per socket; the list itself always applies. */
export const MIN_WATCH_GAP_MS = 200;

export interface LiveIdentity {
  userId: number;
  allianceId: number | null;
  world: string;
}

/** What the gateway needs from the rest of the server; tests pass their own. */
export interface LiveGatewayDeps {
  /** The signed-in player for a game session token, with their world; null when refused. */
  authenticate(token: string): Promise<LiveIdentity | null>;
  /** Zones' versions (`readZoneVersions`). */
  versions(world: string, ids: readonly number[]): Promise<number[]>;
  /** Players' current alliances (after their sight changed: they may have joined or left one). */
  alliancesOf(userIds: readonly number[]): Promise<Map<number, number | null>>;
  warn(message: string): void;
}

export interface LiveSocket extends LiveIdentity {
  ws: Pick<ServerWebSocket<SocketData>, "send" | "close">;
  zones: Set<number>;
  lastWatchAt: number;
  /** A watch answer held back by {@link MIN_WATCH_GAP_MS}, sent when the gap is over. */
  replyTimer?: ReturnType<typeof setTimeout> | null;
}

let deps: LiveGatewayDeps | null = null;

/** world -> zone -> sockets watching it */
const watchers = new Map<string, Map<number, Set<LiveSocket>>>();
const byUser = new Map<number, Set<LiveSocket>>();
const byAlliance = new Map<number, Set<LiveSocket>>();

export const initLiveGateway = (next: LiveGatewayDeps): void => {
  deps = next;
};

/** For the load check and tests: how many live sockets this process holds, and the zones watched. */
export const liveStats = (): { sockets: number; zones: number } => {
  let sockets = 0;
  for (const set of byUser.values()) sockets += set.size;
  let zones = 0;
  for (const world of watchers.values()) zones += world.size;
  return { sockets, zones };
};

const send = (socket: LiveSocket, message: unknown): void => {
  socket.ws.send(JSON.stringify(message));
};

const addTo = <K>(index: Map<K, Set<LiveSocket>>, key: K, socket: LiveSocket): void => {
  let set = index.get(key);
  if (!set) index.set(key, (set = new Set()));
  set.add(socket);
};

const removeFrom = <K>(index: Map<K, Set<LiveSocket>>, key: K, socket: LiveSocket): void => {
  const set = index.get(key);
  if (!set) return;
  set.delete(socket);
  if (!set.size) index.delete(key);
};

const watch = (socket: LiveSocket, zone: number): void => {
  let world = watchers.get(socket.world);
  if (!world) watchers.set(socket.world, (world = new Map()));
  addTo(world, zone, socket);
};

const unwatch = (socket: LiveSocket, zone: number): void => {
  const world = watchers.get(socket.world);
  if (!world) return;
  removeFrom(world, zone, socket);
  if (!world.size) watchers.delete(socket.world);
};

const bytesOf = (data: string | Buffer): number => (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength);

/** A valid zone id: `zoneX * 10000 + zoneY` on an 80 x 80 grid of zones. */
const isZoneId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && Math.floor(value / 10000) < 80 && value % 10000 < 80;

/**
 * Takes a frame if it is the live map's: a socket already signed in as the
 * live map, or a `live.auth` on a socket not yet signed in to anything.
 * Returns false for anything chat should handle.
 */
export const routeLive = async (ws: ServerWebSocket<SocketData>, data: string | Buffer): Promise<boolean> => {
  const live = ws.data.live;
  if (!live) {
    if (ws.data.userId !== null) return false;
    const text = typeof data === "string" ? data : data.toString();
    if (!text.startsWith('{"type":"live.')) return false;
    if (bytesOf(data) > CHAT_SOCKET_LIMITS.maxUnauthenticatedBytes) {
      ws.close(1009, "Message too large");
      return true;
    }
    await signIn(ws, text);
    return true;
  }

  let message: { type?: unknown; z?: unknown };
  try {
    message = JSON.parse(typeof data === "string" ? data : data.toString());
  } catch {
    return true;
  }
  if (message.type === "live.watch") await setWatch(live, message.z);
  // `live.ping` and anything else: nothing to do (the frame itself resets the idle timer).
  return true;
};

const signIn = async (ws: ServerWebSocket<SocketData>, text: string): Promise<void> => {
  let message: { type?: unknown; token?: unknown };
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (message.type !== "live.auth" || typeof message.token !== "string" || !message.token || !deps) return;
  let identity: LiveIdentity | null = null;
  try {
    identity = await deps.authenticate(message.token);
  } catch (error) {
    deps.warn(`Live map sign-in failed: ${error}`);
  }
  if (!identity) {
    ws.send(JSON.stringify({ type: "live.fail" }));
    ws.close(1008, "Sign-in refused");
    return;
  }
  // The socket may have closed while the sign-in was checked.
  if (ws.readyState !== undefined && ws.readyState > 1) return;
  const mine = byUser.get(identity.userId);
  if (mine && mine.size >= maxSocketsPerPlayer()) {
    // The oldest goes: a player who opened a new tab is looking at that one.
    const oldest = mine.values().next().value;
    if (oldest) {
      dropLive(oldest);
      oldest.ws.close(1000, "Opened elsewhere");
    }
  }
  const socket: LiveSocket = { ...identity, ws, zones: new Set(), lastWatchAt: 0 };
  ws.data.live = socket;
  if (ws.data.loginDeadline) clearTimeout(ws.data.loginDeadline);
  ws.data.loginDeadline = null;
  addTo(byUser, socket.userId, socket);
  if (socket.allianceId) addTo(byAlliance, socket.allianceId, socket);
  send(socket, { type: "live.ok" });
};

const setWatch = async (socket: LiveSocket, raw: unknown, now: number = Date.now()): Promise<void> => {
  if (!deps || !Array.isArray(raw)) return;
  const next = new Set<number>();
  for (const value of raw) {
    if (next.size >= MAX_WATCHED) break;
    if (isZoneId(value)) next.add(value);
  }
  for (const zone of socket.zones) if (!next.has(zone)) unwatch(socket, zone);
  for (const zone of next) if (!socket.zones.has(zone)) watch(socket, zone);
  socket.zones = next;

  // The answer: at once, or (a second watch inside the gap) once the gap is over, for the list then.
  const wait = socket.lastWatchAt + MIN_WATCH_GAP_MS - now;
  if (wait > 0) {
    socket.replyTimer ??= setTimeout(() => {
      socket.replyTimer = null;
      void answerWatch(socket, Date.now());
    }, wait);
    return;
  }
  await answerWatch(socket, now);
};

/** Sends every watched zone's version (`live.zones` with `all`). */
const answerWatch = async (socket: LiveSocket, now: number): Promise<void> => {
  if (!deps || !byUser.get(socket.userId)?.has(socket)) return;
  socket.lastWatchAt = now;
  const ids = [...socket.zones];
  let versions: number[] = [];
  try {
    versions = await deps.versions(socket.world, ids);
  } catch (error) {
    deps.warn(`Live map versions not read: ${error}`);
    return;
  }
  // `all`: the answer to a watch, every watched zone; a push carries only the changed ones.
  send(socket, { type: "live.zones", all: 1, z: ids.map((id, index) => [id, versions[index] ?? 0]) });
};

/** Forgets a socket (closed, or replaced by a newer tab). */
export const dropLive = (socket: LiveSocket): void => {
  if (socket.replyTimer) clearTimeout(socket.replyTimer);
  socket.replyTimer = null;
  for (const zone of socket.zones) unwatch(socket, zone);
  socket.zones.clear();
  removeFrom(byUser, socket.userId, socket);
  if (socket.allianceId) removeFrom(byAlliance, socket.allianceId, socket);
};

/** The socket closed: true when it was a live one (chat has nothing to clean up then). */
export const closeLive = (ws: ServerWebSocket<SocketData>): boolean => {
  const live = ws.data.live;
  if (!live) return false;
  dropLive(live);
  ws.data.live = undefined;
  return true;
};

/** A `livemap:zones` message: each watching socket gets its own zones' new versions, once. */
export const fanOutZones = (payload: string): void => {
  let message: ZonesMessage;
  try {
    message = JSON.parse(payload);
  } catch {
    return;
  }
  const world = watchers.get(message.w);
  if (!world || !message.z) return;
  const perSocket = new Map<LiveSocket, [number, number][]>();
  for (const [key, version] of Object.entries(message.z)) {
    const set = world.get(Number(key));
    if (!set) continue;
    for (const socket of set) {
      let list = perSocket.get(socket);
      if (!list) perSocket.set(socket, (list = []));
      list.push([Number(key), Number(version)]);
    }
  }
  for (const [socket, z] of perSocket) send(socket, { type: "live.zones", z });
};

/** A `livemap:sight` message: the players (and alliances' members) whose sight changed. */
export const fanOutSight = async (payload: string): Promise<void> => {
  let message: SightMessage;
  try {
    message = JSON.parse(payload);
  } catch {
    return;
  }
  const users = (message.u ?? []).filter((id) => byUser.has(id));
  // A player whose sight changed may have joined or left an alliance: re-read theirs.
  if (users.length && deps) {
    try {
      const alliances = await deps.alliancesOf(users);
      for (const id of users) {
        const now = alliances.get(id) ?? null;
        for (const socket of byUser.get(id) ?? []) {
          if (socket.allianceId === now) continue;
          if (socket.allianceId) removeFrom(byAlliance, socket.allianceId, socket);
          socket.allianceId = now;
          if (now) addTo(byAlliance, now, socket);
        }
      }
    } catch (error) {
      deps.warn(`Live map alliances not re-read: ${error}`);
    }
  }
  const told = new Set<LiveSocket>();
  for (const id of users) for (const socket of byUser.get(id) ?? []) told.add(socket);
  for (const id of message.a ?? []) for (const socket of byAlliance.get(id) ?? []) told.add(socket);
  for (const socket of told) send(socket, { type: "live.sight" });
};

/** Tests only: forgets every socket. */
export const resetLiveGateway = (): void => {
  watchers.clear();
  byUser.clear();
  byAlliance.clear();
  deps = null;
};
