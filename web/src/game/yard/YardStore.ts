import type {
  BaseLoadResponse,
  CompletedJob,
  ResourceCaps,
  Resources,
  SpeedupItem,
  ShopBuyReport,
  SpeedupReport,
  UpgradeCancelReport,
  UpgradeInstantReport,
  UpgradeStartReport,
  YardResponse,
} from "@/api/types";
import { YARD_STATE_KEYS } from "@/api/types";
import { yardApi, yardRefusal, type YardApi, type YardRefusal } from "@/api/yard";
import type { BaiterRun } from "@/game/baiter/baiterSession";
import type { Notices } from "@/ui/maproom/Notices";
import type { MonstersFocus, MonstersTabId } from "@/ui/monsters/monstersTab";
import { costOf, maxLevel, TRAP_TYPES, WALL_TYPES, type YardKind } from "./buildingCosts";
import { JobKind, predictCompletion, SERVER_COMPLETED_KINDS, yardJobs, type YardJob } from "./jobs";
import { MAIN_YARD, outpostBaseid, type OwnYardTarget } from "./ownYards";
import { freeWorkers, holdsWorker } from "./workers";
import { readYard, type Yard, type YardBuilding, type YardWorkers } from "./yardModel";

/**
 * One of the player's own yards, the main yard or an outpost, as one source
 * of truth (`docs/design/yard-buildings.md` §2.1 "The client side", §2.4).
 *
 * The store holds the save the yard was loaded from, merges every yard-route
 * answer into it, and runs actions through a one-at-a-time queue (T4): a
 * second click while a request is in flight waits for the first answer, then
 * re-checks its own preconditions against the state that answer left, and is
 * refused locally when they no longer hold. It also predicts timers: the
 * scene calls {@link YardStore.tick} once a second, and when a job the server
 * completes reaches zero the display flips at once (the building redraws at
 * its new level, the worker frees) and ONE `POST /bm/yard/state` is scheduled
 * a second later for every job that finished in that second. Whatever the
 * server answers replaces the prediction.
 *
 * Every change is announced through {@link YardStore.subscribe}: the scene,
 * the building panel, the HUD and (Phase 2) the Monsters screen all redraw
 * from the store and from nothing else.
 *
 * ## Hooks for the UI work packages
 *
 * The scene builds one {@link YardUiBinding} per own-yard load and hands the
 * same object to the building panel (WP1.5, `BuildingPanelOptions.yard`) and
 * to the HUD (WP1.6, `Hud.bindYard(binding)`; `null` on a foreign yard or on
 * leaving). A foreign yard has no store and no binding: its panel is
 * read-only and its HUD shows no resources.
 *
 * - `binding.store` — this store. Read {@link YardStoreReader} for what to
 *   draw (`yard`, `save`, `resources`, `credits`, `caps`, `workers`,
 *   `jobs()`, `now()`, `building(id)`), and call {@link YardStoreActions}
 *   (`upgrade`, `cancelUpgrade`, `instantUpgrade`, `speedUp`, `buy`, or
 *   `run` for a route this file does not wrap yet). Every action resolves to
 *   a {@link YardActionResult} and never throws: `{ ok: true, report,
 *   completed }` or `{ ok: false, refusal }`, the refusal carrying the
 *   server's `reason` key (`busy`, `shortfall`, `workers`, …) and message.
 *   Disable a button while `store.isRunning(key)` is true for its key
 *   (`upgrade:<id>`, `cancel:<id>`, `instant:<id>`, `speedup:<id>`,
 *   `buy:<item>`, see {@link actionKey}); the store announces a change with
 *   reason `pending` whenever that set changes.
 * - `binding.store.subscribe(listener)` — called after every change with a
 *   {@link YardChange}: `reason` (`action`, `refresh`, `predicted`, `merge`,
 *   `pending`), the server's `completed` list for that answer (what the
 *   notices of §3.1 group and show; `[]` when nothing finished), and the
 *   jobs the client `predicted` finished. Returns the unsubscribe; call it
 *   on destroy. `away` comes once, from {@link YardStore.start}, with what
 *   the load's own catch-up finished while the player was away (#135); the
 *   yard itself did not change.
 * - `binding.scene.selectBuilding(id)` — pans the camera to a building and
 *   opens its panel: the HUD's Workers control (soonest `nextWorkerJob`) and
 *   a clicked job notice use it.
 * - `binding.scene.openMonsters(tab, focus)` — opens the Monsters screen
 *   (`web/src/ui/monsters/MonstersScreen.ts`) on a tab: the HUD's Monsters
 *   button and the Open button on a monster building use it.
 * - `binding.notices` — the scene's notice dock, for job toasts.
 *
 * The scene owns the store's lifetime: it creates it after the own-yard
 * `/base/load`, calls `tick()` every second, `refresh()` when the tab becomes
 * visible again, `mergeWrite()` when a Yard Planner route answers, and
 * `destroy()` on exit.
 *
 * ## Outposts (outposts WP5, #146)
 *
 * The store is made for one {@link OwnYardTarget}: the main yard, or an
 * outpost by its `baseid`. Every request it sends names that outpost
 * ({@link YardStore.baseid}, handed to each action's `send`), its `state`
 * included, so an outpost's store never asks for the main yard and never
 * replaces the outpost with it. The pool it shows is the main yard's either
 * way: the server serves the owner's pool and caps with an outpost
 * (`services/yard/poolView.ts`).
 */

/** Why the store announced a change. */
export const YardChangeReason = {
  /** A yard action answered; the state is the server's. */
  ACTION: "action",
  /** A `state` call answered; the state is the server's. */
  REFRESH: "refresh",
  /** A job reached zero and the client flipped the display ahead of the server. */
  PREDICTED: "predicted",
  /** A route outside the store (a Yard Planner write) answered and was merged. */
  MERGE: "merge",
  /** Only the set of running requests changed; the yard did not. */
  PENDING: "pending",
  /**
   * What the own-yard `/base/load` finished while the player was away, once,
   * at start. The load's save already holds the result, so the yard did not change.
   */
  AWAY: "away",
} as const;
export type YardChangeReason = (typeof YardChangeReason)[keyof typeof YardChangeReason];

export interface YardChange {
  readonly reason: YardChangeReason;
  /** What the server's catch-up finished in the answer behind this change, oldest first. */
  readonly completed: readonly CompletedJob[];
  /** The jobs the client just predicted finished (`predicted` only). */
  readonly predicted: readonly YardJob[];
}

export type YardListener = (change: YardChange) => void;

/** What an action came to. Never thrown: a refusal is a value. */
export type YardActionResult<Report> =
  | { readonly ok: true; readonly report: Report; readonly completed: readonly CompletedJob[] }
  | { readonly ok: false; readonly refusal: YardRefusal };

/**
 * One request for the queue.
 *
 * `check` runs against the store just before the request is sent — after
 * every request queued ahead of it has answered — and refuses locally by
 * returning a refusal. `send` makes the call, spreading `yard` last into
 * whatever `yard*.ts` call it makes: {@link YardArgs}.
 */
export interface YardStoreAction<Report> {
  /** Groups requests for {@link YardStoreReader.isRunning}; see {@link actionKey}. */
  readonly key: string;
  readonly check?: (store: YardStoreReader) => YardRefusal | null;
  readonly send: (api: YardApi, ...yard: YardArgs) => Promise<YardResponse<Report>>;
}

/**
 * The yard a request acts on, as the trailing argument of a `yard*.ts` call:
 * `[baseid]` on an outpost, and nothing at all on the main yard, whose calls
 * therefore go out exactly as they did before outposts.
 */
export type YardArgs = [] | [baseid: string];

/** The read side, for everything that draws. */
export interface YardStoreReader {
  /** Which of the player's yards this is. */
  readonly target: OwnYardTarget;
  /** Which props table it builds from: the outpost's on an outpost. */
  readonly kind: YardKind;
  /** The outpost's `baseid`, which every request sends; undefined on the main yard. */
  readonly baseid: string | undefined;
  /** The merged save: `/base/load`'s response with every later answer merged in. */
  readonly save: BaseLoadResponse;
  /** The draw list built from {@link save}. */
  readonly yard: Yard;
  readonly resources: Resources;
  readonly credits: number;
  /** The storage caps, once a yard route has answered; null before. */
  readonly caps: ResourceCaps | null;
  /** Workers as the yard stands now, predictions included. */
  readonly workers: YardWorkers;
  /** True while a request is in flight. */
  readonly busy: boolean;
  /** Whether a request with this key is in flight or queued. */
  isRunning(key: string): boolean;
  /** Every job in the yard, soonest first (`jobs.ts`). */
  jobs(): readonly YardJob[];
  /** The server's clock, estimated: unix seconds. */
  now(): number;
  building(id: number): YardBuilding | null;
  subscribe(listener: YardListener): () => void;
}

/** The action side, for the panel and the Monsters screen. */
export interface YardStoreActions {
  upgrade(id: number): Promise<YardActionResult<UpgradeStartReport>>;
  cancelUpgrade(id: number): Promise<YardActionResult<UpgradeCancelReport>>;
  instantUpgrade(id: number): Promise<YardActionResult<UpgradeInstantReport>>;
  speedUp(id: number, item: SpeedupItem): Promise<YardActionResult<SpeedupReport>>;
  buy(item: string): Promise<YardActionResult<ShopBuyReport>>;
  run<Report>(action: YardStoreAction<Report>): Promise<YardActionResult<Report>>;
  refresh(): Promise<YardActionResult<null>>;
}

/** What the scene lets the panel and the HUD do to it. */
export interface YardSceneHooks {
  /** Pans the camera to a building and opens its panel. */
  selectBuilding(id: number): void;
  /**
   * Opens the Monsters screen on a tab (§4.1): the HUD's Monsters button and a
   * monster building's Open button use it. Absent where there is no screen.
   */
  openMonsters?(tab: MonstersTabId, focus?: MonstersFocus): void;
  /** Starts a Wild Monster Baiter practice attack (#126). Absent where there is none. */
  runBaiter?(run: BaiterRun): void;
  /**
   * Opens the Shop (§8.2): the General Store's Open Shop button and the HUD's
   * Shiny counter use it. Absent where there is no screen.
   */
  openShop?(): void;
}

/** Handed to the building panel (WP1.5) and the HUD (WP1.6) on the player's own yard. */
export interface YardUiBinding {
  readonly store: YardStore;
  readonly scene: YardSceneHooks;
  readonly notices: Notices;
}

/** The queue key for an action on a target: `upgrade:12`, `buy:BST`. */
export const actionKey = (action: string, target: number | string): string =>
  `${action}:${target}`;

/** Timers, injectable so tests can run the clock by hand. */
export interface YardStoreTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface YardStoreOptions {
  /** The own-yard `/base/load` response. */
  save: BaseLoadResponse;
  /** The yard that load was for; the main yard when absent. */
  target?: OwnYardTarget;
  /**
   * What that load's catch-up finished while the player was away (its
   * `completed`), announced once by {@link YardStore.start} (#135).
   */
  away?: readonly CompletedJob[];
  api?: YardApi;
  /** The browser's clock, unix seconds. The store corrects it by the server's `currenttime`. */
  clock?: () => number;
  timers?: YardStoreTimers;
  /** How long after a job ends the `state` call goes out. 1 s (§2.4). */
  refreshDelayMs?: number;
  /**
   * The same when every job that ended is a hatch: 10 s, so a yard hatching a
   * monster every few seconds asks for its housing now and then, not per
   * monster (#142).
   */
  hatchRefreshDelayMs?: number;
  /** Called when a request comes back 401/403; the scene sends the player to log in. */
  onAuthFailure?: () => void;
}

/** One second, the coalescing window of §2.4. */
const REFRESH_DELAY_MS = 1_000;

/** The coalescing window when only hatches ended (#142). */
const HATCH_REFRESH_DELAY_MS = 10_000;

const browserTimers: YardStoreTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (handle) => window.clearTimeout(handle as number),
};

/** A local refusal, in the server's shape. */
const refuse = (
  reason: string,
  message: string,
  detail: Record<string, unknown> = {},
): YardRefusal => ({ reason, message, detail, local: true });

interface QueuedAction {
  readonly type: "action";
  readonly key: string;
  readonly check: ((store: YardStoreReader) => YardRefusal | null) | undefined;
  readonly send: (api: YardApi, ...yard: YardArgs) => Promise<YardResponse<unknown>>;
  readonly resolve: (result: YardActionResult<unknown>) => void;
}

interface QueuedRefresh {
  readonly type: "refresh";
  readonly key: typeof REFRESH_KEY;
  /** How many requests had been sent when this refresh was asked for. */
  readonly after: number;
  readonly promise: Promise<YardActionResult<null>>;
  readonly resolve: (result: YardActionResult<null>) => void;
}

type QueueEntry = QueuedAction | QueuedRefresh;

/** The key a `state` call runs under. */
export const REFRESH_KEY = "state";

export class YardStore implements YardStoreReader, YardStoreActions {
  readonly target: OwnYardTarget;
  readonly baseid: string | undefined;
  /** What every request spreads last: `[baseid]` on an outpost, nothing on the main yard. */
  private readonly yardArgs: YardArgs;
  private current: BaseLoadResponse;
  private cachedYard: Yard | null = null;
  private cachedJobs: YardJob[] | null = null;

  private readonly api: YardApi;
  private readonly clock: () => number;
  private readonly timers: YardStoreTimers;
  private readonly refreshDelayMs: number;
  private readonly hatchRefreshDelayMs: number;
  private readonly onAuthFailure: (() => void) | undefined;
  private readonly listeners = new Set<YardListener>();

  /** Server clock minus browser clock, seconds, from the latest answer. */
  private offset = 0;
  private readonly queue: QueueEntry[] = [];
  private inFlight: QueueEntry | null = null;
  /** Requests sent so far; each takes the next number. */
  private sent = 0;
  /** The number of the latest request whose answer was applied. */
  private applied = 0;
  private refreshTimer: unknown = null;
  /** When the scheduled `state` call goes out, browser clock seconds. */
  private refreshDueAt = 0;
  /**
   * Jobs already acted on, as `key@endsAt`: predicted, or already overdue
   * when the server last answered — either way the server has had (or has
   * been asked for) its say, so the job never triggers a second call. This
   * is what stops a kind the server does not complete from looping.
   */
  private readonly handled = new Set<string>();
  /** The load's `completed`, until {@link start} announces it. */
  private away: readonly CompletedJob[];
  private destroyed = false;

  constructor(options: YardStoreOptions) {
    this.api = options.api ?? yardApi;
    this.clock = options.clock ?? (() => Date.now() / 1000);
    this.timers = options.timers ?? browserTimers;
    this.refreshDelayMs = options.refreshDelayMs ?? REFRESH_DELAY_MS;
    this.hatchRefreshDelayMs = options.hatchRefreshDelayMs ?? HATCH_REFRESH_DELAY_MS;
    this.onAuthFailure = options.onAuthFailure;
    this.target = options.target ?? MAIN_YARD;
    this.baseid = outpostBaseid(this.target);
    this.yardArgs = this.baseid === undefined ? [] : [this.baseid];
    this.current = options.save;
    this.away = options.away ?? [];
    this.syncClock(options.save.currenttime);
    this.markOverdue(options.save.currenttime);
  }

  /* ── Reading ────────────────────────────────────────────────────────── */

  get kind(): YardKind {
    return this.target.kind;
  }

  get save(): BaseLoadResponse {
    return this.current;
  }

  get yard(): Yard {
    this.cachedYard ??= readYard(this.current);
    return this.cachedYard;
  }

  get resources(): Resources {
    return this.current.resources ?? {};
  }

  get credits(): number {
    return this.current.credits ?? 0;
  }

  get caps(): ResourceCaps | null {
    return this.current.caps ?? null;
  }

  /**
   * Derived from the buildings rather than read off the last answer's
   * `workers`, so a predicted finish frees its worker at once. The rule is
   * the server's (`workers.ts`), so the two agree whenever nothing is
   * predicted.
   */
  get workers(): YardWorkers {
    return this.yard.workers;
  }

  get busy(): boolean {
    return this.inFlight !== null;
  }

  isRunning(key: string): boolean {
    return this.inFlight?.key === key || this.queue.some((entry) => entry.key === key);
  }

  jobs(): readonly YardJob[] {
    this.cachedJobs ??= yardJobs(this.current);
    return this.cachedJobs;
  }

  now(): number {
    return this.clock() + this.offset;
  }

  building(id: number): YardBuilding | null {
    return this.yard.buildings.find((one) => one.id === id) ?? null;
  }

  subscribe(listener: YardListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * Announces what finished while the player was away, then fetches the
   * server's derived figures once when the load did not carry them.
   *
   * The load's catch-up already finished and wrote those jobs, so the `state`
   * call below finds nothing new; the load's own `completed` is the only
   * record of them, and it goes out here, once, as an `away` change — after
   * the scene has bound the HUD, which the constructor runs before.
   * `/base/load` has no `caps` (it is a yard-route field), so the first open
   * of a yard makes one `state` call; if the load ever sends `caps`, this
   * call disappears on its own.
   */
  start(): void {
    if (this.destroyed) return;
    const away = this.away;
    this.away = [];
    if (away.length > 0) this.emit({ reason: YardChangeReason.AWAY, completed: away, predicted: [] });
    if (!this.current.caps) void this.refresh();
  }

  /**
   * The once-a-second check (§2.4). Every job the server completes that has
   * reached zero is flipped in the display now, and one `state` call is
   * scheduled {@link YardStoreOptions.refreshDelayMs} later for all of them
   * ({@link YardStoreOptions.hatchRefreshDelayMs} when only hatches ended, #142).
   */
  tick(): void {
    if (this.destroyed) return;
    const now = this.now();
    const due = this.jobs().filter(
      (job) =>
        job.endsAt !== null &&
        job.endsAt <= now &&
        SERVER_COMPLETED_KINDS.has(job.kind) &&
        !this.handled.has(handledKey(job)),
    );
    if (due.length === 0) return;

    for (const job of due) this.handled.add(handledKey(job));
    this.setSave(predictCompletion(this.current, due));
    this.emit({ reason: YardChangeReason.PREDICTED, completed: [], predicted: due });
    const hatchesOnly = due.every((job) => job.kind === JobKind.HATCH);
    this.scheduleRefresh(hatchesOnly ? this.hatchRefreshDelayMs : this.refreshDelayMs);
  }

  /**
   * Merges the answer of a route that does not go through the store — the
   * Yard Planner's apply, wall upgrade and trap re-arm — and asks for the
   * full state after it.
   *
   * Those routes move `savetime` to their own `now` without sending it back,
   * so the countdowns they return are measured from about now: the merge sets
   * `savetime` to the store's estimate of the server clock, and the `state`
   * call that follows puts the exact figure in its place.
   */
  mergeWrite(slices: Partial<BaseLoadResponse>): void {
    if (this.destroyed) return;
    const now = Math.floor(this.now());
    this.setSave({ ...this.current, ...slices, savetime: now, currenttime: now });
    this.markOverdue(now);
    this.emit({ reason: YardChangeReason.MERGE, completed: [], predicted: [] });
    void this.refresh();
  }

  /** Stops the timers and drops every listener; answers still in flight are ignored. */
  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer !== null) this.timers.clear(this.refreshTimer);
    this.refreshTimer = null;
    this.listeners.clear();
    for (const entry of this.queue.splice(0)) {
      entry.resolve({ ok: false, refusal: refuse("error", "The yard was closed.") });
    }
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  run<Report>(action: YardStoreAction<Report>): Promise<YardActionResult<Report>> {
    if (this.destroyed) {
      return Promise.resolve({ ok: false, refusal: refuse("error", "The yard was closed.") });
    }
    return new Promise<YardActionResult<Report>>((resolve) => {
      this.queue.push({
        type: "action",
        key: action.key,
        check: action.check,
        send: action.send,
        resolve: resolve as (result: YardActionResult<unknown>) => void,
      });
      this.emitPending();
      this.pump();
    });
  }

  /**
   * Asks the server to catch the yard up and answer with it. Coalesced: a
   * refresh already waiting in the queue is shared, and one that reaches the
   * front after a later-sent answer has already been applied is skipped,
   * because that answer is at least as new.
   */
  refresh(): Promise<YardActionResult<null>> {
    if (this.destroyed) {
      return Promise.resolve({ ok: false, refusal: refuse("error", "The yard was closed.") });
    }
    const waiting = this.queue.find(
      (entry): entry is QueuedRefresh => entry.type === "refresh",
    );
    if (waiting) return waiting.promise;

    let resolve!: (result: YardActionResult<null>) => void;
    const promise = new Promise<YardActionResult<null>>((done) => {
      resolve = done;
    });
    this.queue.push({ type: "refresh", key: REFRESH_KEY, after: this.sent, promise, resolve });
    this.emitPending();
    this.pump();
    return promise;
  }

  upgrade(id: number): Promise<YardActionResult<UpgradeStartReport>> {
    return this.run({
      key: actionKey("upgrade", id),
      check: (store) => upgradeRefusal(store, id),
      send: (api, ...yard) => api.upgrade(id, ...yard),
    });
  }

  cancelUpgrade(id: number): Promise<YardActionResult<UpgradeCancelReport>> {
    return this.run({
      key: actionKey("cancel", id),
      check: (store) => {
        const building = store.building(id);
        if (!building) return refuse("badRequest", "That building is not in your yard.");
        return building.countdown?.kind === "upgrade"
          ? null
          : refuse("notUpgrading", "That building is not upgrading.");
      },
      send: (api, ...yard) => api.cancelUpgrade(id, ...yard),
    });
  }

  instantUpgrade(id: number): Promise<YardActionResult<UpgradeInstantReport>> {
    return this.run({
      key: actionKey("instant", id),
      check: (store) => upgradeRefusal(store, id, { instant: true }),
      send: (api, ...yard) => api.instantUpgrade(id, ...yard),
    });
  }

  speedUp(id: number, item: SpeedupItem): Promise<YardActionResult<SpeedupReport>> {
    return this.run({
      key: actionKey("speedup", id),
      check: (store) => {
        const building = store.building(id);
        const countdown = building?.countdown;
        // An outpost's fortification speeds up too (#191; the server's `speedup` takes its `cF`).
        const fortifying = countdown?.kind === "fortify" && store.kind === "outpost";
        if (countdown?.kind !== "build" && countdown?.kind !== "upgrade" && !fortifying) {
          return refuse("notRunning", "That building has nothing to speed up.");
        }
        if (countdown.paused) {
          return refuse("damaged", "Repair that building first: its countdown is paused.");
        }
        return building?.type === MAP_ROOM_TYPE ? refuse("mapRoom", MAP_ROOM_MESSAGE) : null;
      },
      send: (api, ...yard) => api.speedUp(id, item, ...yard),
    });
  }

  buy(item: string): Promise<YardActionResult<ShopBuyReport>> {
    return this.run({
      key: actionKey("buy", item),
      send: (api, ...yard) => api.shopBuy(item, ...yard),
    });
  }

  /* ── The queue ──────────────────────────────────────────────────────── */

  /** Sends the next request if none is in flight. */
  private pump(): void {
    if (this.inFlight || this.destroyed) return;

    let entry: QueueEntry | undefined;
    while ((entry = this.queue.shift())) {
      if (entry.type === "refresh" && this.applied > entry.after) {
        entry.resolve({ ok: true, report: null, completed: [] });
        continue;
      }
      const refusal = entry.type === "action" ? (entry.check?.(this) ?? null) : null;
      if (refusal && entry.type === "action") {
        entry.resolve({ ok: false, refusal });
        continue;
      }
      break;
    }

    if (!entry) {
      this.emitPending();
      return;
    }
    void this.send(entry);
  }

  private async send(entry: QueueEntry): Promise<void> {
    this.inFlight = entry;
    const number = ++this.sent;
    this.emitPending();

    let result: YardActionResult<unknown>;
    try {
      const response =
        entry.type === "refresh"
          ? await this.api.state(...this.yardArgs)
          : await entry.send(this.api, ...this.yardArgs);
      if (this.destroyed) {
        result = { ok: false, refusal: refuse("error", "The yard was closed.") };
      } else {
        this.apply(response, number, entry.type === "refresh");
        result = { ok: true, report: response.report, completed: response.completed ?? [] };
      }
    } catch (caught) {
      const refusal = yardRefusal(caught);
      result = { ok: false, refusal };
      if (this.destroyed) {
        // Nothing to update any more; the caller still hears how it ended.
      } else if (refusal.reason === "auth") {
        this.onAuthFailure?.();
      } else if (refusal.status === 409 && entry.type === "action") {
        // The yard said no to something the client thought it could do, so
        // what the client holds is stale: fetch the server's version.
        void this.refresh();
      }
    } finally {
      this.inFlight = null;
    }

    (entry.resolve as (result: YardActionResult<unknown>) => void)(result);
    this.emitPending();
    this.pump();
  }

  /** Merges an answer's state into the save. */
  private apply(response: YardResponse<unknown>, number: number, refresh: boolean): void {
    const slices: Partial<BaseLoadResponse> = {};
    const source = response as unknown as Record<string, unknown>;
    for (const key of YARD_STATE_KEYS) {
      if (key in source) (slices as Record<string, unknown>)[key] = source[key];
    }
    this.applied = Math.max(this.applied, number);
    this.syncClock(response.currenttime);
    this.setSave({ ...this.current, ...slices });
    this.markOverdue(response.currenttime);
    this.emit({
      reason: refresh ? YardChangeReason.REFRESH : YardChangeReason.ACTION,
      completed: response.completed ?? [],
      predicted: [],
    });
  }

  /* ── Internals ──────────────────────────────────────────────────────── */

  /**
   * One `state` call `delayMs` from now, or sooner if one is already due
   * sooner: a batch of hatches waiting on its 10 s is pulled in by an upgrade
   * ending in the meantime.
   */
  private scheduleRefresh(delayMs: number): void {
    if (this.destroyed) return;
    const dueAt = this.clock() + delayMs / 1000;
    if (this.refreshTimer !== null) {
      if (this.refreshDueAt <= dueAt) return;
      this.timers.clear(this.refreshTimer);
    }
    this.refreshDueAt = dueAt;
    this.refreshTimer = this.timers.set(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, delayMs);
  }

  private setSave(save: BaseLoadResponse): void {
    this.current = save;
    this.cachedYard = null;
    this.cachedJobs = null;
  }

  private syncClock(serverNow: number | undefined): void {
    if (typeof serverNow === "number" && Number.isFinite(serverNow) && serverNow > 0) {
      this.offset = serverNow - this.clock();
    }
  }

  /**
   * Marks every job already over by `serverNow` as handled: the server has
   * just caught the yard up to that moment and left them, so asking again
   * would change nothing.
   */
  private markOverdue(serverNow: number | undefined): void {
    if (typeof serverNow !== "number") return;
    for (const job of this.jobs()) {
      if (job.endsAt !== null && job.endsAt <= serverNow) this.handled.add(handledKey(job));
    }
  }

  private emit(change: YardChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  private emitPending(): void {
    this.emit({ reason: YardChangeReason.PENDING, completed: [], predicted: [] });
  }
}

/**
 * The Map Room's level is the map version and its L1 to L2 upgrade joins a
 * world when it finishes, so the Shiny routes (instant, speed-ups) refuse it;
 * the plain upgrade takes it (decision D16, `docs/server-api.md`).
 */
const MAP_ROOM_TYPE = 11;
const MAP_ROOM_MESSAGE = "The Map Room cannot be rushed with Shiny.";

const handledKey = (job: YardJob): string => `${job.key}@${job.endsAt ?? "paused"}`;

/**
 * The upgrade rules the client can see for itself, in the server's order
 * (`docs/design/yard-buildings.md` §3.2), re-checked just before sending so
 * a queued click does not fire against a yard the answer ahead of it
 * changed. Town Hall and `re` requirements are left to the server and to the
 * panel's own gate line: they do not change between two clicks.
 */
const upgradeRefusal = (
  store: YardStoreReader,
  id: number,
  options: { instant?: boolean } = {},
): YardRefusal | null => {
  const building = store.building(id);
  if (!building) return refuse("badRequest", "That building is not in your yard.");
  if (WALL_TYPES.includes(building.type) || TRAP_TYPES.includes(building.type)) {
    return refuse("useBatchRoute", "Walls and traps are upgraded from the layout planner.");
  }
  if (options.instant && building.type === MAP_ROOM_TYPE) {
    return refuse("mapRoom", MAP_ROOM_MESSAGE);
  }
  if (holdsWorker(building)) return refuse("busy", "That building is already busy.");
  // Any health reading counts, as on the server: the save writes one only
  // below full health.
  if (building.hp !== null || building.raw.rE) {
    return refuse("damaged", "Repair that building before upgrading it.");
  }
  const kind = store.yard.kind;
  if (building.level >= maxLevel(building.type, kind)) {
    return refuse("maxLevel", "That building is at its highest level.");
  }
  if (options.instant) return null;

  const step = costOf(building.type, building.level, kind);
  if (!step) return refuse("maxLevel", "That building is at its highest level.");
  const [r1, r2, r3, r4] = step;
  const cost = { r1, r2, r3, r4 };
  const shortfall: Record<string, number> = {};
  let short = false;
  for (const key of ["r1", "r2", "r3", "r4"] as const) {
    const missing = cost[key] - (Number(store.resources[key]) || 0);
    shortfall[key] = Math.max(0, missing);
    if (missing > 0) short = true;
  }
  if (short) {
    return refuse("shortfall", "You do not have enough resources for that.", { shortfall });
  }
  // Every step holds a worker, however short (#137).
  if (freeWorkers(store) === 0) {
    return refuse("workers", "All your workers are busy.", { workers: { ...store.workers } });
  }
  return null;
};
