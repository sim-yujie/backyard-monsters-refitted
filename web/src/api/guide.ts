import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";

/**
 * The guided start's routes (issue #227, `docs/design/tutorial.md` §8.3):
 *
 *   POST /api/:apiVersion/bm/yard/guide/advance   from
 *   POST /api/:apiVersion/bm/yard/guide/finish    id
 *   POST /api/:apiVersion/bm/yard/guide/army
 *   POST /api/:apiVersion/bm/yard/guide/skip
 *
 * Yard actions on the main yard, so every answer is the whole yard state with
 * the account's `onboarding` summary in it. The guide's paid build is the
 * ordinary `/bm/yard/build` (`yardBuild.ts`): the server sees the guide's
 * step and tops it up.
 *
 * {@link guideActions} runs them through the own yard's store, which merges
 * each answer; the bare calls are for screens with no store (Map Room 1).
 * Refusals (`wrongStep`, `alreadyGranted`, `guideClosed`, `notYet`,
 * `notGuideBuilding`) mean the screen is behind the server: the runner
 * re-reads the step and carries on from there.
 */

const GUIDE_PATH = "/api/:apiVersion/bm/yard/guide";

/** `report` of `guide/advance`: the step it moved to, or `done`. */
export interface GuideAdvanceReport {
  step: string;
}

/** `report` of `guide/finish`. */
export interface GuideFinishReport {
  id: number;
  t: number;
  finished: boolean;
  points: number;
  step: string;
}

/** `report` of `guide/army`. */
export interface GuideArmyReport {
  added: number;
  housed: number;
  retry: boolean;
  step: string;
}

export const guideAdvance = (from: string): Promise<YardResponse<GuideAdvanceReport>> =>
  post<YardResponse<GuideAdvanceReport>>(`${GUIDE_PATH}/advance`, { from });

export const guideFinish = (id: number): Promise<YardResponse<GuideFinishReport>> =>
  post<YardResponse<GuideFinishReport>>(`${GUIDE_PATH}/finish`, { id });

export const guideArmy = (): Promise<YardResponse<GuideArmyReport>> =>
  post<YardResponse<GuideArmyReport>>(`${GUIDE_PATH}/army`, {});

export const guideSkip = (): Promise<YardResponse<{ state: "skipped" }>> =>
  post<YardResponse<{ state: "skipped" }>>(`${GUIDE_PATH}/skip`, {});

/** The four calls, so a runner can be handed stand-ins under test. */
export interface GuideApi {
  advance: typeof guideAdvance;
  finish: typeof guideFinish;
  army: typeof guideArmy;
  skip: typeof guideSkip;
}

export const guideApi: GuideApi = {
  advance: guideAdvance,
  finish: guideFinish,
  army: guideArmy,
  skip: guideSkip,
};

export interface GuideActions {
  advance(from: string): Promise<YardActionResult<GuideAdvanceReport>>;
  finish(id: number): Promise<YardActionResult<GuideFinishReport>>;
  army(): Promise<YardActionResult<GuideArmyReport>>;
  skip(): Promise<YardActionResult<{ state: "skipped" }>>;
}

/** The guide's routes through the own yard's store: queued, merged. Main yard only. */
export const guideActions = (store: YardStore, api: GuideApi = guideApi): GuideActions => ({
  advance: (from) => store.run({ key: actionKey("guide", from), send: () => api.advance(from) }),
  finish: (id) => store.run({ key: actionKey("guide-finish", id), send: () => api.finish(id) }),
  army: () => store.run({ key: actionKey("guide", "army"), send: () => api.army() }),
  skip: () => store.run({ key: actionKey("guide", "skip"), send: () => api.skip() }),
});
