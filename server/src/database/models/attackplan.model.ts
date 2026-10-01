import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { type Opt, PrimaryKeyProp } from "@mikro-orm/core";

/**
 * A player's plan for a Map Room 2 wild monster camp's tribe and level
 * (issue #221, `services/base/autoAttack/attackPlan.ts`). One row per player,
 * tribe, level and slot; v1 keeps only the `last` slot, the last attack
 * played by hand.
 */
@Entity({ tableName: "attack_plan" })
export class AttackPlanRow {
  [PrimaryKeyProp]?: ["userid", "wmid", "level", "slot"];

  @PrimaryKey({ type: "number" })
  userid!: number;

  /** The camp's tribe, as its `wmid`. */
  @PrimaryKey({ type: "number" })
  wmid!: number;

  @PrimaryKey({ type: "number" })
  level!: number;

  /** `last` for the last hand-played attack; named plans later. */
  @PrimaryKey({ type: "string" })
  slot: Opt<string> = "last";

  /** The camp the plan was played on. */
  @Property({ type: "string" })
  baseid!: string;

  /** `{ v: 1, tick, events }`. */
  @Property({ type: "json" })
  plan!: unknown;

  @Property({ type: Date })
  recorded_at: Opt<Date> = new Date();
}
