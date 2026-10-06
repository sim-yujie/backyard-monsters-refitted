import { ApiError, get, NetworkError, post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The mailbox routes (`docs/server-api.md`, "Mail"), as the Flash client left
 * them: the thread list, one thread, send, and block. The web mailbox screen
 * (#193) is their only caller.
 *
 * - `GET  /api/:apiVersion/player/getmessagethreads`: each thread's last
 *   message, keyed by `threadid`, `userid` rewritten to the other party.
 * - `GET  /api/:apiVersion/player/getmessagetargets`: the names of everyone
 *   the player has a thread with; the game's own notices are `userid` 0.
 * - `POST /api/:apiVersion/player/getmessagethread { threadid }`: a thread's
 *   messages, oldest first. Reading it marks it read on the server.
 * - `POST /api/:apiVersion/player/sendmessage`: `threadid` 0 starts a thread.
 *   Its `type` also proposes, accepts or rejects a truce in a thread (#203),
 *   and invites a player to move onto one of the player's outposts (`baseid`)
 *   or withdraws that invitation (#205).
 * - `POST /api/:apiVersion/player/requesttruce { baseid, message }`: proposes a
 *   truce to a base's owner, from the map, in a new thread (#203).
 * - `POST /api/:apiVersion/player/reportmessagethread { threadid, reason }`: blocks
 *   the thread's other player; their threads disappear from the list.
 * - `POST /base/migratetofriend { threadid, shiny }`: accepts the thread's
 *   invitation to move, at the server's price; `shiny` "1" pays in Shiny (#205).
 * - `POST /base/rejectmigratetofriend { threadid }`: declines it (#205).
 */

const THREADS_PATH = "/api/:apiVersion/player/getmessagethreads";
const TARGETS_PATH = "/api/:apiVersion/player/getmessagetargets";
const THREAD_PATH = "/api/:apiVersion/player/getmessagethread";
const SEND_PATH = "/api/:apiVersion/player/sendmessage";
const BLOCK_PATH = "/api/:apiVersion/player/reportmessagethread";
const TRUCE_PATH = "/api/:apiVersion/player/requesttruce";
const ACCEPT_INVITE_PATH = "/base/migratetofriend";
const DECLINE_INVITE_PATH = "/base/rejectmigratetofriend";

/** One message as the server sends it (`message.model.ts`'s `@FrontendKey` fields). */
export interface MailMessage {
  readonly threadid: number;
  /** Unix seconds. */
  readonly updatetime: number;
  /** The sender; in the thread list, the other party instead. */
  readonly userid: number;
  readonly targetid: number;
  /** `message`, `trucerequest`, `truceaccept`, `trucereject`, or a notice kind. */
  readonly messagetype: string;
  /** 1 while unread by the player. */
  readonly unread?: number;
  readonly subject: string;
  readonly message: string | null;
  /** In the thread list only: how many messages the thread holds. */
  readonly messagecount?: number;
  readonly trucestate?: string | null;
  /**
   * In the thread list only (#203): when the thread's truce ends, unix
   * seconds. An accepted truce's expiry, or when a waiting request lapses.
   */
  readonly truceexpire?: number | null;
  /** A notice's cell, `[x, y]` (#187), or an invitation's outpost (#205). */
  readonly coords?: readonly number[] | null;
  readonly baseid?: string | null;
  /**
   * An invitation to move (#205): on its `migraterequest` message, and on the
   * thread list for the thread's latest. `requested`, `accepted`, `rejected`,
   * `revoked`, `expired` (unanswered for 7 days) or `void` (the outpost
   * changed hands).
   */
  readonly migratestate?: string | null;
  /** When that invitation lapses unanswered, unix seconds (#205). */
  readonly migrateexpire?: number | null;
}

/** One name `getmessagetargets` gives, by user id. */
export interface MailTarget {
  readonly first_name: string;
  readonly last_name?: string;
  readonly pic_square?: string | null;
}

interface ThreadsResponse extends ApiEnvelope {
  threads?: Record<string, MailMessage>;
}

interface TargetsResponse extends ApiEnvelope {
  targets?: Record<string, MailTarget>;
}

interface ThreadResponse extends ApiEnvelope {
  thread?: Record<string, MailMessage>;
}

interface SendResponse extends ApiEnvelope {
  threadid?: number;
}

/** What a send gives back: the thread it went into, or why it did not go. */
export type SendResult =
  | { readonly ok: true; readonly threadid: number }
  | { readonly ok: false; readonly reason: string };

/**
 * What a send is: a message, a truce proposed or answered in a thread (#203),
 * or an invitation to move sent or withdrawn (#205).
 */
export type MailSendType =
  | "message"
  | "trucerequest"
  | "truceaccept"
  | "trucereject"
  | "migraterequest"
  | "migraterevoke";

/** A new message or a reply. */
export interface Outgoing {
  /** 0 starts a new thread. */
  readonly threadid: number;
  /** The recipient. In a reply the server takes it from the thread. */
  readonly targetid: number;
  readonly subject: string;
  readonly message: string;
  /** "message" unless it is a truce's (#203) or an invitation's (#205). */
  readonly type?: MailSendType;
  /** An invitation's outpost (#205). */
  readonly baseid?: string;
}

/** How an invitation to move is paid for: 10,000,000 of each resource, or 1,200 Shiny (#205). */
export type InvitePayment = "resources" | "shiny";

/** An invitation's answer: the main yard's new cell once accepted, or why it did not go. */
export type InviteAnswer =
  | { readonly ok: true; readonly coords: readonly [number, number] | null }
  | { readonly ok: false; readonly reason: string };

interface AcceptInviteResponse extends ApiEnvelope {
  coords?: [number, number];
}

/** Everything the mailbox asks the server, as one object a test can replace. */
export interface MailApi {
  threads(): Promise<MailMessage[]>;
  targets(): Promise<Record<string, MailTarget>>;
  thread(threadid: number): Promise<MailMessage[]>;
  send(outgoing: Outgoing): Promise<SendResult>;
  /** Proposes a truce to a base's owner, in a new thread (#203). */
  requestTruce(baseid: string, message: string): Promise<SendResult>;
  block(threadid: number): Promise<void>;
  /** Accepts the thread's invitation to move: the main yard moves onto the outpost (#205). */
  acceptInvite(threadid: number, payment: InvitePayment): Promise<InviteAnswer>;
  /** Declines the thread's invitation to move (#205). */
  declineInvite(threadid: number): Promise<InviteAnswer>;
}

/** An object keyed by position ("0", "1", …) as a list in that order. */
const inOrder = <T>(record: Record<string, T> | undefined): T[] =>
  Object.entries(record ?? {})
    .sort(([one], [other]) => Number(one) - Number(other))
    .map(([, value]) => value);

/**
 * Why a send did not go, in words: the server's own soft refusal
 * (`{ error: 1, message }`, "Cannot send message to this user"), else a
 * plain one.
 */
export const sendRefusal = (caught: unknown): string => {
  if (caught instanceof NetworkError) return "Could not reach the server. Try again.";
  if (caught instanceof ApiError) {
    const body = caught.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string" && body.message) return body.message;
    // A truce or an invitation refused for a reason the server words (#203, #205): one already waiting, say.
    if (caught.serverStatus === 409 && caught.message) return caught.message;
    return "The message was not sent. That player cannot be written to.";
  }
  return "The message was not sent.";
};

/** Why a block did not go: the server's words (too many reports, #323), else a plain one. */
export const blockRefusal = (caught: unknown): string => {
  const body = caught instanceof ApiError ? (caught.body as { message?: unknown } | undefined) : undefined;
  return typeof body?.message === "string" && body.message ? body.message : "Could not block that player. Try again.";
};

/** Why an answer to an invitation did not go: the server's words, else a plain one (#205). */
const answerRefusal = (caught: unknown): string => {
  if (caught instanceof NetworkError) return "Could not reach the server. Try again.";
  if (caught instanceof ApiError) {
    const body = caught.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string" && body.message) return body.message;
    if (caught.message) return caught.message;
  }
  return "The invitation could not be answered. Try again.";
};

export const mailApi: MailApi = {
  threads: async () => Object.values((await get<ThreadsResponse>(THREADS_PATH)).threads ?? {}),
  targets: async () => (await get<TargetsResponse>(TARGETS_PATH)).targets ?? {},
  thread: async (threadid) =>
    inOrder((await post<ThreadResponse>(THREAD_PATH, { threadid: String(threadid) })).thread),
  send: async (outgoing) => {
    try {
      const response = await post<SendResponse>(SEND_PATH, {
        threadid: String(outgoing.threadid),
        targetid: String(outgoing.targetid),
        subject: outgoing.subject,
        message: outgoing.message,
        type: outgoing.type ?? "message",
        ...(outgoing.baseid !== undefined && { baseid: outgoing.baseid }),
        // Required by the route's schema and never read (`docs/server-api.md`).
        targetbaseid: "0",
      });
      return { ok: true, threadid: Number(response.threadid ?? outgoing.threadid) };
    } catch (caught) {
      return { ok: false, reason: sendRefusal(caught) };
    }
  },
  requestTruce: async (baseid, message) => {
    try {
      const response = await post<SendResponse>(TRUCE_PATH, { baseid, message });
      return { ok: true, threadid: Number(response.threadid ?? 0) };
    } catch (caught) {
      return { ok: false, reason: sendRefusal(caught) };
    }
  },
  block: async (threadid) => {
    // The route requires a reason and stores none; Flash sent "block".
    await post(BLOCK_PATH, { threadid: String(threadid), reason: "block" });
  },
  acceptInvite: async (threadid, payment) => {
    try {
      const response = await post<AcceptInviteResponse>(ACCEPT_INVITE_PATH, {
        threadid: String(threadid),
        // Only which button was pressed: the price is the server's.
        shiny: payment === "shiny" ? "1" : "0",
      });
      const [x, y] = response.coords ?? [];
      return { ok: true, coords: Number.isInteger(x) && Number.isInteger(y) ? [x!, y!] : null };
    } catch (caught) {
      return { ok: false, reason: answerRefusal(caught) };
    }
  },
  declineInvite: async (threadid) => {
    try {
      await post(DECLINE_INVITE_PATH, { threadid: String(threadid) });
      return { ok: true, coords: null };
    } catch (caught) {
      return { ok: false, reason: answerRefusal(caught) };
    }
  },
};
