import { ApiError, get, post } from "./http";
import type { RaidView } from "./raid";
import type { ApiEnvelope, BaseLoadResponse } from "./types";

/**
 * The new Inferno (beta.5, `docs/design/inferno.md` §3.2): how far the player
 * is on the way in. Every route answers `403` with `reason: "infernoOff"`
 * while the server's switch is off (`docs/server-api.md`, "The new Inferno").
 */

/** `GET /bm/inferno/state` without its envelope (`controllers/inferno/infernoState.ts`). */
export interface InfernoState {
  /** The server's clock, unix seconds. */
  readonly now: number;
  readonly cave: {
    /** Whether the cave shows on the main yard: Town Hall 5 (or a cave already up), tutorial over. */
    readonly shown: boolean;
    /** 0-5, one per emergence raid. */
    readonly level: number;
    readonly maxLevel: number;
  };
  readonly emergence: {
    readonly lastAt: number | null;
    /** The earliest the next raid may come (0: any time), or null once all five are done. */
    readonly nextAt: number | null;
    readonly done: boolean;
  };
  readonly descent: {
    readonly level: number;
    readonly destroyed: readonly number[];
    readonly passed: boolean;
  };
  readonly hasYard: boolean;
  /**
   * The Inferno yard's Under Hall level, 0 with none or before the Descent is
   * passed: the hall the main yard's Inferno buildings count by (WP 6.1).
   * Absent from a server that predates it, read as 0.
   */
  readonly underHall?: number;
  readonly korathNotice: boolean;
}

/** One card of Moloch's warning: a monster type and its count, in Flash's order. */
export interface MolochGroup {
  readonly monster: string;
  readonly count: number;
}

/** Moloch's raid as the load answers it: the raid routes' view, and its groups for the warning. */
export interface MolochRaidView extends RaidView {
  readonly groups: readonly MolochGroup[];
}

/**
 * The `/base/load` answer's `infernostate`, on the owner's build load of the
 * main yard while the Inferno is on: the state, `raised`, the level the cave
 * just went up to on this load, or null, and `raid`, Moloch's raid for it
 * (WP 1.9), due now; null when the first raise found the yard at 10% health
 * or less, which grows the cave with no raid, as Flash did.
 */
export interface InfernoLoadState extends InfernoState {
  readonly raised: number | null;
  readonly raid?: MolochRaidView | null;
}

export type InfernoStateResponse = ApiEnvelope & InfernoState;

export const loadInfernoState = (): Promise<InfernoStateResponse> =>
  get<InfernoStateResponse>("/api/:apiVersion/bm/inferno/state");

/**
 * `POST /bm/inferno/load` (WP 1.14): the caller's own Inferno yard, caught up,
 * as the yard routes read it: its save fields, `baseid` (which every yard
 * route then sends), `type: "inferno"`, the shared Shiny and the Inferno
 * purse with its cap. `409 noInfernoYard` before the Descent is won, and
 * `403 infernoOff` while the server's switch is off.
 */
export const loadInfernoYard = (): Promise<BaseLoadResponse> =>
  post<BaseLoadResponse>("/api/:apiVersion/bm/inferno/load");

/**
 * Whether a refusal says there is no Inferno yard to open: `409 noInfernoYard`
 * before the Descent is won, `403 infernoOff` while the switch is off.
 */
export const isInfernoClosed = (caught: unknown): boolean => {
  if (!(caught instanceof ApiError)) return false;
  const reason =
    (caught.details?.data as { reason?: unknown } | undefined)?.reason ??
    (caught.body as { reason?: unknown } | undefined)?.reason;
  return reason === "noInfernoYard" || reason === "infernoOff";
};

/** What the main yard says when the Inferno yard would not open. */
export const INFERNO_CLOSED_TEXT = "The Inferno yard is not open to you yet.";

/** Bone, Coal, Sulfur, Magma: the Inferno purse's four amounts (`purseAmounts`). */
export interface InfernoAmounts {
  readonly r1: number;
  readonly r2: number;
  readonly r3: number;
  readonly r4: number;
}

/**
 * `POST /bm/inferno/attack/start` with `kind: "descent"` (WP 1.11,
 * `controllers/inferno/descentAttack.ts`): the Descent yard to fight, fought
 * as an Inferno yard, and what the attacker fights it with.
 */
export interface DescentAttackStart extends ApiEnvelope {
  readonly kind: "descent";
  readonly yardkind: "inferno";
  readonly attackid: number;
  /** The yard attacked, 1-13 (base id less 200): from 7 surface monsters burn. */
  readonly descentyard: number;
  /** Flash's Descent counter before this attack, 1-13. */
  readonly level: number;
  /** The yard, as an attack load serves one. */
  readonly base: Partial<BaseLoadResponse>;
  readonly defenderforces: unknown;
  readonly attackerbrains?: unknown;
  readonly attackeracademy?: unknown;
  readonly attackerranks?: unknown;
  readonly attpowerups?: unknown[];
  /** What one fling may carry. */
  readonly flingercapacity: number;
  /** The Inferno purse now: the Descent's running loot total. */
  readonly descentloot?: InfernoAmounts;
}

export const startDescentAttack = (baseid: string): Promise<DescentAttackStart> =>
  post<DescentAttackStart>("/api/:apiVersion/bm/inferno/attack/start", { kind: "descent", baseid });

/**
 * The start answer as the attack scene reads an attack load: the yard with
 * the fight's own fields beside it. `type` says Inferno, so the yard is drawn
 * and fought with the Inferno buildings (`docs/design/inferno.md` §2.4 "Yard
 * kind"), as Flash loads a Descent yard as an Inferno yard.
 */
export const descentAttackLoad = (start: DescentAttackStart): BaseLoadResponse =>
  ({
    ...start.base,
    type: "inferno",
    attackid: start.attackid,
    defenderforces: start.defenderforces,
    ...(start.attackerbrains === undefined ? {} : { attackerbrains: start.attackerbrains }),
    ...(start.attackeracademy === undefined ? {} : { attackeracademy: start.attackeracademy }),
    ...(start.attackerranks === undefined ? {} : { attackerranks: start.attackerranks }),
    ...(start.attpowerups === undefined ? {} : { attpowerups: start.attpowerups }),
  }) as BaseLoadResponse;

/**
 * The landing's word on a Descent attack, the `descent` of the `/base/save`
 * answer that ends it (WP 1.12, `services/inferno/descentLanding.ts`).
 */
export interface DescentLanding {
  /** Damage of 90% or more beat the yard. */
  readonly won: boolean;
  /** The server's damage, 0-100. */
  readonly damage: number;
  /** Flash's counter after the attack: 1 + yards beaten, 14 once passed. */
  readonly level: number;
  /** This attack's loot, credited to the Inferno purse. */
  readonly loot: InfernoAmounts;
  /** The purse after it: the report's running total. */
  readonly total: InfernoAmounts;
  /** The 13th win: the Inferno yard is the player's. */
  readonly captured: boolean;
  readonly infernobaseid?: string | number;
}

/** The landing's `descent`, when the answer carries a well-formed one. */
export const descentLandingOf = (response: unknown): DescentLanding | null => {
  const descent = (response as { descent?: unknown } | null)?.descent;
  if (typeof descent !== "object" || descent === null) return null;
  const value = descent as Partial<DescentLanding>;
  return typeof value.won === "boolean" && typeof value.level === "number" ? (value as DescentLanding) : null;
};
