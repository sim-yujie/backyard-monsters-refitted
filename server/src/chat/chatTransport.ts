import { RedisClient } from "bun";

import { redis } from "../server.js";
import { logger } from "../utils/logger.js";
import { exitOnRedisReconnect } from "../utils/redisReconnectGuard.js";
import { CHAT_CONTROL_CHANNEL } from "./chatControl.js";
import { channelMembers, clients } from "./chatState.js";

let redisSub: RedisClient;

/**
 * Opens the dedicated Redis subscriber used for cross-process fan-out.
 *
 * A subscriber-mode client can only subscribe and unsubscribe, which is why this
 * is a second connection rather than the shared `redis` client used to publish.
 * Must be called once before any WebSocket connections are accepted.
 *
 * @param {() => void} onReady - Run once the subscriber connects, to register subscriptions.
 */
export const initTransport = (onReady: () => void) => {
  redisSub = new RedisClient(process.env.REDIS_URL);

  exitOnRedisReconnect(redisSub, "Chat Redis subscriber", () => {
    logger.info("Chat Redis subscriber connected");
    onReady();
  });

  redisSub.onclose = (err) => logger.error(`Chat Redis subscriber disconnected: ${err.message}`);
  redisSub.connect();
};

/**
 * Delivers a raw JSON payload to all locally connected clients in a channel.
 * Runs from the subscription callback, so it handles messages published by any
 * process in the cluster, including this one.
 *
 * @param {string} channel - The channel whose members should receive the payload.
 * @param {string} payload - The serialised JSON message payload.
 */
export const fanOut = (channel: string, payload: string) => {
  const members = channelMembers.get(channel);

  if (!members) return;

  const { except, body } = unwrapExcept(payload);

  for (const userId of members) {
    if (userId === except) continue;

    const client = clients.get(userId);

    if (!client) continue;

    client.ws.send(body);
  }
};

/**
 * Marks a payload as not for one member (the chat filter's sender, who was
 * sent their own copy directly). The mark is taken off in {@link fanOut}
 * before anything is sent, so no client ever sees it.
 */
const EXCEPT_MARK = "~except:";

export const wrapExcept = (payload: string, userId: number): string => `${EXCEPT_MARK}${userId}~${payload}`;

export const unwrapExcept = (payload: string): { except: number | null; body: string } => {
  if (!payload.startsWith(EXCEPT_MARK)) return { except: null, body: payload };
  const end = payload.indexOf("~", EXCEPT_MARK.length);
  if (end < 0) return { except: null, body: payload };
  const except = Number(payload.slice(EXCEPT_MARK.length, end));
  return { except: Number.isSafeInteger(except) ? except : null, body: payload.slice(end + 1) };
};

/**
 * Registers a Redis subscription, logging rather than throwing on failure.
 *
 * @param {string} channel - The channel to subscribe to.
 * @param {(message: string) => void} listener - Called with each raw payload.
 */
const subscribe = (channel: string, listener: (message: string) => void) => {
  redisSub
    .subscribe(channel, listener)
    .catch((err) => logger.error(`Chat subscribe failed for ${channel}: ${err}`));
};

/**
 * Subscribes to a chat channel so its payloads reach local members.
 *
 * @param {string} channel - The channel to subscribe to.
 */
export const subscribeToChannel = (channel: string) => subscribe(channel, (msg) => fanOut(channel, msg));

/**
 * Subscribes to the control channel the API side publishes membership events on.
 *
 * @param {(message: string) => void} listener - Called with each raw control payload.
 */
export const subscribeControl = (listener: (message: string) => void) =>
  subscribe(CHAT_CONTROL_CHANNEL, listener);

/**
 * Subscribes to one of the live map's channels (`liveZones.ts`): every socket
 * server takes every change and picks out its own watchers (`liveGateway.ts`).
 *
 * @param {string} channel - The channel to subscribe to.
 * @param {(message: string) => void} listener - Called with each raw payload.
 */
export const subscribeLive = (channel: string, listener: (message: string) => void) => subscribe(channel, listener);

/**
 * Drops a channel's subscription once no local client remains in it.
 *
 * @param {string} channel - The channel to unsubscribe from.
 */
export const unsubscribeFromChannel = (channel: string) => {
  redisSub
    .unsubscribe(channel)
    .catch((err) => logger.error(`Chat unsubscribe failed for ${channel}: ${err}`));
};

/**
 * Publishes a raw JSON string to a Redis channel. Local delivery happens through
 * {@link fanOut} when the subscription receives it back.
 *
 * @param {string} channel - The Redis channel to publish to.
 * @param {string} payload - The serialised JSON message payload.
 * @param {number} [except] - A member not to send it to (they were sent their own copy).
 */
export const publishToChannel = (channel: string, payload: string, except?: number) => {
  redis
    .publish(channel, except === undefined ? payload : wrapExcept(payload, except))
    .catch((err) => logger.error(`Chat publish error on ${channel}: ${err}`));
};
