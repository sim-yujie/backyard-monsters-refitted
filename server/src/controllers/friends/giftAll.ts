import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { builtEvents, recordAchievements } from "../../services/achievements/record.js";
import { countAfterCommit } from "../../services/alliance/allianceProgress.js";
import { isAttackActive } from "../../services/base/isAttackActive.js";
import { botsAmong } from "../../services/bots/isBot.js";
import { notifyFriend } from "../../services/friends/friendNotifications.js";
import { FRIEND_LIMITS } from "../../services/friends/friendRules.js";
import {
  mostHeld,
  noGiftAmounts,
  planGiftAll,
  type GiftAllCandidate,
  type GiftAmounts,
  type PlannedGift,
  type SkippedGift,
} from "../../services/friends/giftAll.js";
import { GIFT_RESOURCES, giftAmountOf, giftExpiresAt, type GiftResource } from "../../services/friends/giftRules.js";
import { giftedToday, insertGifts } from "../../services/friends/gifts.js";
import { readWishes } from "../../services/friends/giftWishes.js";
import { friendsSince, readSides, type HelpSideRow } from "../../services/friends/helpFacts.js";
import { gateRefusal } from "../../services/friends/helpRules.js";
import { recordQuestEvents } from "../../services/quests/record.js";
import { raidFighting } from "../../services/raids/raidLock.js";
import { notMainYardErr, yardRaidInProgressErr, yardUnderAttackErr } from "../../services/yard/yardErrors.js";
import { logger } from "../../utils/logger.js";
import { catchUpLockedRow } from "../yard/yardAction.js";
import type { FriendsBody } from "./friends.js";
import { lockSave, parsedList, readCaps, resourcesOf } from "./gift.js";

/**
 * "Gift all" (owner, 13 Nov 2026): one gift to every friend who can take one
 * from the player today, in one go. Two routes, both answered the same way:
 *
 * - `POST /bm/friends/gifts/all/plan` `{ fallback? }`: what Gift all would
 *   send now, for the confirm step. It only reads: no lock, no yard catch-up,
 *   nothing written (the yard as last saved, as `GET /bm/friends/gift/cost`).
 * - `POST /bm/friends/gifts/all` `{ fallback?, userids? }`: sends it, in one
 *   transaction under the sender's main-yard lock, so two presses cannot
 *   send twice or spend the same Goo twice. The yard is caught up first and
 *   the plan made again there, so the answer is what really went. `userids`
 *   (the friends the player confirmed) limits it to them, so it never sends
 *   to more than the confirm step showed.
 *
 * Who can take a gift is the single gift's gate, unchanged (`gift.ts`):
 * friends, neither a bot, no block either way, neither banned, both level 5
 * and friends for 12 hours, a main yard each, and no gift from the player
 * to them yet today. Each gift is worth what it would be alone (3% of the
 * lower storage cap) and uses the same one-a-day key. Which resource each
 * friend gets, and who is skipped when the store runs short, is
 * `services/friends/giftAll.ts`. `fallback` is the resource for friends with
 * no wish; left out, the one the player holds most of.
 *
 * The answer: `fallback`, `noWish` (how many of the friends have no wish),
 * `gifts` (`{ userid, username, resource, amount, wish }`, plus `giftid`
 * once sent), `skipped` (`{ userid, username, reason, lacking, amount }`),
 * `cost` per resource and the sender's `resources` (after the gifts left,
 * when sent). Refused as the single gift is while the yard is fought over
 * or is not the player's main yard. A player in `userids` who cannot take
 * a gift any more is listed in `skipped`: `giftSentToday` (one went since),
 * or `cannotSend` (no longer a friend, blocked, banned; `username` is empty
 * for one who is no longer a friend).
 *
 * The cost to the server is the same for 1 friend or 100: a fixed number of
 * queries (friends, their gates, today's gifts, the bot rows, the storage
 * caps) and, sending, one insert for all the gifts.
 */

const id = z.coerce.number().int().positive();

export const GiftAllSchema = z
  .object({
    fallback: z.enum(GIFT_RESOURCES).optional(),
    userids: z.preprocess(parsedList, z.array(id).max(FRIEND_LIMITS.maxFriends * 2)).optional(),
  })
  .strict();

/** A friend of the sender as Gift all reads them, in planning order: pinned first, then by name. */
interface FriendRow {
  userid: number;
  username: string;
  wishes: GiftResource[];
}

const readFriends = async (em: EntityManager, userid: number): Promise<FriendRow[]> => {
  const rows = await em.execute<{ userid: number | string; username: string; gift_wishes: string | null }[]>(
    `SELECT u.userid, u.username, u.gift_wishes
       FROM bym.friend f JOIN bym."user" u ON u.userid = f.friend_userid
      WHERE f.userid = ?
      ORDER BY f.pinned_at NULLS LAST, lower(u.username), u.userid`,
    [userid]
  );
  return rows.map((row) => ({ userid: Number(row.userid), username: row.username, wishes: readWishes(row.gift_wishes) }));
};

interface GiftAllResult {
  fallback: GiftResource;
  gifts: (PlannedGift & { giftid?: number })[];
  skipped: SkippedGift[];
  cost: GiftAmounts;
  resources: GiftAmounts;
  /** How many of the friends who can take a gift have no wish: the ones `fallback` is for. */
  noWish: number;
}

/** Refuses as the single gift does: not the player's main yard, or the yard is fought over. */
const checkYard = (save: Save | null, from: number, now: number): Save => {
  if (!save || save.type !== BaseType.MAIN || save.userid !== from) throw notMainYardErr();
  if (isAttackActive(save)) throw yardUnderAttackErr();
  if (raidFighting(save, now)) throw yardRaidInProgressErr();
  return save;
};

/** The plan for what `save` holds now: who gets what, who is left out and why. */
const planFor = async (
  em: EntityManager,
  mine: HelpSideRow,
  save: Save,
  picked: GiftResource | undefined,
  only: ReadonlySet<number> | null,
  now: number
): Promise<GiftAllResult> => {
  const held = resourcesOf(save) as GiftAmounts;
  const fallback = picked ?? mostHeld(held);
  const { candidates, left } = await giftableFriends(em, mine, save.basesaveid, only, now);
  const planned = planGiftAll(candidates, held, fallback);
  return {
    fallback,
    gifts: planned.gifts,
    // A confirmed friend who cannot take a gift any more is said, not silently dropped.
    skipped: [...planned.skipped, ...left],
    cost: planned.cost,
    resources: held,
    noWish: candidates.filter((friend) => friend.wishes.length === 0).length,
  };
};

/** How many friends are told at once after the send (each telling is its own short write). */
const NOTICES_AT_ONCE = 5;

/**
 * Plans Gift all and, when `send`, sends it.
 *
 * @param user - The sender (`ctx.authUser`).
 * @param body - `{ fallback?, userids? }`.
 * @param now - Unix seconds.
 * @param send - False for the confirm step's plan.
 */
export const giftAllAnswer = async (
  em: EntityManager,
  user: User,
  body: unknown,
  now: number,
  send: boolean
): Promise<FriendsBody> => {
  const { fallback: picked, userids } = GiftAllSchema.parse(body ?? {});
  const from = user.userid;
  const only = userids ? new Set(userids) : null;

  if (!send) {
    // The plan only reads, on a manager of its own: no lock, no catch-up, nothing to flush.
    const read = em.fork();
    const mine = (await readSides(read, [from])).get(from);
    if (!mine?.basesaveid) throw notMainYardErr();
    const save = checkYard(await read.findOne(Save, { basesaveid: mine.basesaveid }), from, now);
    return { error: 0, ...(await planFor(read, mine, save, picked, only, now)) };
  }

  const done = await countAfterCommit(() =>
    em.transactional(async (tx): Promise<GiftAllResult & { senderName: string; senderBasesaveid: number }> => {
      const mine = (await readSides(tx, [from])).get(from);
      if (!mine?.basesaveid) throw notMainYardErr();

      // The sender's main yard: locked, refused while fought over, caught up before reading what it holds.
      const save = checkYard(await lockSave(tx, mine.basesaveid), from, now);
      const completed = await catchUpLockedRow(tx, save, now);
      await recordAchievements(tx, save, now, builtEvents(completed));

      const plan = await planFor(tx, mine, save, picked, only, now);
      const base = { senderName: mine.username, senderBasesaveid: mine.basesaveid, fallback: plan.fallback, noWish: plan.noWish };

      // Each gift as one sent alone, written together; one that loses a race to another send today is skipped, not paid for.
      const written = await insertGifts(
        tx,
        from,
        plan.gifts.map((gift) => ({ to: gift.userid, resource: gift.resource, amount: gift.amount })),
        now,
        giftExpiresAt(now)
      );
      const gifts: GiftAllResult["gifts"] = [];
      const skipped = [...plan.skipped];
      const cost = noGiftAmounts();
      for (const gift of plan.gifts) {
        const sent = written.get(gift.userid);
        if (!sent) {
          skipped.push({ userid: gift.userid, username: gift.username, reason: "giftSentToday", lacking: [], amount: gift.amount });
          continue;
        }
        gifts.push({ ...gift, giftid: sent.giftid });
        cost[gift.resource] += gift.amount;
      }
      const left = { ...plan.resources };
      // Only what a gift was taken from is written, as the single gift writes its one resource.
      const spent: Partial<GiftAmounts> = {};
      for (const key of GIFT_RESOURCES) {
        if (cost[key] <= 0) continue;
        left[key] -= cost[key];
        spent[key] = left[key];
      }
      if (gifts.length > 0) {
        save.resources = { ...(save.resources ?? {}), ...spent };
        save.savetime = now;
      }
      await tx.flush();
      return { ...base, gifts, skipped, cost, resources: left };
    })
  );

  const { senderName, senderBasesaveid, ...result } = done;
  const when = new Date(now * 1000);
  for (let at = 0; at < result.gifts.length; at += NOTICES_AT_ONCE) {
    await Promise.all(
      result.gifts
        .slice(at, at + NOTICES_AT_ONCE)
        .map((gift) =>
          notifyFriend(
            em,
            gift.userid,
            { event: "gift", userid: from, username: senderName, giftid: gift.giftid, resource: gift.resource, amount: gift.amount },
            when
          )
        )
    );
  }
  // Quests: each gift counts, as when sent one at a time (logged, never thrown).
  if (result.gifts.length > 0) await recordQuestEvents(em, senderBasesaveid, { friendGift: result.gifts.length }, now);
  const spent = GIFT_RESOURCES.filter((key) => result.cost[key] > 0)
    .map((key) => `${key}=${result.cost[key]}`)
    .join(" ");
  logger.info(
    `Gift all by ${from}: sent ${result.gifts.length}, skipped ${result.skipped.length}` +
      `${spent ? ` (${spent})` : ""}, fallback ${result.fallback}`
  );
  return { error: 0, ...result };
};

/**
 * The sender's friends who can take a gift from them today, in planning
 * order, each with what a gift to them is worth. The gate is the single
 * gift's (`sendGiftAnswer`), friend by friend, read for all of them at once.
 * With a confirmed list (`only`), `left` names each confirmed player who
 * cannot take one: gifted today since, or no longer open to a gift.
 */
const giftableFriends = async (
  tx: EntityManager,
  mine: HelpSideRow,
  senderBasesaveid: number,
  only: ReadonlySet<number> | null,
  now: number
): Promise<{ candidates: GiftAllCandidate[]; left: SkippedGift[] }> => {
  const from = mine.userid;
  const friends = (await readFriends(tx, from)).filter((friend) => !only || only.has(friend.userid));
  const ids = friends.map((friend) => friend.userid);
  const [sides, since, gifted, bots] = await Promise.all([
    readSides(tx, ids),
    friendsSince(tx, from, ids),
    giftedToday(tx, from, ids, now),
    botsAmong([from, ...ids], tx),
  ]);

  const open: { friend: FriendRow; basesaveid: number }[] = [];
  const left: SkippedGift[] = [];
  const leave = (userid: number, username: string, reason: SkippedGift["reason"]) => {
    // Only a confirmed list reports who dropped out; the plan just leaves them out.
    if (only) left.push({ userid, username, reason, lacking: [], amount: 0 });
  };
  for (const friend of friends) {
    const theirs = sides.get(friend.userid);
    const friendedAt = since.get(friend.userid) ?? null;
    if (gifted.has(friend.userid)) leave(friend.userid, friend.username, "giftSentToday");
    else if (
      !theirs?.basesaveid ||
      friendedAt === null ||
      bots.has(from) ||
      bots.has(friend.userid) ||
      gateRefusal({ helper: mine, owner: theirs, friendsSince: friendedAt, helpsToday: 0 }, now)
    ) {
      leave(friend.userid, friend.username, "cannotSend");
    } else open.push({ friend, basesaveid: theirs.basesaveid });
  }
  // Confirmed, and not a friend any more: the client still has their name from the plan.
  const listed = new Set(ids);
  for (const userid of only ?? []) if (!listed.has(userid)) leave(userid, "", "cannotSend");
  if (open.length === 0) return { candidates: [], left };

  const caps = await readCaps(tx, [senderBasesaveid, ...open.map((entry) => entry.basesaveid)]);
  const senderCap = caps.get(senderBasesaveid) ?? 0;
  const candidates = open.map(({ friend, basesaveid }) => ({
    userid: friend.userid,
    username: friend.username,
    wishes: friend.wishes,
    amount: giftAmountOf(senderCap, caps.get(basesaveid) ?? 0),
  }));
  return { candidates, left };
};
