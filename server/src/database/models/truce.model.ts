import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { TruceStatus } from "../../enums/TruceStatus.js";

@Index({ properties: ["initiator_userid", "status"] })
@Index({ properties: ["recipient_userid", "status"] })
@Entity({ tableName: "truce" })
export class Truce {
  @PrimaryKey({ type: "number" })
  id!: number;

  @Property({ type: "number" })
  initiator_userid!: number;

  @Property({ type: "number" })
  recipient_userid!: number;

  @Property({ type: "string" })
  status: TruceStatus = TruceStatus.REQUESTED;

  /**
   * Unix seconds. An accepted truce: when it ends. A rejected request: when its
   * proposer may ask the same player again (2 days on, #203). Unset while a
   * request waits.
   */
  @Property({ type: "number", nullable: true })
  expires_at?: number;

  @Property({ type: Date })
  created_at: Date = new Date();
}
