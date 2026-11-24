import type { NoRoom, PlanShortfall, YardLabel, YardMove } from "./autoAttack";
import { post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * Smart moving for hand attacks (beta 9, owner 24 Nov 2026;
 * `server/src/services/base/autoAttack/smartMove.ts`).
 *
 * When the player taps Attack on a Map Room 2 camp they have a saved Repeat
 * plan for, the server says whether the yards in range hold that plan's
 * monsters and, when they do not, which moves would bring them in. "Move &
 * attack" sends the moves' key with the attack load itself
 * (`loadAttack(..., { smartMoves })`), which makes them and starts the attack
 * in one request.
 */

/** What Attack offers (see the server's `SmartMoveVerdict`). */
export type SmartMoveVerdict = "off" | "none" | "outOfRange" | "ready" | "moves" | "short" | "housing";

export interface SmartMoveResponse extends ApiEnvelope {
  readonly baseid: string;
  readonly verdict: SmartMoveVerdict;
  /** The camp, for the sheet's head; null when the setting is off. */
  readonly camp: { readonly tribe: string; readonly level: number; readonly damage: number } | null;
  /** The saved plan's monsters, per id. */
  readonly monsters: Readonly<Record<string, number>>;
  /** The moves (`moves` only). */
  readonly moves: readonly YardMove[];
  /** Their key, sent back with the attack load. */
  readonly movesKey: string | null;
  /** Each monster type short (`short` only). */
  readonly missing: readonly PlanShortfall[];
  /** No room in range (`housing` only). */
  readonly noRoom: NoRoom | null;
  /** Where each yard named above sits. */
  readonly yards: Readonly<Record<string, YardLabel>>;
}

/** `POST /worldmapv2/smartmove`: what Attack on a camp offers. Reads only. */
export const getSmartMove = (baseid: string): Promise<SmartMoveResponse> =>
  post<SmartMoveResponse>("/worldmapv2/smartmove", { baseid });
