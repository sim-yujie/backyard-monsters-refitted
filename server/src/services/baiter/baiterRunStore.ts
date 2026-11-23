import { gunzipSync, gzipSync } from "node:zlib";

import { redis } from "../../server.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { RUN_TICKET_SECONDS } from "./baiterTestRules.js";

/**
 * A started friend test (beta 9 feature #4): the one-use ticket the tester
 * gets when they press Start, kept on the server with the yard they were
 * served, its seed and the army cap. The finished test spends it; the server
 * fights the battle on THIS yard, so a yard changed since cannot make the
 * replay disagree with what the tester saw.
 *
 * One per tester: starting another test replaces the earlier ticket.
 */

/** One started test. */
export interface RunTicket {
  readonly token: string;
  readonly inviter: number;
  readonly seed: number;
  readonly cap: number;
  /** The inviter's Baiter level when the test started. */
  readonly baiterLevel: number;
  /** Unix seconds it started. */
  readonly at: number;
  /** The yard as served. */
  readonly load: JsonObject;
}

/** Where tickets are kept; injectable so tests need no Redis. */
export interface RunTicketStore {
  issue(tester: number, ticket: RunTicket): Promise<void>;
  /** Takes the tester's ticket out, so it is spent once; null when there is none. */
  take(tester: number): Promise<RunTicket | null>;
}

export const baiterRunKey = (userid: number): string => `baiter-test-run:${userid}`;

interface StoredTicket extends Omit<RunTicket, "load"> {
  readonly load: string;
}

/** Tickets in Redis, gzipped, for {@link RUN_TICKET_SECONDS}. */
export const redisRunTickets: RunTicketStore = {
  async issue(tester, ticket) {
    const stored: StoredTicket = { ...ticket, load: gzipSync(JSON.stringify(ticket.load)).toString("base64") };
    await redis.setex(baiterRunKey(tester), RUN_TICKET_SECONDS, JSON.stringify(stored));
  },
  async take(tester) {
    // GETDEL: two finishes racing for one ticket cannot both spend it.
    const raw = await redis.getdel(baiterRunKey(tester));
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as StoredTicket;
      const load = JSON.parse(gunzipSync(Buffer.from(stored.load, "base64")).toString("utf8")) as JsonObject;
      return { ...stored, load };
    } catch {
      return null;
    }
  },
};

/** Tickets in memory, for tests. */
export const memoryRunTickets = (): RunTicketStore & { readonly held: Map<number, RunTicket> } => {
  const held = new Map<number, RunTicket>();
  return {
    held,
    async issue(tester, ticket) {
      held.set(tester, ticket);
    },
    async take(tester) {
      const ticket = held.get(tester) ?? null;
      held.delete(tester);
      return ticket;
    },
  };
};
