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
import { BaseType } from "../../enums/Base.js";
import { combatConfig } from "../../config/CombatConfig.js";
import { requireFlingsInRoom } from "../../services/base/combat/recordFlingRoom.js";
import { infernoConfig } from "../../config/InfernoConfig.js";
import {
  discardRowlessCheckpoint,
  isInfernoKind,
  readRowlessCheckpoint,
  readRowlessSession,
  rowlessKindOf,
  storeRowlessCheckpoint,
} from "../../services/base/rowlessCheckpoint.js";
import {
  readInfernoPlayerCheckpoint,
  readInfernoPlayerSession,
  storeInfernoPlayerCheckpoint,
} from "../../services/inferno/infernoPlayerSession.js";

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
 *
 * An attack on another player's Inferno yard is bound to its own session and
 * kept under its own key (`infernoPlayerSession.ts`), for the Inferno
 * finaliser (`infernoPlayerFinalise.ts`), never the surface one.
 *
 * An attack on a yard with no row — a Map Room 1 tribe, a Descent yard, a
 * Moloch tribe — names the yard by `baseid` with `basesaveid` 0, and is bound
 * to the attacker's session for that yard (`rowlessCheckpoint.ts`), for the
 * rowless finaliser (`finaliseRowlessAttack.ts`).
 */
export const attackCheckpoint: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = AttackCheckpointSchema.parse(ctx.request.body);
  const { basesaveid } = body;

  if (!(Number.isSafeInteger(basesaveid) && basesaveid > 0)) {
    await rowlessCheckpoint(ctx, user, body);
    return;
  }

  const baseSave = await postgres.em.findOne(
    Save,
    { basesaveid },
    { fields: ["basesaveid", "attackid", "saveuserid", "type", "baseid"] }
  );
  if (!baseSave || baseSave.attackid === 0 || baseSave.saveuserid === user.userid) throw permissionErr();

  const now = getCurrentDateTime();
  const inferno = baseSave.type === BaseType.INFERNO;
  const infernoAttack = inferno ? await readInfernoPlayerSession(basesaveid) : null;
  const session =
    inferno ? (infernoAttack?.baseid === baseSave.baseid ? infernoAttack.session : null) : await readAttackSession(basesaveid);
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
  const stored = inferno ? await readInfernoPlayerCheckpoint(basesaveid) : await readCheckpoint(basesaveid);
  const refusal = checkpointExtends(stored?.attackid === session.attackid ? stored : null, input);
  if (refusal) throw attackCheckpointRefusedErr(refusal);

  // An over-full fling (`recordFlingRoom.ts`) is never kept, so the finaliser
  // can only land the attack as it stood before it. An Inferno attack cuts
  // its flings to its own Flinger instead (`descentFightableLog`).
  if (!inferno) {
    await requireFlingsInRoom(
      ctx,
      user,
      baseSave,
      input.flinglog,
      session.attackerAcademy,
      combatConfig.mode,
      session.attackid,
      "checkpoint"
    );
  }

  const checkpoint = newCheckpoint(session, baseSave.saveuserid, input, now);
  if (inferno) await storeInfernoPlayerCheckpoint(basesaveid, checkpoint);
  else await storeCheckpoint(basesaveid, checkpoint);

  ctx.status = Status.OK;
  ctx.body = { error: 0, stored: true, tick: input.tick };
};

/**
 * A checkpoint of an attack on a yard with no row (`rowlessCheckpoint.ts`),
 * bound exactly as that attack's final save is: the caller's own session for
 * that yard, inside its window, for the attack it names.
 */
const rowlessCheckpoint = async (
  ctx: Parameters<KoaController>[0],
  user: User,
  body: ReturnType<typeof AttackCheckpointSchema.parse>
): Promise<void> => {
  const baseid = String(body.baseid ?? "");
  const kind = rowlessKindOf(baseid);
  if (!kind || (isInfernoKind(kind) && !infernoConfig.enabled)) throw permissionErr();

  const ref = { kind, userid: user.userid, baseid };
  const now = getCurrentDateTime();
  const attack = await readRowlessSession(ref);
  const binding = checkAttackBinding({
    session: attack?.session ?? null,
    callerid: user.userid,
    storedAttackId: attack?.session.attackid ?? 0,
    submittedAttackId: body.attackid ? Number(body.attackid) : undefined,
    now,
  });
  if (!binding.ok || !attack) throw attackNotBoundErr(binding.ok ? "no-session" : binding.reason);
  const { session } = attack;

  const input = parseCheckpoint(body);
  if ("refused" in input) {
    if (input.refused !== "empty") throw attackCheckpointRefusedErr(input.refused);
    ctx.status = Status.OK;
    ctx.body = { error: 0, stored: false };
    return;
  }

  if (kind === "mr1") {
    await requireFlingsInRoom(
      ctx,
      user,
      { baseid, rowless: "mr1-tribe" },
      input.flinglog,
      session.attackerAcademy,
      combatConfig.mode,
      session.attackid,
      "checkpoint"
    );
  }

  const stored = await readRowlessCheckpoint(ref);
  const refusal = checkpointExtends(stored?.checkpoint.attackid === session.attackid ? stored.checkpoint : null, input);
  if (refusal) throw attackCheckpointRefusedErr(refusal);

  await storeRowlessCheckpoint({
    ...ref,
    flingerCapacity: attack.flingerCapacity,
    checkpoint: newCheckpoint(session, user.userid, input, now),
  });

  // The attack may have landed while this was on its way: its save (or the
  // finaliser) ends the session and then drops the checkpoint, so one stored
  // after that would land the attack a second time. The session gone (or
  // another attack's by now) means exactly that, and what was stored goes.
  const after = await readRowlessSession(ref);
  if (after?.session.attackid !== session.attackid) {
    await discardRowlessCheckpoint(ref);
    throw attackNotBoundErr("no-session");
  }

  ctx.status = Status.OK;
  ctx.body = { error: 0, stored: true, tick: input.tick };
};
