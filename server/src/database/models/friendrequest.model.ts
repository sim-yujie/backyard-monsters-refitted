import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { BigIntType, type Opt, PrimaryKeyProp } from "@mikro-orm/core";

/** Where a friend request stands. Only `pending` ones can be answered or cancelled. */
export type FriendRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

/**
 * One friend request (`docs/design/friends.md` §6.1, issue #368), kept after
 * it is answered: a decline holds back the next ask for 7 days, and the day's
 * sent requests count toward the daily cap. The migration allows one
 * `pending` row per ordered pair.
 */
@Entity({ tableName: "friend_request" })
@Index({ name: "friend_request_to_status", properties: ["to_userid", "status"] })
@Index({ name: "friend_request_from_created", properties: ["from_userid", "created_at"] })
export class FriendRequest {
  [PrimaryKeyProp]?: "id";

  @PrimaryKey({ type: new BigIntType("number"), autoincrement: true })
  id!: number;

  @Property({ type: "number" })
  from_userid!: number;

  @Property({ type: "number" })
  to_userid!: number;

  @Property({ type: "string", columnType: "text", default: "pending" })
  status: Opt<FriendRequestStatus> = "pending";

  @Property({ type: Date, defaultRaw: "now()" })
  created_at: Opt<Date> = new Date();

  @Property({ type: Date, nullable: true })
  answered_at?: Date | null;
}
