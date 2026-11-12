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
  markDeleted,
} from "../../services/friends/gifts.js";
import { friendsSince, readSides } from "../../services/friends/helpFacts.js";
import { MAX_GIFT_WISHES, setWishes, wishesOf } from "../../services/friends/giftWishes.js";
import { gateRefusal, refusalDetails } from "../../services/friends/helpRules.js";
import { raidFighting } from "../../services/raids/raidLock.js";
import { creditResources } from "../../services/yard/credit.js";
import { notMainYardErr, yardRaidInProgressErr, yardUnderAttackErr } from "../../services/yard/yardErrors.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { catchUpLockedRow } from "../yard/yardAction.js";
import { recordQuestEvents } from "../../services/quests/record.js";
import type { FriendsBody } from "./friends.js";

/**
 * The gift routes (`docs/design/friends.md` §3.4, §5 and §6.2, issue #375):
 *
 * - `POST /bm/friends/gift` `{ userid, resource }`: a gift to a friend,
 *   once per friend per UTC day, worth 3% of the lower of the two storage
 *   caps, fixed when sent and taken from the sender's main yard (owner,
 *   7 Nov 2026: gifts cost the sender; an uncollected gift that lapses is
 *   not given back). Refusals in order: `self`, `noSuchPlayer`,
 *   `notFriends`, `cannotSend` (so a stranger learns nothing more), `tooNew`
 *   (the help gates: 12 hours of friendship, both level 5; `rule` says
 *   which holds, `from` when the friendship's age lifts), the sender's yard
 *   under attack or being raided (as the yard actions), `notEnough`
 *   (`need`: the gift's amount), then `giftSentToday`. The answer carries
 *   the sender's `resources` after the gift left.
 * - `GET /bm/friends/gifts`: the gifts waiting, oldest first, and how many
 *   more can be collected today.
 * - `POST /bm/friends/wishes` `{ wishes: ["r1", "r3"] }`: the player's gift
 *   wishes, up to 3 (#391), best first (the order is the rank), answered as stored. `GET /bm/friends/gifts`
 *   carries them as `wishes`, and each friend in `GET /bm/friends` carries
 *   theirs.
 * - `POST /bm/friends/gifts/collect` `{ giftid }` or `{ all: true }`: credits
 *   the main yard, clamped to its storage cap, at most 10 gifts a UTC day
 *   (owner, 9 Nov 2026: was 5); the rest wait. The main yard is locked and
 *   caught up first, and refused while it is under attack or being raided, as
 *   the yard actions are.
 * - `POST /bm/friends/gifts/delete` `{ giftid }` or `{ all: true }` (owner,
 *   9 Nov 2026): the receiver throws waiting gifts away. Nothing is credited
 *   and no daily collect is used; the sender's one-a-day key still holds.
 *   One gift not waiting for the caller is `noSuchGift`.
 */

const id = z.coerce.number().int().positive();

export const GiftSchema = z.object({ userid: id, resource: z.enum(GIFT_RESOURCES) });
/** A JSON body's array arrives re-stringified (`middleware/jsonBody.ts`), so a string is parsed first. */
const parsedList = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
export const WishesSchema = z
  .object({ wishes: z.preprocess(parsedList, z.array(z.enum(GIFT_RESOURCES)).max(MAX_GIFT_WISHES)) })
  .strict()
  .refine((body) => new Set(body.wishes).size === body.wishes.length, { message: "each wish once" });
export const CollectSchema = z.union([
  z.object({ giftid: id }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
/** The same two shapes as a collect: one gift, or every one waiting. */
export const DeleteGiftsSchema = CollectSchema;

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

    // The gift comes out of the sender's main yard: lock it, refuse it as the
    // yard actions do while it is fought over, and catch it up before reading what it holds.
    const save = await lockSave(tx, mine.basesaveid);
    if (!save || save.type !== BaseType.MAIN || save.userid !== from) throw notMainYardErr();
    if (isAttackActive(save)) throw yardUnderAttackErr();
    if (raidFighting(save, now)) throw yardRaidInProgressErr();
    const completed = await catchUpLockedRow(tx, save, now);
    await recordAchievements(tx, save, now, builtEvents(completed));

    const caps = await readCaps(tx, [mine.basesaveid, theirs.basesaveid]);
    const amount = giftAmountOf(caps.get(mine.basesaveid) ?? 0, caps.get(theirs.basesaveid) ?? 0);
    const held = heldOf(save, resource);
    if (held < amount) throw friendRefusedErr("notEnough", { need: amount, have: held });

    const gift = await insertGift(tx, { from, to, resource, amount, now, expiresAt: giftExpiresAt(now) });
    if (!gift) throw friendRefusedErr("giftSentToday");
    save.resources = { ...(save.resources ?? {}), [resource]: held - amount };
    save.savetime = now;
    await tx.flush();
    return {
      gift,
      senderName: mine.username,
      senderBasesaveid: mine.basesaveid,
      receiver: theirs,
      resources: resourcesOf(save),
    };
  });

  await notifyFriend(
    em,
    to,
    { event: "gift", userid: from, username: done.senderName, giftid: done.gift.giftid, resource, amount: done.gift.amount },
    new Date(now * 1000)
  );
  // Quests: a gift sent, on the sender's main row under its own lock (logged, never thrown).
  await recordQuestEvents(em, done.senderBasesaveid, { friendGift: 1 }, now);

  // The sender's answer names the receiver, as a sent request does.
  return {
    error: 0,
    gift: { ...done.gift, userid: to, username: done.receiver.username },
    resources: done.resources,
  };
};

/** One resource as the save holds it; anything unreadable is zero. */
const heldOf = (save: Save, key: string): number => {
  const value = Number(save.resources?.[key]);
  return Number.isFinite(value) ? value : 0;
};

/** The four resources a save holds, as whole numbers. */
const resourcesOf = (save: Save) => {
  const amounts = noAmounts();
  for (const key of GIFT_RESOURCES) amounts[key] = heldOf(save, key);
  return amounts;
};

/** `GET /bm/friends/gifts`. */
export const giftsAnswer = async (em: EntityManager, user: User, now: number): Promise<FriendsBody> => {
  const [gifts, collected, wishes] = await Promise.all([
    listWaitingGifts(em, user.userid, now),
    collectedToday(em, user.userid, now),
    wishesOf(em, user.userid),
  ]);
  return { error: 0, gifts, collectsLeft: collectsLeftOf(collected), wishes };
};

/** `POST /bm/friends/wishes` `{ wishes }`: up to 3 gift resources, each once, best first; `[]` clears them. */
export const wishesAnswer = async (em: EntityManager, user: User, body: unknown): Promise<FriendsBody> => {
  const { wishes } = WishesSchema.parse(body);
  return { error: 0, wishes: await setWishes(em, user.userid, wishes) };
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

/**
 * Deletes one waiting gift, or every one waiting (owner, 9 Nov 2026). Only the
 * caller's own waiting gifts are touched: another player's gift, a collected
 * one or a lapsed one is `noSuchGift`. Gives nothing and leaves today's collects
 * as they were. Answers how many went, the collects left and the gifts still
 * waiting.
 *
 * @param user - The receiver (`ctx.authUser`).
 * @param body - `{ giftid }` or `{ all: true }`.
 * @param now - Unix seconds.
 */
export const deleteGiftsAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<FriendsBody> => {
  const which = DeleteGiftsSchema.parse(body);
  const me = user.userid;
  const giftid = "giftid" in which ? which.giftid : null;

  const deleted = await em.transactional(async (tx) => {
    const waiting = await lockWaitingGifts(tx, me, giftid, now);
    if (giftid !== null && waiting.length === 0) throw friendRefusedErr("noSuchGift");
    await markDeleted(
      tx,
      waiting.map((gift) => gift.id),
      now
    );
    return waiting.length;
  });

  const [collected, giftsWaiting] = await Promise.all([collectedToday(em, me, now), countWaitingGifts(em, me, now)]);
  return { error: 0, deleted, collectsLeft: collectsLeftOf(collected), giftsWaiting };
};
