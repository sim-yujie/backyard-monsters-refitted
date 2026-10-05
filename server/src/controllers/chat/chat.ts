import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";
import type { HistoryEntry } from "../../chat/chatProtocol.js";
import { CHANNELS, INFERNO_CHAT_CHANNEL } from "../../config/ChatConfig.js";
import { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { CHAT_REPORT_MAX_TEXT, recordChatReport } from "../../services/chat/chatReports.js";

/**
 * The web client's chat box routes beside the WebSocket (issue #282), as
 * functions of an entity manager and the caller so they run under test;
 * `routes.ts` binds them to Koa, `postgres.em` and the channel history.
 *
 * - `POST /bm/chat/report` `{ userid, channel, message, ts }` → `{ error: 0, stored, verified }`:
 *   reports one world chat line for moderation (`services/chat/chatReports.ts`).
 * - `GET  /bm/chat/yard?userid=` → `{ error: 0, baseid, name }`: the main yard
 *   of a player seen in chat, for "View their yard".
 */

export interface ChatAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** Reads a global channel's history, oldest first (`chatHistory.ts` `getHistory`). */
export type HistoryReader = (channel: string) => Promise<HistoryEntry[]>;

/**
 * The world rooms a line can be reported from: the global channels the server
 * issues at base load, as `chatChannels.ts` `validateChannel` accepts them.
 * Alliance rooms are left out; the web client has none yet.
 */
const WORLD_CHANNELS = new Set([...Object.values(CHANNELS), INFERNO_CHAT_CHANNEL]);

const ReportSchema = z.object({
  userid: z.coerce.number().int().positive(),
  channel: z.string().refine((channel) => WORLD_CHANNELS.has(channel)),
  message: z.string().trim().min(1).max(CHAT_REPORT_MAX_TEXT * 2),
  ts: z.coerce.number().int().positive(),
});

const YardSchema = z.object({ userid: z.coerce.number().int().positive() });

const refused = (status: number, error: string, reason: string): ChatAnswer => ({
  status,
  body: { error, reason },
});

export const reportAnswer = async (
  em: EntityManager,
  user: User,
  rawBody: unknown,
  readHistory: HistoryReader,
): Promise<ChatAnswer> => {
  const parsed = ReportSchema.safeParse(rawBody ?? {});
  if (!parsed.success) return refused(Status.BAD_REQUEST, "That message could not be reported.", "badRequest");

  const { userid, channel, message, ts } = parsed.data;
  if (userid === user.userid) return refused(Status.BAD_REQUEST, "You cannot report yourself.", "self");

  const history = await readHistory(channel);
  const result = await recordChatReport(em, { reporter: user.userid, reported: userid, channel, message, ts }, history);

  return { status: Status.OK, body: { error: 0, ...result } };
};

export const yardAnswer = async (em: EntityManager, rawQuery: unknown): Promise<ChatAnswer> => {
  const parsed = YardSchema.safeParse(rawQuery ?? {});
  if (!parsed.success) return refused(Status.BAD_REQUEST, "That player could not be found.", "badRequest");

  const player = await em.findOne(
    User,
    { userid: parsed.data.userid },
    { fields: ["userid", "username", "banned", "save.baseid"] },
  );
  const baseid = player?.save?.baseid;

  if (!player || player.banned || !baseid) {
    return refused(Status.NOT_FOUND, "That player's yard could not be found.", "notFound");
  }

  return { status: Status.OK, body: { error: 0, baseid: String(baseid), name: player.username } };
};
