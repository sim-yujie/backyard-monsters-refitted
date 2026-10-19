import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";

import type { User } from "../../database/models/user.model.js";
import {
  answerFriendRequest,
  blockPlayer,
  cancelFriendRequest,
  removeFriend,
  resolvePlayer,
  sendFriendRequest,
  unblockPlayer,
} from "../../services/friends/friendships.js";
import { FRIEND_LIMITS } from "../../services/friends/friendRules.js";
import {
  allianceSuggestions,
  countIncoming,
  listBlocked,
  listFriends,
  listRequests,
  searchPlayers,
} from "../../services/friends/friendViews.js";

/**
 * The friends routes (`docs/design/friends.md` §6.2, issue #368), as
 * functions of an entity manager, the caller, what they sent and the time, so
 * they run under test; `routes.ts` binds them to Koa. Each answers the body
 * to send (`{ error: 0, ... }`) or throws: a bad body is a zod 400, a refusal
 * a 409 `friendRefusedErr` with its `reason`.
 */

export type FriendsBody = Record<string, unknown>;

const id = z.coerce.number().int().positive();

export const FriendRequestSchema = z
  .object({ userid: id.optional(), username: z.string().trim().min(1).max(64).optional() })
  .refine((body) => body.userid !== undefined || body.username !== undefined, { message: "userid or username is required" });
export const AnswerRequestSchema = z.object({ requestid: id, accept: z.boolean() });
export const CancelRequestSchema = z.object({ requestid: id });
export const PlayerSchema = z.object({ userid: id });
export const SearchSchema = z.object({ q: z.string().trim().min(3).max(64) });

/** `GET /bm/friends`: the list and the counts the bar and screen show. */
export const friendsAnswer = async (em: EntityManager, user: User, now: number): Promise<FriendsBody> => {
  const [friends, requestsIn] = await Promise.all([listFriends(em, user.userid, now), countIncoming(em, user.userid, now)]);
  return {
    error: 0,
    friends,
    max: FRIEND_LIMITS.maxFriends,
    requestsIn,
    // Gifts (WP8) and help (WP6) fill these in.
    giftsWaiting: 0,
    helpsLeft: FRIEND_LIMITS.dailyHelps,
  };
};

/** `GET /bm/friends/requests`. */
export const requestsAnswer = async (em: EntityManager, user: User, now: number): Promise<FriendsBody> => ({
  error: 0,
  ...(await listRequests(em, user.userid, now)),
});

/** `POST /bm/friends/request` `{ userid }` or `{ username }`. */
export const requestAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<FriendsBody> => {
  const target = FriendRequestSchema.parse(body);
  return { error: 0, ...(await sendFriendRequest(em, user.userid, target, now)) };
};

/** `POST /bm/friends/request/answer` `{ requestid, accept }`. */
export const answerAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<FriendsBody> => {
  const { requestid, accept } = AnswerRequestSchema.parse(body);
  return { error: 0, ...(await answerFriendRequest(em, user.userid, requestid, accept, now)) };
};

/** `POST /bm/friends/request/cancel` `{ requestid }`. */
export const cancelAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<FriendsBody> => {
  const { requestid } = CancelRequestSchema.parse(body);
  await cancelFriendRequest(em, user.userid, requestid, now);
  return { error: 0 };
};

/** `POST /bm/friends/remove` `{ userid }`. */
export const removeAnswer = async (em: EntityManager, user: User, body: unknown): Promise<FriendsBody> => {
  const { userid } = PlayerSchema.parse(body);
  await removeFriend(em, user.userid, userid);
  return { error: 0 };
};

/** `GET /bm/friends/search?q=`: up to 10 players. */
export const searchAnswer = async (em: EntityManager, user: User, query: unknown, now: number): Promise<FriendsBody> => {
  const { q } = SearchSchema.parse(query);
  return { error: 0, results: await searchPlayers(em, user.userid, q, now) };
};

/** `GET /bm/friends/suggestions`: alliance mates not yet friends. */
export const suggestionsAnswer = async (em: EntityManager, user: User, now: number): Promise<FriendsBody> => ({
  error: 0,
  results: await allianceSuggestions(em, user.userid, now),
});

/** `GET /player/blocked`. */
export const blockedAnswer = async (em: EntityManager, user: User): Promise<FriendsBody> => ({
  error: 0,
  blocked: await listBlocked(em, user.userid),
});

/** `POST /player/block` `{ userid }`. */
export const blockAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<FriendsBody> => {
  const { userid } = PlayerSchema.parse(body);
  const other = await resolvePlayer(em, { userid });
  await blockPlayer(em, user.userid, other, now);
  return { error: 0 };
};

/** `POST /player/unblock` `{ userid }`. */
export const unblockAnswer = async (em: EntityManager, user: User, body: unknown): Promise<FriendsBody> => {
  const { userid } = PlayerSchema.parse(body);
  await unblockPlayer(em, user.userid, userid);
  return { error: 0 };
};
