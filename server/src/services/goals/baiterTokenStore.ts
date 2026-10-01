import { redis } from "../../server.js";
import { BAITER_TOKEN_SECONDS, type BaiterTicket, type BaiterTokenStore } from "./baiterRun.js";

/**
 * The Baiter run tokens in Redis (`baiterRun.ts`): one key per player, which
 * lapses after {@link BAITER_TOKEN_SECONDS}. A take reads the key and deletes
 * it, and only the request whose delete removed it gets the ticket, so two
 * spends of one token racing each other count once.
 */

const keyOf = (userid: number) => `goals:baiter-run:${userid}`;

const parse = (raw: string | null): BaiterTicket | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BaiterTicket>;
    return typeof value.token === "string" && typeof value.at === "number"
      ? { token: value.token, at: value.at }
      : null;
  } catch {
    return null;
  }
};

export const redisBaiterTokens: BaiterTokenStore = {
  async issue(userid, ticket) {
    await redis.setex(keyOf(userid), BAITER_TOKEN_SECONDS, JSON.stringify(ticket));
  },
  async take(userid) {
    const raw = await redis.get(keyOf(userid));
    if (!raw) return null;
    const removed = await redis.del(keyOf(userid));
    return removed > 0 ? parse(raw) : null;
  },
};
