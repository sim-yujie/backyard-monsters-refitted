import type { KoaController } from "../../utils/KoaController.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import { AttackCheckpointSchema } from "../../schemas/AttackCheckpointSchema.js";
import { attackCheckpointRefusedErr, attackNotBoundErr, permissionErr } from "../../errors/errors.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { checkAttackBinding } from "../../services/base/attackSession.js";
import { readAttackSession } from "../../services/base/attackSessionStore.js";
import {
  checkpointExtends,
  newCheckpoint,
  parseCheckpoint,
} from "../../services/base/attackCheckpoint.js";
import { readCheckpoint, storeCheckpoint } from "../../services/base/attackCheckpointStore.js";

/**
 * `POST /base/checkpoint`: the web client's running record of an attack
 * (issue #138, `services/base/attackCheckpoint.ts`).
 *
 * Sent after every drop, bomb and siege weapon and every few seconds while
 * the battle runs, so that an attack its attacker leaves without a save is
 * finished by the server from here (`services/base/finaliseAttack.ts`) rather
 * than undone. Bound exactly as the attack save is (issue #25): only the
 * attacker the session names, inside its window, against the attack the row
 * still carries. It writes no game state; the checkpoint is kept in Redis.
 *
 * An attack with nothing dropped yet has nothing to keep (#79), so an empty
 * log is answered `stored: false` rather than refused.
 */
export const attackCheckpoint: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = AttackCheckpointSchema.parse(ctx.request.body);
  const { basesaveid } = body;

  const baseSave = await postgres.em.findOne(
    Save,
    { basesaveid },
    { fields: ["basesaveid", "attackid", "saveuserid"] }
  );
  if (!baseSave || baseSave.attackid === 0 || baseSave.saveuserid === user.userid) throw permissionErr();

  const now = getCurrentDateTime();
  const session = await readAttackSession(basesaveid);
  const binding = checkAttackBinding({
    session,
    callerid: user.userid,
    storedAttackId: baseSave.attackid,
    submittedAttackId: body.attackid ? Number(body.attackid) : undefined,
    now,
  });
  if (!binding.ok || !session) throw attackNotBoundErr(binding.ok ? "no-session" : binding.reason);

  const input = parseCheckpoint(body);
  if ("refused" in input) {
    if (input.refused !== "empty") throw attackCheckpointRefusedErr(input.refused);
    ctx.status = Status.OK;
    ctx.body = { error: 0, stored: false };
    return;
  }

  // One left by an earlier attack on this row belongs to that attack, not this one.
  const stored = await readCheckpoint(basesaveid);
  const refusal = checkpointExtends(stored?.attackid === session.attackid ? stored : null, input);
  if (refusal) throw attackCheckpointRefusedErr(refusal);

  await storeCheckpoint(basesaveid, newCheckpoint(session, baseSave.saveuserid, input, now));

  ctx.status = Status.OK;
  ctx.body = { error: 0, stored: true, tick: input.tick };
};
