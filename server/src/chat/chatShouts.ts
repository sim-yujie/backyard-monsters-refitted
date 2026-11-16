import { allianceChannelKey } from "./chatChannels.js";
import { ServerMessageType, type HistoryEntry, type ServerMessage } from "./chatProtocol.js";
import { publishToChannel } from "./chatTransport.js";

/**
 * Delivers a shout to everyone currently in an alliance's channel.
 *
 * Shouts are raised on the API side when membership changes, but the channel
 * roster lives with the gateway. Publishing the finished message straight to the
 * alliance channel means the gateway fans it out through the subscription it
 * already holds - it does not care which side published.
 *
 * @param {number} allianceId - The alliance whose channel should receive it.
 * @param {HistoryEntry} entry - The shout, with its text already composed.
 */
export const publishAllianceShout = (allianceId: number, entry: HistoryEntry) => {
  const channel = allianceChannelKey(allianceId);
  publishToChannel(channel, JSON.stringify(shoutMessage(channel, entry)));
};

/**
 * The live message for a shout: the same fields the feed read gives, so the
 * Map button (under attack) and the Trade button (a trade request) show on a
 * line that arrives live, not only after a reload reads the feed.
 */
export const shoutMessage = (channel: string, entry: HistoryEntry): ServerMessage => ({
  type: ServerMessageType.Message,
  channel,
  messageType: entry.messageType,
  userId: entry.userId,
  displayName: entry.displayName,
  picSquare: entry.picSquare,
  allianceImage: entry.allianceImage,
  body: entry.body,
  ts: entry.ts,
  ...(entry.cell && { cell: entry.cell }),
  ...(entry.tradeRequest !== undefined && { tradeRequest: entry.tradeRequest }),
});
