import { get } from "./http";
import type { ApiEnvelope } from "./types";

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

/**
 * The `/base/load` answer's `infernostate`, on the owner's build load of the
 * main yard while the Inferno is on: the state, and `raised`, the level the
 * cave just went up to on this load (its emergence raid is due now), or null.
 */
export interface InfernoLoadState extends InfernoState {
  readonly raised: number | null;
}

export type InfernoStateResponse = ApiEnvelope & InfernoState;

export const loadInfernoState = (): Promise<InfernoStateResponse> =>
  get<InfernoStateResponse>("/api/:apiVersion/bm/inferno/state");
