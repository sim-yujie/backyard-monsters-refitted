import type { Context } from "koa";
import { User } from "../../../database/models/user.model.js";
import { attackResultPendingErr } from "../../../errors/errors.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { logger } from "../../../utils/logger.js";
import type { AbandonedInput, AbandonedOutcome } from "./abandonedAttack.js";
import { battleMismatches, type ClientBattle } from "./battle.js";
import { ReplayTimeoutError, SAVE_REPLAY_DEADLINE_MS, replayAbandonedInWorker } from "./replayRunner.js";

/**
 * The attack save's side of the server's battle (issue #23, C3 and C4): the
 * replay run for a save that ends an attack, and the record of where the save
 * disagreed with it. Shared by the Map Room 2 save (`baseSave.ts`) and the Map
 * Room 1 tribe save (`scaledMR1Tribes.ts`).
 */

/** The base a save is for, as the log lines name it. */
export interface SavedBase {
  readonly baseid: string;
  /** Absent for a Map Room 1 tribe, which has no row. */
  readonly basesaveid?: number;
}

/**
 * The save's battle replay, in a worker (issue #23, C5). A replay past its
 * deadline writes nothing: the session is left as it is, so where there is a
 * checkpoint the finaliser lands the attack from it (`finaliseAttack.ts`),
 * and where there is none (a Map Room 1 tribe) only a resent save can.
 *
 * @param handOff - What happens to the attack now, for the log line.
 * @throws {ClientSafeError} `attackResultPendingErr` when the replay timed out.
 */
export const replayBattleForSave = async (
  ctx: Context,
  user: User,
  base: SavedBase,
  input: AbandonedInput,
  handOff: string
): Promise<AbandonedOutcome> => {
  try {
    return await replayAbandonedInWorker(input, SAVE_REPLAY_DEADLINE_MS);
  } catch (err) {
    if (!(err instanceof ReplayTimeoutError)) throw err;
    logger.warn(`Attack replay for {username} on base {baseid} timed out: ${handOff}`, {
      event: "attack-replay-timeout",
      userid: user.userid,
      username: user.username,
      baseid: base.baseid,
      basesaveid: base.basesaveid,
      deadlineMs: err.deadlineMs,
      ip: ctx.ip,
    });
    throw attackResultPendingErr();
  }
};

/**
 * Where the client's save and the server's battle disagree, recorded and
 * never written (issue #23, C3). An honest client fought the same battle with
 * the same engine, so any line here is a tampered save or a divergence to fix.
 *
 * @param storedBuildingdata - The defender's `buildingdata` before the save.
 */
export const logBattleMismatches = (
  ctx: Context,
  user: User,
  base: SavedBase,
  client: ClientBattle,
  battle: AbandonedOutcome,
  storedBuildingdata: JsonObject | null | undefined
): void => {
  const fields = battleMismatches(client, battle, storedBuildingdata);
  if (fields.length === 0) return;
  logger.warn("Attack save for {username} on base {baseid} disagrees with the replay on {fields}", {
    event: "attack-replay-mismatch",
    userid: user.userid,
    username: user.username,
    baseid: base.baseid,
    basesaveid: base.basesaveid,
    fields,
    sent: { damage: client.damage, destroyed: client.destroyed },
    derived: { damage: battle.damage, destroyed: battle.destroyed, tick: battle.tick },
    ip: ctx.ip,
  });
};
