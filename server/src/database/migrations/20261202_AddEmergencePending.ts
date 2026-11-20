import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `emergence_pending` to `bym.inferno_progress` (patch 7.12, owner's
 * A + C, 19 Nov 2026): the cave level whose Moloch raid has been raised but
 * not yet played to its landing, or null. While it is set the main yard's
 * next load plays that stage's earthquake, warning and fight again
 * (`emergenceOnLoad.ts`), and the cave does not rise further.
 *
 * Every existing row gets null: stages raised before this patch are not run
 * again (owner's C, no back-pay). Additive only: a nullable column, no rows
 * rewritten.
 */
export class Migration20261202_AddEmergencePending extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."inferno_progress"
        ADD COLUMN IF NOT EXISTS "emergence_pending" smallint NULL
          CHECK ("emergence_pending" BETWEEN 1 AND 5);
    `);
  }
}
