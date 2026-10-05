import { Save } from "../database/models/save.model.js";
import { User } from "../database/models/user.model.js";
import { postgres, redis } from "../server.js";
import { calculateBaseLevel } from "../services/base/calculateBaseLevel.js";
import { chatTokenKey } from "./chatChannels.js";
import {
  AuthFailReason,
  ClientMessageType,
  ErrorCode,
  send,
  ServerMessageType,
  type ClientMessage,
  type ServerMessage,
} from "./chatProtocol.js";
import { onLevelChange } from "./levelChangeBus.js";
import { leaveAllChannels } from "./chatRooms.js";
import { clients, type ChatClient, type SocketData } from "./chatState.js";
import { publishToChannel } from "./chatTransport.js";

type ServerWebSocket<T> = import("bun").ServerWebSocket<T>;

type AuthMessage = Extract<ClientMessage, { type: ClientMessageType.Auth }>;

type ChatIdentity = Pick<User, "username" | "pic_square"> & {
  save?: Pick<Save, "points" | "basevalue"> | null;
};

const CHAT_FIELDS = [
  "userid",
  "username",
  "banned",
  "pic_square",
  "save.points",
  "save.basevalue"
] as const;

/**
 * The `[level] name` format shown in chat, shared by {@link getDisplayName}
 * (at auth) and {@link notifyLevelChange} (on a later level change).
 *
 * @param {string} username - The player's username.
 * @param {number} level - Their current level.
 * @returns {string} The display name to broadcast for this user.
 */
const formatDisplayName = (username: string, level: number): string => `[${level}] ${username}`;

/**
 * The authoritative chat display name for a user.
 *
 * @param {ChatIdentity} user - The authenticated user, with the level fields selected.
 * @returns {string} The display name to broadcast for this user.
 */
const getDisplayName = (user: ChatIdentity): string => {
  const save = user.save;
  const level = save ? calculateBaseLevel(save.points, save.basevalue) : 1;

  return formatDisplayName(user.username, level);
};

/**
 * Authenticates a connection and registers it as a {@link ChatClient}.
 *
 * The token is checked against the one issued during base load, then the account
 * is loaded to derive the display name server-side rather than trusting whatever
 * the client claims to be called. A second connection for the same player closes
 * the first, so a player is only ever in one place.
 *
 * @param {ServerWebSocket<SocketData>} ws - The connection authenticating.
 * @param {AuthMessage} message - The client's auth message.
 */
export const authenticate = async (ws: ServerWebSocket<SocketData>, message: AuthMessage) => {
  if (ws.data.userId !== null) {
    send(ws, { type: ServerMessageType.Error, code: ErrorCode.AlreadyAuthenticated });
    return;
  }

  const storedToken = await redis.get(chatTokenKey(message.userId));

  if (!storedToken || storedToken !== message.token) {
    send(ws, { type: ServerMessageType.AuthFail, reason: AuthFailReason.InvalidToken });
    ws.close();
    return;
  }

  const em = postgres.orm.em.fork();

  const user = await em.findOne(User, { userid: message.userId }, { fields: CHAT_FIELDS });

  if (!user || user.banned) {
    send(ws, { type: ServerMessageType.AuthFail, reason: AuthFailReason.UserNotFound });
    ws.close();
    return;
  }

  const displayName = getDisplayName(user);

  const client: ChatClient = {
    ws,
    userId: user.userid,
    displayName,
    username: user.username,
    picSquare: user.pic_square ?? null,
    channels: new Map(),
    lastMsgAt: 0,
  };

  ws.data.userId = user.userid;
  ws.data.displayName = displayName;

  const existing = clients.get(user.userid);

  if (existing) {
    existing.ws.close();
    leaveAllChannels(existing);
  }

  clients.set(user.userid, client);

  send(ws, { type: ServerMessageType.AuthOk, userId: user.userid, displayName });
};

/**
 * Pushes a player's chat display name to everyone in the channels they are
 * currently in, once their level has changed (issue #232).
 *
 * The level is recalculated from building value now (#209), so there is no
 * single save write to hook: callers just report the player's current level
 * after whatever they did, and this decides for itself whether that is new.
 * It is a no-op when the player has no open chat connection, and when the
 * level given is already the one in `client.displayName` — so a caller never
 * needs to track the level itself or compare before/after.
 *
 * Flash did the equivalent with `BYMChat.broadcastDisplayNameUpdate`
 * (`client/scripts/BASE.as:4922-4926`), over the same already-open
 * connection rather than a new one; this does the same, publishing to the
 * channels the existing connection already holds rather than opening one.
 *
 * @param {number} userId - The player whose level may have changed.
 * @param {string} username - Their username, as stored.
 * @param {number} level - Their current level, e.g. from `playerLevelOf`.
 */
export const notifyLevelChange = (userId: number, username: string, level: number): void => {
  const client = clients.get(userId);

  if (!client) return;

  const displayName = formatDisplayName(username, level);

  if (client.displayName === displayName) return;

  client.displayName = displayName;
  client.ws.data.displayName = displayName;

  for (const channel of client.channels.keys()) {
    const message: ServerMessage = {
      type: ServerMessageType.NameUpdate,
      channel,
      userId,
      displayName,
    };

    publishToChannel(channel, JSON.stringify(message));
  }
};

// Registered as soon as this module loads, which happens as a side effect of
// `server.ts` starting the chat subsystem (`levelChangeBus.ts`'s file
// comment) — well before any yard route can call `emitLevelChange`.
onLevelChange(notifyLevelChange);
