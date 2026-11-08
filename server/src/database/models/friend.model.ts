import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { type Opt, PrimaryKeyProp } from "@mikro-orm/core";

/**
 * One side of a friendship (`docs/design/friends.md` §6.1, issue #368): a
 * friendship is two rows, one each way, written and removed together
 * (`services/friends/friendships.ts`). `created_at` is "friends since".
 */
@Entity({ tableName: "friend" })
@Index({ name: "friend_friend_userid", properties: ["friend_userid"] })
export class Friend {
  [PrimaryKeyProp]?: ["userid", "friend_userid"];

  @PrimaryKey({ type: "number" })
  userid!: number;

  @PrimaryKey({ type: "number" })
  friend_userid!: number;

  @Property({ type: Date, defaultRaw: "now()" })
  created_at: Opt<Date> = new Date();

  /** When this player pinned the friend to the top of their list (up to 10); null when not pinned. */
  @Property({ type: Date, nullable: true })
  pinned_at?: Date | null;
}
