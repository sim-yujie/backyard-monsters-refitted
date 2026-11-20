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
  | { readonly kind: "bomb"; readonly id: string; readonly reason: "catapult" | "cost" | "unknown" }
  /** Not enough putty for Repeat attack's fee and the Catapult's putty shots together. */
  | { readonly kind: "fee"; readonly need: number; readonly have: number };

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

/** Monsters moved from one of the player's yards to a yard in range (Smart Repeat attack). */
export interface YardMove {
  readonly from: string;
  readonly to: string;
  readonly monsters: Readonly<Record<string, number>>;
}

/** Where one of the player's yards sits, so a move can name it. */
export interface YardLabel {
  readonly main: boolean;
  readonly x: number;
  readonly y: number;
}

/** No room in range for the monsters that would have to move in. */
export interface NoRoom {
  /** Housing space they take. */
  readonly need: number;
  /** Free housing in each yard in range that could take them. */
  readonly free: readonly { readonly baseid: string; readonly free: number }[];
}

export interface AutoAttackPlanResponse extends ApiEnvelope {
  readonly baseid: string;
  readonly plan: PlanSummary | null;
  /** What the player lacks, counting every yard they could move monsters from. */
  readonly missing: readonly PlanShortfall[];
  /**
   * Smart Repeat attack (owner, 16 Nov 2026): monsters to move into the yards
   * in range first; empty when those yards hold the army already. Absent from
   * an older server.
   */
  readonly moves?: readonly YardMove[];
  /** Sent back with "Move and attack"; null without moves. */
  readonly movesKey?: string | null;
  /** The army could be gathered, but the yards in range cannot house it. */
  readonly noRoom?: NoRoom | null;
  /** Where each yard `moves` and `noRoom` name sits. */
  readonly yards?: Readonly<Record<string, YardLabel>>;
  readonly outOfRange: boolean;
  readonly underAttack: boolean;
  /** The camp's damage now, whole. */
  readonly damage: number;
  /**
   * Repeat attack's putty fee for this camp, burned before the attack starts
   * (owner, 20 Nov 2026). Absent from an older server.
   */
  readonly fee?: number;
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
  /** Monsters moved into the yards in range before the attack. */
  readonly moved?: readonly YardMove[];
  readonly yards?: Readonly<Record<string, YardLabel>>;
  /** The putty fee burned before the attack started. */
  readonly fee?: number;
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
  /** Declare War's longer countdown; only on a replay of an attack fought while the old alliance power-up ran. */
  readonly declareWar?: boolean;
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
 * the list. `movesKey` is the key of the moves the player agreed to (Smart
 * Repeat attack); the server makes them only when its own plan has the same
 * key, and otherwise refuses with `movesChanged`.
 */
export const runAutoAttack = (baseid: string, movesKey?: string | null): Promise<AutoAttackResponse> =>
  post<AutoAttackResponse>("/worldmapv2/autoattack", movesKey ? { baseid, moves: movesKey } : { baseid });

/** `GET /worldmapv2/autoattackreplay`: the last auto-attack's battle. */
export const getAutoAttackReplay = (): Promise<AutoAttackReplayResponse> =>
  get<AutoAttackReplayResponse>("/worldmapv2/autoattackreplay");
