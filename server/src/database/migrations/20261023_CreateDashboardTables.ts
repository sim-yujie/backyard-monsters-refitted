import { Migration } from "@mikro-orm/migrations";

/**
 * The owner's dashboard (`docs/design/admin-dashboard-api.md`):
 *
 * - `bym.daily_stat` (`services/stats/dailyStats.ts`): one row per finished
 *   UTC day, counted once the day is over. Every player count leaves out bots
 *   and test accounts (`services/stats/realPlayers.ts`). A null count means
 *   the day could not be counted (from before the dashboard, with no log file
 *   to rebuild it from); `active_source` says where `active_players` came
 *   from: `tracked` (the day-by-day record that started with the dashboard)
 *   or `logs` (rebuilt from the server's log files).
 * - `bym.app_error` (`services/errors/errorStore.ts`): browser and server
 *   errors, one row per kind of error (`fingerprint`), with how often and when
 *   it was first and last seen. `userids` holds at most a few recent account
 *   numbers and nothing else about a player. The daily clean-up deletes rows
 *   not seen for 30 days; account deletion takes the account's number out.
 * - Bug report tickets (`services/admin/bugReportsAdmin.ts`): each report gets
 *   a `status` (`new`, `working`, `fixed`, `wontfix`) and the owner's
 *   `owner_notes`, with when each last changed; `bym.bug_report_change` keeps
 *   every change with its time. Changes go with their report (the foreign key
 *   cascades, so the report clean-up and account deletion take them too).
 *
 * Additive only.
 */
export class CreateDashboardTables extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."daily_stat" (
        "day"               date        PRIMARY KEY,
        "new_players"       integer     NOT NULL DEFAULT 0,
        "total_players"     integer     NOT NULL DEFAULT 0,
        "active_players"    integer     NULL,
        "active_source"     text        NULL,
        "attacks"           integer     NOT NULL DEFAULT 0,
        "tribe_raids"       integer     NULL,
        "event_new_players" jsonb       NOT NULL DEFAULT '{}'::jsonb,
        "event_players"     jsonb       NULL,
        "bug_reports"       integer     NOT NULL DEFAULT 0,
        "browser_errors"    integer     NULL,
        "server_errors"     integer     NULL,
        "computed_at"       timestamptz NOT NULL DEFAULT now()
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."app_error" (
        "id"           bigserial   PRIMARY KEY,
        "source"       text        NOT NULL CHECK ("source" IN ('browser', 'server')),
        "fingerprint"  text        NOT NULL UNIQUE,
        "message"      text        NOT NULL,
        "place"        text        NOT NULL DEFAULT '',
        "stack"        text        NOT NULL DEFAULT '',
        "count"        integer     NOT NULL DEFAULT 1,
        "first_seen"   timestamptz NOT NULL DEFAULT now(),
        "last_seen"    timestamptz NOT NULL DEFAULT now(),
        "game_version" text        NOT NULL DEFAULT '',
        "screen"       text        NOT NULL DEFAULT '',
        "userids"      integer[]   NOT NULL DEFAULT '{}'
      );
    `);
    // The dashboard's list (newest first) and the clean-up's scan by age.
    this.addSql(`CREATE INDEX IF NOT EXISTS "app_error_last_seen" ON "bym"."app_error" ("last_seen");`);

    this.addSql(`
      ALTER TABLE "bym"."bug_report"
        ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'new'
          CHECK ("status" IN ('new', 'working', 'fixed', 'wontfix')),
        ADD COLUMN IF NOT EXISTS "owner_notes" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "status_changed_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "notes_changed_at" timestamptz NULL;
    `);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."bug_report_change" (
        "id"            bigserial   PRIMARY KEY,
        "bug_report_id" bigint      NOT NULL REFERENCES "bym"."bug_report" ("id") ON DELETE CASCADE,
        "changed_at"    timestamptz NOT NULL DEFAULT now(),
        "changed_by"    integer     NULL,
        "old_status"    text        NULL,
        "new_status"    text        NULL,
        "notes"         text        NULL
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "bug_report_change_report" ON "bym"."bug_report_change" ("bug_report_id", "changed_at");`,
    );
  }
}
