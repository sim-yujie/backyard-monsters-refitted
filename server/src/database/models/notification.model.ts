import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { BigIntType, type Opt, PrimaryKeyProp } from "@mikro-orm/core";

/** A `jobs` row is one kind of job from a yard answer; an `away` row is a whole load's. */
export type NotificationKind = "jobs" | "away";

/**
 * One entry in the yard's notification list (issue #257,
 * `services/notifications/notifications.ts`): what the catch-up finished, as
 * the yard once told it in a toast. Read and written only for its own player.
 */
@Entity({ tableName: "notification" })
@Index({ name: "notification_userid_created_at", properties: ["userid", "created_at"] })
export class Notification {
  [PrimaryKeyProp]?: "id";

  @PrimaryKey({ type: new BigIntType("number"), autoincrement: true })
  id!: number;

  @Property({ type: "number" })
  userid!: number;

  /** The outpost the jobs finished on; null for the main yard. */
  @Property({ type: "string", nullable: true })
  baseid?: string | null;

  @Property({ type: "string", columnType: "text" })
  kind!: NotificationKind;

  /** The catch-up's `completed` entries, as the answer carried them. */
  @Property({ type: "json", columnType: "jsonb" })
  jobs!: unknown[];

  /** When the player clicked it; null while unread. */
  @Property({ type: Date, nullable: true })
  read_at?: Date | null;

  @Property({ type: Date })
  created_at: Opt<Date> = new Date();
}
