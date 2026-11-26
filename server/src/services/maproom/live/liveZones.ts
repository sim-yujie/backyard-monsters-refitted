import { MapRoom2 } from "../../../enums/MapRoom.js";
import { setLiveMarkSink, type LiveMarkSink } from "./liveMarks.js";
import type { PublicCells, PushedCell, RosterEntry } from "./liveCells.js";

/**
 * The live map's zone versions (beta 9, stage 1).
 *
 * A zone is the 10 x 10 block the map asks `getarea` for (`zoneId` below is
 * the client's `zoneX * 10000 + zoneY`). Each has a version in Redis,
 * `livemap:zv:<world>` field `<zoneId>`, shared by every server machine. A
 * mark (`liveMarks.ts`) puts its cells in this process's half-second bundle;
 * every half second the bundle's yards, players and alliances are looked up to
 * cells (one query each), every zone whose `getarea` answer holds one of
 * those cells gets its version raised, and one message per world goes out on
 * {@link LIVE_ZONES_CHANNEL}. The socket side (`chat/liveGateway.ts`) passes
 * each zone on to the sockets watching it; the map re-asks only those zones.
 *
 * The bundle is the only state kept in this process, and only for half a
 * second: a restart loses at most those marks (the map's 5-minute version
 * check does not see those; the next change to the zone does).
 */

/**
 * Put before the live map's Redis channel names. Redis pub/sub ignores the database number, so
 * servers sharing one Redis on different databases (local test servers, each on its own slot, often
 * on copies of the same game database with the same world ids) would hear, and draw, each other's
 * pushes. `LIVE_MAP_CHANNEL_PREFIX` when set; otherwise `db<n>:` for a REDIS_URL on database n > 0,
 * and nothing on database 0 (the live game). Every process of one game shares its REDIS_URL, so
 * they always agree.
 */
export const channelPrefix = (env: Record<string, string | undefined> = process.env): string => {
  if (env.LIVE_MAP_CHANNEL_PREFIX !== undefined) return env.LIVE_MAP_CHANNEL_PREFIX;
  const db = /\/(\d+)\/?$/.exec(env.REDIS_URL ?? "")?.[1];
  return db && Number(db) > 0 ? `db${Number(db)}:` : "";
};
const CHANNEL_PREFIX = channelPrefix();
export const LIVE_ZONES_CHANNEL = `${CHANNEL_PREFIX}livemap:zones`;
export const LIVE_SIGHT_CHANNEL = `${CHANNEL_PREFIX}livemap:sight`;
/** A player's own channel (stage 2): their own cells' full payloads, and "ask these zones again". */
export const LIVE_OWN_CHANNEL = `${CHANNEL_PREFIX}livemap:own`;
export const zoneVersionsKey = (world: string): string => `livemap:zv:${world}`;
/** Every public push, kept {@link REPLAY_MS} for a map that was away a moment (stage 2). */
export const LIVE_LOG_KEY = "livemap:log";
/** Players with a live map open: score = when a gateway last said so, ms (stage 2). */
export const LIVE_PRESENT_KEY = "livemap:present";
/** How far back a reconnecting map can catch up from the log. */
export const REPLAY_MS = 5 * 60_000;
/** A player counts as having the map open for this long after a gateway last said so. */
export const PRESENT_MS = 150_000;
/**
 * The most cells one push carries. A bigger bundle (an alliance renamed: every member's cells)
 * goes out as versions only, and the maps ask those zones again (stage 1's way).
 */
export const MAX_PUSH_CELLS = 400;

/**
 * How long marks are gathered before their zones are published, ms. Half a second (lead, 25 Nov
 * 2026): with the map's 0-1.5 s random wait before it asks, a change is on screen within 2 s for
 * 95 in 100; more pushes on Redis are cheap, the wait is what spreads the database's load.
 */
export const BUNDLE_MS = 500;

export const ZONE_SIZE = 10;

/** The client's zone id (`web/src/api/maproom.ts` `zoneId`) for a zone origin. */
export const zoneId = (originX: number, originY: number): number =>
  (originX / ZONE_SIZE) * 10000 + originY / ZONE_SIZE;

const origin = (value: number): number => Math.floor(value / ZONE_SIZE) * ZONE_SIZE;

const inWorld = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MapRoom2.WIDTH && y < MapRoom2.HEIGHT;

/**
 * Every zone whose `getarea` answer holds the cell: its own, and the one
 * before on a column or row that is a multiple of ten (answers are 11 x 11,
 * `x..x+10`, so neighbouring zones share an edge).
 */
export const coveringZones = (x: number, y: number): number[] => {
  if (!inWorld(x, y)) return [];
  const xs = x % ZONE_SIZE === 0 && x > 0 ? [origin(x), x - ZONE_SIZE] : [origin(x)];
  const ys = y % ZONE_SIZE === 0 && y > 0 ? [origin(y), y - ZONE_SIZE] : [origin(y)];
  const out: number[] = [];
  for (const zx of xs) for (const zy of ys) out.push(zoneId(zx, zy));
  return out;
};

/** A cell as the lookups return it. */
export interface CellRow {
  world_id: string;
  x: number;
  y: number;
}

/** The part of Bun's Redis client this uses (`send` for the hash, `publish`). */
export interface LiveRedis {
  send(command: string, args: string[]): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
}

export interface LiveZoneDeps {
  redis: LiveRedis;
  /** Runs one read-only query; `?` placeholders. */
  query(sql: string, params: unknown[]): Promise<CellRow[]>;
  /** Failures are logged and the bundle dropped; nothing throws back into a write. */
  warn(message: string): void;
  /** Builds the cells a push carries; without it, versions only (stage 1). */
  cells?: LiveCellBuilder;
  /** ms since the epoch (tests). */
  now?: () => number;
}

const placeholders = (count: number): string => Array.from({ length: count }, () => "?").join(", ");

/** What one published message carries: a world and its zones' new versions. */
export interface ZonesMessage {
  w: string;
  z: Record<string, number>;
}

/**
 * A public push (stage 2): the zones' new versions and, unless `x`, every changed cell of them as
 * a stranger sees it (`liveCells.ts`). `id` is its place in the replay log, `ad` the crests of the
 * alliances owning the cells, `ow` the owners whose own channel got their full cells this time.
 */
export interface CellsMessage extends ZonesMessage {
  id?: string;
  c?: PushedCell[];
  ad?: RosterEntry[];
  ow?: number[];
  /** 1: the cells are not in it (too many, or not built): ask the zones again. */
  x?: 1;
}

/** A player's own channel: their own cells in full (`c`), or the players whose relation to them changed (`ro`). */
export interface OwnMessage {
  u: number;
  w?: string;
  c?: PushedCell[];
  ro?: number[];
}

/** The sight nudge: players and alliances whose fog of war changed. */
export interface SightMessage {
  u: number[];
  a: number[];
}

/** What builds the pushed cells (`liveCells.ts`); tests pass their own. */
export interface LiveCellBuilder {
  publicCells(world: string, coords: readonly (readonly [number, number])[]): Promise<PublicCells>;
  ownerCells(userid: number, world: string, coords: readonly (readonly [number, number])[]): Promise<PushedCell[]>;
  /** The players these players have ever attacked (their bases are revealed in those players' fog). */
  defendersOf(userids: readonly number[]): Promise<number[]>;
}

export class LiveZoneWriter implements LiveMarkSink {
  private saveMarks = new Set<number>();
  private saveOwnerMarks = new Set<number>();
  private homeMarks = new Set<number>();
  private userMarks = new Set<number>();
  private allianceMarks = new Set<number>();
  /** world -> "x,y" */
  private cellMarks = new Map<string, Set<string>>();
  private sightUserMarks = new Set<number>();
  private sightAllianceMarks = new Set<number>();
  /** "a,b": a relation between two players changed (truce, friends, an attack). */
  private relationMarks = new Set<string>();
  /** Players whose cells moved, came or went: their past defenders' fog may have changed. */
  private revealMarks = new Set<number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(private readonly deps: LiveZoneDeps) {}

  saves(ids: readonly number[]): void {
    for (const id of ids) this.saveMarks.add(id);
  }

  saveOwners(ids: readonly number[]): void {
    for (const id of ids) this.saveOwnerMarks.add(id);
  }

  homes(ids: readonly number[]): void {
    for (const id of ids) this.homeMarks.add(id);
  }

  cells(world: string, coords: readonly (readonly [number, number])[]): void {
    let set = this.cellMarks.get(world);
    if (!set) this.cellMarks.set(world, (set = new Set()));
    for (const [x, y] of coords) set.add(`${x},${y}`);
  }

  users(ids: readonly number[]): void {
    for (const id of ids) this.userMarks.add(id);
  }

  alliances(ids: readonly number[]): void {
    for (const id of ids) this.allianceMarks.add(id);
  }

  sightUsers(ids: readonly number[]): void {
    for (const id of ids) this.sightUserMarks.add(id);
  }

  sightAlliances(ids: readonly number[]): void {
    for (const id of ids) this.sightAllianceMarks.add(id);
  }

  relations(pairs: readonly (readonly [number, number])[]): void {
    for (const [a, b] of pairs) if (a !== b) this.relationMarks.add(`${a},${b}`);
  }

  revealsOf(ids: readonly number[]): void {
    for (const id of ids) this.revealMarks.add(id);
  }

  /** Publishes every BUNDLE_MS until `stop`. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), BUNDLE_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Publishes what has gathered since the last flush (one at a time). */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushNow().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async flushNow(): Promise<void> {
    const saves = [...this.saveMarks];
    const saveOwners = [...this.saveOwnerMarks];
    const homes = [...this.homeMarks];
    const users = [...this.userMarks];
    const alliances = [...this.allianceMarks];
    const cells = this.cellMarks;
    const sightUsers = [...this.sightUserMarks];
    const sightAlliances = [...this.sightAllianceMarks];
    const relations = [...this.relationMarks].map((pair) => pair.split(",").map(Number) as [number, number]);
    const reveals = [...this.revealMarks];
    this.saveMarks = new Set();
    this.saveOwnerMarks = new Set();
    this.homeMarks = new Set();
    this.userMarks = new Set();
    this.allianceMarks = new Set();
    this.cellMarks = new Map();
    this.sightUserMarks = new Set();
    this.sightAllianceMarks = new Set();
    this.relationMarks = new Set();
    this.revealMarks = new Set();

    try {
      // An attacker's base is revealed in the fog of everyone they attacked, for ever: when their
      // cells move, come or go, those players with a map open read their sight again (getarea's
      // own copy runs out in 30 s; a socket keeps its sight until told).
      if (reveals.length && this.deps.cells) {
        const present = await this.presentAmong(await this.deps.cells.defendersOf(reveals));
        for (const id of present) if (!sightUsers.includes(id)) sightUsers.push(id);
      }
      // The sight nudge first: a gateway re-reads those players' fog before it masks the cells
      // below with it (a change that took sight away must not be shown under the old sight).
      if (sightUsers.length || sightAlliances.length) {
        const message: SightMessage = { u: sightUsers, a: sightAlliances };
        await this.deps.redis.publish(LIVE_SIGHT_CHANNEL, JSON.stringify(message));
      }
      /** world -> "x,y" -> the changed cell */
      const changed = new Map<string, Map<string, [number, number]>>();
      const add = (world: string, x: number, y: number) => {
        if (!inWorld(x, y)) return;
        let set = changed.get(world);
        if (!set) changed.set(world, (set = new Map()));
        set.set(`${x},${y}`, [x, y]);
      };
      for (const [world, coords] of cells) {
        for (const key of coords) {
          const [x, y] = key.split(",").map(Number);
          add(world, x!, y!);
        }
      }
      const { yards, owned } = await this.lookUp({ saves, saveOwners, homes, users, alliances });
      // A yard's own fields (shield, damage, an attack...) show on that cell alone.
      for (const row of yards) add(row.world_id, row.x, row.y);
      // A player's or an alliance's cells: their neighbours' `nb` counts follow who owns them.
      for (const row of owned) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(row.world_id, row.x + dx, row.y + dy);
      }
      await Promise.all([...changed].map(([world, coords]) => this.publishWorld(world, [...coords.values()])));
      if (relations.length) await this.publishRelations(relations);
    } catch (error) {
      this.deps.warn(`Live map zones not published: ${error}`);
    }
  }

  /**
   * The cells behind the bundle's marks, one query per kind: `yards` change alone (a save's own
   * fields, an online flag), `owned` with their neighbours (who owns them changed).
   */
  private async lookUp(marks: {
    saves: number[];
    saveOwners: number[];
    homes: number[];
    users: number[];
    alliances: number[];
  }): Promise<{ yards: CellRow[]; owned: CellRow[] }> {
    const yards: CellRow[] = [];
    const owned: CellRow[] = [];
    const cell = "c.world_id, c.x, c.y";
    const v2 = "c.map_version = 2";
    const run = async (into: CellRow[], ids: unknown[], sql: (list: string) => string) => {
      if (ids.length) into.push(...(await this.deps.query(sql(placeholders(ids.length)), ids)));
    };
    await run(yards, marks.saves, (list) =>
      `SELECT ${cell} FROM bym.save s JOIN bym.world_map_cell c ON c.baseid = s.baseid AND ${v2} WHERE s.basesaveid IN (${list})`,
    );
    await run(yards, marks.homes, (list) => `SELECT ${cell} FROM bym.world_map_cell c WHERE ${v2} AND c.base_type = 2 AND c.uid IN (${list})`);
    await run(owned, marks.saveOwners, (list) =>
      `SELECT ${cell} FROM bym.world_map_cell c JOIN bym.save s ON c.uid = s.saveuserid WHERE ${v2} AND s.basesaveid IN (${list})`,
    );
    await run(owned, marks.users, (list) => `SELECT ${cell} FROM bym.world_map_cell c WHERE ${v2} AND c.uid IN (${list})`);
    await run(owned, marks.alliances, (list) =>
      `SELECT ${cell} FROM bym.world_map_cell c JOIN bym."user" u ON u.userid = c.uid WHERE ${v2} AND u.alliance_id IN (${list})`,
    );
    return { yards, owned };
  }

  /**
   * One world's changed cells: their zones' versions are raised FIRST, then the cells are read
   * (so a push under version v holds everything committed before v; two servers flushing at once
   * can never put an older read under a newer version), then the owners with a map open get their
   * own cells on their own channel, then the public push goes to the log and out.
   */
  private async publishWorld(world: string, coords: [number, number][]): Promise<void> {
    const ids = new Set<number>();
    for (const [x, y] of coords) for (const id of coveringZones(x, y)) ids.add(id);
    if (!ids.size) return;
    const zoneList = [...ids];
    const key = zoneVersionsKey(world);
    const versions = await Promise.all(zoneList.map((id) => this.deps.redis.send("HINCRBY", [key, String(id), "1"])));
    const message: CellsMessage = { w: world, z: {} };
    zoneList.forEach((id, index) => {
      message.z[String(id)] = Number(versions[index]);
    });

    const builder = this.deps.cells;
    if (!builder || coords.length > MAX_PUSH_CELLS) {
      if (builder) message.x = 1;
      await this.publishCells(message);
      return;
    }
    let built: PublicCells;
    try {
      built = await builder.publicCells(world, coords);
    } catch (error) {
      // The versions have moved: say so without the cells, and every map asks those zones again.
      this.deps.warn(`Live map cells not built: ${error}`);
      message.x = 1;
      await this.publishCells(message);
      return;
    }
    message.c = built.cells;
    if (built.alliances.length) message.ad = built.alliances;

    // Owners with a map open: their own cells in full, on their own channel, before the public push.
    const present = await this.presentAmong(built.owners);
    const sentTo: number[] = [];
    await Promise.all(
      present.map(async (uid) => {
        try {
          const own = await builder.ownerCells(uid, world, coords);
          if (!own.length) return;
          const ownMessage: OwnMessage = { u: uid, w: world, c: own };
          await this.deps.redis.publish(LIVE_OWN_CHANNEL, JSON.stringify(ownMessage));
          sentTo.push(uid);
        } catch (error) {
          this.deps.warn(`Live map own cells not sent to ${uid}: ${error}`);
        }
      }),
    );
    if (sentTo.length) message.ow = sentTo;
    await this.publishCells(message);
  }

  /** Writes the push to the replay log (its `id`), then publishes it. */
  private async publishCells(message: CellsMessage): Promise<void> {
    try {
      const minId = String(Math.max(0, this.now() - REPLAY_MS));
      const id = await this.deps.redis.send("XADD", [LIVE_LOG_KEY, "MINID", "~", minId, "*", "d", JSON.stringify(message)]);
      if (typeof id === "string") message.id = id;
    } catch (error) {
      // No log: the push still goes out; a map that missed it catches up by its version check.
      this.deps.warn(`Live map push not logged: ${error}`);
    }
    await this.deps.redis.publish(LIVE_ZONES_CHANNEL, JSON.stringify(message));
  }

  /** The players among `uids` with a live map open somewhere (`LIVE_PRESENT_KEY`). */
  private async presentAmong(uids: readonly number[]): Promise<number[]> {
    if (!uids.length) return [];
    try {
      const scores = (await this.deps.redis.send("ZMSCORE", [LIVE_PRESENT_KEY, ...uids.map(String)])) as (string | number | null)[] | null;
      const since = this.now() - PRESENT_MS;
      return uids.filter((_, index) => Number(scores?.[index] ?? 0) >= since);
    } catch {
      return [];
    }
  }

  /**
   * A relation between two players changed (a truce, a friendship, an attack): only they see it
   * (`t`, `fr`, `fp`, `ak`, `ho`), so each of them with a map open is told who the other is; their
   * map asks again every cached zone holding the other's cells (on screen now, or once back on
   * screen). Nothing public changes.
   */
  private async publishRelations(pairs: [number, number][]): Promise<void> {
    const everyone = [...new Set(pairs.flat())];
    const present = new Set(await this.presentAmong(everyone));
    if (!present.size) return;
    /** viewer -> the other players */
    const told = new Map<number, Set<number>>();
    const tell = (viewer: number, other: number) => {
      if (!present.has(viewer)) return;
      let set = told.get(viewer);
      if (!set) told.set(viewer, (set = new Set()));
      set.add(other);
    };
    for (const [a, b] of pairs) {
      tell(a, b);
      tell(b, a);
    }
    for (const [viewer, others] of told) {
      const message: OwnMessage = { u: viewer, ro: [...others] };
      await this.deps.redis.publish(LIVE_OWN_CHANNEL, JSON.stringify(message));
    }
  }
}

/** One zone's version as `getarea` sends it (`zv`); 0 when it never changed or Redis is down. */
export const readZoneVersion = async (redis: Pick<LiveRedis, "send">, world: string, id: number): Promise<number> => {
  try {
    return Number((await redis.send("HGET", [zoneVersionsKey(world), String(id)])) ?? 0) || 0;
  } catch {
    return 0;
  }
};

/** Many zones' versions at once (the socket's watch answer and version check). */
export const readZoneVersions = async (
  redis: Pick<LiveRedis, "send">,
  world: string,
  ids: readonly number[],
): Promise<number[]> => {
  if (!ids.length) return [];
  const raw = (await redis.send("HMGET", [zoneVersionsKey(world), ...ids.map(String)])) as (string | null)[] | null;
  return ids.map((_, index) => Number(raw?.[index] ?? 0) || 0);
};

let writer: LiveZoneWriter | null = null;

/** Starts the bundle and makes it the marks' sink (server start). */
export const startLiveZones = (deps: LiveZoneDeps): LiveZoneWriter => {
  writer?.stop();
  writer = new LiveZoneWriter(deps);
  setLiveMarkSink(writer);
  writer.start();
  return writer;
};
