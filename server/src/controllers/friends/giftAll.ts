import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";

import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { builtEvents, recordAchievements } from "../../services/achievements/record.js";
import { countAfterCommit } from "../../services/alliance/allianceProgress.js";
import { isAttackActive } from "../../services/base/isAttackActive.js";
import { isBot } from "../../services/bots/isBot.js";
import { notifyFriend } from "../../services/friends/friendNotifications.js";
import { FRIEND_LIMITS } from "../../services/friends/friendRules.js";
import {
  mostHeld,
  planGiftAll,
  type GiftAllCandidate,
  type GiftAmounts,
  type PlannedGift,
  type SkippedGift,
} from "../../services/friends/giftAll.js";
import { GIFT_RESOURCES, giftAmountOf, giftExpiresAt, type GiftResource } from "../../services/friends/giftRules.js";
import { giftedToday, insertGift } from "../../services/friends/gifts.js";
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
 *   send now, for the confirm step. Writes nothing but the yard's catch-up.
 * - `POST /bm/friends/gifts/all` `{ fallback?, userids? }`: sends it, in one
 *   transaction under the sender's main-yard lock, so two presses cannot
 *   send twice or spend the same Goo twice. `userids` (the friends the
 *   player confirmed) limits it to them, so it never sends to more than the
 *   confirm step showed.
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
 * The answer: `fallback`, `gifts` (`{ userid, username, resource, amount,
 * wish }`, plus `giftid` once sent), `skipped` (`{ userid, username, reason,
 * lacking, amount }`), `cost` per resource and the sender's `resources`
 * (after the gifts left, when sent). Refused as the single gift is while the
 * yard is fought over or is not the player's main yard.
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
}

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

  const done = await countAfterCommit(() =>
    em.transactional(async (tx): Promise<GiftAllResult & { senderName: string; senderBasesaveid: number }> => {
      const mine = (await readSides(tx, [from])).get(from);
      if (!mine?.basesaveid) throw notMainYardErr();

      // The sender's main yard: locked, refused while fought over, caught up before reading what it holds.
      const save = await lockSave(tx, mine.basesaveid);
      if (!save || save.type !== BaseType.MAIN || save.userid !== from) throw notMainYardErr();
      if (isAttackActive(save)) throw yardUnderAttackErr();
      if (raidFighting(save, now)) throw yardRaidInProgressErr();
      const completed = await catchUpLockedRow(tx, save, now);
      await recordAchievements(tx, save, now, builtEvents(completed));

      const held = resourcesOf(save) as GiftAmounts;
      const fallback = picked ?? mostHeld(held);
      const candidates = await giftableFriends(tx, from, mine, mine.basesaveid, only, now);
      const plan = planGiftAll(candidates, held, fallback);
      const base = { senderName: mine.username, senderBasesaveid: mine.basesaveid, fallback };
      if (!send) return { ...base, ...plan, resources: held };

      // Each gift as one sent alone; one that loses a race to another send today is skipped, not paid for.
      const gifts: GiftAllResult["gifts"] = [];
      const skipped = [...plan.skipped];
      const cost: GiftAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
      for (const gift of plan.gifts) {
        const sent = await insertGift(tx, {
          from,
          to: gift.userid,
          resource: gift.resource,
          amount: gift.amount,
          now,
          expiresAt: giftExpiresAt(now),
        });
        if (!sent) {
          skipped.push({ userid: gift.userid, username: gift.username, reason: "giftSentToday", lacking: [], amount: gift.amount });
          continue;
        }
        gifts.push({ ...gift, giftid: sent.giftid });
        cost[gift.resource] += gift.amount;
      }
      const left = { ...held };
      for (const key of GIFT_RESOURCES) left[key] -= cost[key];
      if (gifts.length > 0) {
        save.resources = { ...(save.resources ?? {}), ...left };
        save.savetime = now;
      }
      await tx.flush();
      return { ...base, gifts, skipped, cost, resources: left };
    })
  );

  const { senderName, senderBasesaveid, ...result } = done;
  if (send) {
    for (const gift of result.gifts) {
      await notifyFriend(
        em,
        gift.userid,
        { event: "gift", userid: from, username: senderName, giftid: gift.giftid, resource: gift.resource, amount: gift.amount },
        new Date(now * 1000)
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
  }
  return { error: 0, ...result };
};

/**
 * The sender's friends who can take a gift from them today, in planning
 * order, each with what a gift to them is worth. The gate is the single
 * gift's (`sendGiftAnswer`), friend by friend.
 */
const giftableFriends = async (
  tx: EntityManager,
  from: number,
  mine: HelpSideRow,
  senderBasesaveid: number,
  only: ReadonlySet<number> | null,
  now: number
): Promise<GiftAllCandidate[]> => {
  if (await isBot(from, tx)) return [];
  const friends = (await readFriends(tx, from)).filter((friend) => !only || only.has(friend.userid));
  if (friends.length === 0) return [];
  const ids = friends.map((friend) => friend.userid);
  const [sides, since, gifted] = await Promise.all([
    readSides(tx, ids),
    friendsSince(tx, from, ids),
    giftedToday(tx, from, ids, now),
  ]);

  const open: { friend: FriendRow; basesaveid: number }[] = [];
  for (const friend of friends) {
    const theirs = sides.get(friend.userid);
    const friendedAt = since.get(friend.userid) ?? null;
    if (!theirs?.basesaveid || friendedAt === null || gifted.has(friend.userid)) continue;
    if (gateRefusal({ helper: mine, owner: theirs, friendsSince: friendedAt, helpsToday: 0 }, now)) continue;
    if (await isBot(friend.userid, tx)) continue;
    open.push({ friend, basesaveid: theirs.basesaveid });
  }
  if (open.length === 0) return [];

  const caps = await readCaps(tx, [senderBasesaveid, ...open.map((entry) => entry.basesaveid)]);
  const senderCap = caps.get(senderBasesaveid) ?? 0;
  return open.map(({ friend, basesaveid }) => ({
    userid: friend.userid,
    username: friend.username,
    wishes: friend.wishes,
    amount: giftAmountOf(senderCap, caps.get(basesaveid) ?? 0),
  }));
};
