import { Migration } from "@mikro-orm/migrations";

/**
 * Renaming, reports and admin actions for alliances (alliances phase 0,
 * design v5 §6 and §13).
 *
 * `bym.alliance` gains:
 * - `renamed_at`: when the leader last renamed it; once per 7 days
 *   (`RENAME_COOLDOWN_DAYS`).
 * - `must_rename`: set when an admin renames it to "Alliance {id}"; the leader
 *   may then pick a new name at once, without the 7-day wait.
 *
 * New tables:
 * - `alliance_report`: a player reporting an alliance (name, ad or shield)
 *   for the admin dashboard. The alliance's name and ad are copied in, so the
 *   report still reads after a rename or a disband (no foreign key on purpose).
 * - `alliance_admin_action`: every admin rename, ad clear and disband, with
 *   who did it and what the alliance was called.
 *
 * Only adds; no row is removed.
 */
export class Migration20261117_AddAllianceModeration extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      ALTER TABLE bym.alliance
        ADD COLUMN IF NOT EXISTS renamed_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS must_rename BOOLEAN NOT NULL DEFAULT false
    `);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.alliance_report (
        id SERIAL PRIMARY KEY,
        alliance_id INTEGER NOT NULL,
        alliance_name VARCHAR(255) NOT NULL,
        alliance_desc TEXT NOT NULL DEFAULT '',
        reporter_id INTEGER NOT NULL,
        reason VARCHAR(255) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        closed_at TIMESTAMPTZ NULL,
        closed_by INTEGER NULL,
        outcome VARCHAR(16) NULL
      )
    `);
    await this.execute(
      `CREATE INDEX IF NOT EXISTS alliance_report_open_idx ON bym.alliance_report (created_at) WHERE closed_at IS NULL`
    );
    await this.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS alliance_report_one_open_idx
         ON bym.alliance_report (alliance_id, reporter_id) WHERE closed_at IS NULL`
    );

    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.alliance_admin_action (
        id SERIAL PRIMARY KEY,
        alliance_id INTEGER NOT NULL,
        alliance_name VARCHAR(255) NOT NULL,
        admin_id INTEGER NOT NULL,
        action VARCHAR(16) NOT NULL CHECK (action IN ('rename', 'clear_ad', 'disband')),
        detail TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.execute(
      `CREATE INDEX IF NOT EXISTS alliance_admin_action_alliance_idx ON bym.alliance_admin_action (alliance_id, created_at)`
    );
  }

  async down(): Promise<void> {
    await this.execute(`DROP TABLE IF EXISTS bym.alliance_admin_action`);
    await this.execute(`DROP TABLE IF EXISTS bym.alliance_report`);
    await this.execute(`
      ALTER TABLE bym.alliance
        DROP COLUMN IF EXISTS renamed_at,
        DROP COLUMN IF EXISTS must_rename
    `);
  }
}
