import { MapRoom2 } from "../../../enums/MapRoom.js";
import { setLiveMarkSink, type LiveMarkSink } from "./liveMarks.js";

/**
 * The live map's zone versions (beta 9, stage 1).
 *
 * A zone is the 10 x 10 block the map asks `getarea` for (`zoneId` below is
 * the client's `zoneX * 10000 + zoneY`). Each has a version in Redis,
 * `livemap:zv:<world>` field `<zoneId>`, shared by every server machine. A
 * mark (`liveMarks.ts`) puts its cells in this process's one-second bundle;
 * once a second the bundle's yards, players and alliances are looked up to
 * cells (one query each), every zone whose `getarea` answer holds one of
 * those cells gets its version raised, and one message per world goes out on
 * {@link LIVE_ZONES_CHANNEL}. The socket side (`chat/liveGateway.ts`) passes
 * each zone on to the sockets watching it; the map re-asks only those zones.
 *
 * The bundle is the only state kept in this process, and only for a second:
 * a restart loses at most that second's marks (the map's 5-minute version
 * check does not see those; the next change to the zone does).
 */

export const LIVE_ZONES_CHANNEL = "livemap:zones";
export const LIVE_SIGHT_CHANNEL = "livemap:sight";
export const zoneVersionsKey = (world: string): string => `livemap:zv:${world}`;

/** How long marks are gathered before their zones are published, ms (owner: ~1 s is fine). */
export const BUNDLE_MS = 1000;

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
}

const placeholders = (count: number): string => Array.from({ length: count }, () => "?").join(", ");

/** What one published message carries: a world and its zones' new versions. */
export interface ZonesMessage {
  w: string;
  z: Record<string, number>;
}

/** The sight nudge: players and alliances whose fog of war changed. */
export interface SightMessage {
  u: number[];
  a: number[];
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

  private async flushNow(): Promise<void> {
    const saves = [...this.saveMarks];
    const saveOwners = [...this.saveOwnerMarks];
    const homes = [...this.homeMarks];
    const users = [...this.userMarks];
    const alliances = [...this.allianceMarks];
    const cells = this.cellMarks;
    const sightUsers = [...this.sightUserMarks];
    const sightAlliances = [...this.sightAllianceMarks];
    this.saveMarks = new Set();
    this.saveOwnerMarks = new Set();
    this.homeMarks = new Set();
    this.userMarks = new Set();
    this.allianceMarks = new Set();
    this.cellMarks = new Map();
    this.sightUserMarks = new Set();
    this.sightAllianceMarks = new Set();

    try {
      const zones = new Map<string, Set<number>>();
      const add = (world: string, x: number, y: number) => {
        let set = zones.get(world);
        if (!set) zones.set(world, (set = new Set()));
        for (const id of coveringZones(x, y)) set.add(id);
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
      await Promise.all([...zones].map(([world, ids]) => this.publishZones(world, [...ids])));
      if (sightUsers.length || sightAlliances.length) {
        const message: SightMessage = { u: sightUsers, a: sightAlliances };
        await this.deps.redis.publish(LIVE_SIGHT_CHANNEL, JSON.stringify(message));
      }
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

  private async publishZones(world: string, ids: number[]): Promise<void> {
    if (!ids.length) return;
    const key = zoneVersionsKey(world);
    const versions = await Promise.all(ids.map((id) => this.deps.redis.send("HINCRBY", [key, String(id), "1"])));
    const message: ZonesMessage = { w: world, z: {} };
    ids.forEach((id, index) => {
      message.z[String(id)] = Number(versions[index]);
    });
    await this.deps.redis.publish(LIVE_ZONES_CHANNEL, JSON.stringify(message));
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
