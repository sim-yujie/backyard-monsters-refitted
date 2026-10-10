import { get, post } from "./http";
import type { ApiEnvelope, BaseLoadResponse } from "./types";

/**
 * Auto-attack on a Map Room 2 wild monster camp (issue #221,
 * `server/src/services/base/autoAttack/autoAttack.ts`).
 *
 * The client names the camp and nothing else: the server finds the plan (the
 * player's last attack played by hand on a camp of the same tribe and level),
 * checks the army, fights the battle and lands it.
 */

/** Something the repeated attack used that the player lacks now. */
export type PlanShortfall =
  | { readonly kind: "monster"; readonly id: string; readonly need: number; readonly have: number }
  | { readonly kind: "champion"; readonly t: number; readonly reason: "none" | "hurt" | "away" }
  | { readonly kind: "bomb"; readonly id: string; readonly reason: "catapult" | "cost" | "unknown" };

/** The attack a camp would repeat. */
export interface PlanSummary {
  readonly tribe: string;
  readonly level: number;
  /** The camp it was played on. */
  readonly recordedOn: { readonly baseid: string; readonly x: number; readonly y: number };
  /** Unix seconds. */
  readonly recordedAt: number;
  readonly monsters: Readonly<Record<string, number>>;
  /** Each champion it flings, at the level and power level it fights at now. */
  readonly champions: readonly { readonly t: number; readonly l: number; readonly pl?: number }[];
  /** Bomb ids, in order. */
  readonly bombs: readonly string[];
  /** It used siege weapons, which are not repeated. */
  readonly siege: boolean;
}

export interface AutoAttackPlanResponse extends ApiEnvelope {
  readonly baseid: string;
  readonly plan: PlanSummary | null;
  readonly missing: readonly PlanShortfall[];
  readonly outOfRange: boolean;
  readonly underAttack: boolean;
  /** The camp's damage now, whole. */
  readonly damage: number;
}

export interface ResourceAmounts {
  readonly r1: number;
  readonly r2: number;
  readonly r3: number;
  readonly r4: number;
}

export interface AutoAttackResponse extends ApiEnvelope {
  readonly baseid: string;
  readonly tribe: string;
  readonly level: number;
  readonly damageBefore: number;
  readonly damageAfter: number;
  readonly damageAdded: number;
  /** At or past 90%: the camp can be taken over. */
  readonly conquered: boolean;
  readonly destroyed: 0 | 1;
  /** What landed in the player's pool, and what their storage left behind. */
  readonly loot: ResourceAmounts;
  readonly lootLeft: ResourceAmounts;
  readonly flung: Readonly<Record<string, number>>;
  readonly champions: readonly { readonly t: number; readonly hp: number }[];
  readonly bombs: readonly string[];
  readonly report: string;
  readonly plan: PlanSummary;
}

/** The last auto-attack's battle, for Watch. */
export interface AutoAttackReplay {
  readonly baseid: string;
  readonly name: string;
  /** The camp as the battle found it, shaped as an attack load. */
  readonly load: BaseLoadResponse;
  readonly seed: number;
  readonly events: readonly unknown[];
  readonly tick: number;
  readonly levels: Readonly<Record<string, number>>;
  /** The attacker's Monster Lab ranks (issue #352); absent on a replay kept before them. */
  readonly ranks?: Readonly<Record<string, number>>;
  readonly declareWar: boolean;
}

export interface AutoAttackReplayResponse extends ApiEnvelope {
  readonly replay: AutoAttackReplay | null;
}

/** `POST /worldmapv2/autoattackplan`: what a camp's Repeat attack would do. */
export const getAutoAttackPlan = (baseid: string): Promise<AutoAttackPlanResponse> =>
  post<AutoAttackPlanResponse>("/worldmapv2/autoattackplan", { baseid });

/**
 * `POST /worldmapv2/autoattack`: one auto-attack, resolved at once. A refusal
 * is an `ApiError` whose `details.data` carries `reason` and, for `missing`,
 * the list.
 */
export const runAutoAttack = (baseid: string): Promise<AutoAttackResponse> =>
  post<AutoAttackResponse>("/worldmapv2/autoattack", { baseid });

/** `GET /worldmapv2/autoattackreplay`: the last auto-attack's battle. */
export const getAutoAttackReplay = (): Promise<AutoAttackReplayResponse> =>
  get<AutoAttackReplayResponse>("/worldmapv2/autoattackreplay");
