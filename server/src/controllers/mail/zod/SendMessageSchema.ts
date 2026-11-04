import z from "zod";
import { MessageType } from "../../../enums/MessageType.js";

/**
 * Schema for validating and transforming send message data.
 * The client sends data stringified, or in unexpected ways, so we need to transform it.
 * Add more properties as needed and handle accordingly.
 *
 * @type {z.ZodObject}
 */
export const SendMessageSchema = z.object({
  /**
   * The subject of the message, set when compose first thread. The compose
   * box stops at 60 characters, but a reply carries its thread's subject,
   * and the server writes longer ones ("Bug report #12: <60 characters>",
   * invitations with both names), so the cap here is looser. It bounds the
   * word filter's work on a player-sent text.
   * @type {string}
   */
  subject: z.string().max(200),

  /**
   * The message type.
   * @type {MessageType}
   */
  type: z.enum(MessageType),

  /**
   * the content of the message
   */
  message: z.string().max(580).min(1),

  /**
   * userid of the recipient of the message
   * @type {number}
   */
  targetid: z.string().transform((id) => parseInt(id)),

  /**
   * the id of the thread
   * @type {number}
   */
  threadid: z.string().transform((id) => parseInt(id)),

  /**
   * The baseid of the reciepent for migraterequest.
   * @type {string}
   */
  targetbaseid: z.string(),

  /**
   * The baseid for migraterequest.
   * @type {string}
   */
  baseid: z.string().optional(),
});
