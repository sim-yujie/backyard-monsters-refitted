import { Migration } from "@mikro-orm/migrations";

/**
 * Adds save.onboarding, the new-player tutorial's server-only record: the
 * guided start's step and grant ledger, the practice camp, Goals, counters and
 * tips seen (`services/onboarding/state.ts`, `docs/design/tutorial.md` §8.2,
 * issue #227).
 *
 * Every existing main save is an account from before the tutorial, so it gets
 * the legacy record: it never sees the guided start, the staged raid counts as
 * seen (goal D1 is met), and `goalsBaseline: "pending"` asks the Goals package
 * to mark whatever the save already meets as claimed with no reward the first
 * time it reads it (decision Q1 of 2026-10-01; the rules are TypeScript, not
 * SQL). The literal equals `LEGACY_ONBOARDING_JSON` in `state.ts` (a test
 * checks). Outposts, Inferno yards and tribe rows stay NULL: only the main
 * save holds the record.
 */
export class AddOnboardingToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "onboarding" jsonb NULL;
    `);
    this.addSql(`
      UPDATE "bym"."save"
        SET "onboarding" = '{"v":1,"guide":{"state":"legacy"},"raidSeen":1,"goalsBaseline":"pending"}'
        WHERE "type" = 'main' AND "onboarding" IS NULL;
    `);
  }
}
