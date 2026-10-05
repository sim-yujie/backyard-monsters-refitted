import { get, post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * World chat (#282): the chat server's WebSocket protocol as the web client
 * speaks it, and the two HTTP routes beside it.
 *
 * The socket (`server/src/chat/chatProtocol.ts`) is JSON both ways. The client
 * authenticates with the token its own yard load issued, joins the world room
 * the same load named (`chatchannel`), and then says lines and edits its ignore
 * list. The server stamps every line with the speaker's `[level] name`; the
 * client never names anyone itself.
 *
 * - `POST /api/:apiVersion/bm/chat/report { userid, channel, message, ts }`:
 *   reports one line for moderation; rate limited (429).
 * - `GET  /api/:apiVersion/bm/chat/yard?userid=`: the player's main yard, for
 *   "View their yard".
 */

const REPORT_PATH = "/api/:apiVersion/bm/chat/report";
const YARD_PATH = "/api/:apiVersion/bm/chat/yard";

/** What the client sends on the socket. */
export type ChatClientMessage =
  | { type: "auth"; userId: number; token: string }
  | { type: "join"; channel: string }
  | { type: "say"; channel: string; message: string }
  | { type: "leave"; channel: string }
  | { type: "getignore" }
  | { type: "ignore"; targetId: string }
  | { type: "unignore"; targetId: string }
  | { type: "ping" };

/** One line as the server sends it, live or in a room's history. */
export interface ChatLineWire {
  userId: number;
  /** `[level] name`, the server's words. */
  displayName: string;
  body: string;
  /** When it was said, ms since the epoch: with `userId`, what names the line. */
  ts: number;
}

/** The error codes the chat server answers with. */
export type ChatErrorCode =
  | "invalid_json"
  | "already_authenticated"
  | "rate_limited"
  | "not_authenticated"
  | "invalid_channel"
  | "not_in_channel"
  | "server_error";

/** What the server sends on the socket; anything else is ignored. */
export type ChatServerMessage =
  | { type: "auth_ok"; userId: number; displayName: string }
  | { type: "auth_fail"; reason: "invalid_token" | "user_not_found" }
  | { type: "joined"; channel: string; history: ChatLineWire[] }
  | ({ type: "message"; channel: string } & ChatLineWire)
  | { type: "user_enter"; channel: string; userId: number; displayName: string }
  | { type: "user_exit"; channel: string; userId: number }
  /** A player's level changed (#232): their name for the lines still to come. */
  | { type: "name_update"; channel: string; userId: number; displayName: string }
  | { type: "ignore_list"; list: { target: string; displayname: string }[] }
  | { type: "error"; code: ChatErrorCode };

/** Everything needed to reach world chat, from the owner's yard load. */
export interface ChatConfig {
  /** The socket's address, `ws://` or `wss://`. */
  readonly url: string;
  readonly userId: number;
  readonly token: string;
  readonly channel: string;
}

/**
 * The socket's address for a `chatservers` entry. The server names it as
 * `host:port`; a page served over https needs `wss:`. An entry that already
 * carries a scheme is taken as it is.
 */
export const chatSocketUrl = (server: string, secure: boolean): string =>
  /^wss?:\/\//.test(server) ? server : `${secure ? "wss" : "ws"}://${server}`;

/**
 * Reads the chat fields off an own-yard load; null when the load carries none
 * (a visit, an attack, Inferno, or a server with chat switched off).
 */
export const chatConfigFrom = (
  load: { chatservers?: string[]; chattoken?: string; chatchannel?: string },
  userId: number,
  secure: boolean,
): ChatConfig | null => {
  const server = load.chatservers?.[0];
  if (!server || !load.chattoken || !load.chatchannel || !(userId > 0)) return null;
  return {
    url: chatSocketUrl(server, secure),
    userId,
    token: load.chattoken,
    channel: load.chatchannel,
  };
};

interface ReportResponse extends ApiEnvelope {
  stored?: boolean;
}

interface YardResponse extends ApiEnvelope {
  baseid?: string;
  name?: string;
}

/** The line a report is about. */
export interface ChatReportRequest {
  readonly userId: number;
  readonly channel: string;
  readonly body: string;
  readonly ts: number;
}

/** Everything the chat box asks over HTTP, as one object a test can replace. */
export interface ChatApi {
  report(line: ChatReportRequest): Promise<void>;
  /** The player's main yard; null when they have none to show. */
  yardOf(userId: number): Promise<{ baseid: string; name: string } | null>;
}

export const chatApi: ChatApi = {
  async report(line) {
    await post<ReportResponse>(REPORT_PATH, {
      userid: line.userId,
      channel: line.channel,
      message: line.body,
      ts: line.ts,
    });
  },
  async yardOf(userId) {
    const answer = await get<YardResponse>(YARD_PATH, { userid: userId });
    return answer.baseid ? { baseid: answer.baseid, name: answer.name ?? "" } : null;
  },
};
