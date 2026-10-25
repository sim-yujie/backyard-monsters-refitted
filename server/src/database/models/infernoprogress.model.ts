import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { type Opt, PrimaryKeyProp } from "@mikro-orm/core";

/**
 * How far a player is on the way into the Inferno (`docs/design/inferno.md`
 * §3.1; migration `20261025_CreateInfernoProgressTable.ts`): the cave's
 * emergence level, the Descent, the captured Inferno yard and Korath. One row
 * per player, made the first time something is written; no row reads as
 * {@link NO_INFERNO_PROGRESS} (`services/inferno/infernoProgress.ts`).
 *
 * Server-only: no property is a `@FrontendKey`, and no client route writes
 * it. `GET /bm/inferno/state` answers a view of it.
 */
@Entity({ tableName: "inferno_progress" })
export class InfernoProgress {
  [PrimaryKeyProp]?: "userid";

  @PrimaryKey({ type: "number", autoincrement: false })
  userid!: number;

  /** The cave's level, 0-5: one per emergence raid. */
  @Property({ type: "number", columnType: "smallint", default: 0 })
  emergence_level: Opt<number> = 0;

  /** When the cave last went up a level; null before the first. */
  @Property({ type: Date, nullable: true })
  emergence_last_at?: Date | null;

  /** The 13 Descent yards, in order: 1 once beaten. Shorter while not all were attacked. */
  @Property({ type: "json", columnType: "jsonb", default: "'[]'::jsonb" })
  descent_destroyed: Opt<number[]> = [];

  /** The best damage (0-100) reached on each Descent yard, in order. */
  @Property({ type: "json", columnType: "jsonb", default: "'[]'::jsonb" })
  descent_best: Opt<number[]> = [];

  /** When the 13th Descent yard fell; null until then. */
  @Property({ type: Date, nullable: true })
  descent_passed_at?: Date | null;

  /** The player's Inferno yard, made at the capture; null until then. */
  @Property({ type: "string", columnType: "varchar(255)", nullable: true })
  inferno_baseid?: string | null;

  /** When owning an Inferno yard unlocked Korath (owner I10). */
  @Property({ type: Date, nullable: true })
  korath_unlocked_at?: Date | null;

  /** When the player was told Korath is unlocked. */
  @Property({ type: Date, nullable: true })
  korath_notice_at?: Date | null;

  /** The one-time story popups shown, by key: unix seconds each was shown. */
  @Property({ type: "json", columnType: "jsonb", default: "'{}'::jsonb" })
  popups_seen: Opt<Record<string, number>> = {};

  @Property({ type: Date, defaultRaw: "now()" })
  created_at: Opt<Date> = new Date();

  @Property({ type: Date, defaultRaw: "now()" })
  updated_at: Opt<Date> = new Date();
}
