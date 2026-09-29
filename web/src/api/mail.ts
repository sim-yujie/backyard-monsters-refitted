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
 * - `POST /api/:apiVersion/player/reportmessagethread { threadid, reason }`: blocks
 *   the thread's other player; their threads disappear from the list.
 */

const THREADS_PATH = "/api/:apiVersion/player/getmessagethreads";
const TARGETS_PATH = "/api/:apiVersion/player/getmessagetargets";
const THREAD_PATH = "/api/:apiVersion/player/getmessagethread";
const SEND_PATH = "/api/:apiVersion/player/sendmessage";
const BLOCK_PATH = "/api/:apiVersion/player/reportmessagethread";

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
  /** A notice's cell, `[x, y]` (#187). */
  readonly coords?: readonly number[] | null;
  readonly baseid?: string | null;
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

/** A new message or a reply. */
export interface Outgoing {
  /** 0 starts a new thread. */
  readonly threadid: number;
  /** The recipient. In a reply the server takes it from the thread. */
  readonly targetid: number;
  readonly subject: string;
  readonly message: string;
}

/** Everything the mailbox asks the server, as one object a test can replace. */
export interface MailApi {
  threads(): Promise<MailMessage[]>;
  targets(): Promise<Record<string, MailTarget>>;
  thread(threadid: number): Promise<MailMessage[]>;
  send(outgoing: Outgoing): Promise<SendResult>;
  block(threadid: number): Promise<void>;
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
    return "The message was not sent. That player cannot be written to.";
  }
  return "The message was not sent.";
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
        type: "message",
        // Required by the route's schema and never read (`docs/server-api.md`).
        targetbaseid: "0",
      });
      return { ok: true, threadid: Number(response.threadid ?? outgoing.threadid) };
    } catch (caught) {
      return { ok: false, reason: sendRefusal(caught) };
    }
  },
  block: async (threadid) => {
    // The route requires a reason and stores none; Flash sent "block".
    await post(BLOCK_PATH, { threadid: String(threadid), reason: "block" });
  },
};
