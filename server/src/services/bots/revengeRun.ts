import { RequestContext } from "@mikro-orm/core";

import { baseModeAttack } from "../../controllers/base/load/modes/baseModeAttack.js";
import { Maproom } from "../../database/models/maproom.model.js";
import { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { postgres } from "../../server.js";
import { logger } from "../../utils/logger.js";
import { newCheckpoint } from "../base/attackCheckpoint.js";
import { storeCheckpoint } from "../base/attackCheckpointStore.js";
import { readAttackSession } from "../base/attackSessionStore.js";
import { planLog, type OwnedChampion } from "../base/autoAttack/attackPlan.js";
import { playerLevelOf } from "../base/calculateBaseLevel.js";
import { ReplayTimeoutError, reserveReplaySlot } from "../base/combat/replayRunner.js";
import { finaliseAttacksFor, finaliseExpiredOnBase, landCheckpointedAttack } from "../base/finaliseAttack.js";
import { catchUpArmyRow } from "../yard/armies.js";
import { isPlayerOnline } from "../user/online.js";
import { ONLINE_SECONDS, type RevengeOutcome } from "./revenge.js";
import { planRevenge, revengeArmyOf } from "./revengePlan.js";

/**
 * Fights a bot's revenge on a player (issue #244, `docs/design/bot-neighbours.md`
 * §4.7 steps 2-5), once the sweep's checks (`revenge.ts`) have said it may run.
 * The same operation as an auto-attack (`autoAttack.ts`), with the bot as the
 * attacker and the player's main yard as the target:
 *
 * 1. Any attack the bot left lands first, and the player's yard's own expired
 *    one, as before any attack (`baseLoad.ts`).
 * 2. **The plan**, before anything is written: the bot's housed monsters and
 *    caged champion, caught up to now (`revengeArmyOf`), dropped on the
 *    player's yard as it stands (`planRevenge`). No plan (nothing to send,
 *    nothing standing) is no revenge.
 * 3. **A replay slot** (`reserveReplaySlot`); none free is a retry.
 * 4. **The attack load** (`baseModeAttack`, Map Room 1, the bot's level): it
 *    refuses as for any attacker (protected, online, under attack, truce), and
 *    otherwise commits the attack: the bot's protection ends, the counters
 *    move (`registerAttacker`), `attack_logs` gets its row.
 * 5. **The checkpoint**, from the plan under a fresh seed, and
 *    `retaliatecount` + 1 on the player's map entry for the bot (decision 11).
 * 6. **The landing** (`landCheckpointedAttack`, `left: false`,
 *    `recordPlan: false`): real damage and loot, the bot's monsters spent and
 *    its loot banked, post-attack protection, and the defence notice and away
 *    toast (`afterYardDefended`), as from any attacker. A replay past its
 *    deadline writes nothing: the checkpoint stays and the attack finaliser's
 *    sweep lands it, exactly once, as it lands an attack a player left.
 *
 * Past step 4 the attack is committed and this never throws: whatever goes
 * wrong is logged and the attack lands from its checkpoint (or, with no
 * checkpoint, expires as an empty attack). The sweep's checks see the attack
 * log and never run the same revenge twice.
 */

export interface RevengeAttack {
  readonly bot: number;
  readonly target: number;
  /** Unix seconds. */
  readonly now: number;
  /** The plan's seed; random by default. */
  readonly planSeed?: number;
  /** The battle's seed; random by default. */
  readonly battleSeed?: number;
}

/** What the runner is built on, for tests to stand in for. */
export interface RevengeRunDeps {
  readonly land?: typeof landCheckpointedAttack;
}

/** A random 32-bit seed. */
const mintSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

/**
 * The bot's entry on the player's map list (put there by `registerAttacker`)
 * gets one more vengeance (decision 11). Never stops the landing.
 */
const countRetaliation = async (player: number, bot: number): Promise<void> => {
  try {
    const room = await postgres.em.findOne(Maproom, { userid: player });
    const entry = room?.neighbors.find((neighbour) => neighbour.userid === bot);
    if (!room || !entry) return;
    entry.retaliatecount = (entry.retaliatecount ?? 0) + 1;
    await postgres.em.flush();
  } catch (error) {
    logger.error("Could not count bot {bot}'s revenge on {player}: {error}", {
      event: "bot-revenge-retaliatecount",
      bot,
      player,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Runs one revenge attack (the file comment). The caller has checked the
 * switch, the bot, the player and the caps, and holds the bot's lock.
 */
export const runRevengeAttack = (attack: RevengeAttack, deps: RevengeRunDeps = {}): Promise<RevengeOutcome> =>
  RequestContext.create(postgres.orm.em, () => fight(attack, deps));

const fight = async ({ bot, target, now, planSeed, battleSeed }: RevengeAttack, deps: RevengeRunDeps): Promise<RevengeOutcome> => {
  const land = deps.land ?? landCheckpointedAttack;
  // As an attack load does: what the bot left lands first, then the yard's
  // own expired attack, before either row is read here.
  await finaliseAttacksFor(bot, "bot-revenge");
  const home = await postgres.em.fork().findOne(User, { userid: target }, { populate: ["save"] });
  if (home?.save?.baseid) await finaliseExpiredOnBase(home.save.baseid);

  const attacker = await postgres.em.findOne(User, { userid: bot }, { populate: ["save"] });
  const defender = await postgres.em.findOne(User, { userid: target }, { populate: ["save"] });
  const botSave = attacker?.save;
  const yard = defender?.save;
  if (!attacker || !botSave || !yard || yard.type !== BaseType.MAIN || yard.mapversion !== MapRoomVersion.V1) {
    return { status: "nothing" };
  }

  const housed = catchUpArmyRow(botSave, botSave, now).monsters;
  const plan = planRevenge(
    revengeArmyOf({ monsters: housed, champion: botSave.champion, academy: botSave.academy }),
    { buildingdata: yard.buildingdata as never, buildinghealthdata: yard.buildinghealthdata as never },
    planSeed ?? mintSeed()
  );
  if (!plan) return { status: "nothing" };

  const release = await reserveReplaySlot();
  if (!release) return { status: "busy" };
  try {
    let minted;
    try {
      minted = await baseModeAttack({
        user: attacker,
        baseid: yard.baseid,
        mapversion: MapRoomVersion.V1,
        attackerLevel: playerLevelOf(botSave),
      });
    } catch (error) {
      // Refused before anything was written: the sweep checks again later.
      if (error instanceof ClientSafeError) return { status: "refused", reason: error.message };
      throw error;
    }

    // Committed: from here on, log and let the checkpoint land it.
    const { save } = minted;
    try {
      const session = await readAttackSession(save.basesaveid);
      if (!session?.entryHoused) throw new Error("the attack session was not stored");
      const seed = battleSeed ?? mintSeed();
      await storeCheckpoint(
        save.basesaveid,
        newCheckpoint(
          session,
          save.saveuserid,
          {
            tick: plan.tick,
            flinglog: planLog(plan, seed, botSave.champion as OwnedChampion[] | null),
            sources: Object.keys(session.entryHoused),
          },
          now
        )
      );
      await countRetaliation(target, bot);

      const landed = await land(save.basesaveid, "bot-revenge", { left: false, recordPlan: false });
      if (landed.status !== "finalised" || !landed.landed) {
        logger.warn("Bot {bot}'s revenge on {target} did not land now ({status}); its checkpoint stays", {
          event: "bot-revenge-pending",
          bot,
          target,
          basesaveid: save.basesaveid,
          status: landed.status,
        });
        return { status: "pending" };
      }
      const { outcome, damageBefore, damageAfter, credited } = landed.landed;
      logger.info("Bot {botname} took revenge on {username}: {damageBefore}% to {damageAfter}%", {
        event: "bot-revenge",
        bot,
        botname: attacker.username,
        target,
        username: defender.username,
        basesaveid: save.basesaveid,
        seed,
        damageBefore,
        damageAfter,
        loot: credited,
        flung: outcome.flung,
      });
      return { status: "landed", damageBefore, damageAfter };
    } catch (error) {
      if (!(error instanceof ReplayTimeoutError)) {
        logger.error("Bot {bot}'s revenge on {target} failed after it began: {error}", {
          event: "bot-revenge-failed",
          bot,
          target,
          basesaveid: save.basesaveid,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        logger.warn("Bot {bot}'s revenge on {target} ran past its deadline; the finaliser lands it", {
          event: "bot-revenge-pending",
          bot,
          target,
          basesaveid: save.basesaveid,
        });
      }
      return { status: "pending" };
    }
  } finally {
    release();
  }
};

/**
 * Whether the player is online (`revenge.ts`): seen within {@link ONLINE_SECONDS}
 * and a real game action in the last ten minutes, with no in-game check
 * pending (`services/user/online.ts`, #271). A tab left open is not online.
 */
export const seenRecently = (userid: number, now: number): Promise<boolean> =>
  isPlayerOnline(userid, now, ONLINE_SECONDS);
