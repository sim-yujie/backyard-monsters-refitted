import {
  activeOverdrive,
  HATCHERY_OVERDRIVES,
  MAX_ADD,
  type HatchTarget,
  type OverdriveItem,
} from "@/game/monsters/hatchPlan";
import { isListed } from "@/game/monsters/monsterCatalogue";
import {
  actionKey,
  type YardActionResult,
  type YardStore,
  type YardStoreReader,
} from "@/game/yard/YardStore";
import { post } from "./http";
import type { ShopBuyReport, YardResponse } from "./types";
import { yardBody, type YardRefusal } from "./yard";

/**
 * The Hatchery and Hatchery Control Centre's yard routes
 * (`docs/design/yard-buildings.md` §4.4; wire contract in `docs/server-api.md`
 * "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/hatchery/add      hatchery, monster, count
 *   POST /api/:apiVersion/bm/yard/hatchery/remove   hatchery, slot, count
 *   POST /api/:apiVersion/bm/yard/hatchery/finish   hatchery
 *   POST /api/:apiVersion/bm/yard/shop/buy          item=HOD|HOD2|HOD3
 *
 * `hatchery` is a hatchery's building id, or `hcc` for the shared queue once
 * a Hatchery Control Centre runs it. Each answers like every yard action and
 * refuses with the flat `{ error, reason, ...detail }` body. The calls hold no
 * state; {@link hatcheryActions} runs them through the `YardStore`'s
 * one-at-a-time queue, which merges every answer.
 */

const HATCHERY_PATH = "/api/:apiVersion/bm/yard/hatchery";

/** `report` of `hatchery/add`: partial by design. */
export interface HatcheryAddReport {
  hatchery: HatchTarget;
  monster: string;
  /** How many went in. */
  added: number;
  /** How many were asked for. */
  requested: number;
  /** Why it stopped short: no stack room, not enough goo, or null when all went in. */
  stoppedBy: null | "queue" | "goo";
  /** Goo charged. */
  cost: { r4: number };
}

/** `report` of `hatchery/remove`. */
export interface HatcheryRemoveReport {
  hatchery: HatchTarget;
  slot: number;
  monster: string;
  removed: number;
  /** Goo actually returned, after the storage cap. */
  refund: { r4: number };
}

/** `report` of `hatchery/finish`. */
export interface HatcheryFinishReport {
  hatchery: HatchTarget;
  /** Monsters moved into housing, by id. */
  housed: Record<string, number>;
  /** Shiny charged. */
  credits: number;
  /** False when housing ran out before everything was done. */
  finishedAll: boolean;
}

/**
 * Queues up to `count` (1..400) of `monster` in one request. Refusals:
 * 400 `badRequest`, `locked { monster }`, `noHcc`, `noHatchery { id }`,
 * `useHcc { id }`, `mapRoom3`.
 */
export const hatcheryAdd = (
  hatchery: HatchTarget,
  monster: string,
  count: number,
  baseid?: string,
): Promise<YardResponse<HatcheryAddReport>> =>
  post<YardResponse<HatcheryAddReport>>(
    `${HATCHERY_PATH}/add`,
    yardBody({ hatchery: String(hatchery), monster, count: String(count) }, baseid),
  );

/**
 * Takes monsters out for the goo paid: `slot` 0 is the one in production,
 * n ≥ 1 the n-th stack; `count` a number or `all`. Refusals: the add's target
 * ones, `noSlot { slot }`.
 */
export const hatcheryRemove = (
  hatchery: HatchTarget,
  slot: number,
  count: number | "all",
  baseid?: string,
): Promise<YardResponse<HatcheryRemoveReport>> =>
  post<YardResponse<HatcheryRemoveReport>>(
    `${HATCHERY_PATH}/remove`,
    yardBody({ hatchery: String(hatchery), slot: String(slot), count: String(count) }, baseid),
  );

/**
 * Houses what fits now for Shiny. Refusals: the add's target ones, `busy`,
 * `damaged`, `nothingToFinish`, `housingFull { free }`, `shinyLocked`, `credits`.
 */
export const hatcheryFinish = (
  hatchery: HatchTarget,
  baseid?: string,
): Promise<YardResponse<HatcheryFinishReport>> =>
  post<YardResponse<HatcheryFinishReport>>(
    `${HATCHERY_PATH}/finish`,
    yardBody({ hatchery: String(hatchery) }, baseid),
  );

/** Every call above, so the actions can be handed a stand-in under test. */
export interface HatcheryApi {
  add: typeof hatcheryAdd;
  remove: typeof hatcheryRemove;
  finish: typeof hatcheryFinish;
}

export const hatcheryApi: HatcheryApi = {
  add: hatcheryAdd,
  remove: hatcheryRemove,
  finish: hatcheryFinish,
};

/** The queue keys, for `store.isRunning`. */
export const HatcheryKey = {
  ADD: actionKey("hatchery", "add"),
  REMOVE: actionKey("hatchery", "remove"),
  FINISH: actionKey("hatchery", "finish"),
} as const;

/** Every hatchery key, the overdrive buys included, for disabling the tab's buttons while one runs. */
export const HATCHERY_KEYS: readonly string[] = [
  ...Object.values(HatcheryKey),
  ...HATCHERY_OVERDRIVES.map(({ item }) => actionKey("buy", item)),
];

/** What the Hatch tab can do, each a queued store action that never throws. */
export interface HatcheryActions {
  add(target: HatchTarget, monster: string, count: number): Promise<YardActionResult<HatcheryAddReport>>;
  remove(
    target: HatchTarget,
    slot: number,
    count: number | "all",
  ): Promise<YardActionResult<HatcheryRemoveReport>>;
  finish(target: HatchTarget): Promise<YardActionResult<HatcheryFinishReport>>;
  /** Buys a Hatchery Overdrive through the store's shop route. */
  overdrive(item: OverdriveItem): Promise<YardActionResult<ShopBuyReport>>;
}

/** A local refusal, in the server's shape. */
const refuse = (
  reason: string,
  message: string,
  detail: Record<string, unknown> = {},
): YardRefusal => ({ reason, message, detail, local: true });

/** The add's checks the client can see: an obtainable, unlocked monster and a sane count. */
const addRefusal = (reader: YardStoreReader, monster: string, count: number): YardRefusal | null => {
  if (!isListed(monster)) return refuse("badRequest", "That monster cannot be hatched.", { monster });
  if (Number(reader.save.lockerdata?.[monster]?.t) !== 2) {
    return refuse("locked", "Unlock that monster in the Monster Locker first.", { monster });
  }
  if (!(Number.isInteger(count) && count >= 1 && count <= MAX_ADD)) {
    return refuse("badRequest", `Add between 1 and ${MAX_ADD} at a time.`, { count });
  }
  return null;
};

/**
 * The hatchery routes, routed through `store.run` so they queue behind any
 * request in flight (T4). The store merges every answer and refreshes after
 * a 409. An Overdrive is refused locally while one runs (`alreadyActive`).
 */
export const hatcheryActions = (
  store: YardStore,
  api: HatcheryApi = hatcheryApi,
): HatcheryActions => ({
  add: (target, monster, count) =>
    store.run({
      key: HatcheryKey.ADD,
      check: (reader) => addRefusal(reader, monster, count),
      send: (_api, ...yard) => api.add(target, monster, count, ...yard),
    }),
  remove: (target, slot, count) =>
    store.run({
      key: HatcheryKey.REMOVE,
      send: (_api, ...yard) => api.remove(target, slot, count, ...yard),
    }),
  finish: (target) =>
    store.run({ key: HatcheryKey.FINISH, send: (_api, ...yard) => api.finish(target, ...yard) }),
  overdrive: (item) => {
    const running = activeOverdrive(store.save.storedata, store.now());
    if (running) {
      return Promise.resolve({
        ok: false,
        refusal: refuse("alreadyActive", "A Hatchery Overdrive is already running.", {
          item: running.item,
          endsAt: running.endsAt,
        }),
      });
    }
    return store.buy(item);
  },
});
