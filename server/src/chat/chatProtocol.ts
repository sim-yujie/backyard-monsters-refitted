import type { AllianceMessageType } from "../enums/Alliance.js";

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
  allianceImage: number | null;
  body: string;
  messageType: AllianceMessageType;
  ts: number;
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
  | { type: ClientMessageType.Ping };

export type ServerMessage =
  | { type: ServerMessageType.AuthOk; userId: number; displayName: string }
  | { type: ServerMessageType.AuthFail; reason: AuthFailReason }
  | { type: ServerMessageType.Joined; channel: string; history: HistoryEntry[] }
  | { type: ServerMessageType.Message; channel: string; messageType: AllianceMessageType; userId: number; displayName: string; picSquare: string | null; allianceImage: number | null; body: string; ts: number; gm?: boolean; mod?: boolean }
  | { type: ServerMessageType.UserEnter; channel: string; userId: number; displayName: string }
  | { type: ServerMessageType.UserExit; channel: string; userId: number }
  | { type: ServerMessageType.NameUpdate; channel: string; userId: number; displayName: string }
  | { type: ServerMessageType.IgnoreList; list: IgnoreEntry[] }
  | { type: ServerMessageType.Error; code: Exclude<ErrorCode, ErrorCode.Muted> }
  | { type: ServerMessageType.Error; code: ErrorCode.Muted; until: number }
  | { type: ServerMessageType.Kicked; reason: "banned"; until: number | null; text: string; banReason: string }
  | { type: ServerMessageType.Notice };

interface Sender { send(data: string): void; }

/**
 * Serialises a {@link ServerMessage} to JSON and sends it over the WebSocket.
 * @param {Sender} ws - The WebSocket connection to send the message on.
 * @param {ServerMessage} msg - The typed server message to send.
 */
export const send = (ws: Sender, msg: ServerMessage): void => ws.send(JSON.stringify(msg));
