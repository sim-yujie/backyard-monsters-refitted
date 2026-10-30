import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { BigIntType, type Opt } from "@mikro-orm/core";
import { FrontendKey } from "../../utils/FrontendKey.js";
import { v4 } from "uuid";

/**
 * What an attack notice is about, as numbers (less-text job 3, 28 Oct 2026),
 * so the bell, the away line and the mailbox can show it as icons: the damage
 * the yard was left at, in percent, and the loot taken, whole units by
 * resource key (`r1`..`r4`; Bone to Magma on an Inferno notice). The housed
 * monsters lost are kept for the record but not told (owner, 27 Oct).
 */
export interface AttackStats {
  readonly damage: number;
  readonly loot: Partial<Record<"r1" | "r2" | "r3" | "r4", number>>;
  readonly housedLost?: number;
}

@Index({ properties: ["userid", "userUnread"] })
@Index({ properties: ["targetid", "targetUnread"] })
@Entity({ tableName: "message" })
export class Message {
  @PrimaryKey({ type: 'string' })
  @Property({ type: 'string' })
  id: string = v4();

  @Property({ type: 'string', persist: false })
  @FrontendKey
  messageid!: Opt<string>;

  @Index()
  @Property({ type: 'number' })
  @FrontendKey
  threadid!: number;

  @FrontendKey
  @Property({ type: 'number' })
  updatetime!: number;

  @Property({ type: 'number' })
  @FrontendKey
  userid!: number;

  @Property({ type: 'number' })
  @FrontendKey
  targetid!: number;

  @Property({ type: 'string' })
  @FrontendKey
  messagetype!: string;

  @Property({ type: 'number' })
  userUnread!: number;

  @Property({ type: 'number' })
  targetUnread!: number;

  @FrontendKey
  @Property({ type: 'number', persist: false })
  unread!: Opt<number>;

  @Property({ type: 'string', nullable: true, length: 580 })
  @FrontendKey
  message!: string;

  @Property({ type: 'string' })
  @FrontendKey
  subject!: string;

  @Property({ type: 'number', persist: false })
  @FrontendKey
  messagecount!: Opt<number>;

  @Property({ type: 'string', default: "0" })
  @FrontendKey
  reportid: Opt<string> = "0";

  @Property({ type: 'string', nullable: true })
  @FrontendKey
  truceid: string | null = null;

  @Property({ type: 'string', nullable: true })
  @FrontendKey
  trucestate: string | null = null;

  /**
   * Thread list only (#203): when the thread's truce ends, unix seconds. An
   * accepted truce's expiry, or the last moment a waiting request can be
   * answered (`truceRules.ts`). Absent when the thread has no truce.
   */
  @Property({ type: 'number', persist: false, nullable: true })
  @FrontendKey
  truceexpire?: Opt<number>;

  @Property({ type: 'string', nullable: true })
  @FrontendKey
  migratestate: string | null = null;

  @Property({ nullable: true, type: "json", columnType: "jsonb" })
  @FrontendKey
  coords: number[] | null = null;

  @Property({ type: 'string', nullable: true })
  @FrontendKey
  worldid: string | null = null;

  @Property({ type: 'string', nullable: true })
  @FrontendKey
  baseid: string | null = null;

  /**
   * An "attacked your yard" notice's defence replay (`defence_replay.id`,
   * `docs/design/defence-replays.md` §8), for its Watch button; null on every
   * other message, and once the replay is pruned. The mail API returns it
   * (#361); only the defender is ever sent a notice that has one.
   */
  @Property({ type: new BigIntType("number"), nullable: true })
  @FrontendKey
  replayid: number | null = null;

  /**
   * On the game's attack notices (`outpostattacked`, `outposttaken`,
   * `yardattacked`), the player who did it, for the notice's Add friend
   * (friends WP11, #378); null on every other message and on older notices.
   */
  @Property({ type: "number", nullable: true })
  @FrontendKey
  byuserid: number | null = null;

  /**
   * On the game's attack notices (`outpostattacked`, `yardattacked`,
   * `infernoattacked`), the attack's numbers ({@link AttackStats}); null on
   * every other message and on notices written before 28 Oct 2026, which keep
   * only their sentence.
   */
  @Property({ nullable: true, type: "json", columnType: "jsonb" })
  @FrontendKey
  attackstats: AttackStats | null = null;

  @Property({ type: Date, onCreate: () => new Date() })
  createdAt: Opt<Date> = new Date();

  selectUnread(userid: number) {
    this.unread = this.userid === userid ? this.userUnread : this.targetUnread;
  }
}
