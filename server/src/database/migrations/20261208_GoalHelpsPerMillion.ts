import { Migration } from "@mikro-orm/migrations";

/**
 * `bym.alliance_contribution.goal_helps` moves from per mille to per million
 * of a goal (`allianceProgress.ts` addGoalProgress). Since the 24 Nov targets
 * (Hard x10), one tribe yard is a tenth of a per mille of a Hard goal and
 * rounded to nothing, so a member who only helped Medium and Hard goals was
 * not counted as helping. Existing tallies are scaled to the new unit.
 */
export class GoalHelpsPerMillion extends Migration {
  async up(): Promise<void> {
    this.addSql(`UPDATE bym.alliance_contribution SET goal_helps = goal_helps * 1000 WHERE goal_helps <> 0`);
  }

  async down(): Promise<void> {
    this.addSql(`UPDATE bym.alliance_contribution SET goal_helps = goal_helps / 1000 WHERE goal_helps <> 0`);
  }
}
