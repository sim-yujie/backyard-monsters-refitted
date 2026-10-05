import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { BigIntType, type Opt, PrimaryKeyProp } from "@mikro-orm/core";

/** How a bot's progression weighs its next build (`docs/design/bot-neighbours.md` §4.2). */
export type BotPersona = "economy" | "towers" | "army";

/**
 * `retired` bots have moved off Map Room 1 and are never picked again (§4.4).
 * `seeded` rows are not bots at all but `db:seed:mr2` dev players, kept here
 * only so the sweep repairs and grows their yards outside production (issue
 * #233, `services/bots/seededPlayers.ts`): never a neighbour, never retired,
 * never counted in the bot total, and `isBot` is false for them.
 */
export type BotState = "active" | "retired" | "seeded";

/**
 * A computer-run Map Room 1 player (issue #235, `docs/design/bot-neighbours.md`
 * §4.1 and §5). The bot's account is an ordinary `user` row and its yard an
 * ordinary main `save`; this row is the only thing that marks it as a bot.
 *
 * Server-only: no property is a `@FrontendKey` and no response may carry this
 * row or anything read from it. Ask {@link isBot} (`services/bots/isBot.ts`).
 */
@Entity({ tableName: "bot" })
@Index({ name: "bot_state_level", properties: ["state", "level"] })
export class Bot {
  [PrimaryKeyProp]?: "userid";

  /** The bot's `user.userid`. */
  @PrimaryKey({ type: "number", autoincrement: false })
  userid!: number;

  /** Seeds the bot's layout and progression RNG. */
  @Property({ type: new BigIntType("number") })
  seed!: number;

  @Property({ type: "string", columnType: "text" })
  persona!: BotPersona;

  /** `calculateBaseLevel` of the bot's yard, kept by the brain. */
  @Property({ type: "number" })
  level!: number;

  /** When the bot reached {@link level}, for its growth pace. */
  @Property({ type: Date })
  level_since!: Date;

  @Property({ type: "string", columnType: "text", default: "active" })
  state: Opt<BotState> = "active";

  @Property({ type: Date })
  created_at: Opt<Date> = new Date();

  @Property({ type: Date, nullable: true })
  retired_at?: Date | null;

  /** Grow jobs dropped in a row by the sweep; it retires the bot at `MAX_GROW_DROPS` (issue #248). */
  @Property({ type: "number", default: 0 })
  grow_drops: Opt<number> = 0;
}
