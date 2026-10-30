import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { UpgradeCost, YardResponse } from "./types";
import { yardBody } from "./yard";

/**
 * The Goals routes (`docs/design/tutorial.md` §6, §8.3, issue #227). All are
 * yard actions on the main yard (`server/src/controllers/yard/goals.ts`) and
 * refuse on an outpost; `state` and `claim` also answer on the Inferno yard,
 * with its 38 quests (`docs/design/inferno.md` WP 4.1-4.3), when the request
 * names it by `baseid`:
 *
 *   POST /api/:apiVersion/bm/yard/goals/state            the list
 *   POST /api/:apiVersion/bm/yard/goals/claim  id        pay one goal
 *   POST /api/:apiVersion/bm/yard/goals/baiter-start     a Baiter run's token
 *   POST /api/:apiVersion/bm/yard/goals/baiter-run token  the run finished
 *
 * Every answer carries the yard state, so the store merges it as any other
 * yard action's (the badge's `onboarding.goalsReady` included).
 */

const GOALS_PATH = "/api/:apiVersion/bm/yard/goals";

/** One goal's monster reward. */
export interface GoalMonsters {
  id: string;
  name: string;
  count: number;
}

/** A siege weapon reward (SW4-SW12): one weapon made in the Chaos Factory. */
export interface GoalSiege {
  id: string;
  name: string;
  count: number;
}

/** One goal as `goals/state` sends it; goals the player cannot see yet are not sent. */
export interface GoalView {
  id: string;
  order: number;
  name: string;
  description: string;
  reward: UpgradeCost;
  /** Shiny on top of the reward (five Inferno quests). */
  shiny?: number;
  monsters?: GoalMonsters;
  siege?: GoalSiege;
  status: "open" | "ready" | "claimed";
  /** Marked claimed when Goals arrived, without a reward. */
  baseline?: true;
  /** A counting goal's figures, while open. */
  progress?: { have: number; need: number };
  /**
   * A ready goal with monsters: whether Housing has room for them all now;
   * with a siege weapon: whether the Chaos Factory can take it now.
   */
  room?: boolean;
}

export interface GoalsStateReport {
  goals: GoalView[];
}

/** `report` of `goals/claim`. */
export interface GoalClaimReport {
  id: string;
  /** What landed in storage, after the cap. */
  credited: UpgradeCost;
  /** What the cap turned away. */
  overflow: UpgradeCost;
  /** Shiny paid to the shared Shiny. */
  shiny?: number;
  monsters?: { id: string; count: number };
  /** The siege weapon made in the Chaos Factory. */
  siegeReward?: { id: string; count: number };
  /** Every weapon's record after a siege reward (merged by `siegeSlices`). */
  siege?: Record<string, { level: number; quantity: number }>;
  points: number;
}

export const goalsState = (baseid?: string): Promise<YardResponse<GoalsStateReport>> =>
  post<YardResponse<GoalsStateReport>>(`${GOALS_PATH}/state`, yardBody({}, baseid));

/**
 * Pays one goal. Refusals: 400 `unknownGoal`; 409 `alreadyClaimed`,
 * `goalHidden`, `notMet`, `mapRoom3`, `housing { monster, count, need, free }`,
 * `siegeRoom { weapon }`.
 */
export const claimGoal = (id: string, baseid?: string): Promise<YardResponse<GoalClaimReport>> =>
  post<YardResponse<GoalClaimReport>>(`${GOALS_PATH}/claim`, yardBody({ id }, baseid));

/** A Baiter practice run's token, issued as the run starts. Refusal: 409 `noBaiter`. */
export const baiterStart = (): Promise<YardResponse<{ token: string }>> =>
  post<YardResponse<{ token: string }>>(`${GOALS_PATH}/baiter-start`);

/** The run reached its end screen. Refusals: 409 `noRun`, `tooSoon`, `noBaiter`. */
export const baiterRun = (token: string): Promise<YardResponse<{ baiterRuns: number }>> =>
  post<YardResponse<{ baiterRuns: number }>>(`${GOALS_PATH}/baiter-run`, { token });

/** The calls the panel makes, so tests can hand it stand-ins. */
export interface GoalsApi {
  state: typeof goalsState;
  claim: typeof claimGoal;
}

export const goalsApi: GoalsApi = { state: goalsState, claim: claimGoal };

/** The queue keys. */
export const GoalsKey = {
  STATE: actionKey("goals", "state"),
  claim: (id: string): string => actionKey("goals", id),
} as const;

export interface GoalsActions {
  state(): Promise<YardActionResult<GoalsStateReport>>;
  claim(id: string): Promise<YardActionResult<GoalClaimReport>>;
}

/**
 * The Goals routes through the store's one-at-a-time queue, which merges each
 * answer. They name the store's yard: none on the main yard, the Inferno
 * yard's `baseid` there (the panel is not mounted on an outpost).
 */
export const goalsActions = (store: Pick<YardStore, "run">, api: GoalsApi = goalsApi): GoalsActions => ({
  state: () => store.run({ key: GoalsKey.STATE, send: (_api, ...yard) => api.state(...yard) }),
  claim: (id) => store.run({ key: GoalsKey.claim(id), send: (_api, ...yard) => api.claim(id, ...yard) }),
});
