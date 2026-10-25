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
