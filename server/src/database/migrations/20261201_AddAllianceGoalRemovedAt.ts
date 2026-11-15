import { Migration } from "@mikro-orm/migrations";

/**
 * A removed weekly goal stays on record for the rest of its week (owner,
 * 15 Nov 2026: the Leader or an Officer may remove any unfinished goal, and a
 * kind used this week cannot be set again that week).
 *
 * - `bym.alliance_goal.removed_at`: when the goal was removed; null while it
 *   is live. A removed goal gains nothing, is not shown, frees its weekly
 *   slot, and its kind stays taken for the week (the table's
 *   `UNIQUE (alliance_id, week, kind)` keeps it so).
 *
 * Additive only: one nullable column, no rows rewritten. Goals removed before
 * this were deleted, so their kinds are free again this week, as before.
 */
export class Migration20261201_AddAllianceGoalRemovedAt extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE bym.alliance_goal ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ`);
  }

  async down(): Promise<void> {
    this.addSql(`DELETE FROM bym.alliance_goal WHERE removed_at IS NOT NULL`);
    this.addSql(`ALTER TABLE bym.alliance_goal DROP COLUMN IF EXISTS removed_at`);
  }
}
