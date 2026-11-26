import { RequestContext } from "@mikro-orm/core";

import { answerPing } from "../controllers/maproom/presence.js";
import { sessionUser } from "../middleware/auth.js";
import { isValidApiVersion } from "../middleware/apiVersioning.js";
import { postgres } from "../server.js";
import { logger } from "../utils/logger.js";
import { send, ServerMessageType, type ClientMessage, ClientMessageType } from "./chatProtocol.js";
import type { ChatClient, SocketData } from "./chatState.js";

type ServerWebSocket<T> = import("bun").ServerWebSocket<T>;
type PresenceMessage = Extract<ClientMessage, { type: ClientMessageType.Presence }>;

/**
 * The game's presence ping over the chat socket (beta 9, speed-ups item 10).
 *
 * A web player keeps their "online" mark alive with a ping every 30 seconds
 * (`POST /bm/presence`, `controllers/maproom/presence.ts`). An idle player
 * already holds this socket open, so the ping rides it instead of a request
 * of its own. The answer is the route's, word for word ({@link answerPing}),
 * sent back under the ping's `id`.
 *
 * It counts only when a request would have: the frame carries the game
 * session's bearer token, checked as `verifyUserAuth` checks it (the session's
 * current token, a player who is not banned), and it must be this socket's
 * own player; the API version must be one the routes take. Anything else is
 * answered `ok: false`, and the client sends that ping over HTTP, where the
 * route answers as it always has. A socket may ping once every
 * {@link PRESENCE_MIN_GAP_MS}; a faster one is answered `throttled`, the
 * same.
 *
 * `POST /bm/presence` stays as it is: an open tab from before this release,
 * a player with World chat switched off, or one whose socket is down pings
 * there.
 */

/** The least time between two pings taken on one socket. */
export const PRESENCE_MIN_GAP_MS = 2_000;

/** The longest token read (the client sends none longer); a real one is ~0.2 KB, the frame cap 4 KB. */
const MAX_TOKEN_LENGTH = 3_000;

export const handlePresence = async (
  ws: ServerWebSocket<SocketData>,
  client: ChatClient,
  message: PresenceMessage,
  nowMs: number = Date.now()
): Promise<void> => {
  const id = Number(message.id);
  if (!Number.isSafeInteger(id)) return;
  const refuse = (reason: "throttled" | "auth" | "version" | "error") =>
    send(ws, { type: ServerMessageType.Presence, id, ok: false, reason });

  if (nowMs - (ws.data.lastPresenceAt ?? 0) < PRESENCE_MIN_GAP_MS) return refuse("throttled");
  ws.data.lastPresenceAt = nowMs;

  if (typeof message.token !== "string" || message.token.length === 0 || message.token.length > MAX_TOKEN_LENGTH) {
    return refuse("auth");
  }
  if (!isValidApiVersion(message.apiVersion)) return refuse("version");

  try {
    await RequestContext.create(postgres.orm.em, async () => {
      const signedIn = await sessionUser(message.token).catch(() => null);
      if (!signedIn || signedIn.user.userid !== client.userId) return refuse("auth");
      const answer = await answerPing(signedIn.user, message.screen);
      send(ws, { type: ServerMessageType.Presence, id, ok: true, answer });
    });
  } catch (err) {
    logger.warn(`Presence ping over chat failed for user ${client.userId}: ${err}`);
    refuse("error");
  }
};
