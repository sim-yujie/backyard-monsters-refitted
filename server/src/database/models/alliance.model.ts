import { Entity, Index, OneToOne, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import type { Opt } from "@mikro-orm/core";
import { AllianceStats } from "./alliancestats.view.js";
import { AllianceType } from "../../enums/Alliance.js";

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

  /** When the leader last renamed it; once per `RENAME_COOLDOWN_DAYS`. */
  @Property({ type: Date, nullable: true })
  renamed_at?: Date | null = null;

  /** Set by an admin rename: the leader may pick a new name at once. */
  @Property({ type: "boolean", default: false })
  must_rename: Opt<boolean> = false;

  @OneToOne({ entity: () => AllianceStats, mappedBy: "alliance" })
  stats?: AllianceStats;
}
