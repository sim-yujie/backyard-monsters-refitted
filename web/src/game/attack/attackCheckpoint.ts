import type { FlingLog } from "@/game/combat/rules";
import type { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";

/**
 * The running record of an attack the server keeps while it is fought
 * (issue #138, `server/src/services/base/attackCheckpoint.ts`).
 *
 * If the attack ends without its save reaching the server — a killed browser,
 * a crash, a lost connection — the server finishes it from the last of these:
 * it replays the fling log with the shared engine up to `tick`, the moment
 * the attacker was last seen, and takes the flung monsters out of the cells
 * listed in `sources`, first cell first, as the save's `monsterupdate` would
 * (`attackSave.ts`). So the checkpoint carries exactly those three things,
 * and the ids that bind it to this attack.
 */
export interface AttackCheckpoint {
  /** The defender's row; 0 for a yard with no row, which {@link baseid} names instead. */
  readonly basesaveid: number;
  /** A yard with no row (a Map Room 1 tribe, a Descent yard, a Moloch tribe): its base id. */
  readonly baseid?: string;
  readonly attackid: number;
  /** Battle ticks the clock has reached. */
  readonly tick: number;
  readonly flinglog: FlingLog;
  /** The attacker's cells the roster came from, in the order a fling spends them. */
  readonly sources: readonly string[];
}

/**
 * Whether the attack is on a yard with no row of its own: a Map Room 1 tribe,
 * a Descent yard or a Moloch tribe. Every player fights their own copy of
 * those, so the server keys their attack, and its checkpoint, by the attacker
 * and the yard (`server/src/services/base/rowlessCheckpoint.ts`).
 */
export const isRowlessTarget = (
  target: Pick<AttackTarget, "kind" | "mapversion" | "descentYard" | "infernoTribe">,
): boolean =>
  target.descentYard !== undefined ||
  target.infernoTribe === true ||
  (target.kind === "wild" && target.mapversion === 1);

/**
 * The checkpoint for the session as it stands, or null while there is
 * nothing to keep: before the load, or before the first drop, bomb or siege
 * weapon — an attack with nothing dropped saves nothing (#79).
 *
 * A yard with a row (Map Room 2, a Map Room 1 player's yard, another
 * player's Inferno yard) is named by its `basesaveid`. A Map Room 1 tribe, a
 * Descent yard and a Moloch tribe have none, so they are named by base id
 * with `basesaveid` 0 (owner, 2 Nov 2026: their attacks are finished from the
 * last checkpoint too). Anything else without a row (a practice attack, a
 * raid) keeps none.
 */
export const checkpointOf = (session: AttackSession): AttackCheckpoint | null => {
  const load = session.attackLoad();
  const log = session.flingLog();
  if (!load || log.events.length === 0) return null;
  const hasRow = Number.isSafeInteger(load.basesaveid) && load.basesaveid > 0;
  if (!hasRow && !isRowlessTarget(session.target)) return null;
  return {
    basesaveid: hasRow ? load.basesaveid : 0,
    ...(hasRow ? {} : { baseid: session.target.baseid }),
    attackid: load.attackid ?? 0,
    tick: session.state().tick,
    flinglog: log,
    sources: session.target.roster.sources.map((source) => source.baseid),
  };
};
