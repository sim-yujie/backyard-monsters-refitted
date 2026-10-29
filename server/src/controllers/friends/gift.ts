import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { friendRefusedErr } from "../../errors/errors.js";
import { builtEvents, recordAchievements } from "../../services/achievements/record.js";
import { addAmounts, noAmounts, storageCap, type StorageCapSave } from "../../services/base/economy/resourceBudget.js";
import { isAttackActive } from "../../services/base/isAttackActive.js";
import { isBot } from "../../services/bots/isBot.js";
import { notifyFriend } from "../../services/friends/friendNotifications.js";
import { placeholders } from "../../services/friends/friendViews.js";
import { collectsLeftOf, GIFT_RESOURCES, giftAmountOf, giftExpiresAt } from "../../services/friends/giftRules.js";
import {
  collectedToday,
  countWaitingGifts,
  insertGift,
  listWaitingGifts,
  lockWaitingGifts,
  markCollected,
} from "../../services/friends/gifts.js";
import { friendsSince, readSides } from "../../services/friends/helpFacts.js";
import { gateRefusal, refusalDetails } from "../../services/friends/helpRules.js";
import { raidFighting } from "../../services/raids/raidLock.js";
import { creditResources } from "../../services/yard/credit.js";
import { notMainYardErr, yardRaidInProgressErr, yardUnderAttackErr } from "../../services/yard/yardErrors.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { catchUpLockedRow } from "../yard/yardAction.js";
import type { FriendsBody } from "./friends.js";

/**
 * The gift routes (`docs/design/friends.md` §3.4, §5 and §6.2, issue #375):
 *
 * - `POST /bm/friends/gift` `{ userid, resource }`: a free gift to a friend,
 *   once per friend per UTC day, worth 3% of the lower of the two storage
 *   caps, fixed when sent. Refusals in order: `self`, `noSuchPlayer`,
 *   `notFriends`, `cannotSend` (so a stranger learns nothing more), `tooNew`
 *   (the help gates: 12 hours of friendship, both level 5; `rule` says
 *   which holds, `from` when the friendship's age lifts), then `giftSentToday`. Nothing is taken from the sender.
 * - `GET /bm/friends/gifts`: the gifts waiting, oldest first, and how many
 *   more can be collected today.
 * - `POST /bm/friends/gifts/collect` `{ giftid }` or `{ all: true }`: credits
 *   the main yard, clamped to its storage cap, at most 5 gifts a UTC day; the
 *   rest wait. The main yard is locked and caught up first, and refused while
 *   it is under attack or being raided, as the yard actions are.
 */

const id = z.coerce.number().int().positive();

export const GiftSchema = z.object({ userid: id, resource: z.enum(GIFT_RESOURCES) });
export const CollectSchema = z.union([
  z.object({ giftid: id }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

/** The storage-cap slice of each main save, by save id. */
const readCaps = async (em: EntityManager, basesaveids: readonly number[]): Promise<Map<number, number>> => {
  const rows = await em.execute<
    { basesaveid: number | string; buildingdata: BuildingDataMap | null; storedata: JsonObject | null; outposts: unknown[] | null }[]
  >(
    `SELECT basesaveid, buildingdata, storedata, outposts FROM bym.save WHERE basesaveid IN (${placeholders(basesaveids)})`,
    [...basesaveids]
  );
  return new Map(rows.map((row) => [Number(row.basesaveid), storageCap(row as StorageCapSave)]));
};

/**
 * Sends a friend a gift.
 *
 * @param user - The sender (`ctx.authUser`).
 * @param body - `{ userid, resource }`.
 * @param now - Unix seconds.
 */
export const sendGiftAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<FriendsBody> => {
  const { userid: to, resource } = GiftSchema.parse(body);
  const from = user.userid;
  if (to === from) throw friendRefusedErr("self");

  const done = await em.transactional(async (tx) => {
    const sides = await readSides(tx, [from, to]);
    const mine = sides.get(from);
    const theirs = sides.get(to);
    if (!theirs) throw friendRefusedErr("noSuchPlayer");
    if (!mine?.basesaveid) throw notMainYardErr();

    const since = (await friendsSince(tx, from, [to])).get(to) ?? null;
    // Accounts that cannot be friended never take or give gifts; the answer is a non-friend's.
    if (since === null || (await isBot(to, tx)) || (await isBot(from, tx))) throw friendRefusedErr("notFriends");
    const gate = gateRefusal({ helper: mine, owner: theirs, friendsSince: since, helpsToday: 0 }, now);
    if (gate) throw friendRefusedErr(gate.reason, refusalDetails(gate));
    if (!theirs.basesaveid) throw friendRefusedErr("cannotSend");

    const caps = await readCaps(tx, [mine.basesaveid, theirs.basesaveid]);
    const amount = giftAmountOf(caps.get(mine.basesaveid) ?? 0, caps.get(theirs.basesaveid) ?? 0);
    const gift = await insertGift(tx, { from, to, resource, amount, now, expiresAt: giftExpiresAt(now) });
    if (!gift) throw friendRefusedErr("giftSentToday");
    return { gift, senderName: mine.username, receiver: theirs };
  });

  await notifyFriend(
    em,
    to,
    { event: "gift", userid: from, username: done.senderName, giftid: done.gift.giftid, resource, amount: done.gift.amount },
    new Date(now * 1000)
  );

  // The sender's answer names the receiver, as a sent request does.
  return { error: 0, gift: { ...done.gift, userid: to, username: done.receiver.username } };
};

/** `GET /bm/friends/gifts`. */
export const giftsAnswer = async (em: EntityManager, user: User, now: number): Promise<FriendsBody> => {
  const [gifts, collected] = await Promise.all([
    listWaitingGifts(em, user.userid, now),
    collectedToday(em, user.userid, now),
  ]);
  return { error: 0, gifts, collectsLeft: collectsLeftOf(collected) };
};

/** `SELECT … FOR UPDATE` on one save row, refreshed into the identity map. */
const lockSave = (tx: EntityManager, basesaveid: number) =>
  tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

/**
 * Collects one waiting gift, or as many as today's limit allows, oldest
 * first. Answers how many were collected, what landed in the main yard after
 * the storage cap (`resources`), the collects left today and the gifts still
 * waiting. `{ all: true }` with nothing waiting collects nothing; one gift no
 * longer waiting is `noSuchGift`.
 *
 * @param user - The receiver (`ctx.authUser`).
 * @param body - `{ giftid }` or `{ all: true }`.
 * @param now - Unix seconds.
 */
export const collectGiftsAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<FriendsBody> => {
  const which = CollectSchema.parse(body);
  const me = user.userid;
  const giftid = "giftid" in which ? which.giftid : null;

  const done = await em.transactional(async (tx) => {
    const [side] = (await readSides(tx, [me])).values();
    if (!side?.basesaveid) throw notMainYardErr();
    const save = await lockSave(tx, side.basesaveid);
    if (!save || save.type !== BaseType.MAIN || save.userid !== me) throw notMainYardErr();
    if (isAttackActive(save)) throw yardUnderAttackErr();
    if (raidFighting(save, now)) throw yardRaidInProgressErr();

    const waiting = await lockWaitingGifts(tx, me, giftid, now);
    if (giftid !== null && waiting.length === 0) throw friendRefusedErr("noSuchGift");
    const left = collectsLeftOf(await collectedToday(tx, me, now));
    if (waiting.length > 0 && left === 0) throw friendRefusedErr("collectLimit");
    const taking = waiting.slice(0, left);

    const completed = await catchUpLockedRow(tx, save, now);
    await recordAchievements(tx, save, now, builtEvents(completed));

    const total = noAmounts();
    for (const gift of taking) addAmounts(total, { ...noAmounts(), [gift.resource]: gift.amount });
    const credited = creditResources(save, total).credited;
    save.savetime = now;
    await markCollected(
      tx,
      taking.map((gift) => gift.id),
      now
    );
    await tx.flush();
    return { collected: taking.length, resources: credited, collectsLeft: left - taking.length };
  });

  return { error: 0, ...done, giftsWaiting: await countWaitingGifts(em, me, now) };
};
