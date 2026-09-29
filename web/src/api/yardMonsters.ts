import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import {
  LOCKER_OVERDRIVE,
  runningUnlock,
  startGate,
  instantGate,
  gateText,
  type UnlockGate,
} from "@/game/monsters/lockerModel";
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
 * The Monster Locker's yard routes (`docs/design/yard-buildings.md` §4.3;
 * wire contract in `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/locker/start     monster
 *   POST /api/:apiVersion/bm/yard/locker/cancel
 *   POST /api/:apiVersion/bm/yard/locker/finish
 *   POST /api/:apiVersion/bm/yard/locker/instant   monster
 *   POST /api/:apiVersion/bm/yard/shop/buy         item=CLOD
 *
 * Each answers like every yard action — the whole yard state, what the
 * catch-up finished (`completed`) and the route's own `report` — and refuses
 * with the flat `{ error, reason, ...detail }` body `yardRefusal` reads.
 * The calls hold no state; {@link lockerActions} runs them through the
 * `YardStore`'s one-at-a-time queue, which merges every answer.
 */

const LOCKER_PATH = "/api/:apiVersion/bm/yard/locker";

/** `report` of `locker/start`. */
export interface LockerStartReport {
  monster: string;
  /** When the unlock ends, unix seconds, before any Overdrive. */
  endsAt: number;
  /** Putty charged. */
  cost: { r3: number };
}

/** `report` of `locker/cancel`. */
export interface LockerCancelReport {
  monster: string;
  /** Putty actually returned, after the storage cap. */
  refund: { r3: number };
}

/** `report` of `locker/finish` and `locker/instant`. */
export interface LockerShinyReport {
  monster: string;
  /** Shiny spent. */
  credits: number;
}

/**
 * Starts unlocking `monster`: the full putty price now, one unlock at a time.
 * Refusals, in the server's order: 400 `badRequest` (not obtainable),
 * `alreadyUnlocked`, `unlockRunning {monster}`, `noLocker`,
 * `lockerLevel {have, need}`, `shortfall`.
 */
export const lockerStart = (
  monster: string,
  baseid?: string,
): Promise<YardResponse<LockerStartReport>> =>
  post<YardResponse<LockerStartReport>>(`${LOCKER_PATH}/start`, yardBody({ monster }, baseid));

/** Cancels the running unlock for its full putty price back, capped. Refusal: `notUnlocking`. */
export const lockerCancel = (baseid?: string): Promise<YardResponse<LockerCancelReport>> =>
  post<YardResponse<LockerCancelReport>>(`${LOCKER_PATH}/cancel`, yardBody({}, baseid));

/**
 * Finishes the running unlock now for `timeCost(e − now)` Shiny. Refusals:
 * `notUnlocking`, `shinyLocked`, `credits`.
 */
export const lockerFinish = (baseid?: string): Promise<YardResponse<LockerShinyReport>> =>
  post<YardResponse<LockerShinyReport>>(`${LOCKER_PATH}/finish`, yardBody({}, baseid));

/**
 * Unlocks `monster` at once for Shiny, no putty. Refusals: `start`'s short of
 * `shortfall`, then `shinyLocked`, `credits`.
 */
export const lockerInstant = (
  monster: string,
  baseid?: string,
): Promise<YardResponse<LockerShinyReport>> =>
  post<YardResponse<LockerShinyReport>>(
    `${LOCKER_PATH}/instant`,
    yardBody({ monster }, baseid),
  );

/** Every call above, so the actions can be handed a stand-in under test. */
export interface LockerApi {
  start: typeof lockerStart;
  cancel: typeof lockerCancel;
  finish: typeof lockerFinish;
  instant: typeof lockerInstant;
}

export const lockerApi: LockerApi = {
  start: lockerStart,
  cancel: lockerCancel,
  finish: lockerFinish,
  instant: lockerInstant,
};

/**
 * The queue keys, for `store.isRunning`. One per action rather than per
 * monster: only one unlock runs at a time, so every Start is the same button.
 */
export const LockerKey = {
  START: actionKey("locker", "start"),
  CANCEL: actionKey("locker", "cancel"),
  FINISH: actionKey("locker", "finish"),
  INSTANT: actionKey("locker", "instant"),
  /** What `store.buy("CLOD")` runs under. */
  OVERDRIVE: actionKey("buy", LOCKER_OVERDRIVE.item),
} as const;

/** Every locker key, for disabling the whole tab's buttons while one runs. */
export const LOCKER_KEYS: readonly string[] = Object.values(LockerKey);

/** What the Unlock tab can do, each a queued store action that never throws. */
export interface LockerActions {
  start(monster: string): Promise<YardActionResult<LockerStartReport>>;
  cancel(): Promise<YardActionResult<LockerCancelReport>>;
  finish(): Promise<YardActionResult<LockerShinyReport>>;
  instant(monster: string): Promise<YardActionResult<LockerShinyReport>>;
  /** Buys the Locker Overdrive, `CLOD`, through the store's shop route. */
  overdrive(): Promise<YardActionResult<ShopBuyReport>>;
}

/** A local refusal, in the server's shape. */
const refuse = (
  reason: string,
  message: string,
  detail: Record<string, unknown> = {},
): YardRefusal => ({ reason, message, detail, local: true });

/** A gate as the refusal the server would send for it. */
const gateRefusal = (gate: UnlockGate): YardRefusal => {
  const message = `${gateText(gate)}.`;
  switch (gate.reason) {
    case "unlockRunning":
      return refuse(gate.reason, message, { monster: gate.monster });
    case "lockerLevel":
      return refuse(gate.reason, message, { have: gate.have, need: gate.need });
    case "shortfall":
      return refuse(gate.reason, message, { shortfall: { r1: 0, r2: 0, r3: gate.need, r4: 0 } });
    default:
      return refuse(gate.reason, message);
  }
};

const unknownMonster = (monster: string): YardRefusal =>
  refuse("badRequest", "That monster cannot be unlocked.", { monster });

const notUnlocking = (store: YardStoreReader): YardRefusal | null =>
  runningUnlock(store) ? null : refuse("notUnlocking", "No unlock is running.");

/**
 * The locker routes, routed through `store.run` so they queue behind any
 * request in flight and re-check the rules the client can see against the
 * state the answer ahead of them left (T4). The store merges every answer and
 * refreshes after a 409, as for the building routes.
 */
export const lockerActions = (store: YardStore, api: LockerApi = lockerApi): LockerActions => ({
  start: (monster) =>
    store.run({
      key: LockerKey.START,
      check: (reader) => {
        const entry = monsterEntry(monster);
        if (!entry || entry.blocked) return unknownMonster(monster);
        const gate = startGate(entry, reader);
        return gate ? gateRefusal(gate) : null;
      },
      send: (_api, ...yard) => api.start(monster, ...yard),
    }),
  cancel: () =>
    store.run({ key: LockerKey.CANCEL, check: notUnlocking, send: (_api, ...yard) => api.cancel(...yard) }),
  finish: () =>
    store.run({ key: LockerKey.FINISH, check: notUnlocking, send: (_api, ...yard) => api.finish(...yard) }),
  instant: (monster) =>
    store.run({
      key: LockerKey.INSTANT,
      check: (reader) => {
        const entry = monsterEntry(monster);
        if (!entry || entry.blocked) return unknownMonster(monster);
        const gate = instantGate(entry, reader);
        return gate ? gateRefusal(gate) : null;
      },
      send: (_api, ...yard) => api.instant(monster, ...yard),
    }),
  overdrive: () => store.buy(LOCKER_OVERDRIVE.item),
});
