import { RequestContext } from "@mikro-orm/core";

import { infernoConfig } from "../../config/InfernoConfig.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { landDescentFromCheckpoint } from "../inferno/descentLanding.js";
import { landInfernoTribeFromCheckpoint } from "../inferno/infernoTribeLanding.js";
import { landMR1TribeFromCheckpoint } from "../maproom/v1/scaledMR1Tribes.js";
import { checkpointExpired } from "./attackCheckpoint.js";
import {
  acquireRowlessFinalLock,
  countRowlessCloseFailure,
  discardRowlessCheckpoint,
  isInfernoKind,
  listRowlessCheckpoints,
  readRowlessCheckpoint,
  readRowlessCloseFailures,
  releaseRowlessFinalLock,
  type RowlessCheckpoint,
  type RowlessKind,
  type RowlessRef,
} from "./rowlessCheckpoint.js";

/**
 * Finishes an attack on a yard with no row — a Map Room 1 tribe, a Descent
 * yard, a Moloch tribe — that its attacker left without the final save
 * (owner, 2 Nov 2026: leaving a battle must never undo it). The Map Room 2
 * finaliser's rule (`finaliseAttack.ts`), for the attacks
 * `rowlessCheckpoint.ts` keeps checkpoints of.
 *
 * The web client sends the final save as the page goes, but a killed
 * browser, a phone browser swiped away or a lost connection sends nothing.
 * Those attacks used to land nothing at all: the monsters came home and the
 * damage was undone, so closing the tab when a fight went badly was free. So
 * the attack lands from its last checkpoint, through the kind's own landing
 * (`scaledMR1Tribes.ts`, `descentLanding.ts`, `infernoTribeLanding.ts`): the
 * battle is replayed to the moment the attacker was last seen, and exactly
 * what the final save would have landed at that moment lands — the monsters
 * flung by then spent, the damage, the loot, the Descent's or the tribe's
 * progress, a yard won only if that battle won it. Never more.
 *
 * When it runs, as on Map Room 2:
 * - the attacker's next yard load (`/base/load`, `/bm/inferno/load`) and next
 *   Inferno attack start: they have plainly left that battle;
 * - a sweep every minute, once the attack's window has closed. Nobody else's
 *   load ever needs it: the yard is the attacker's own copy.
 *
 * Exactly once: the final save and this take the kind's final lock, and each
 * ends the session and drops the checkpoint before letting go. A replay that
 * fails {@link ROWLESS_CLOSE_ATTEMPTS} times is given up: the attack lands
 * with no battle, its flung monsters spent; one that cannot land even so is
 * dropped after as many more, never retried for the checkpoint's 7 days.
 */

export type RowlessOutcome = "finalised" | "none" | "busy" | "stale";

/** How many failed replays an attack gets before it lands with no battle. */
export const ROWLESS_CLOSE_ATTEMPTS = 3;

type Lander = (user: User, stored: RowlessCheckpoint, now: number, replay: boolean) => Promise<unknown>;

const LANDERS: Readonly<Record<RowlessKind, Lander>> = {
  mr1: landMR1TribeFromCheckpoint,
  descent: landDescentFromCheckpoint,
  "inferno-tribe": landInfernoTribeFromCheckpoint,
};

const finaliseLocked = async (ref: RowlessRef, trigger: string): Promise<RowlessOutcome> => {
  const stored = await readRowlessCheckpoint(ref);
  if (!stored) return "none";
  // With the Inferno switched off nothing of it lands; the checkpoint waits.
  if (isInfernoKind(ref.kind) && !infernoConfig.enabled) return "none";

  const facts = { kind: ref.kind, userid: ref.userid, baseid: ref.baseid, attackid: stored.checkpoint.attackid, trigger };
  const user = await postgres.em.findOne(User, { userid: ref.userid }, { populate: ["save"] });
  if (!user?.save) {
    await discardRowlessCheckpoint(ref);
    return "stale";
  }

  const failures = await readRowlessCloseFailures(ref);
  if (failures >= 2 * ROWLESS_CLOSE_ATTEMPTS) {
    await discardRowlessCheckpoint(ref);
    logger.error("Gave up landing an attack left on a yard with no row; dropped its checkpoint", {
      event: "attack-finalise-given-up",
      ...facts,
    });
    return "stale";
  }

  const replay = failures < ROWLESS_CLOSE_ATTEMPTS;
  try {
    await LANDERS[ref.kind](user, stored, getCurrentDateTime(), replay);
  } catch (err) {
    await countRowlessCloseFailure(ref);
    throw err;
  }
  logger.info("Finalised an attack its attacker left, from its checkpoint", {
    event: "attack-finalised-rowless",
    ...facts,
    tick: stored.checkpoint.tick,
    replayed: replay,
  });
  return "finalised";
};

/**
 * Lands one rowless attack's checkpoint now (the rules above), in an ORM
 * context of its own so a request's entities are neither shared nor flushed.
 * A caller inside a request must call it before it loads any row this writes.
 */
export const finaliseRowlessAttack = (ref: RowlessRef, trigger: string): Promise<RowlessOutcome> =>
  RequestContext.create(postgres.orm.em, async () => {
    if (!(await acquireRowlessFinalLock(ref))) return "busy" as const;
    try {
      return await finaliseLocked(ref, trigger);
    } finally {
      await releaseRowlessFinalLock(ref);
    }
  });

/** Lands every checkpoint `choose` picks, one at a time, carrying on past a failure. Never throws. */
const finaliseWhere = async (choose: (stored: RowlessCheckpoint) => boolean, trigger: string): Promise<number> => {
  let finalised = 0;
  try {
    for (const stored of await listRowlessCheckpoints()) {
      if (!choose(stored)) continue;
      try {
        if ((await finaliseRowlessAttack(stored, trigger)) === "finalised") finalised++;
      } catch (err) {
        logger.error(`Finalising the ${stored.kind} attack of ${stored.userid} on ${stored.baseid} failed: ${err}`);
      }
    }
  } catch (err) {
    logger.error(`Listing the attacks left on yards with no row failed: ${err}`);
  }
  return finalised;
};

/**
 * Before a player's yard load or Inferno attack start: every attack on a yard
 * with no row they left without a save. Never throws.
 *
 * @param userid - The player.
 * @param trigger - What asked, for the log line.
 */
export const finaliseRowlessAttacksOf = (userid: number, trigger: string): Promise<number> =>
  finaliseWhere((stored) => stored.userid === userid, trigger);

/** Every rowless attack whose window has closed without a save: the minute sweep's share. */
export const finaliseExpiredRowlessAttacks = (): Promise<number> => {
  const now = getCurrentDateTime();
  return finaliseWhere((stored) => checkpointExpired(stored.checkpoint, now), "expired");
};
