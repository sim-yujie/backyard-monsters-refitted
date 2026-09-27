import type { FlingLog } from "@/game/combat/rules";
import type { AttackSession } from "./AttackSession";

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
  readonly basesaveid: number;
  readonly attackid: number;
  /** Battle ticks the clock has reached. */
  readonly tick: number;
  readonly flinglog: FlingLog;
  /** The attacker's cells the roster came from, in the order a fling spends them. */
  readonly sources: readonly string[];
}

/**
 * The checkpoint for the session as it stands, or null while there is
 * nothing to keep: before the load, or before the first drop, bomb or siege
 * weapon — an attack with nothing dropped saves nothing (#79).
 */
export const checkpointOf = (session: AttackSession): AttackCheckpoint | null => {
  const load = session.attackLoad();
  const log = session.flingLog();
  if (!load || log.events.length === 0) return null;
  return {
    basesaveid: load.basesaveid,
    attackid: load.attackid ?? 0,
    tick: session.state().tick,
    flinglog: log,
    sources: (session.target.roster.sources ?? []).map((source) => source.baseid),
  };
};
