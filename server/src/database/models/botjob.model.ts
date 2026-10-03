import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { BigIntType, type Opt, PrimaryKeyProp } from "@mikro-orm/core";

import type { JsonObject } from "../../types/JsonObject.js";

/** The work a bot job does when due (`docs/design/bot-neighbours.md` §6). */
export type BotJobKind = "grow" | "repair" | "revenge" | "declineTruce" | "rebalance";

/**
 * One piece of bot work due at a future time (issue #235,
 * `docs/design/bot-neighbours.md` §5 and §6), claimed by the bot sweep. The
 * table allows one pending `grow` and one `repair` per bot, and one `revenge`
 * per bot and player (partial unique indexes in the migration).
 *
 * Server-only, like {@link Bot}.
 */
@Entity({ tableName: "bot_job" })
@Index({ name: "bot_job_due", properties: ["due_at"] })
export class BotJob {
  [PrimaryKeyProp]?: "id";

  @PrimaryKey({ type: new BigIntType("number"), autoincrement: true })
  id!: number;

  /** The bot the job belongs to (`bot.userid`). */
  @Property({ type: "number" })
  bot_userid!: number;

  @Property({ type: "string", columnType: "text" })
  kind!: BotJobKind;

  /** The player a `revenge` or `declineTruce` job is about. */
  @Property({ type: "number", nullable: true })
  target_userid?: number | null;

  @Property({ type: Date })
  due_at!: Date;

  /** A `revenge` job gives up at this time: 72 hours after the attack that triggered it. */
  @Property({ type: Date, nullable: true })
  giveup_at?: Date | null;

  @Property({ type: "number", default: 0 })
  attempts: Opt<number> = 0;

  @Property({ type: "json", columnType: "jsonb" })
  payload: Opt<JsonObject> = {};

  @Property({ type: Date })
  created_at: Opt<Date> = new Date();
}
