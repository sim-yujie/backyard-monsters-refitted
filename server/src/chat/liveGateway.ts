import { CHAT_SOCKET_LIMITS } from "../config/SpamLimitConfig.js";
import type { HexShape } from "../game-rules/maproom/range.js";
import type { CellsMessage, OwnMessage, SightMessage } from "../services/maproom/live/liveZones.js";
import { inZoneAnswer, maskShows, zoneMask, type LiveSight, type ZoneMask } from "../services/maproom/live/liveFog.js";
import type { PushedCell } from "../services/maproom/live/liveCells.js";
import type { SocketData } from "./chatState.js";

type ServerWebSocket<T> = import("bun").ServerWebSocket<T>;

/**
 * The live map's side of the chat socket server (beta 9, stages 1 and 2).
 *
 * The map opens its own connection to the chat port and signs in with
 * `live.auth` instead of chat's `auth`, so it works with World chat switched
 * off and never meets chat's one-connection-per-player rule. From then on
 * the socket only carries `live.*` frames:
 *
 * - `live.watch {z: [zoneId, ...], since?}`: the zones the map has on screen
 *   (at most {@link MAX_WATCHED}); replaces the last list, and is also the
 *   map's 5-minute version check. A zone the player's fog hides entirely is
 *   refused (never watched, no version). Answered with `live.zones` holding
 *   every watched zone's version; with `since` (the last push id the map
 *   saw, after a reconnect) first with `live.cells` `rp:1`, everything the
 *   log holds since then for those zones ({@link replay}).
 * - `live.cells {id, z: [[zoneId, version, from?]...], c: [[x, y, cell]...], ad?, rz?}`
 *   pushed when watched zones change (stage 2): each changed cell exactly as
 *   the player's own `getarea` would give it, minus what only they see
 *   (their relations to the owner, kept from their own answers). Cells the
 *   player's fog hides are left out; their own cells come on `live.own`
 *   instead, or the zone is named in `rz` (ask it again).
 * - `live.zones {z: [[zoneId, version]...]}`: a change without its cells (too
 *   big a bundle, or this socket's sight is being re-read): ask those zones.
 * - `live.own {c}`: the player's own cells in full (army, resources, next
 *   hatch...), on their own sockets only. `live.redo {z}`: ask these zones
 *   again (a relation to another player changed: truce, friends, an attack).
 * - `live.sight` pushed when the player's fog of war changed: the map asks
 *   `/worldmapv2/sight` again (and the server re-reads it here too).
 * - `live.ping`: keeps the socket inside the server's idle timeout.
 *
 * The registry is this process's own (which socket watches what, and each
 * socket's sight); zone versions, the push log, who has a map open and every
 * change come through Redis, so several socket servers can run side by side
 * (stage 3).
 */

/** Most zones one socket may watch: the map caches at most 300 (`ZoneStore.MAX_CACHED_ZONES`). */
export const MAX_WATCHED = 300;
/** Most live sockets per player (tabs); the load check raises it. */
export const maxSocketsPerPlayer = (): number => Number(process.env.LIVE_MAP_MAX_PER_USER) || 4;
/** Watch answers (a read of every watched zone's version) are at most this often per socket; the list itself always applies. */
export const MIN_WATCH_GAP_MS = 200;

/** A socket's sight is re-read when a watch comes this long after the last read (a Flinger finishing on its clock moves it unwritten). */
export const SIGHT_REFRESH_MS = 4 * 60_000;
/** How often this process tells Redis which players have a live map open here. */
export const PRESENCE_MS = 60_000;

export interface LiveIdentity {
  userId: number;
  allianceId: number | null;
  world: string;
}

/** What the replay log holds after an id (`liveGatewayDeps.ts`). */
export interface LogRead {
  entries: CellsMessage[];
  /** False when the log no longer reaches back that far (or was cut short): the version check catches up instead. */
  complete: boolean;
}

/** What the gateway needs from the rest of the server; tests pass their own. */
export interface LiveGatewayDeps {
  /** The signed-in player for a game session token, with their world; null when refused. */
  authenticate(token: string): Promise<LiveIdentity | null>;
  /** Zones' versions (`readZoneVersions`). */
  versions(world: string, ids: readonly number[]): Promise<number[]>;
  /** Players' current alliances (after their sight changed: they may have joined or left one). */
  alliancesOf(userIds: readonly number[]): Promise<Map<number, number | null>>;
  /** The player's sight exactly as `getarea` reads it (`getPlayerSight`); null when the fog is off. */
  sight(userId: number): Promise<LiveSight | null>;
  /** The map's hex shape (`mr2HexShape`). */
  shape(): HexShape;
  /** The pushes logged after `since` (`livemap:log`). */
  readLog?(since: string): Promise<LogRead>;
  /** These players have a live map open here, as of `at` (ms). */
  present?(userIds: readonly number[], at: number): Promise<void>;
  warn(message: string): void;
}

export interface LiveSocket extends LiveIdentity {
  ws: Pick<ServerWebSocket<SocketData>, "send" | "close">;
  zones: Set<number>;
  lastWatchAt: number;
  /** A watch answer held back by {@link MIN_WATCH_GAP_MS}, sent when the gap is over. */
  replyTimer?: ReturnType<typeof setTimeout> | null;
  /** The player's sight as last read; an empty one (all fog) until the first read worked. */
  sight: LiveSight | null;
  sightAt: number;
  /** True while the sight is being re-read after a change: pushes go out without cells then. */
  sightStale: boolean;
  sightLoad?: Promise<void> | null;
  /** Raised by every sight change heard; a read that started before the last one reads again. */
  sightWanted: number;
  /** Each zone's mask under `sight`, worked out when first needed. */
  masks: Map<number, ZoneMask>;
}

const NO_SIGHT: LiveSight = { sv: "", sources: [], revealed: [] };

let deps: LiveGatewayDeps | null = null;
let presenceTimer: ReturnType<typeof setInterval> | null = null;

/** world -> zone -> sockets watching it */
const watchers = new Map<string, Map<number, Set<LiveSocket>>>();
const byUser = new Map<number, Set<LiveSocket>>();
const byAlliance = new Map<number, Set<LiveSocket>>();

export const initLiveGateway = (next: LiveGatewayDeps): void => {
  deps = next;
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
  if (next.present) {
    presenceTimer = setInterval(() => {
      if (byUser.size) void deps?.present?.([...byUser.keys()], Date.now()).catch(() => undefined);
    }, PRESENCE_MS);
    presenceTimer.unref?.();
  }
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

/** A push log id as Redis writes them (`<ms>-<seq>`). */
const isLogId = (value: unknown): value is string => typeof value === "string" && /^\d{1,16}-\d{1,10}$/.test(value);

/** The zone's mask under the socket's sight, worked out once per sight. */
const maskOf = (socket: LiveSocket, zone: number): ZoneMask => {
  let mask = socket.masks.get(zone);
  if (mask === undefined) {
    mask = deps ? zoneMask(socket.sight, zone, deps.shape()) : 0;
    socket.masks.set(zone, mask);
  }
  return mask;
};

/** Reads the socket's sight again (sign-in, a sight change, a watch long after the last read). */
const loadSight = (socket: LiveSocket): Promise<void> => {
  if (socket.sightLoad) return socket.sightLoad;
  socket.sightStale = true;
  socket.sightLoad = (async () => {
    try {
      // Read again while a change came in during the read: the answer may predate it.
      for (let tries = 0; tries < 3 && deps; tries++) {
        const wanted = socket.sightWanted;
        const sight = await deps.sight(socket.userId);
        socket.sight = sight;
        socket.sightAt = Date.now();
        socket.masks.clear();
        if (socket.sightWanted === wanted) {
          socket.sightStale = false;
          return;
        }
      }
    } catch (error) {
      // Kept stale: pushes go out without cells (the map asks `getarea`, which reads the fog itself).
      deps?.warn(`Live map sight not read for ${socket.userId}: ${error}`);
    } finally {
      socket.sightLoad = null;
    }
  })();
  return socket.sightLoad;
};

/** A sight change was heard for this socket: no cells until it is read again. */
const sightChanged = (socket: LiveSocket): void => {
  socket.sightStale = true;
  socket.sightWanted += 1;
};

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

  let message: { type?: unknown; z?: unknown; since?: unknown };
  try {
    message = JSON.parse(typeof data === "string" ? data : data.toString());
  } catch {
    return true;
  }
  if (message.type === "live.watch") await setWatch(live, message.z, isLogId(message.since) ? message.since : null);
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
  // Until the sight is read the player sees nothing through this socket (fail closed).
  const socket: LiveSocket = {
    ...identity,
    ws,
    zones: new Set(),
    lastWatchAt: 0,
    sight: NO_SIGHT,
    sightAt: 0,
    sightStale: true,
    sightWanted: 0,
    masks: new Map(),
  };
  await loadSight(socket);
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
  ws.data.live = socket;
  if (ws.data.loginDeadline) clearTimeout(ws.data.loginDeadline);
  ws.data.loginDeadline = null;
  addTo(byUser, socket.userId, socket);
  if (socket.allianceId) addTo(byAlliance, socket.allianceId, socket);
  void deps.present?.([socket.userId], Date.now()).catch(() => undefined);
  send(socket, { type: "live.ok" });
};

const setWatch = async (socket: LiveSocket, raw: unknown, since: string | null, now: number = Date.now()): Promise<void> => {
  if (!deps || !Array.isArray(raw)) return;
  // The 5-minute check also re-reads the sight: a Flinger finishing on its clock is written nowhere.
  if (now - socket.sightAt > SIGHT_REFRESH_MS) await loadSight(socket);
  if (!byUser.get(socket.userId)?.has(socket)) return;
  const next = new Set<number>();
  for (const value of raw) {
    if (next.size >= MAX_WATCHED) break;
    // A zone the fog hides entirely is not the player's to know about (not even that it changed).
    if (isZoneId(value) && maskOf(socket, value) !== 0) next.add(value);
  }
  for (const zone of socket.zones) if (!next.has(zone)) unwatch(socket, zone);
  for (const zone of next) if (!socket.zones.has(zone)) watch(socket, zone);
  socket.zones = next;

  // Back after a short break: what the log holds since the last push it saw, before the versions.
  if (since) await replay(socket, since);

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
  const ids = [...socket.zones].filter((id) => maskOf(socket, id) !== 0);
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

/** A player cell's owner, or 0 (camps, water, ground). */
const ownerOf = (cell: PushedCell): number => {
  const payload = cell[2] as { uid?: unknown; b?: unknown } | null | undefined;
  return payload && typeof payload.uid === "number" && typeof payload.b === "number" && payload.b >= 2 ? payload.uid : 0;
};

/**
 * What one socket may be sent of a set of changed zones and cells: the zones its fog does not
 * wholly hide (`z`), the cells it can see in them (`cells`, indexes), and the zones to ask again
 * (`rz`): one holding the player's own cell whose full copy is not on its way (`ownSent`), or one
 * whose cells did not come (`incomplete`).
 */
const cut = (
  socket: LiveSocket,
  zones: readonly (readonly number[])[],
  cells: readonly PushedCell[],
  zoneCells: Map<number, number[]>,
  ownSent: boolean,
  incomplete: ReadonlySet<number>,
): { z: (readonly number[])[]; cells: number[]; rz: number[] } => {
  const z: (readonly number[])[] = [];
  const included = new Set<number>();
  const rz = new Set<number>();
  for (const pair of zones) {
    const zone = pair[0]!;
    const mask = maskOf(socket, zone);
    if (mask === 0) continue;
    z.push(pair);
    if (incomplete.has(zone)) rz.add(zone);
    for (const index of zoneCells.get(zone) ?? []) {
      const cell = cells[index]!;
      if (!maskShows(mask, zone, cell[0], cell[1])) continue;
      if (ownerOf(cell) === socket.userId) {
        // The player's own cell: its full copy comes on their own channel, or they ask again.
        if (!ownSent) rz.add(zone);
        continue;
      }
      included.add(index);
    }
  }
  return { z, cells: [...included].sort((a, b) => a - b), rz: [...rz] };
};

/** Which of `cells` (indexes) each zone's 11 x 11 answer holds. */
const cellsByZone = (zones: Iterable<number>, cells: readonly PushedCell[]): Map<number, number[]> => {
  const out = new Map<number, number[]>();
  for (const zone of zones) {
    const list: number[] = [];
    cells.forEach((cell, index) => {
      if (inZoneAnswer(zone, cell[0], cell[1])) list.push(index);
    });
    if (list.length) out.set(zone, list);
  }
  return out;
};

/**
 * A `livemap:zones` push: each watching socket gets its own zones' new versions and the changed
 * cells its fog lets it see, once. Sockets that may be sent the same are sent the same text, built
 * once.
 */
export const fanOutZones = (payload: string): void => {
  let message: CellsMessage;
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
  if (!perSocket.size) return;
  const cells = message.x ? undefined : message.c;
  const zoneCells = cells ? cellsByZone(Object.keys(message.z).map(Number), cells) : new Map<number, number[]>();
  const cellText = cells?.map((cell) => JSON.stringify(cell));
  const head = `{"type":"live.cells"${message.id ? `,"id":${JSON.stringify(message.id)}` : ""}`;
  const adText = message.ad?.length ? `,"ad":${JSON.stringify(message.ad)}` : "";
  const owners = new Set(message.ow ?? []);
  const frames = new Map<string, string>();
  const none = new Set<number>();
  for (const [socket, z] of perSocket) {
    if (!cells || socket.sightStale) {
      // No cells (too many, not built) or a sight being re-read: the versions alone, ask again.
      const shown = z.filter(([zone]) => maskOf(socket, zone) !== 0);
      if (shown.length) send(socket, { type: "live.zones", z: shown });
      continue;
    }
    const part = cut(socket, z, cells, zoneCells, owners.has(socket.userId), none);
    if (!part.z.length) continue;
    const key = `${JSON.stringify(part.z)}|${part.cells.join(",")}|${part.rz.join(",")}`;
    let frame = frames.get(key);
    if (frame === undefined) {
      frame =
        `${head},"z":${JSON.stringify(part.z)},"c":[${part.cells.map((index) => cellText![index]).join(",")}]` +
        `${part.cells.length ? adText : ""}${part.rz.length ? `,"rz":${JSON.stringify(part.rz)}` : ""}}`;
      frames.set(key, frame);
    }
    socket.ws.send(frame);
  }
};

/**
 * Back after a short break (`live.watch` with `since`): everything the log holds after `since`
 * for the socket's zones, as one `live.cells` with `rp: 1`, cut to what its sight shows NOW, each
 * cell's latest copy only. Each zone is `[zone, last version, first version]`: the map takes it
 * only when it held the version just before the first. A log that no longer reaches back that far
 * sends nothing; the watch answer's versions catch up as in stage 1.
 */
const replay = async (socket: LiveSocket, since: string): Promise<void> => {
  if (!deps?.readLog || !socket.zones.size) return;
  let log: LogRead;
  try {
    log = await deps.readLog(since);
  } catch (error) {
    deps.warn(`Live map log not read: ${error}`);
    return;
  }
  if (!log.complete || !log.entries.length) return;
  const range = new Map<number, [number, number]>();
  const incomplete = new Set<number>();
  const latest = new Map<string, PushedCell>();
  const crests = new Map<number, unknown>();
  let lastId: string | undefined;
  for (const entry of log.entries) {
    lastId = entry.id ?? lastId;
    if (entry.w !== socket.world) continue;
    for (const [key, raw] of Object.entries(entry.z ?? {})) {
      const zone = Number(key);
      if (!socket.zones.has(zone)) continue;
      const version = Number(raw);
      const seen = range.get(zone);
      range.set(zone, seen ? [Math.max(seen[0], version), Math.min(seen[1], version)] : [version, version]);
      if (entry.x || !entry.c) incomplete.add(zone);
    }
    for (const cell of entry.c ?? []) latest.set(`${cell[0]},${cell[1]}`, cell);
    for (const crest of entry.ad ?? []) crests.set(crest.alliance_id, crest);
  }
  if (!range.size) return;
  const cells = [...latest.values()];
  const zones = [...range].map(([zone, [last, first]]) => [zone, last, first] as const);
  // No own-channel copies in the log: a zone holding one of the player's own cells is asked again.
  const part = cut(socket, zones, cells, cellsByZone(range.keys(), cells), false, incomplete);
  if (!part.z.length) return;
  send(socket, {
    type: "live.cells",
    rp: 1,
    ...(lastId && { id: lastId }),
    z: part.z,
    c: part.cells.map((index) => cells[index]),
    ...(part.cells.length && crests.size && { ad: [...crests.values()] }),
    ...(part.rz.length && { rz: part.rz }),
  });
};

/**
 * A `livemap:own` message: a player's own cells in full (`live.own`), or the zones holding another
 * player's cells to ask again after a relation changed (`live.redo`, only zones the player watches
 * and can see, so it says nothing about where anyone's hidden cells are).
 */
export const fanOutOwn = (payload: string): void => {
  let message: OwnMessage;
  try {
    message = JSON.parse(payload);
  } catch {
    return;
  }
  for (const socket of byUser.get(message.u) ?? []) {
    if (socket.world !== message.w) continue;
    if (message.c?.length) send(socket, { type: "live.own", c: message.c });
    const redo = (message.rz ?? []).filter((zone) => socket.zones.has(zone) && maskOf(socket, zone) !== 0);
    if (redo.length) send(socket, { type: "live.redo", z: redo });
  }
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
  // Until their sight is read again, their pushes carry no cells (`sightStale`).
  for (const id of users) for (const socket of byUser.get(id) ?? []) sightChanged(socket);
  for (const id of message.a ?? []) for (const socket of byAlliance.get(id) ?? []) sightChanged(socket);
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
  for (const socket of told) {
    sightChanged(socket);
    send(socket, { type: "live.sight" });
  }
  await Promise.all([...told].map((socket) => loadSight(socket)));
};

/** Tests only: forgets every socket. */
export const resetLiveGateway = (): void => {
  watchers.clear();
  byUser.clear();
  byAlliance.clear();
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
  deps = null;
};
