import { Entity, Index, OneToOne, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import type { Opt } from "@mikro-orm/core";
import { AllianceStats } from "./alliancestats.view.js";
import { AllianceJoinMode, AllianceType } from "../../enums/Alliance.js";
import { ALLIANCE_AD } from "../../config/AllianceConfig.js";

@Entity({ tableName: "alliance" })
export class Alliance {
  @PrimaryKey({ autoincrement: true, type: "number" })
  id!: number;

  @Property({ type: "string" })
  name!: string;

  @Property({ type: "number", default: 1 })
  image: Opt<number> = 1;

  @Property({ type: "string", default: "" })
  description: Opt<string> = "";

  @Index()
  @Property({ type: "number" })
  leader_userid!: number;

  @Property({ type: "string", default: "" })
  leader_name: Opt<string> = "";

  @Property({ type: "string" })
  world_id!: string;

  @Property({ type: "number", default: 2 })
  map_version: Opt<number> = 2;

  @Property({ type: Date })
  created_at: Opt<Date> = new Date();

  /** Midas' Council, Conquest Horde or Fortress Legion: sets the member and Officer limits. */
  @Property({ type: "string", length: 16, default: AllianceType.MIDAS })
  type: Opt<AllianceType> = AllianceType.MIDAS;

  /** When the type last changed; null if it never has. A down switch waits from here. */
  @Property({ type: Date, nullable: true })
  type_changed_at?: Date | null = null;

  /** Alliance points not yet spent. Nothing earns them yet (a later phase). */
  @Property({ type: "number", default: 0 })
  points: Opt<number> = 0;

  /** Alliance points spent on constellation stars. Nothing spends them yet (a later phase). */
  @Property({ type: "number", default: 0 })
  points_spent: Opt<number> = 0;

  /** Constellation steps lit, per constellation id of its type (`allianceBonuses.ts`); reset on a type switch. */
  @Property({ type: "json", default: "{}" })
  stars: Opt<Record<string, number>> = {};

  /** When the leader last renamed it; once per `RENAME_COOLDOWN_DAYS`. */
  @Property({ type: Date, nullable: true })
  renamed_at?: Date | null = null;

  /** Set by an admin rename: the leader may pick a new name at once. */
  @Property({ type: "boolean", default: false })
  must_rename: Opt<boolean> = false;

  /** Open, Ask to join or Invite only (the marketplace ad, design v5 §7a). */
  @Property({ type: "string", length: 8, default: AllianceJoinMode.ASK })
  join_mode: Opt<AllianceJoinMode> = AllianceJoinMode.ASK;

  /** The ad's language: a country code from the chat country list, or null for any. */
  @Property({ type: "string", length: 2, nullable: true })
  language?: string | null = null;

  /** The ad's time zone as a whole GMT band (-12 to 14), or null when not set. */
  @Property({ type: "smallint", nullable: true })
  time_zone?: number | null = null;

  /** Lowest player level that may ask or join; the floor (`ALLIANCE_AD.minLevel.min`) takes anyone. */
  @Property({ type: "smallint", default: ALLIANCE_AD.minLevel.min })
  min_level: Opt<number> = ALLIANCE_AD.minLevel.min;

  @OneToOne({ entity: () => AllianceStats, mappedBy: "alliance" })
  stats?: AllianceStats;
}
