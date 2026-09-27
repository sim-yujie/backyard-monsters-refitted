import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import {
  gateText,
  instantGate,
  runningTraining,
  trainGate,
  type TrainGate,
} from "@/game/monsters/training";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import type { YardRefusal } from "./yard";

/**
 * The Monster Academy's yard routes (`docs/design/yard-buildings.md` §6
 * "Train tab"; wire contract in `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/academy/train     monster, academy?
 *   POST /api/:apiVersion/bm/yard/academy/cancel    monster
 *   POST /api/:apiVersion/bm/yard/academy/finish    monster
 *   POST /api/:apiVersion/bm/yard/academy/instant   monster, academy?
 *
 * Each answers like every yard action — the whole yard state, what the
 * catch-up finished (`completed`) and the route's own `report` — and refuses
 * with the flat `{ error, reason, ...detail }` body `yardRefusal` reads. The
 * calls hold no state; {@link academyActions} runs them through the
 * `YardStore`'s one-at-a-time queue, which merges every answer.
 */

const ACADEMY_PATH = "/api/:apiVersion/bm/yard/academy";

/** `report` of `academy/train`. */
export interface AcademyTrainReport {
  monster: string;
  /** The academy the server put it in. */
  academy: number;
  /** The level the training reaches. */
  to: number;
  /** When it ends, unix seconds. */
  endsAt: number;
  /** Putty charged. */
  cost: { r3: number };
}

/** `report` of `academy/cancel`. */
export interface AcademyCancelReport {
  monster: string;
  /** Putty actually returned, after the storage cap. */
  refund: { r3: number };
}

/** `report` of `academy/finish` and `academy/instant`. */
export interface AcademyShinyReport {
  monster: string;
  /** The level it is now. */
  level: number;
  /** Shiny spent. */
  credits: number;
}

/**
 * Trains `monster` one level: the step's full putty price now, at the first
 * idle academy high enough. Refusals, in the server's order: 400 `badRequest`,
 * `noAcademy`, `training`, `locked`, `maxLevel`, `academyBusy {id, monster}`
 * (or `busy`/`damaged {id}`), `academyLevel {have, need}`, `shortfall`.
 */
export const academyTrain = (monster: string): Promise<YardResponse<AcademyTrainReport>> =>
  post<YardResponse<AcademyTrainReport>>(`${ACADEMY_PATH}/train`, { monster });

/** Cancels `monster`'s training for its full putty price back, capped. Refusal: `notTraining`. */
export const academyCancel = (monster: string): Promise<YardResponse<AcademyCancelReport>> =>
  post<YardResponse<AcademyCancelReport>>(`${ACADEMY_PATH}/cancel`, { monster });

/** Finishes `monster`'s training now for `timeCost(time − now)` Shiny. Refusals: `notTraining`, `shinyLocked`, `credits`. */
export const academyFinish = (monster: string): Promise<YardResponse<AcademyShinyReport>> =>
  post<YardResponse<AcademyShinyReport>>(`${ACADEMY_PATH}/finish`, { monster });

/** Trains `monster` one level at once for Shiny, no putty. Refusals: `train`'s short of `shortfall`, then `shinyLocked`, `credits`. */
export const academyInstant = (monster: string): Promise<YardResponse<AcademyShinyReport>> =>
  post<YardResponse<AcademyShinyReport>>(`${ACADEMY_PATH}/instant`, { monster });

/** Every call above, so the actions can be handed a stand-in under test. */
export interface AcademyApi {
  train: typeof academyTrain;
  cancel: typeof academyCancel;
  finish: typeof academyFinish;
  instant: typeof academyInstant;
}

export const academyApi: AcademyApi = {
  train: academyTrain,
  cancel: academyCancel,
  finish: academyFinish,
  instant: academyInstant,
};

/**
 * The queue keys, for `store.isRunning`. One per action: the tab waits on
 * every academy button while any academy request runs, as the Unlock tab does.
 */
export const AcademyKey = {
  TRAIN: actionKey("academy", "train"),
  CANCEL: actionKey("academy", "cancel"),
  FINISH: actionKey("academy", "finish"),
  INSTANT: actionKey("academy", "instant"),
} as const;

/** Every academy key, for disabling the whole tab's buttons while one runs. */
export const ACADEMY_KEYS: readonly string[] = Object.values(AcademyKey);

/** What the Train tab can do, each a queued store action that never throws. */
export interface AcademyActions {
  train(monster: string): Promise<YardActionResult<AcademyTrainReport>>;
  cancel(monster: string): Promise<YardActionResult<AcademyCancelReport>>;
  finish(monster: string): Promise<YardActionResult<AcademyShinyReport>>;
  instant(monster: string): Promise<YardActionResult<AcademyShinyReport>>;
}

/** A local refusal, in the server's shape. */
const refuse = (
  reason: string,
  message: string,
  detail: Record<string, unknown> = {},
): YardRefusal => ({ reason, message, detail, local: true });

/** A gate as the refusal the server would send for it. */
const gateRefusal = (gate: TrainGate): YardRefusal => {
  const message = `${gateText(gate)}.`;
  switch (gate.reason) {
    case "academyLevel":
      return refuse(gate.reason, message, { have: gate.have, need: gate.need });
    case "shortfall":
      return refuse(gate.reason, message, { shortfall: { r1: 0, r2: 0, r3: gate.need, r4: 0 } });
    default:
      return refuse(gate.reason, message);
  }
};

const unknownMonster = (monster: string): YardRefusal =>
  refuse("badRequest", "That monster cannot be trained.", { monster });

/**
 * The academy routes, routed through `store.run` so they queue behind any
 * request in flight and re-check the rules the client can see against the
 * state the answer ahead of them left (T4). The store merges every answer and
 * refreshes after a 409, as for the building routes.
 */
export const academyActions = (store: YardStore, api: AcademyApi = academyApi): AcademyActions => {
  const gated = (monster: string, gate: typeof trainGate) => (reader: Parameters<typeof trainGate>[1]) => {
    const entry = monsterEntry(monster);
    if (!entry || entry.blocked) return unknownMonster(monster);
    const refusal = gate(entry, reader);
    return refusal ? gateRefusal(refusal) : null;
  };
  const training = (monster: string) => (reader: Parameters<typeof runningTraining>[0]) =>
    runningTraining(reader, monster)
      ? null
      : refuse("notTraining", "That monster is not training.", { monster });

  return {
    train: (monster) =>
      store.run({ key: AcademyKey.TRAIN, check: gated(monster, trainGate), send: () => api.train(monster) }),
    cancel: (monster) =>
      store.run({ key: AcademyKey.CANCEL, check: training(monster), send: () => api.cancel(monster) }),
    finish: (monster) =>
      store.run({ key: AcademyKey.FINISH, check: training(monster), send: () => api.finish(monster) }),
    instant: (monster) =>
      store.run({
        key: AcademyKey.INSTANT,
        check: gated(monster, instantGate),
        send: () => api.instant(monster),
      }),
  };
};
