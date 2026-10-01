import { Migration } from "@mikro-orm/migrations";

/**
 * Creates bym.attack_plan, the plans auto-attack repeats (issue #221).
 *
 * One row per player, Map Room 2 camp tribe (`wmid`) and level, and slot: the
 * last attack the player played by hand on any camp of that tribe and level,
 * as the server fought it. `slot` is `last` for every row today; named plans
 * would add other slots beside it.
 */
export class CreateAttackPlanTable extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.attack_plan (
        userid      INTEGER      NOT NULL,
        wmid        INTEGER      NOT NULL,
        level       INTEGER      NOT NULL,
        slot        VARCHAR(32)  NOT NULL DEFAULT 'last',
        baseid      VARCHAR(255) NOT NULL,
        plan        JSONB        NOT NULL,
        recorded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (userid, wmid, level, slot)
      )
    `);
  }
}
