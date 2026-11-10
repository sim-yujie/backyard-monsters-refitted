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
  /** Said by the game team: the server sets it, only for the game team's accounts. */
  gm?: boolean;
  /** Said by a chat moderator: the server sets it, only for accounts on the dashboard's Moderators list (never with `gm`). */
  mod?: boolean;
  /**
   * An Alliance room line's kind: `message` for one a member said, anything
   * else for an automatic line (joins, leaves, an under-attack alert). Absent
   * in the other rooms.
   */
  messageType?: string;
  /** The map cell an automatic line is about (an under-attack alert): Show on map. */
  cell?: { x: number; y: number };
  /** A trade request line's request, for the chat box's Give (alliance trading). */
  tradeRequest?: number;
}

/** The error codes the chat server answers with. */
export type ChatErrorCode =
  | "invalid_json"
  | "already_authenticated"
  | "rate_limited"
  | "not_authenticated"
  | "invalid_channel"
  | "not_in_channel"
  | "server_error"
  /** The game team paused this player's chat; the message carries `until`. */
  | "muted";

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
  /** `channel`: on a refused join, the room asked for. */
  | { type: "error"; code: ChatErrorCode; until?: number; channel?: string }
  /** Banned by the game team: the server closes the socket after it. */
  | { type: "kicked"; reason: "banned"; until: number | null; text: string; banReason?: string }
  /** The game team left a warning or mute to show (`api/moderation.ts`). */
  | { type: "notice" }
  /** New mail for this player: the game asks `/player/mailstatus` what came (owner, beta 7). */
  | { type: "mail" }
  /** Taken out of a room: left or was kicked from the alliance (beta 7). */
  | { type: "left"; channel: string };

/** Everything needed to reach world chat, from the owner's yard load. */
export interface ChatConfig {
  /** The socket's address, `ws://` or `wss://`. */
  readonly url: string;
  readonly userId: number;
  readonly token: string;
  /** Global: the world room for the player's Map Room. */
  readonly channel: string;
  /** The player's country room beside Global, when their country has one. */
  readonly countryChannel?: string | null;
  /** That room's country, ISO 3166-1 alpha-2, for its tab. */
  readonly country?: string | null;
  /** The player's alliance, for the Alliance room between Global and the country room (beta 7); null when in none. */
  readonly alliance?: ChatAlliance | null | undefined;
}

/** The player's alliance as the chat box shows it: its id, name and shield (1 to 41). */
export interface ChatAlliance {
  readonly id: number;
  readonly name: string;
  readonly image: number;
}

/** The alliance on an own-yard load (`alliancedata`), or null for none or a malformed one. */
export const chatAllianceOf = (data: unknown): ChatAlliance | null => {
  if (!data || typeof data !== "object") return null;
  const row = data as { alliance_id?: unknown; name?: unknown; image?: unknown };
  const id = Number(row.alliance_id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { id, name: String(row.name ?? ""), image: Number(row.image) || 1 };
};

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
  load: {
    chatservers?: string[];
    chattoken?: string;
    chatchannel?: string;
    chatcountrychannel?: string;
    chatcountry?: string;
    alliancedata?: unknown;
  },
  userId: number,
  secure: boolean,
): ChatConfig | null => {
  const server = load.chatservers?.[0];
  if (!server || !load.chattoken || !load.chatchannel || !(userId > 0)) return null;
  const country = load.chatcountrychannel && load.chatcountry ? load.chatcountry : null;
  return {
    url: chatSocketUrl(server, secure),
    userId,
    token: load.chattoken,
    channel: load.chatchannel,
    countryChannel: country ? (load.chatcountrychannel ?? null) : null,
    country,
    alliance: chatAllianceOf(load.alliancedata),
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
