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
import { notifyFriend, type FriendNotice } from "../../services/friends/friendNotifications.js";
import { LEGACY_HELPS_LEFT } from "../../services/friends/helpConfig.js";
import { markHelped } from "../../services/friends/helpedMark.js";
import {
  friendsSince,
  helpsToday,
  readSides,
  recordHelps,
  repairsToday,
  type HelpRecord,
  type HelpSideRow,
} from "../../services/friends/helpFacts.js";
import {
  gateRefusal,
  helpRewardOf,
  isRefusal,
  planRepair,
  planSpeedup,
  refusalDetails,
  repairDayRefusal,
  rewardsLeftOf,
  type HelpKind,
  type HelpRefusal,
} from "../../services/friends/helpRules.js";
import { raidFighting } from "../../services/raids/raidLock.js";
import { catchUpDamage } from "../../services/yard/catchUpDamage.js";
import { flingerClockOf, type FlingerClock } from "../../services/yard/derivedLevels.js";
import { logger } from "../../utils/logger.js";
import { creditResources } from "../../services/yard/credit.js";
import { notMainYardErr, yardRaidInProgressErr, yardRefusedErr } from "../../services/yard/yardErrors.js";
import type { BuildingData } from "../../types/BuildingData.js";
import type { ResourceAmounts } from "../../services/yardplanner/costs.js";
import { catchUpLockedRow } from "../yard/yardAction.js";
import { recordQuests } from "../../services/quests/state.js";
import { isTrap } from "../../game-rules/combat/damagePercent.js";
import { maskBuilding } from "../../services/base/viewMask.js";
import type { FriendsBody } from "./friends.js";
import { countAfterCommit } from "../../services/alliance/allianceProgress.js";

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
 *    `underAttack`; the helper's own under attack is `helperUnderAttack`
 *    (so the web never says "They are under attack" about the helper's own
 *    yard), being raided the yard actions' `raidInProgress`.
 * 3. Catch both yards up to now, as their owners' loads would.
 * 4. The gates (`helpRules.gateRefusal`): friends, no block either way, the
 *    age and level rules, all read inside the locks (no daily cap since
 *    15 Nov 2026; the 5 helpers a job is checked with the speed-up).
 * 5. Apply the speed-up or the repair to the friend's yard (one repair per
 *    friend's yard per UTC day, `repairedToday`; owner, 16 Nov 2026), credit the reward
 *    (the first 5 helps of the helper's UTC day only, owner 15 Nov 2026)
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

/**
 * The helper's own yard is under attack (bug report #50): its own reason, so
 * the web shows the server's words about the helper's yard, never the
 * friend's `underAttack` ("They are under attack right now").
 */
const helperUnderAttackErr = () =>
  yardRefusedErr("helperUnderAttack", "Your own yard is under attack right now. Try again when the attack is over.");

export const HelpSchema = z.object({
  userid: id,
  buildingId: z.coerce.number().int().nonnegative(),
  kind: z.enum(["speedup", "repair"]),
});

/** `SELECT … FOR UPDATE` on one save row, refreshed into the identity map. */
const lockSave = (tx: EntityManager, basesaveid: number) =>
  tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

/**
 * A help visit opened inside a transaction (steps 2 to 4 above): both main
 * saves locked, lower user id first, checked, caught up, and the gates
 * passed. One help (`helpAnswer`) and Help all (`helpAll.ts`) both open it
 * once and then give their helps on it (`giveOneHelp`).
 */
export interface HelpVisit {
  mySide: HelpSideRow;
  /** The helper's main yard, locked and caught up. */
  mine: Save;
  /** The friend's main yard, locked and caught up. */
  theirs: Save;
  /** The owner's Flinger before any help, for the sight cache. */
  ownerFlingerBefore: FlingerClock;
  /** Helps the helper had given in this UTC day before the visit (only the first few pay). */
  helpsBefore: number;
}

/**
 * Opens a help visit (steps 2 to 4 above). Every refusal about the whole
 * visit throws here, before anything is written: not friends, a block or a
 * ban, `tooNew`, either yard fought over, no main yard.
 */
export const openHelpVisit = async (tx: EntityManager, helper: number, owner: number, now: number): Promise<HelpVisit> => {
  const sides = await readSides(tx, [helper, owner]);
  const mySide = sides.get(helper);
  const theirSide = sides.get(owner);
  if (!theirSide) throw friendRefusedErr("noSuchPlayer");
  if (!mySide?.basesaveid) throw notMainYardErr();
  // Friendship and blocks first, so a stranger learns nothing about the yard (not even an attack).
  const known = (await friendsSince(tx, helper, [owner])).get(owner) ?? null;
  const early = gateRefusal({ helper: mySide, owner: theirSide, friendsSince: known }, now);
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
  if (isAttackActive(mine)) throw helperUnderAttackErr();
  if (raidFighting(mine, now)) throw yardRaidInProgressErr();

  // The owner's Flinger before the help: a speed-up or a repair can move
  // when its upgrade finishes without changing its level, which the
  // cached alliance sight was timed to (`invalidateSightIfFlingerClockChanged`).
  const ownerFlingerBefore = flingerClockOf(theirs, now);
  for (const save of [mine, theirs]) {
    const completed = await catchUpLockedRow(tx, save, now);
    await recordAchievements(tx, save, now, builtEvents(completed));
  }

  // Today's count is read inside the lock on the helper's yard, so two helps at once count in turn.
  const [since, today] = await Promise.all([friendsSince(tx, helper, [owner]), helpsToday(tx, helper, now)]);
  const gate = gateRefusal(
    {
      helper: { ...mySide, points: mine.points, basevalue: mine.basevalue },
      owner: { ...theirSide, points: theirs.points, basevalue: theirs.basevalue },
      friendsSince: since.get(owner) ?? null,
    },
    now
  );
  if (gate) throw friendRefusedErr(gate.reason, refusalDetails(gate));
  return { mySide, mine, theirs, ownerFlingerBefore, helpsBefore: today };
};

/** One help that went through on an open visit. */
export interface LandedHelp {
  buildingId: number;
  kind: HelpKind;
  /** A speed-up's seconds off; 0 for a repair. */
  secondsSaved: number;
  /** What the helper was credited, after the storage-cap clamp. */
  reward: ResourceAmounts;
  /** The friend's building after this help, masked as the visit's load was (`viewMask.ts`). */
  building: BuildingData;
}

/**
 * Gives one help on an open visit (step 5 above): the speed-up or the repair
 * on the friend's yard, the reward (the first 5 helps of the helper's UTC day
 * only) on the helper's, and the quest count. Changes the two locked saves
 * in memory only; the caller writes the `friend_help` rows and flushes. A
 * refusal about this building (`nothingToHelp`, `alreadyHelped`,
 * `helpersFull`, `repairedToday`) is returned, with nothing changed.
 *
 * @param helpsBefore - Helps the helper has given today before this one.
 * @param repairsHere - The helper's repairs in this yard today before this one; asked only for a repair.
 */
export const giveOneHelp = async (
  visit: HelpVisit,
  helper: number,
  buildingId: number,
  kind: HelpKind,
  helpsBefore: number,
  repairsHere: () => Promise<number>,
  now: number
): Promise<LandedHelp | HelpRefusal> => {
  const { mine, theirs } = visit;
  const key = String(buildingId);
  const building = theirs.buildingdata?.[key];
  // A trap is never shown to a visitor (`viewMask.ts`), so it has no help to give.
  if (!building || isTrap(Number(building.t))) return { reason: "nothingToHelp" };

  let secondsSaved = 0;
  if (kind === "speedup") {
    const plan = planSpeedup(building, helper);
    if (isRefusal(plan)) return plan;
    theirs.buildingdata = { ...theirs.buildingdata, [key]: plan.building };
    secondsSaved = plan.seconds;
  } else {
    const plan = planRepair(theirs, key);
    if (isRefusal(plan)) return plan;
    // One repair a friend's yard a UTC day (owner, 16 Nov 2026), read inside the lock on the helper's yard.
    const repairDay = repairDayRefusal(await repairsHere());
    if (repairDay) return repairDay;
    theirs.buildingdata = plan.buildingdata;
    theirs.buildinghealthdata = plan.buildinghealthdata;
    catchUpDamage(theirs);
  }

  const reward = creditResources(mine, helpRewardOf(helpsBefore, storageCap(mine), storageCap(theirs))).credited;
  mine.savetime = now;
  theirs.savetime = now;
  // Quests: a friend's yard helped, on the helper's locked main row.
  recordQuests(mine, now, { friendHelp: 1 });
  return { buildingId, kind, secondsSaved, reward, building: maskBuilding(theirs.buildingdata![key]!, "main") };
};

/** The `friend_help` row of a help that went through. */
export const helpRecordOf = (visit: HelpVisit, helper: number, owner: number, landed: LandedHelp, now: number): HelpRecord => ({
  helper,
  owner,
  baseid: String(visit.theirs.baseid),
  buildingId: landed.buildingId,
  kind: landed.kind,
  secondsSaved: landed.secondsSaved,
  reward: landed.reward,
  now,
});

/** The owner's bell line for a help that went through. */
export const helpNoticeOf = (helper: number, helperName: string, landed: LandedHelp): FriendNotice =>
  landed.kind === "speedup"
    ? {
        event: "helpSpeedup",
        userid: helper,
        username: helperName,
        building: Number(landed.building.t),
        buildingId: landed.buildingId,
        seconds: landed.secondsSaved,
      }
    : { event: "helpRepair", userid: helper, username: helperName, building: Number(landed.building.t), buildingId: landed.buildingId };

/** What one help did, as the route answers it. */
interface HelpDone {
  landed: LandedHelp;
  /** Helps today that still pay a reward, after this one. */
  rewardsLeft: number;
  helperName: string;
  /** The owner's Flinger before and after, for the sight cache; not sent. */
  ownerFlingerBefore: FlingerClock;
  ownerFlingerAfter: FlingerClock;
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

  const done = await countAfterCommit(() => em.transactional(async (tx): Promise<HelpDone> => {
    const visit = await openHelpVisit(tx, helper, owner, now);
    const repairsHere = async () => (await repairsToday(tx, helper, [owner], now)).get(owner) ?? 0;
    const landed = await giveOneHelp(visit, helper, buildingId, kind, visit.helpsBefore, repairsHere, now);
    if (isRefusal(landed)) throw friendRefusedErr(landed.reason);
    await recordHelps(tx, [helpRecordOf(visit, helper, owner, landed, now)]);
    await tx.flush();
    return {
      landed,
      rewardsLeft: rewardsLeftOf(visit.helpsBefore + 1),
      helperName: visit.mySide.username,
      ownerFlingerBefore: visit.ownerFlingerBefore,
      ownerFlingerAfter: flingerClockOf(visit.theirs, now),
    };
  }));

  await dropOwnerSight(owner, done.ownerFlingerBefore, done.ownerFlingerAfter);
  await notifyFriend(em, owner, helpNoticeOf(helper, done.helperName, done.landed), new Date(now * 1000));
  // The owner's open yard reads itself again on their next presence ping (#374).
  await markHelped(owner, now);

  const { landed } = done;
  return {
    error: 0,
    ...(kind === "speedup" ? { secondsSaved: landed.secondsSaved } : { healed: true as const }),
    reward: landed.reward,
    rewardsLeft: done.rewardsLeft,
    // Kept only for pre-7.6 clients: always `LEGACY_HELPS_LEFT`, so an old tab never locks its help buttons.
    helpsLeft: LEGACY_HELPS_LEFT,
    // Sent back for the visit's panel: masked as the visit's load was (`viewMask.ts`).
    building: landed.building,
  };
};

/**
 * Drops the helped owner's cached Map Room 2 sight (own and alliance) when
 * the help moved their Flinger's level or finish (`sightService.ts`). After
 * the commit; never throws, since the help already stands, and a cache left
 * in place still runs out by itself. Imported on use, as `plannerYard.ts`
 * does, to stay off `sightService.ts`'s import chain.
 */
export const dropOwnerSight = async (owner: number, before: FlingerClock, after: FlingerClock): Promise<void> => {
  try {
    const sightService = await import("../../services/maproom/sight/sightService.js");
    await sightService.invalidateSightIfFlingerClockChanged(owner, before, after);
  } catch (error) {
    logger.warn("Sight of {userid} not dropped after a friend's help", { userid: owner, error });
  }
};
