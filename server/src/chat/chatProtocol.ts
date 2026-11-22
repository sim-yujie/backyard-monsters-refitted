import type { AllianceMessageType } from "../enums/Alliance.js";
import type { MaintenanceNotice } from "../services/admin/maintenance.js";

export enum ClientMessageType {
  Auth = "auth",
  Join = "join",
  Say = "say",
  Leave = "leave",
  GetIgnore = "getignore",
  Ignore = "ignore",
  Unignore = "unignore",
  UpdateName = "updatename",
  Ping = "ping",
  /** The game's presence ping (beta 9, `chatPresence.ts`): `POST /bm/presence` over this socket. */
  Presence = "presence",
}

export enum ServerMessageType {
  AuthOk = "auth_ok",
  AuthFail = "auth_fail",
  Joined = "joined",
  Message = "message",
  UserEnter = "user_enter",
  UserExit = "user_exit",
  NameUpdate = "name_update",
  IgnoreList = "ignore_list",
  Error = "error",
  /** The game team banned this player: the connection closes after it. */
  Kicked = "kicked",
  /** The game team left this player a warning or a mute: the game fetches it to show. */
  Notice = "notice",
  /** New mail arrived for this player: the game fetches it (`/player/mailstatus`) to show. */
  Mail = "mail",
  /**
   * The maintenance switch (`services/admin/maintenance.ts`): on with the time
   * left to the cut-off, or off. At the cut-off a non-owner gets it with no
   * time left and the connection closes after it.
   */
  Maintenance = "maintenance",
  /** The player was taken out of a room (left or was kicked from their alliance): the client drops its tab. */
  Left = "left",
  /** The answer to a {@link ClientMessageType.Presence} ping, under the ping's `id`. */
  Presence = "presence",
}

export enum ErrorCode {
  InvalidJson = "invalid_json",
  AlreadyAuthenticated = "already_authenticated",
  RateLimited = "rate_limited",
  NotAuthenticated = "not_authenticated",
  InvalidChannel = "invalid_channel",
  NotInChannel = "not_in_channel",
  ServerError = "server_error",
  /** The game team paused this player's chat; `until` says when it ends. */
  Muted = "muted",
}

export enum AuthFailReason {
  InvalidToken = "invalid_token",
  UserNotFound = "user_not_found",
}

export interface HistoryEntry {
  userId: number;
  displayName: string;
  picSquare: string | null;
  /** The speaker's visible photo's upload number (`chatPhotos.ts`); absent for their critter. */
  photo?: number;
  allianceImage: number | null;
  body: string;
  messageType: AllianceMessageType;
  ts: number;
  /** The map cell an automatic line is about (an under-attack alert's yard): the chat box offers Show on map. */
  cell?: { x: number; y: number };
  /** A trade request line's request, for the chat box's Give (`shoutText.ts`). */
  tradeRequest?: number;
  /** Said by the game team (an `ADMIN_USER_IDS` account): the chat box marks it. Set by the server only. */
  gm?: boolean;
  /** Said by a chat moderator (`chatModerators.ts`), never with `gm`: the chat box marks it. Set by the server only. */
  mod?: boolean;
}

export interface IgnoreEntry {
  target: string;
  displayname: string;
}

export type ClientMessage =
  | { type: ClientMessageType.Auth; userId: number; token: string }
  | { type: ClientMessageType.Join; channel: string }
  | { type: ClientMessageType.Say; channel: string; message: string }
  | { type: ClientMessageType.Leave; channel: string }
  | { type: ClientMessageType.GetIgnore }
  | { type: ClientMessageType.Ignore; targetId: string }
  | { type: ClientMessageType.Unignore; targetId: string }
  | { type: ClientMessageType.UpdateName }
  | { type: ClientMessageType.Ping }
  | {
      type: ClientMessageType.Presence;
      /** The client's number for this ping; the answer carries it back. */
      id: number;
      /** The game session's bearer token, checked as `verifyUserAuth` checks it. */
      token: string;
      /** The API version the client would put in the route's path. */
      apiVersion?: string;
      /** What `POST /bm/presence` takes as its body: `{ where, planner }`. */
      screen?: unknown;
    };

export type ServerMessage =
  /** `presence`: this server answers presence pings on the socket (beta 9); an older one leaves it out. */
  | { type: ServerMessageType.AuthOk; userId: number; displayName: string; presence?: true }
  | { type: ServerMessageType.AuthFail; reason: AuthFailReason }
  | { type: ServerMessageType.Joined; channel: string; history: HistoryEntry[] }
  | { type: ServerMessageType.Message; channel: string; messageType: AllianceMessageType; userId: number; displayName: string; picSquare: string | null; photo?: number; allianceImage: number | null; body: string; ts: number; cell?: { x: number; y: number }; tradeRequest?: number; gm?: boolean; mod?: boolean }
  | { type: ServerMessageType.UserEnter; channel: string; userId: number; displayName: string }
  | { type: ServerMessageType.UserExit; channel: string; userId: number }
  | { type: ServerMessageType.NameUpdate; channel: string; userId: number; displayName: string }
  | { type: ServerMessageType.IgnoreList; list: IgnoreEntry[] }
  /** `channel`: the room a refused join asked for, so the client knows which tab to drop. */
  | { type: ServerMessageType.Error; code: Exclude<ErrorCode, ErrorCode.Muted>; channel?: string }
  | { type: ServerMessageType.Error; code: ErrorCode.Muted; until: number }
  | { type: ServerMessageType.Kicked; reason: "banned"; until: number | null; text: string; banReason: string }
  | { type: ServerMessageType.Notice }
  | { type: ServerMessageType.Mail }
  | ({ type: ServerMessageType.Maintenance } & MaintenanceNotice)
  | { type: ServerMessageType.Left; channel: string }
  /** `answer`: what `POST /bm/presence` would have answered. `ok: false`: send that ping over HTTP instead. */
  | { type: ServerMessageType.Presence; id: number; ok: true; answer: Record<string, unknown> }
  | { type: ServerMessageType.Presence; id: number; ok: false; reason: "throttled" | "auth" | "version" | "error" };

interface Sender { send(data: string): void; }

/**
 * Serialises a {@link ServerMessage} to JSON and sends it over the WebSocket.
 * @param {Sender} ws - The WebSocket connection to send the message on.
 * @param {ServerMessage} msg - The typed server message to send.
 */
export const send = (ws: Sender, msg: ServerMessage): void => ws.send(JSON.stringify(msg));
