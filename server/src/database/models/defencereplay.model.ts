import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { BigIntType, PrimaryKeyProp } from "@mikro-orm/core";
import type { JsonObject } from "../../types/JsonObject.js";

/**
 * One landed attack on a player's main yard, kept so the defender can watch it
 * (`docs/design/defence-replays.md` §3, issue #357): who attacked, when, what
 * it did, and the compressed inputs to fight the battle again
 * (`services/defences/defenceReplayStore.ts`).
 *
 * The newest 20 per defender are kept; older rows are pruned on every insert.
 * The attacker's name and picture are frozen at landing, as `attack_logs`
 * freezes them. Nothing here says whether either side is a bot.
 */
@Entity({ tableName: "defence_replay" })
@Index({ name: "defence_replay_defender_landed_at", properties: ["defender_userid", "landed_at"] })
export class DefenceReplay {
  [PrimaryKeyProp]?: "id";

  @PrimaryKey({ type: new BigIntType("number"), autoincrement: true })
  id!: number;

  @Property({ type: "number" })
  defender_userid!: number;

  /** The defender's main yard. */
  @Property({ type: "string" })
  baseid!: string;

  /** The Map Room the yard was on when it was attacked: 2 for now. */
  @Property({ type: "number", columnType: "smallint" })
  map_version!: number;

  @Property({ type: "number" })
  attacker_userid!: number;

  @Property({ type: "string" })
  attacker_username!: string;

  @Property({ type: "string", columnType: "text", nullable: true })
  attacker_pic_square?: string | null;

  /** When the attack session started. */
  @Property({ type: Date })
  attacked_at!: Date;

  /** When it landed; the list sorts by this. */
  @Property({ type: Date })
  landed_at!: Date;

  /** The yard's whole damage % before and after; the attack did `after - before`. */
  @Property({ type: "number" })
  damage_before!: number;

  @Property({ type: "number" })
  damage_after!: number;

  /** What the defender lost, by resource. */
  @Property({ type: "json", columnType: "jsonb" })
  loot!: JsonObject;

  /** Housed monsters the defender lost. */
  @Property({ type: "number" })
  housed_lost!: number;

  /** The attacker left (tab closed, timed out): landed from its checkpoint. */
  @Property({ type: "boolean" })
  attacker_left!: boolean;

  /** The combat rules' manifest `version` the battle was fought under. */
  @Property({ type: "string", length: 32 })
  rules_version!: string;

  /** The gzipped replay payload; null when its inputs were missing or too big. */
  @Property({ type: "blob", columnType: "bytea", nullable: true, lazy: true })
  replay?: Buffer | null;

  /** The stored payload's size in bytes, 0 when there is none. */
  @Property({ type: "number" })
  replay_bytes!: number;
}
