import {
  AREA_BURST,
  AREA_ZONE_SIZE,
  AREA_MAX_CONCURRENT,
  AREA_REFILL_PER_SECOND,
  RESOURCE_SYNC_SECONDS,
  ZONE_STALE_JITTER,
} from "@/config";
import { getArea, getAreas } from "@/api/maproom";
import { ApiError, NetworkError } from "@/api/http";
import { isPlayerCell, type AreaCellGrid, type GetAreaResponse, type MapCell, type PlayerCell, type Resources } from "@/api/types";
import { TokenBucket } from "./TokenBucket";
import { parseAllianceRoster, type MapAlliance } from "./mapAlliances";
import {
  ZONE_COLUMNS,
  ZONE_ROWS,
  rangeCentre,
  zoneFor,
  zoneFromId,
  zonePriority,
  zonesForRange,
  type CellRange,
  type ZoneRef,
} from "./zones";

/** One cached area response. */
export interface ZoneRecord extends ZoneRef {
  data: AreaCellGrid;
  /** Milliseconds since the epoch when the response was applied. */
  fetchedAt: number;
  /**
   * The sight version (`sv`) the data was cut to: the answer's own, or the sight it was found to
   * still match when the sight changed (`ZoneStore.applySight`).
   */
  sv?: string;
  /** The zone's version when the server read it (`zv`, live map, beta 9); 0 before it ever changed. */
  zv?: number;
}

/** One of the viewer's own cells (`mine`) in the cache, with where it is (`attackEntry.OwnCell`). */
export interface StoredOwnCell {
  readonly col: number;
  readonly row: number;
  readonly cell: PlayerCell;
}

/** What the store reports when a request fails. */
export type ZoneErrorKind = "auth" | "rate-limit" | "network" | "server";

export interface ZoneError {
  kind: ZoneErrorKind;
  message: string;
}

export type AreaFetcher = (
  x: number,
  y: number,
  options: { sendResources?: boolean },
) => Promise<GetAreaResponse>;

/** Several zones in one call (`getareas`), answers in the order asked. */
export type AreasFetcher = (zones: readonly { x: number; y: number }[]) => Promise<GetAreaResponse[]>;

/**
 * Live map re-asks (beta 9, owner's standard practice, 25 Nov 2026): a zone a push says changed
 * is asked again only while it is on screen, at most once per {@link LIVE_MIN_GAP_MS}, after a
 * random wait of up to {@link LIVE_JITTER_MS} (so everyone watching it does not ask at once),
 * and every zone due together goes in one `getareas` call of at most {@link LIVE_BATCH} zones.
 */
export const LIVE_MIN_GAP_MS = 3_000;
export const LIVE_JITTER_MS = 1_500;
export const LIVE_BATCH = 10;
/** How long a zone the sight forgot is remembered, only to compare its next answer with. */
export const GHOST_MS = 15_000;

export interface ZoneStoreOptions {
  /** Injected for tests; defaults to the real `getarea` call. */
  fetcher?: AreaFetcher;
  /** Injected for tests; defaults to the real `getareas` call. */
  areasFetcher?: AreasFetcher;
  /** Injected for tests; 0..1. */
  random?: () => number;
  /** Injected for tests; milliseconds since an epoch. */
  now?: () => number;
  maxConcurrent?: number;
  /**
   * Fired once per applied response whose drawn cells changed (a zone's first
   * answer always), so the renderer can invalidate. `previous` is the record
   * it replaces, if the zone was cached.
   */
  onZone?: (zone: ZoneRecord, previous: ZoneRecord | undefined, live?: boolean) => void;
  /**
   * Fired instead of `onZone` when a refetched zone came back with the same
   * drawn cells as the record it replaces (`drawnKey`): the map's picture
   * needs no work, only what reads the clock (a truce running out) might.
   * The new record is stored either way, so the owner's live army and
   * resources (`m`, `r`) are always the latest.
   */
  onZoneRefreshed?: (zone: ZoneRecord) => void;
  /** Fired when a response carried the caller's own resources. */
  onResources?: (resources: Resources, credits: number | undefined) => void;
  /** Fired when a response carried the viewer's own alliance id (#334). */
  onAlliance?: (allianceId: number | null) => void;
  /** Fired with the alliances owning cells in a response's area (`alliancedata`, beta 7). */
  onAllianceRoster?: (roster: MapAlliance[]) => void;
  /**
   * Fired with every applied response's `sv` (issue #330, #331): the fog of
   * war sight version, so the caller can refetch `/worldmapv2/sight` and
   * drop the zone cache the moment it disagrees with what it is holding.
   */
  onSightVersion?: (sv: string | undefined) => void;
  onError?: (error: ZoneError) => void;
  /**
   * Starts the next queued zone as soon as a request answers, instead of
   * waiting for the caller's next `pump` (default on; a test that counts
   * exactly what one `pump` starts turns it off). Failures never chain: they
   * back off and wait for the caller's pump as before.
   */
  pumpOnSettle?: boolean;
  /** Fired when a request came back 401, so the app can return to login. */
  onAuthFailure?: () => void;
  /**
   * True for a zone the caller already knows is entirely outside the
   * player's fog of war sight (issue #331, `Sight.isZoneFullyFogged`): never
   * queued, so a zoomed-out viewport does not spend its request budget on
   * zones the server would answer as nothing but `{ fog: 1 }`.
   */
  skipZone?: (zone: ZoneRef) => boolean;
  /**
   * How many zones the cache keeps before forgetting the longest-unfetched ones (default
   * `MAX_CACHED_ZONES`). Never a zone on screen or holding the viewer's own cells.
   */
  maxZones?: number;
  /** Fired with the zones the cap just forgot, so the renderer forgets them too. */
  onEvict?: (zones: ZoneRecord[]) => void;
}

interface QueueEntry extends ZoneRef {
  priority: number;
  /** A forced entry survives a viewport change; a speculative one does not. */
  forced: boolean;
}

/**
 * The keys of a cell the map never draws: the viewer's own cells carry their
 * live resources (`r`) and army (`m`), which the server works out afresh on
 * every answer, so they differ on nearly every refetch while nothing on the
 * map does. Read by the panels and the attack screen from the store instead.
 */
const UNDRAWN_KEYS = new Set(["r", "m"]);

/**
 * A fingerprint of what the map draws from a zone's cells: the answer's JSON
 * without the undrawn keys, hashed (53-bit, cyrb53) so a few hundred cached
 * zones do not keep a second copy of their text.
 */
export const drawnKey = (data: AreaCellGrid): number => {
  const text = JSON.stringify(data, (key, value: unknown) =>
    UNDRAWN_KEYS.has(key) && typeof value === "object" && value !== null ? undefined : value,
  );
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

/** Whether an answer holds one of the viewer's own cells. */
const holdsOwnCell = (data: AreaCellGrid): boolean => {
  for (const column of Object.values(data)) {
    for (const cell of Object.values(column)) if (isPlayerCell(cell) && cell.mine === 1) return true;
  }
  return false;
};

/** Backoff after a failure, in milliseconds, by consecutive failure count. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 15_000];
/** How long to stand down after the server itself said 429. */
const RATE_LIMIT_BACKOFF_MS = 15_000;

/**
 * How many zones may be queued at once.
 *
 * Three bursts' worth. Deep enough that the queue never empties while requests
 * are in flight, shallow enough that a zoomed-out viewport does not enqueue the
 * whole world and then spend an hour draining it at a cell size of two pixels.
 */
export const QUEUE_DEPTH = 64;

/**
 * How many zones the cache holds before it forgets the ones fetched longest ago (map lag, 25 Nov
 * 2026: it never forgot any, so a long browse grew it, and everything that walks it, without
 * end). About fifteen screenfuls at the usual zoom. A soft cap: zones on screen (zoomed far out,
 * more than this) and zones holding the viewer's own cells are never forgotten.
 */
export const MAX_CACHED_ZONES = 300;

/**
 * Loads, caches and refreshes Map Room 2 zones.
 *
 * Responsibilities, in the order they matter:
 *
 *  - never exceed the server's 120 getarea/min (see TokenBucket),
 *  - fetch what the player is looking at before what they are not,
 *  - never have two requests in flight for the same zone,
 *  - keep visible zones fresh so NPC camp damage updates without opening a yard.
 *
 * The store holds no Pixi or DOM state: it is a cache with a scheduler, and it
 * tells the renderer that something changed through `revision` and `onZone`.
 */
export class ZoneStore {
  /** Bumped on every applied response; cheap change detection for the renderer. */
  revision = 0;

  private readonly zones = new Map<number, ZoneRecord>();
  /** Each cached zone's `drawnKey`, to tell a refetch that changed nothing drawn. */
  private readonly drawnKeys = new Map<number, number>();
  /** The cached zones holding one of the viewer's own cells (`mine`), for `ownCells`. */
  private readonly ownZones = new Set<number>();
  /** When each cached zone first went into `zones` (its place in the map's order), for `ownCells`. */
  private readonly placed = new Map<number, number>();
  private placedCount = 0;
  /** `ownCells`' answer, until the cache next changes. */
  private ownCache: StoredOwnCell[] | null = null;
  private readonly queue = new Map<number, QueueEntry>();
  private readonly inFlight = new Set<number>();
  /**
   * Live map (beta 9): zones the live socket said moved past the version cached, with that
   * version. Their next answer is "live" (the ring, the panel), and one that comes back older
   * (it was read before the change) is asked once more.
   */
  private readonly liveWanted = new Map<number, number>();
  private readonly liveRetried = new Set<number>();
  /** When each wanted zone may be asked (its random wait), ms. */
  private readonly liveDueAt = new Map<number, number>();
  /** When each zone was last asked because of a push, ms. */
  private readonly liveAskedAt = new Map<number, number>();
  /**
   * Zones the sight just forgot (`applySight`) with what they showed: an attack on the player's
   * own outpost changes their sight in the same moment, and without this its answer would arrive
   * as a first one, with nothing to ring. Kept {@link GHOST_MS}, never drawn.
   */
  private readonly ghosts = new Map<number, { record: ZoneRecord; live: boolean; at: number }>();
  /** The live batch in flight, and the server's "busy, retry after" pause. */
  private liveInFlight = false;
  private livePausedUntil = 0;
  /** "Busy" answers in a row: each doubles the server's wait, up to 30 s (a crowd backs off). */
  private busyInARow = 0;
  /** Each cached zone's first time-only change (a shield or truce running out...), unix seconds. */
  private readonly nextDue = new Map<number, number>();

  private readonly bucket: TokenBucket;
  private readonly fetcher: AreaFetcher;
  private readonly areasFetcher: AreasFetcher;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly maxConcurrent: number;
  private readonly options: ZoneStoreOptions;

  /** Zones the last `ensureVisible` asked for, used by the refresh rules. */
  private visible = new Set<number>();
  /** The same zones as a list, sorted lazily by distance from the centre. */
  private visibleOrdered: ZoneRef[] = [];
  private visibleSorted = false;
  private centre = { x: 0, y: 0 };

  private pausedUntilMs = 0;
  /** Set by `stop`: the map closed, so an answer landing later starts nothing new. */
  private stopped = false;
  private consecutiveFailures = 0;
  private lastResourceSyncMs = 0;
  /** Per-zone jitter on the stale threshold, so they do not all expire together. */
  private readonly jitter = new Map<number, number>();

  constructor(options: ZoneStoreOptions = {}) {
    this.options = options;
    this.fetcher = options.fetcher ?? ((x, y, o) => getArea(x, y, o));
    this.areasFetcher = options.areasFetcher ?? (async (zones) => (await getAreas(zones)).areas);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.maxConcurrent = options.maxConcurrent ?? AREA_MAX_CONCURRENT;
    this.bucket = new TokenBucket({
      capacity: AREA_BURST,
      refillPerSecond: AREA_REFILL_PER_SECOND,
      ...(options.now ? { now: options.now } : {}),
    });
  }

  /* ── Reads ──────────────────────────────────────────────────────────── */

  /** The cell at a coordinate, or undefined while its zone is unloaded. */
  getCell(x: number, y: number): MapCell | undefined {
    const zone = this.zones.get(zoneFor(x, y).id);
    return zone?.data[String(x)]?.[String(y)];
  }

  /** The cached record for a zone, for staleness displays. */
  getZone(id: number): ZoneRecord | undefined {
    return this.zones.get(id);
  }

  get loadedZones(): number {
    return this.zones.size;
  }

  /** Every cached zone, for the minimap's coverage shading. */
  loadedZoneRefs(): Iterable<ZoneRecord> {
    return this.zones.values();
  }

  /**
   * Every cell marked `mine` in the cache, once each: exactly `attackEntry.ownCellsIn` over every
   * cached zone (a cell on a shared zone edge is read from the copy fetched last), worked out from
   * the zones that hold one and kept until the cache changes (map lag, 25 Nov 2026: the map's
   * once-a-second range update walked every cell of every cached zone).
   */
  ownCells(): readonly StoredOwnCell[] {
    if (this.ownCache) return this.ownCache;
    const found = new Map<string, StoredOwnCell>();
    for (const id of this.ownZones) {
      const zone = this.zones.get(id);
      if (!zone) continue;
      for (const [xKey, column] of Object.entries(zone.data)) {
        for (const [yKey, cell] of Object.entries(column)) {
          if (!isPlayerCell(cell) || cell.mine !== 1) continue;
          const key = `${xKey},${yKey}`;
          if (found.has(key)) continue;
          const latest = this.latestCopy(Number(xKey), Number(yKey), xKey, yKey);
          if (latest && isPlayerCell(latest) && latest.mine === 1) {
            found.set(key, { col: Number(xKey), row: Number(yKey), cell: latest });
          }
        }
      }
    }
    this.ownCache = [...found.values()];
    return this.ownCache;
  }

  /**
   * The copy of a cell from the cached zone that fetched it last (zones share their edge row and
   * column, so up to four hold it); on a tie, the one later in the cache's order, as
   * `ownCellsIn` reads them.
   */
  private latestCopy(x: number, y: number, xKey: string, yKey: string): MapCell | undefined {
    let best: MapCell | undefined;
    let bestAt = -Infinity;
    let bestPlace = -Infinity;
    // A cell on a multiple of the zone size also sits on the edge of the zone before (`zones.ts`).
    const xs = x % AREA_ZONE_SIZE === 0 ? [x, x - AREA_ZONE_SIZE] : [x];
    const ys = y % AREA_ZONE_SIZE === 0 ? [y, y - AREA_ZONE_SIZE] : [y];
    for (const zx of xs) {
      for (const zy of ys) {
        if (zx < 0 || zy < 0) continue;
        const ref = zoneFor(zx, zy);
        if (ref.originX / AREA_ZONE_SIZE >= ZONE_COLUMNS || ref.originY / AREA_ZONE_SIZE >= ZONE_ROWS) continue;
        const zone = this.zones.get(ref.id);
        const cell = zone?.data[xKey]?.[yKey];
        if (!zone || cell === undefined) continue;
        const place = this.placed.get(ref.id) ?? 0;
        if (zone.fetchedAt > bestAt || (zone.fetchedAt === bestAt && place > bestPlace)) {
          best = cell;
          bestAt = zone.fetchedAt;
          bestPlace = place;
        }
      }
    }
    return best;
  }

  get pendingRequests(): number {
    return this.queue.size + this.inFlight.size;
  }

  /** True while the store is standing down after a failure. */
  get paused(): boolean {
    return this.now() < this.pausedUntilMs;
  }

  /* ── Scheduling ─────────────────────────────────────────────────────── */

  /**
   * Declares what the player can see.
   *
   * It does not queue the whole viewport. Zoomed all the way out the viewport
   * *is* the world — 6,400 zones — and queuing them would commit the client to
   * over an hour of requests at the permitted rate for a view in which a single
   * cell is two pixels across. Instead the visible set is remembered and the
   * queue is topped up from it, nearest first, to a fixed depth (`QUEUE_DEPTH`).
   * The map still fills in, it just fills in from the middle and stays bounded.
   *
   * Speculative entries for zones that have scrolled out of view are dropped:
   * panning past a region is a statement that the player does not want it, and
   * the request budget is better spent on what is on screen now.
   */
  ensureVisible(range: CellRange): void {
    this.visibleOrdered = zonesForRange(range);
    this.centre = rangeCentre(range);
    this.visible = new Set(this.visibleOrdered.map((zone) => zone.id));
    this.visibleSorted = false;

    for (const [id, entry] of this.queue) {
      if (!entry.forced && !this.visible.has(id)) this.queue.delete(id);
    }

    // Top up straight away when there is real room, so opening the map does not
    // wait for the next pump. A full queue means a pan is in progress and the
    // sort below would be repeated every frame for nothing.
    if (this.queue.size < QUEUE_DEPTH / 2) this.topUpQueue();
    this.reprioritise();
  }

  /**
   * Refetches visible zones whose data is older than `maxAgeSeconds`.
   *
   * This is the rule behind "NPC camp state stays fresh without opening the
   * yard": nothing here waits for the player to interact with a cell.
   */
  refreshStale(maxAgeSeconds: number): void {
    const now = this.now();
    let queued = 0;

    // Nearest first and capped, for the same reason ensureVisible is: at world
    // scale "everything visible" is every zone the client has ever loaded.
    for (const ref of this.orderedVisible()) {
      if (queued >= QUEUE_DEPTH) break;
      const zone = this.zones.get(ref.id);
      if (!zone) continue;
      const ageSeconds = (now - zone.fetchedAt) / 1000;
      if (ageSeconds < maxAgeSeconds * this.jitterFor(ref.id)) continue;
      this.enqueue(zone, false);
      queued += 1;
    }
    this.reprioritise();
  }

  /**
   * Refetches everything visible regardless of age: tab focus, refresh button.
   *
   * Capped the same way as `ensureVisible`, and for the same reason: "refresh"
   * on a world-scale view must not mean 6,400 requests.
   */
  refreshVisible(): void {
    // Fills the queue to the depth rather than adding that many, so the queue
    // never exceeds QUEUE_DEPTH however often refresh is pressed.
    for (const zone of this.orderedVisible()) {
      if (this.queue.size >= QUEUE_DEPTH) break;
      this.enqueue(zoneFromId(zone.id), true);
    }
    this.reprioritise();
  }

  /** Forces one cell's zone to the front of the queue, after an action on it. */
  invalidateCell(x: number, y: number): void {
    this.enqueue(zoneFor(x, y), true);
    this.reprioritise();
  }

  /* ── Live map (beta 9) ───────────────────────────────────────────────── */

  /**
   * The live socket's zone versions: every cached (or arriving) zone whose version differs from
   * the one it holds is asked again, at the front of the queue; nothing else is. Returns how many
   * were asked.
   */
  applyVersions(pairs: readonly (readonly [number, number])[], now: boolean = false): number {
    let wanted = 0;
    const at = this.now();
    for (const [id, version] of pairs) {
      const zone = this.zones.get(id);
      const flying = this.inFlight.has(id);
      if (!zone && !flying) continue;
      if (zone && !flying && (zone.zv ?? 0) === version) continue;
      this.liveWanted.set(id, Math.max(version, this.liveWanted.get(id) ?? version));
      this.liveRetried.delete(id);
      if (!this.liveDueAt.has(id)) this.liveDueAt.set(id, at + (now ? 0 : Math.floor(this.random() * LIVE_JITTER_MS)));
      wanted += 1;
    }
    return wanted;
  }

  /** Zones a push said changed that have not been asked again yet (on screen or not). */
  get liveWaiting(): number {
    return this.liveWanted.size;
  }

  /**
   * Asks again, in one `getareas` call, the changed zones that are due: on screen, their random
   * wait over, not asked because of a push in the last {@link LIVE_MIN_GAP_MS}, not already in
   * flight. One batch at a time; call it from the scene's pump. A zone off screen keeps waiting
   * and is asked once it comes into view. "Busy" from the server pauses the batches for as long
   * as it says, then they try again.
   */
  async pumpLive(): Promise<void> {
    if (this.stopped || this.liveInFlight || this.liveWanted.size === 0) return;
    const at = this.now();
    if (at < this.livePausedUntil) return;
    const due: ZoneRef[] = [];
    for (const id of this.liveWanted.keys()) {
      if (due.length >= LIVE_BATCH) break;
      if (!this.visible.has(id) || this.inFlight.has(id)) continue;
      if ((this.liveDueAt.get(id) ?? 0) > at) continue;
      if (at - (this.liveAskedAt.get(id) ?? -Infinity) < LIVE_MIN_GAP_MS) continue;
      due.push(zoneFromId(id));
    }
    if (due.length === 0) return;
    this.liveInFlight = true;
    for (const zone of due) {
      this.inFlight.add(zone.id);
      this.liveAskedAt.set(zone.id, at);
      this.liveDueAt.delete(zone.id);
      // A forced entry for the same zone is answered by this batch.
      this.queue.delete(zone.id);
    }
    let answers: GetAreaResponse[] | undefined;
    let failure: unknown;
    try {
      answers = await this.areasFetcher(due.map((zone) => ({ x: zone.originX, y: zone.originY })));
    } catch (caught) {
      failure = caught;
    }
    for (const zone of due) this.inFlight.delete(zone.id);
    this.liveInFlight = false;
    if (answers) {
      this.busyInARow = 0;
      due.forEach((zone, index) => {
        const answer = answers![index];
        if (answer) this.apply({ ...zone, priority: 0, forced: true }, answer);
      });
      return;
    }
    // Still wanted: asked again once due (and after the server's pause, if it was busy).
    for (const zone of due) this.liveDueAt.set(zone.id, this.now());
    const retry = busyRetrySeconds(failure);
    if (retry !== null) {
      this.livePausedUntil = this.now() + Math.min(30, retry * 2 ** this.busyInARow) * 1000;
      this.busyInARow += 1;
    }
    else if (failure instanceof ApiError && failure.isAuthFailure) this.handleFailure({ ...due[0]!, priority: 0, forced: true }, failure);
    else this.livePausedUntil = this.now() + LIVE_MIN_GAP_MS;
  }

  /**
   * The zones worth watching on the live socket, at most `limit`: those holding the viewer's own
   * cells first (the attack roster reads them wherever they are), then the visible ones nearest
   * the centre.
   */
  watchList(limit: number): number[] {
    const out = new Set<number>();
    for (const id of this.ownZones) {
      if (out.size >= limit) break;
      out.add(id);
    }
    for (const zone of this.orderedVisible()) {
      if (out.size >= limit) break;
      // A zone wholly in the fog is never watched: its changes are not the viewer's to know.
      if (this.options.skipZone?.(zone)) continue;
      out.add(zone.id);
    }
    return [...out];
  }

  /** Every cached zone and the version it holds, for a version check after a reconnect. */
  heldVersions(): Map<number, number> {
    const out = new Map<number, number>();
    for (const zone of this.zones.values()) out.set(zone.id, zone.zv ?? 0);
    return out;
  }

  /**
   * Once a second (live map, beta 9): applies the time-only changes that are due, without asking
   * the server: a shield (`pe`) or a camp's damage (`rg`) runs out, a truce (`t`) ends. A running
   * attack's end (`atk`) asks the zone again, as the yard's lock may have gone with it. A zone
   * whose cells changed is handed to `onZone` again, as a fresh answer would be.
   */
  expireDue(nowSeconds: number): void {
    for (const [id, due] of this.nextDue) {
      if (due > nowSeconds) continue;
      const zone = this.zones.get(id);
      if (!zone) {
        this.nextDue.delete(id);
        continue;
      }
      const { changed, reask } = expireCells(zone.data, nowSeconds);
      const next = firstDue(zone.data);
      if (next === undefined) this.nextDue.delete(id);
      else this.nextDue.set(id, next);
      if (reask) this.enqueue(zoneFromId(id), true);
      if (!changed) continue;
      this.drawnKeys.set(id, drawnKey(zone.data));
      this.ownCache = null;
      this.revision += 1;
      if (!this.stopped) this.options.onZone?.(zone, zone, false);
    }
  }

  /** Clears the backoff so the next pump tries again immediately. */
  resume(): void {
    this.pausedUntilMs = 0;
    this.consecutiveFailures = 0;
  }

  /**
   * Forgets every cached zone (issue #331, `fog-of-war.md` §6): the player's
   * sight version changed, so what used to be visible may now be fog and
   * there is no memory of it to fall back on. Queued requests are dropped
   * too, since some may now be for zones `skipZone` would refuse; already
   * in-flight requests are left to land — whatever they come back with is
   * still the server's own, current word on what is visible.
   *
   * Callers follow this with `ensureVisible` for the current viewport, so
   * the map refills rather than sitting empty.
   */
  dropAll(): void {
    this.zones.clear();
    this.drawnKeys.clear();
    this.ownZones.clear();
    this.placed.clear();
    this.ownCache = null;
    this.queue.clear();
    this.revision += 1;
  }

  /**
   * The player's sight changed (map lag, 25 Nov 2026): forgets only the cached zones `keep`
   * refuses (those whose visible cells may differ under the new sight, `Sight` decides), and
   * stamps the rest with the new `sv`, since they show exactly what it lets them. The "no memory"
   * rule (`fog-of-war.md` §6) holds: a zone any of whose cells gained or lost sight is forgotten
   * like `dropAll` forgets them all. The queue is emptied as there, for `skipZone`'s sake.
   * Returns the forgotten records, for the renderer to forget too.
   */
  applySight(keep: (zone: ZoneRecord) => boolean, sv: string): ZoneRecord[] {
    const dropped: ZoneRecord[] = [];
    for (const [id, zone] of this.zones) {
      if (keep(zone)) {
        zone.sv = sv;
        continue;
      }
      dropped.push(zone);
      // Live map: what it showed, only to tell what its next answer changed (never drawn again).
      this.ghosts.set(id, { record: zone, live: this.liveWanted.has(id), at: this.now() });
      this.forget(id);
    }
    this.queue.clear();
    this.revision += 1;
    return dropped;
  }

  /**
   * Starts as many queued requests as the budget and concurrency allow.
   *
   * Call it from the scene's update loop. The returned promise settles when the
   * requests started by *this* call have settled, which is what the unit tests
   * await; callers in the game ignore it.
   */
  async pump(): Promise<void> {
    if (this.paused || this.stopped) return;
    this.topUpQueue();

    const started: Promise<void>[] = [];
    // `request` marks its zone in flight before its first await, so `inFlight`
    // already counts what this loop started: adding `started.length` as well
    // counted each new request twice and let only half the limit run at once.
    while (this.queue.size > 0 && this.inFlight.size < this.maxConcurrent) {
      const next = this.takeHighestPriority();
      if (!next) break;
      if (!this.bucket.take()) {
        // Out of budget: put it back and wait for the bucket to refill.
        this.queue.set(next.id, next);
        break;
      }
      started.push(this.request(next));
    }

    await Promise.all(started);
  }

  /**
   * The map closed: nothing new starts from here on (requests already out
   * still land in the cache, which nobody reads any more).
   */
  stop(): void {
    this.stopped = true;
    this.queue.clear();
  }

  /* ── Internals ──────────────────────────────────────────────────────── */

  /**
   * The visible zones, nearest the viewport centre first.
   *
   * Sorted on demand rather than in `ensureVisible`, because the camera is
   * dirty on every frame of a drag and the list can hold 6,400 entries.
   */
  private orderedVisible(): ZoneRef[] {
    if (!this.visibleSorted) {
      this.visibleOrdered.sort(
        (a, b) => zonePriority(a, this.centre) - zonePriority(b, this.centre),
      );
      this.visibleSorted = true;
    }
    return this.visibleOrdered;
  }

  /** Fills the queue from the visible set, nearest first, up to QUEUE_DEPTH. */
  private topUpQueue(): void {
    if (this.queue.size >= QUEUE_DEPTH) return;

    for (const zone of this.orderedVisible()) {
      if (this.queue.size >= QUEUE_DEPTH) break;
      if (this.zones.has(zone.id) || this.inFlight.has(zone.id)) continue;
      this.enqueue(zone, false);
    }
  }

  private enqueue(zone: ZoneRef, forced: boolean): void {
    if (this.inFlight.has(zone.id)) return;
    if (this.options.skipZone?.(zone)) return;
    const existing = this.queue.get(zone.id);
    if (existing) {
      // A forced request never gets downgraded to speculative.
      existing.forced ||= forced;
      return;
    }
    this.queue.set(zone.id, { ...zone, forced, priority: 0 });
  }

  private reprioritise(): void {
    for (const entry of this.queue.values()) {
      entry.priority = zonePriority(entry, this.centre);
    }
  }

  private takeHighestPriority(): QueueEntry | undefined {
    let best: QueueEntry | undefined;
    for (const entry of this.queue.values()) {
      if (!best || entry.priority < best.priority) best = entry;
    }
    if (best) this.queue.delete(best.id);
    return best;
  }

  /**
   * Piggy-backs the resource sync onto whichever request happens to be next.
   *
   * `sendresources=1` makes the server attach the caller's own resources and
   * credits, which is how the HUD stays live without a second endpoint. Asking
   * on every request would be wasted server work, so it is rate limited on its
   * own clock.
   */
  private shouldSyncResources(): boolean {
    return this.now() - this.lastResourceSyncMs >= RESOURCE_SYNC_SECONDS * 1000;
  }

  private async request(entry: QueueEntry): Promise<void> {
    this.inFlight.add(entry.id);
    const wantsResources = this.shouldSyncResources();
    if (wantsResources) this.lastResourceSyncMs = this.now();

    let response: GetAreaResponse | undefined;
    let failure: unknown;
    try {
      response = await this.fetcher(entry.originX, entry.originY, {
        sendResources: wantsResources,
      });
    } catch (caught) {
      failure = caught;
    }

    // Clear the in-flight mark first: handleFailure re-queues the zone, and
    // enqueue refuses anything it believes is still being fetched.
    this.inFlight.delete(entry.id);

    if (response) {
      this.apply(entry, response);
      this.consecutiveFailures = 0;
      this.busyInARow = 0;
      // A slot just came free: start the next queued zone now rather than at
      // the scene's next pump tick (up to 250 ms later on every request).
      if (this.options.pumpOnSettle !== false && !this.stopped) void this.pump();
      return;
    }
    this.handleFailure(entry, failure);
  }

  private apply(entry: QueueEntry, response: GetAreaResponse): void {
    const record: ZoneRecord = {
      id: entry.id,
      originX: entry.originX,
      originY: entry.originY,
      data: response.data,
      fetchedAt: this.now(),
      ...(response.sv !== undefined && { sv: response.sv }),
      ...(response.zv !== undefined && { zv: response.zv }),
    };
    // Live map: an answer the socket asked for, and one read before the change it was asked for.
    const wanted = this.liveWanted.get(entry.id);
    const ghost = this.ghosts.get(entry.id);
    this.ghosts.delete(entry.id);
    const recent = ghost && this.now() - ghost.at < GHOST_MS ? ghost : undefined;
    const live = wanted !== undefined || recent?.live === true;
    this.liveWanted.delete(entry.id);
    if (wanted !== undefined && response.zv !== undefined && response.zv < wanted && !this.liveRetried.has(entry.id)) {
      // Read before the change it was asked for: asked once more by the next live batch.
      this.liveRetried.add(entry.id);
      this.liveWanted.set(entry.id, wanted);
      this.liveDueAt.set(entry.id, this.now());
    } else {
      this.liveRetried.delete(entry.id);
      this.liveDueAt.delete(entry.id);
    }
    const due = firstDue(response.data);
    if (due === undefined) this.nextDue.delete(entry.id);
    else this.nextDue.set(entry.id, due);
    const previous = this.zones.get(entry.id);
    // What the live ring compares with: the record replaced, or the one the sight just forgot.
    const compared = previous ?? (live ? recent?.record : undefined);
    const key = drawnKey(response.data);
    const unchanged = previous !== undefined && this.drawnKeys.get(entry.id) === key;
    if (!previous) this.placed.set(entry.id, (this.placedCount += 1));
    this.zones.set(entry.id, record);
    this.drawnKeys.set(entry.id, key);
    if (holdsOwnCell(response.data)) this.ownZones.add(entry.id);
    else this.ownZones.delete(entry.id);
    this.ownCache = null;
    this.revision += 1;
    const evicted = previous ? [] : this.evictBeyondCap();
    // A zone that lands after the map closed only fills the cache: the scene's
    // callbacks would draw on a renderer that is already destroyed (live error
    // "reading 'clear'" in drawHighlight, 9-10 Nov).
    if (this.stopped) return;
    // The minute's refresh of a zone that did not change (map lag, 25 Nov
    // 2026): applying it again cost the whole picture's rework, a 10-80 ms
    // hitch per zone, every minute, while standing still.
    if (evicted.length > 0) this.options.onEvict?.(evicted);
    if (unchanged) this.options.onZoneRefreshed?.(record);
    else this.options.onZone?.(record, compared, live);

    if (response.resources) {
      this.options.onResources?.(response.resources, response.credits);
    }
    if (response.myalliance !== undefined) {
      this.options.onAlliance?.(response.myalliance);
    }
    if (response.alliancedata !== undefined) {
      this.options.onAllianceRoster?.(parseAllianceRoster(response.alliancedata));
    }
    this.options.onSightVersion?.(response.sv);
  }

  /** Takes one zone out of the cache and everything kept about it. */
  private forget(id: number): void {
    this.zones.delete(id);
    this.nextDue.delete(id);
    this.liveWanted.delete(id);
    this.liveRetried.delete(id);
    this.liveDueAt.delete(id);
    this.liveAskedAt.delete(id);
    this.drawnKeys.delete(id);
    this.ownZones.delete(id);
    this.placed.delete(id);
    this.ownCache = null;
  }

  /**
   * Forgets the zones fetched longest ago while the cache holds more than its cap
   * (`MAX_CACHED_ZONES`), never one on screen or holding the viewer's own cells. Returns them.
   */
  private evictBeyondCap(): ZoneRecord[] {
    const cap = this.options.maxZones ?? MAX_CACHED_ZONES;
    const evicted: ZoneRecord[] = [];
    while (this.zones.size > cap) {
      let oldest: ZoneRecord | undefined;
      for (const zone of this.zones.values()) {
        if (this.visible.has(zone.id) || this.ownZones.has(zone.id)) continue;
        if (!oldest || zone.fetchedAt < oldest.fetchedAt) oldest = zone;
      }
      if (!oldest) break;
      this.forget(oldest.id);
      evicted.push(oldest);
    }
    if (evicted.length > 0) this.revision += 1;
    return evicted;
  }

  private handleFailure(entry: QueueEntry, caught: unknown): void {
    // Keep the zone queued: a failed fetch is still a zone the player needs.
    this.enqueue(entry, entry.forced);

    if (caught instanceof ApiError && caught.isAuthFailure) {
      this.queue.clear();
      this.pausedUntilMs = Number.POSITIVE_INFINITY;
      this.options.onError?.({ kind: "auth", message: "Your session has expired." });
      this.options.onAuthFailure?.();
      return;
    }

    // The server is busy (`areaGate`): wait as long as it says, quietly, and ask again.
    const busy = busyRetrySeconds(caught);
    if (busy !== null) {
      this.pausedUntilMs = this.now() + Math.min(30, busy * 2 ** this.busyInARow) * 1000;
      this.busyInARow += 1;
      return;
    }

    if (caught instanceof ApiError && caught.status === 429) {
      // The server's window disagrees with the local budget, so trust the
      // server: empty the bucket and stand down for a while.
      this.bucket.drain();
      this.pausedUntilMs = this.now() + RATE_LIMIT_BACKOFF_MS;
      this.options.onError?.({
        kind: "rate-limit",
        message: "Slowing down: the server is rate limiting map requests.",
      });
      return;
    }

    this.consecutiveFailures += 1;
    const backoff =
      BACKOFF_MS[Math.min(this.consecutiveFailures - 1, BACKOFF_MS.length - 1)] ?? 15_000;
    this.pausedUntilMs = this.now() + backoff;

    if (caught instanceof NetworkError) {
      this.options.onError?.({
        kind: "network",
        message: "Lost contact with the server. Retrying…",
      });
      return;
    }

    const message = caught instanceof Error ? caught.message : "The map could not be loaded.";
    this.options.onError?.({ kind: "server", message });
  }

  /**
   * A stable per-zone multiplier in [1 - j, 1 + j] on the stale threshold.
   *
   * Derived once per zone and kept, so a zone does not drift its own deadline
   * every time it is checked.
   */
  private jitterFor(id: number): number {
    const existing = this.jitter.get(id);
    if (existing !== undefined) return existing;
    const value = 1 + (Math.random() * 2 - 1) * ZONE_STALE_JITTER;
    this.jitter.set(id, value);
    return value;
  }
}

/** A cell's time-only changes still to come (live map, beta 9), unix seconds. */
const dueTimes = (cell: MapCell): number[] => {
  const out: number[] = [];
  const timed = cell as { pe?: unknown; atk?: unknown; t?: unknown; rg?: unknown };
  for (const value of [timed.pe, timed.atk, timed.t, timed.rg]) if (typeof value === "number" && value > 0) out.push(value);
  return out;
};

/** The first time-only change among a zone's cells, or undefined when none is coming. */
export const firstDue = (data: AreaCellGrid): number | undefined => {
  let first = Infinity;
  for (const column of Object.values(data)) {
    for (const cell of Object.values(column)) for (const at of dueTimes(cell)) first = Math.min(first, at);
  }
  return Number.isFinite(first) ? first : undefined;
};

/**
 * Applies a zone's time-only changes due by `now`, in place: a shield ends (`p` 0), a camp grows
 * back (`dm`, `d` 0), a truce ends. `reask`: a running attack ended, which only the server can say
 * the rest of (the yard's lock).
 */
export const expireCells = (data: AreaCellGrid, now: number): { changed: boolean; reask: boolean } => {
  let changed = false;
  let reask = false;
  for (const column of Object.values(data)) {
    for (const cell of Object.values(column)) {
      const timed = cell as { p?: number; pe?: number; atk?: number; t?: number; rg?: number; dm?: number; d?: number };
      if (typeof timed.pe === "number" && timed.pe <= now) {
        timed.p = 0;
        delete timed.pe;
        changed = true;
      }
      if (typeof timed.atk === "number" && timed.atk <= now) {
        delete timed.atk;
        changed = true;
        reask = true;
      }
      if (typeof timed.t === "number" && timed.t <= now) {
        delete timed.t;
        changed = true;
      }
      if (typeof timed.rg === "number" && timed.rg <= now) {
        timed.dm = 0;
        timed.d = 0;
        delete timed.rg;
        changed = true;
      }
    }
  }
  return { changed, reask };
};

/** The seconds a "busy" answer (503 from `areaGate`) says to wait, or null for any other failure. */
export const busyRetrySeconds = (caught: unknown): number | null => {
  if (!(caught instanceof ApiError) || (caught.status !== 503 && caught.serverStatus !== 503)) return null;
  const retry = Number((caught.body as { retry?: unknown } | undefined)?.retry);
  return Number.isFinite(retry) && retry > 0 ? Math.min(retry, 30) : 3;
};
