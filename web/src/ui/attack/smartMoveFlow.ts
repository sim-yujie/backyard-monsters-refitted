import { loadAttack } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import { isNewVersionRefusal } from "@/api/rulesStamp";
import { getSmartMove, type SmartMoveResponse } from "@/api/smartMove";
import type { BaseLoadResponse } from "@/api/types";
import { rosterWithHousing } from "@/game/attack/attackEntry";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { smartMovingOn } from "@/game/attack/smartMoveSetting";
import { MOVES_CHANGED } from "./autoAttackText";
import { SmartMoveChanged, SmartMoveClosed, SmartMoveSheet, smartMoveNote } from "./smartMoveSheet";

/**
 * Smart moving for hand attacks (beta 9, owner's grilling of 24 Nov 2026):
 * what the map's Attack does on a Map Room 2 camp before the Attack window.
 *
 * - The setting off, not a Map Room 2 camp, no saved plan, the army already
 *   in range, or no answer in time: the Attack window as before.
 * - The army can be gathered: the "Bring saved army?" sheet. Skip opens the
 *   Attack window; Move & attack sends the attack load with the moves' key
 *   (the server moves them and starts the attack in one request) and goes
 *   straight into the battle; closing it goes back to the map.
 * - It cannot be gathered: the Attack window, with the note saying what is
 *   short or where there is no room.
 */

/** How long the offer may take before the Attack window opens without it. */
export const SMART_MOVE_OFFER_MS = 2_500;

export const SMART_MOVE_ERRORS = {
  network: "Could not reach the server. Try again.",
  gone: "Your yards changed: nothing to move now. Skip to attack.",
} as const;

/** What the map does next. */
export type SmartMoveOutcome =
  /** The Attack window, with the "can't gather" note when there is one. */
  | { readonly kind: "window"; readonly note: HTMLElement | null }
  /** Back to the map: the sheet was closed. */
  | { readonly kind: "closed" }
  /** Into the battle: the moves are made and the attack has started (`load`). */
  | { readonly kind: "moved"; readonly target: AttackTarget };

export interface SmartMoveCalls {
  readonly offer: (baseid: string) => Promise<SmartMoveResponse>;
  readonly start: (target: AttackTarget, movesKey: string) => Promise<BaseLoadResponse>;
}

const CALLS: SmartMoveCalls = {
  offer: getSmartMove,
  start: (target, movesKey) => loadAttack(target.baseid, target.kind, target.roster, { smartMoves: movesKey }),
};

/** The offer, or null when it does not come in time (the Attack window opens as before). */
const offerInTime = async (calls: SmartMoveCalls, baseid: string, ms: number): Promise<SmartMoveResponse | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      calls.offer(baseid),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms))),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const reasonOf = (caught: unknown): string | null => {
  if (!(caught instanceof ApiError)) return null;
  const reason = (caught.details?.data as { reason?: unknown } | undefined)?.reason;
  return typeof reason === "string" ? reason : null;
};

export interface SmartMoveOptions {
  /** The overlay's modal layer. */
  readonly modal: HTMLElement;
  /** The attack the cell would receive. */
  readonly attack: AttackTarget;
  readonly calls?: SmartMoveCalls;
  /** The account's setting as this page last heard it. */
  readonly isOn?: () => boolean;
  readonly offerMs?: number;
}

/**
 * Runs smart moving's part of Attack (see the file comment) and says what
 * comes next.
 */
export const smartMoveBeforeAttack = async ({
  modal,
  attack,
  calls = CALLS,
  isOn = smartMovingOn,
  offerMs = SMART_MOVE_OFFER_MS,
}: SmartMoveOptions): Promise<SmartMoveOutcome> => {
  // Map Room 2 camps only (owner, 24 Nov 2026): a Map Room 1 target names its Map Room.
  if (attack.kind !== "wild" || attack.mapversion !== undefined || !isOn()) return { kind: "window", note: null };
  const offer = await offerInTime(calls, attack.baseid, offerMs);
  if (!offer) return { kind: "window", note: null };
  if (offer.verdict !== "moves" || !offer.movesKey || offer.moves.length === 0) {
    return { kind: "window", note: smartMoveNote(offer) };
  }

  let started: AttackTarget | null = null;
  const sheet: SmartMoveSheet = new SmartMoveSheet({
    container: modal,
    offer,
    onMove: async (movesKey) => {
      try {
        const load = await calls.start(attack, movesKey);
        const roster = load.smartmoved ? rosterWithHousing(attack.roster, load.smartmoved.housed) : attack.roster;
        started = { ...attack, roster, load };
      } catch (caught) {
        // "New version": nothing moved; the card with its Reload button says it.
        if (isNewVersionRefusal(caught)) throw new SmartMoveClosed();
        if (reasonOf(caught) === "movesChanged") {
          const fresh = await offerInTime(calls, attack.baseid, offerMs);
          if (fresh?.verdict === "moves" && fresh.movesKey) {
            sheet.update(fresh, MOVES_CHANGED);
            throw new SmartMoveChanged();
          }
          throw new Error(SMART_MOVE_ERRORS.gone);
        }
        if (caught instanceof NetworkError) throw new Error(SMART_MOVE_ERRORS.network);
        throw caught instanceof Error ? caught : new Error(String(caught));
      }
    },
  });
  const choice = await sheet.done;
  if (choice === "moved" && started) return { kind: "moved", target: started };
  if (choice === "skip") return { kind: "window", note: null };
  return { kind: "closed" };
};
