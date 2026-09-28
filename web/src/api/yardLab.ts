import { labAbility } from "@/game/monsters/monsterCatalogue";
import {
  gateText,
  instantGate,
  researchGate,
  runningResearch,
  type LabContext,
  type LabGate,
} from "@/game/monsters/lab";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import type { YardRefusal } from "./yard";

/**
 * The Monster Lab's yard routes (`docs/design/yard-buildings.md` §6 "Lab
 * tab"; wire contract in `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/lab/start     monster
 *   POST /api/:apiVersion/bm/yard/lab/cancel
 *   POST /api/:apiVersion/bm/yard/lab/finish
 *   POST /api/:apiVersion/bm/yard/lab/instant   monster
 *
 * One Lab, one research: cancel and finish name nothing. Each answers like
 * every yard action — the whole yard state, what the catch-up finished
 * (`completed`) and the route's own `report` — and refuses with the flat
 * `{ error, reason, ...detail }` body `yardRefusal` reads. The calls hold no
 * state; {@link labActions} runs them through the `YardStore`'s
 * one-at-a-time queue, which merges every answer.
 */

const LAB_PATH = "/api/:apiVersion/bm/yard/lab";

/** `report` of `lab/start`. */
export interface LabStartReport {
  monster: string;
  /** The rank the research reaches. */
  rank: number;
  /** The Lab doing it. */
  lab: number;
  /** When it ends, unix seconds. */
  endsAt: number;
  /** Putty charged. */
  cost: { r3: number };
}

/** `report` of `lab/cancel`. */
export interface LabCancelReport {
  monster: string;
  rank: number;
  /** Putty actually returned, after the storage cap. */
  refund: { r3: number };
}

/** `report` of `lab/finish` and `lab/instant`. */
export interface LabShinyReport {
  monster: string;
  /** The rank it has now. */
  rank: number;
  /** Shiny spent. */
  credits: number;
}

/**
 * Researches `monster`'s next rank: its full putty price now. Refusals, in the
 * server's order: 400 `badRequest`, `noLab`, `busy`/`damaged {id}`,
 * `labBusy {id, monster}`, `locked`, `maxRank`, `labLevel {have, need}`,
 * `monsterLevel {monster, have, need}`, `shortfall`.
 */
export const labStart = (monster: string): Promise<YardResponse<LabStartReport>> =>
  post<YardResponse<LabStartReport>>(`${LAB_PATH}/start`, { monster });

/** Cancels the research for its full putty price back, capped. Refusals: `noLab`, `notResearching`. */
export const labCancel = (): Promise<YardResponse<LabCancelReport>> =>
  post<YardResponse<LabCancelReport>>(`${LAB_PATH}/cancel`, {});

/** Finishes the research now for `timeCost(upt − now)` Shiny. Refusals: `notResearching`, `shinyLocked`, `credits`. */
export const labFinish = (): Promise<YardResponse<LabShinyReport>> =>
  post<YardResponse<LabShinyReport>>(`${LAB_PATH}/finish`, {});

/** Researches `monster`'s next rank at once for Shiny, no putty. Refusals: `start`'s short of `shortfall`, then `shinyLocked`, `credits`. */
export const labInstant = (monster: string): Promise<YardResponse<LabShinyReport>> =>
  post<YardResponse<LabShinyReport>>(`${LAB_PATH}/instant`, { monster });

/** Every call above, so the actions can be handed a stand-in under test. */
export interface LabApi {
  start: typeof labStart;
  cancel: typeof labCancel;
  finish: typeof labFinish;
  instant: typeof labInstant;
}

export const labApi: LabApi = {
  start: labStart,
  cancel: labCancel,
  finish: labFinish,
  instant: labInstant,
};

/** The queue keys, for `store.isRunning`. The tab waits on every Lab button while any Lab request runs. */
export const LabKey = {
  START: actionKey("lab", "start"),
  CANCEL: actionKey("lab", "cancel"),
  FINISH: actionKey("lab", "finish"),
  INSTANT: actionKey("lab", "instant"),
} as const;

/** Every Lab key, for disabling the whole tab's buttons while one runs. */
export const LAB_KEYS: readonly string[] = Object.values(LabKey);

/** What the Lab tab can do, each a queued store action that never throws. */
export interface LabActions {
  start(monster: string): Promise<YardActionResult<LabStartReport>>;
  cancel(): Promise<YardActionResult<LabCancelReport>>;
  finish(): Promise<YardActionResult<LabShinyReport>>;
  instant(monster: string): Promise<YardActionResult<LabShinyReport>>;
}

/** A local refusal, in the server's shape. */
const refuse = (
  reason: string,
  message: string,
  detail: Record<string, unknown> = {},
): YardRefusal => ({ reason, message, detail, local: true });

/** A gate as the refusal the server would send for it. */
const gateRefusal = (gate: LabGate): YardRefusal => {
  const message = `${gateText(gate)}.`;
  switch (gate.reason) {
    case "labLevel":
      return refuse(gate.reason, message, { have: gate.have, need: gate.need });
    case "monsterLevel":
      return refuse(gate.reason, message, { monster: gate.monster, have: gate.have, need: gate.need });
    case "shortfall":
      return refuse(gate.reason, message, { shortfall: { r1: 0, r2: 0, r3: gate.need, r4: 0 } });
    default:
      return refuse(gate.reason, message);
  }
};

/**
 * The Lab routes, routed through `store.run` so they queue behind any request
 * in flight and re-check the rules the client can see against the state the
 * answer ahead of them left (T4). The store merges every answer and refreshes
 * after a 409, as for the building routes.
 */
export const labActions = (store: YardStore, api: LabApi = labApi): LabActions => {
  const gated = (monster: string, gate: typeof researchGate) => (reader: LabContext) => {
    const ability = labAbility(monster);
    if (!ability) return refuse("badRequest", "That monster has no Lab ability.", { monster });
    const refusal = gate(ability, reader);
    return refusal ? gateRefusal(refusal) : null;
  };
  const running = (reader: LabContext) =>
    runningResearch(reader) ? null : refuse("notResearching", "The Monster Lab is not researching.");

  return {
    start: (monster) =>
      store.run({ key: LabKey.START, check: gated(monster, researchGate), send: () => api.start(monster) }),
    cancel: () => store.run({ key: LabKey.CANCEL, check: running, send: () => api.cancel() }),
    finish: () => store.run({ key: LabKey.FINISH, check: running, send: () => api.finish() }),
    instant: (monster) =>
      store.run({ key: LabKey.INSTANT, check: gated(monster, instantGate), send: () => api.instant(monster) }),
  };
};
