import {
  activeOverdrive,
  HATCHERY_OVERDRIVES,
  INFERNO_HATCHERY_OVERDRIVES,
  MAX_ADD,
  type HatchTarget,
  type OverdriveItem,
} from "@/game/monsters/hatchPlan";
import { isListedIn, monsterRealmOf, monsterWords } from "@/game/monsters/realm";
import {
  actionKey,
  type YardActionResult,
  type YardArgs,
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
 *   POST /api/:apiVersion/bm/yard/hatchery/clear    hatchery
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

/** `report` of `hatchery/clear`. */
export interface HatcheryClearReport {
  hatchery: HatchTarget;
  /** Monsters taken out, by id. */
  removed: Record<string, number>;
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
  remote?: boolean,
): Promise<YardResponse<HatcheryAddReport>> =>
  post<YardResponse<HatcheryAddReport>>(
    `${HATCHERY_PATH}/add`,
    yardBody({ hatchery: String(hatchery), monster, count: String(count), ...remoteField(remote) }, baseid),
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
  remote?: boolean,
): Promise<YardResponse<HatcheryRemoveReport>> =>
  post<YardResponse<HatcheryRemoveReport>>(
    `${HATCHERY_PATH}/remove`,
    yardBody({ hatchery: String(hatchery), slot: String(slot), count: String(count), ...remoteField(remote) }, baseid),
  );

/**
 * Clear all: empties every waiting stack for the goo paid, as `remove` with
 * `all` on each would; the monsters in production keep hatching. Refusals: the
 * add's target ones, `emptyQueue`.
 */
export const hatcheryClear = (
  hatchery: HatchTarget,
  baseid?: string,
  remote?: boolean,
): Promise<YardResponse<HatcheryClearReport>> =>
  post<YardResponse<HatcheryClearReport>>(
    `${HATCHERY_PATH}/clear`,
    yardBody({ hatchery: String(hatchery), ...remoteField(remote) }, baseid),
  );

/**
 * Houses what fits now for Shiny. Refusals: the add's target ones, `busy`,
 * `damaged`, `nothingToFinish`, `housingFull { free }`, `shinyLocked`, `credits`.
 */
export const hatcheryFinish = (
  hatchery: HatchTarget,
  baseid?: string,
  remote?: boolean,
): Promise<YardResponse<HatcheryFinishReport>> =>
  post<YardResponse<HatcheryFinishReport>>(
    `${HATCHERY_PATH}/finish`,
    yardBody({ hatchery: String(hatchery), ...remoteField(remote) }, baseid),
  );

/** One preset stack on the wire: a monster and how many. */
export type HccPresetStack = [id: string, count: number];

/** `report` of `hatchery/preset/save` (beta 9). */
export interface HccPresetSaveReport {
  list: "home" | "out";
  slot: number;
  /** As saved: two stacks of one monster side by side joined. */
  preset: HccPresetStack[];
}

/** `report` of `hatchery/preset/send` (beta 9): partial by design, as an add. */
export interface HccPresetSendReport {
  list: "home" | "out";
  slot: number;
  added: number;
  requested: number;
  stoppedBy: null | "queue" | "goo";
  /** Monsters left out because they are locked, in preset order. */
  skipped: string[];
  cost: { r4: number };
}

/** One outpost on the level 3 HCC's yard list (beta 9). */
export interface HccOutpostRow {
  baseid: string;
  /** Its HCC's level, 0 for none. */
  hcc: number;
  /** Monsters in its queue and hatcheries, as last saved. */
  queued: number;
}

/** `report` of `hatchery/outposts` (beta 9). */
export interface HccOutpostsReport {
  yards: HccOutpostRow[];
}

/**
 * Saves the HCC preset in `slot` (beta 9): `stacks` in the order they are
 * sent, `[]` to empty it. The list is the yard's own (the main yard's, or the
 * one every outpost shares). Refusals: `noHcc`, `presetLocked { slot, slots }`,
 * `badRequest`, and `remote`'s `hccLevel`, `noOutpostHcc`.
 */
export const hccPresetSave = (
  slot: number,
  stacks: readonly HccPresetStack[],
  baseid?: string,
  remote?: boolean,
): Promise<YardResponse<HccPresetSaveReport>> =>
  post<YardResponse<HccPresetSaveReport>>(
    `${HATCHERY_PATH}/preset/save`,
    yardBody(
      {
        slot: String(slot),
        stacks: JSON.stringify(stacks),
        ...remoteField(remote),
      },
      baseid,
    ),
  );

/** Adds the preset in `slot` to the end of the HCC's queue (beta 9). Refusals: as save, and `emptyPreset`. */
export const hccPresetSend = (
  slot: number,
  baseid?: string,
  remote?: boolean,
): Promise<YardResponse<HccPresetSendReport>> =>
  post<YardResponse<HccPresetSendReport>>(
    `${HATCHERY_PATH}/preset/send`,
    yardBody({ slot: String(slot), ...remoteField(remote) }, baseid),
  );

/** The main yard's outposts as its level 3 HCC runs them (beta 9). Refusal: `hccLevel`. */
export const hccOutposts = (): Promise<YardResponse<HccOutpostsReport>> =>
  post<YardResponse<HccOutpostsReport>>(`${HATCHERY_PATH}/outposts`, yardBody({}));


/** Every call above, so the actions can be handed a stand-in under test. */
export interface HatcheryApi {
  add: typeof hatcheryAdd;
  remove: typeof hatcheryRemove;
  clear: typeof hatcheryClear;
  finish: typeof hatcheryFinish;
  presetSave?: typeof hccPresetSave;
  presetSend?: typeof hccPresetSend;
}

export const hatcheryApi: HatcheryApi = {
  add: hatcheryAdd,
  remove: hatcheryRemove,
  clear: hatcheryClear,
  finish: hatcheryFinish,
  presetSave: hccPresetSave,
  presetSend: hccPresetSend,
};

/** `remote=1` when the main yard's level 3 HCC runs an outpost from home (beta 9). */
const remoteField = (remote: boolean | undefined): { remote?: string } => (remote ? { remote: "1" } : {});

/** The queue keys, for `store.isRunning`. */
export const HatcheryKey = {
  ADD: actionKey("hatchery", "add"),
  REMOVE: actionKey("hatchery", "remove"),
  CLEAR: actionKey("hatchery", "clear"),
  FINISH: actionKey("hatchery", "finish"),
  PRESET_SAVE: actionKey("hatchery", "preset/save"),
  PRESET_SEND: actionKey("hatchery", "preset/send"),
  OUTPOSTS: actionKey("hatchery", "outposts"),
} as const;

/** Every hatchery key, the overdrive buys included, for disabling the tab's buttons while one runs. */
export const HATCHERY_KEYS: readonly string[] = [
  ...Object.values(HatcheryKey),
  ...[...HATCHERY_OVERDRIVES, ...INFERNO_HATCHERY_OVERDRIVES].map(({ item }) => actionKey("buy", item)),
];

/** What the Hatch tab can do, each a queued store action that never throws. */
export interface HatcheryActions {
  add(target: HatchTarget, monster: string, count: number): Promise<YardActionResult<HatcheryAddReport>>;
  remove(
    target: HatchTarget,
    slot: number,
    count: number | "all",
  ): Promise<YardActionResult<HatcheryRemoveReport>>;
  /** Clear all: every waiting stack of the target's queue. */
  clear(target: HatchTarget): Promise<YardActionResult<HatcheryClearReport>>;
  finish(target: HatchTarget): Promise<YardActionResult<HatcheryFinishReport>>;
  /** Saves an HCC preset (beta 9). */
  presetSave(slot: number, stacks: readonly HccPresetStack[]): Promise<YardActionResult<HccPresetSaveReport>>;
  /** Sends an HCC preset to the end of the queue (beta 9). */
  presetSend(slot: number): Promise<YardActionResult<HccPresetSendReport>>;
  /** Buys a Hatchery Overdrive through the store's shop route. */
  overdrive(item: OverdriveItem): Promise<YardActionResult<ShopBuyReport>>;
}

/** A local refusal, in the server's shape. */
const refuse = (
  reason: string,
  message: string,
  detail: Record<string, unknown> = {},
): YardRefusal => ({ reason, message, detail, local: true });

/**
 * The add's checks the client can see: an obtainable, unlocked monster of the
 * yard's realm (the Inferno roster in an Incubator) and a sane count.
 */
const addRefusal = (reader: YardStoreReader, monster: string, count: number): YardRefusal | null => {
  const realm = monsterRealmOf(reader.kind);
  if (!isListedIn(monster, realm)) return refuse("badRequest", "That monster cannot be hatched.", { monster });
  if (Number(reader.save.lockerdata?.[monster]?.t) !== 2) {
    return refuse("locked", `Unlock that monster in the ${monsterWords(realm).locker} first.`, { monster });
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
  options: { readonly remote?: boolean } = {},
): HatcheryActions => {
  // `remote` rides only on an outpost's store run from the main yard's level 3 HCC.
  const remote = (yard: YardArgs): yard is [baseid: string] => options.remote === true && yard[0] !== undefined;
  return {
    add: (target, monster, count) =>
      store.run({
        key: HatcheryKey.ADD,
        check: (reader) => addRefusal(reader, monster, count),
        send: (_api, ...yard) =>
          remote(yard) ? api.add(target, monster, count, yard[0], true) : api.add(target, monster, count, ...yard),
      }),
    remove: (target, slot, count) =>
      store.run({
        key: HatcheryKey.REMOVE,
        send: (_api, ...yard) =>
          remote(yard) ? api.remove(target, slot, count, yard[0], true) : api.remove(target, slot, count, ...yard),
      }),
    clear: (target) =>
      store.run({
        key: HatcheryKey.CLEAR,
        send: (_api, ...yard) => (remote(yard) ? api.clear(target, yard[0], true) : api.clear(target, ...yard)),
      }),
    finish: (target) =>
      store.run({
        key: HatcheryKey.FINISH,
        send: (_api, ...yard) => (remote(yard) ? api.finish(target, yard[0], true) : api.finish(target, ...yard)),
      }),
    presetSave: (slot, stacks) =>
      store.run({
        key: HatcheryKey.PRESET_SAVE,
        send: (_api, ...yard) => (api.presetSave ?? hccPresetSave)(slot, stacks, yard[0], remote(yard)),
      }),
    presetSend: (slot) =>
      store.run({
        key: HatcheryKey.PRESET_SEND,
        send: (_api, ...yard) => (api.presetSend ?? hccPresetSend)(slot, yard[0], remote(yard)),
      }),
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
  };
};
