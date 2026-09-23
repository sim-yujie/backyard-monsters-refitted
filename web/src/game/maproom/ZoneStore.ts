import {
  AREA_BURST,
  AREA_MAX_CONCURRENT,
  AREA_REFILL_PER_SECOND,
  RESOURCE_SYNC_SECONDS,
  ZONE_STALE_JITTER,
} from "@/config";
import { getArea } from "@/api/maproom";
import { ApiError, NetworkError } from "@/api/http";
import type { AreaCellGrid, GetAreaResponse, MapCell, Resources } from "@/api/types";
import { TokenBucket } from "./TokenBucket";
import {
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

export interface ZoneStoreOptions {
  /** Injected for tests; defaults to the real `getarea` call. */
  fetcher?: AreaFetcher;
  /** Injected for tests; milliseconds since an epoch. */
  now?: () => number;
  maxConcurrent?: number;
  /** Fired once per applied response, so the renderer can invalidate. */
  onZone?: (zone: ZoneRecord) => void;
  /** Fired when a response carried the caller's own resources. */
  onResources?: (resources: Resources, credits: number | undefined) => void;
  onError?: (error: ZoneError) => void;
  /** Fired when a request came back 401, so the app can return to login. */
  onAuthFailure?: () => void;
}

interface QueueEntry extends ZoneRef {
  priority: number;
  /** A forced entry survives a viewport change; a speculative one does not. */
  forced: boolean;
}

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
  private readonly queue = new Map<number, QueueEntry>();
  private readonly inFlight = new Set<number>();

  private readonly bucket: TokenBucket;
  private readonly fetcher: AreaFetcher;
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
  private consecutiveFailures = 0;
  private lastResourceSyncMs = 0;
  /** Per-zone jitter on the stale threshold, so they do not all expire together. */
  private readonly jitter = new Map<number, number>();

  constructor(options: ZoneStoreOptions = {}) {
    this.options = options;
    this.fetcher = options.fetcher ?? ((x, y, o) => getArea(x, y, o));
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

  /** Clears the backoff so the next pump tries again immediately. */
  resume(): void {
    this.pausedUntilMs = 0;
    this.consecutiveFailures = 0;
  }

  /**
   * Starts as many queued requests as the budget and concurrency allow.
   *
   * Call it from the scene's update loop. The returned promise settles when the
   * requests started by *this* call have settled, which is what the unit tests
   * await; callers in the game ignore it.
   */
  async pump(): Promise<void> {
    if (this.paused) return;
    this.topUpQueue();

    const started: Promise<void>[] = [];
    while (this.queue.size > 0 && this.inFlight.size + started.length < this.maxConcurrent) {
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
    };
    this.zones.set(entry.id, record);
    this.revision += 1;
    this.options.onZone?.(record);

    if (response.resources) {
      this.options.onResources?.(response.resources, response.credits);
    }
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
