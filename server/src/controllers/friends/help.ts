import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { friendRefusedErr } from "../../errors/errors.js";
import { builtEvents, recordAchievements } from "../../services/achievements/record.js";
import { storageCap } from "../../services/base/economy/resourceBudget.js";
import { isAttackActive } from "../../services/base/isAttackActive.js";
import { notifyFriend } from "../../services/friends/friendNotifications.js";
import { markHelped } from "../../services/friends/helpedMark.js";
import { friendsSince, helpsToday, readSides, recordHelp } from "../../services/friends/helpFacts.js";
import {
  gateRefusal,
  helpsLeftOf,
  isRefusal,
  planRepair,
  planSpeedup,
  refusalDetails,
  rewardOf,
  type HelpKind,
} from "../../services/friends/helpRules.js";
import { raidFighting } from "../../services/raids/raidLock.js";
import { catchUpDamage } from "../../services/yard/catchUpDamage.js";
import { creditResources } from "../../services/yard/credit.js";
import { notMainYardErr, yardRaidInProgressErr, yardUnderAttackErr } from "../../services/yard/yardErrors.js";
import type { BuildingData } from "../../types/BuildingData.js";
import type { ResourceAmounts } from "../../services/yardplanner/costs.js";
import { catchUpLockedRow } from "../yard/yardAction.js";
import { isTrap } from "../../game-rules/combat/damagePercent.js";
import { maskBuilding } from "../../services/base/viewMask.js";
import type { FriendsBody } from "./friends.js";

/**
 * `POST /bm/friends/help` `{ userid, buildingId, kind }` (`docs/design/friends.md`
 * §4 and §6.3, issue #373): one speed-up or one repair in a friend's main
 * yard, and the helper's reward, in one transaction. The wrapper beside
 * `defineYardAction`:
 *
 * 1. Parse the body (a zod 400). Helping yourself is `self`.
 * 2. Lock **both** main saves `FOR UPDATE`, lower user id first, so two helps
 *    on one yard, or two helps by one helper, run one after the other and
 *    never deadlock. The friend's yard under attack or being raided is
 *    `underAttack`; the helper's own is the yard actions' refusal.
 * 3. Catch both yards up to now, as their owners' loads would.
 * 4. The gates (`helpRules.gateRefusal`): friends, no block either way, the
 *    age and level rules, the daily cap, all read inside the locks.
 * 5. Apply the speed-up or the repair to the friend's yard, credit the reward
 *    to the helper's main yard through the storage-cap clamp, write the
 *    `friend_help` row, flush, commit.
 * 6. After the commit, a `friend` notification for the owner, and the
 *    helped mark the presence ping reads (`helpedMark.ts`, #374).
 *
 * The client names the friend, the building and the kind; the time taken
 * off, the health and the reward are worked out here from the locked saves.
 * A refusal throws before anything is written, so it is never counted.
 */

const id = z.coerce.number().int().positive();

export const HelpSchema = z.object({
  userid: id,
  buildingId: z.coerce.number().int().nonnegative(),
  kind: z.enum(["speedup", "repair"]),
});

/** `SELECT … FOR UPDATE` on one save row, refreshed into the identity map. */
const lockSave = (tx: EntityManager, basesaveid: number) =>
  tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

/** What one help did, as the route answers it. */
interface HelpDone {
  secondsSaved?: number;
  healed?: true;
  reward: ResourceAmounts;
  helpsLeft: number;
  building: BuildingData;
  helperName: string;
}

/**
 * Helps a friend once.
 *
 * @param user - The helper (`ctx.authUser`).
 * @param body - `{ userid, buildingId, kind }`.
 * @param now - Unix seconds.
 */
export const helpAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<FriendsBody> => {
  const { userid: owner, buildingId, kind } = HelpSchema.parse(body);
  const helper = user.userid;
  if (owner === helper) throw friendRefusedErr("self");

  const done = await em.transactional(async (tx): Promise<HelpDone> => {
    const sides = await readSides(tx, [helper, owner]);
    const mySide = sides.get(helper);
    const theirSide = sides.get(owner);
    if (!theirSide) throw friendRefusedErr("noSuchPlayer");
    if (!mySide?.basesaveid) throw notMainYardErr();
    // Friendship and blocks first, so a stranger learns nothing about the yard (not even an attack).
    const known = (await friendsSince(tx, helper, [owner])).get(owner) ?? null;
    const early = gateRefusal({ helper: mySide, owner: theirSide, friendsSince: known, helpsToday: 0 }, now);
    if (early?.reason === "notFriends" || early?.reason === "cannotSend") throw friendRefusedErr(early.reason);
    if (!theirSide.basesaveid) throw friendRefusedErr("nothingToHelp");

    const order = [
      [helper, mySide.basesaveid],
      [owner, theirSide.basesaveid],
    ].sort((a, b) => a[0]! - b[0]!);
    const locked = new Map<number, Save | null>();
    for (const [userid, basesaveid] of order) locked.set(userid!, await lockSave(tx, basesaveid!));
    const mine = locked.get(helper);
    const theirs = locked.get(owner);

    if (!mine || mine.type !== BaseType.MAIN || mine.userid !== helper) throw notMainYardErr();
    if (!theirs || theirs.type !== BaseType.MAIN || theirs.userid !== owner) throw friendRefusedErr("nothingToHelp");
    if (isAttackActive(theirs) || raidFighting(theirs, now)) throw friendRefusedErr("underAttack");
    if (isAttackActive(mine)) throw yardUnderAttackErr();
    if (raidFighting(mine, now)) throw yardRaidInProgressErr();

    for (const save of [mine, theirs]) {
      const completed = await catchUpLockedRow(tx, save, now);
      await recordAchievements(tx, save, now, builtEvents(completed));
    }

    const [since, today] = await Promise.all([friendsSince(tx, helper, [owner]), helpsToday(tx, helper, now)]);
    const gate = gateRefusal(
      {
        helper: { ...mySide, points: mine.points, basevalue: mine.basevalue },
        owner: { ...theirSide, points: theirs.points, basevalue: theirs.basevalue },
        friendsSince: since.get(owner) ?? null,
        helpsToday: today,
      },
      now
    );
    if (gate) throw friendRefusedErr(gate.reason, refusalDetails(gate));

    const key = String(buildingId);
    const building = theirs.buildingdata?.[key];
    // A trap is never shown to a visitor (`viewMask.ts`), so it has no help to give.
    if (!building || isTrap(Number(building.t))) throw friendRefusedErr("nothingToHelp");

    let secondsSaved = 0;
    if (kind === "speedup") {
      const plan = planSpeedup(building, helper);
      if (isRefusal(plan)) throw friendRefusedErr(plan.reason);
      theirs.buildingdata = { ...theirs.buildingdata, [key]: plan.building };
      secondsSaved = plan.seconds;
    } else {
      const plan = planRepair(theirs, key);
      if (isRefusal(plan)) throw friendRefusedErr(plan.reason);
      theirs.buildingdata = plan.buildingdata;
      theirs.buildinghealthdata = plan.buildinghealthdata;
      catchUpDamage(theirs);
    }

    const reward = creditResources(mine, rewardOf(storageCap(mine), storageCap(theirs))).credited;
    mine.savetime = now;
    theirs.savetime = now;
    await recordHelp(tx, {
      helper,
      owner,
      baseid: String(theirs.baseid),
      buildingId,
      kind: kind as HelpKind,
      secondsSaved,
      reward,
      now,
    });
    await tx.flush();

    return {
      ...(kind === "speedup" ? { secondsSaved } : { healed: true as const }),
      reward,
      helpsLeft: helpsLeftOf(today + 1),
      // Sent back for the visit's panel: masked as the visit's load was (`viewMask.ts`).
      building: maskBuilding(theirs.buildingdata![key]!, "main"),
      helperName: mySide.username,
    };
  });

  await notifyFriend(
    em,
    owner,
    kind === "speedup"
      ? { event: "helpSpeedup", userid: helper, username: done.helperName, building: Number(done.building.t), buildingId, seconds: done.secondsSaved ?? 0 }
      : { event: "helpRepair", userid: helper, username: done.helperName, building: Number(done.building.t), buildingId },
    new Date(now * 1000)
  );
  // The owner's open yard reads itself again on their next presence ping (#374).
  await markHelped(owner, now);

  const { helperName: _name, ...answer } = done;
  return { error: 0, ...answer };
};
