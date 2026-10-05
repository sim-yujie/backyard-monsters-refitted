import { Entity, Index, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/es";
import { BigIntType, type Opt, PrimaryKeyProp } from "@mikro-orm/core";

/**
 * One player's report of one world chat line (issue #282,
 * `services/chat/chatReports.ts`), kept for moderation. Nothing reads these
 * yet: there is no moderation screen.
 *
 * `message` is the server's own copy of the line when it was still in the
 * channel's history (`verified`), otherwise the words the reporter's client
 * sent, which nothing vouches for.
 */
@Entity({ tableName: "chat_report" })
@Unique({ name: "chat_report_once", properties: ["reporter_id", "reported_id", "message_ts"] })
@Index({ name: "chat_report_reported_created_at", properties: ["reported_id", "created_at"] })
export class ChatReport {
  [PrimaryKeyProp]?: "id";

  @PrimaryKey({ type: new BigIntType("number"), autoincrement: true })
  id!: number;

  @Property({ type: "number" })
  reporter_id!: number;

  @Property({ type: "number" })
  reported_id!: number;

  /** The chat channel key, e.g. `chat:mr2-global`. */
  @Property({ type: "string" })
  channel!: string;

  @Property({ type: "string", columnType: "text" })
  message!: string;

  /** When the line was said, as the chat server stamped it (ms since the epoch). */
  @Property({ type: new BigIntType("number") })
  message_ts!: number;

  /** True when `message` is the server's copy from the channel's history. */
  @Property({ type: "boolean" })
  verified!: boolean;

  @Property({ type: Date })
  created_at: Opt<Date> = new Date();
}
