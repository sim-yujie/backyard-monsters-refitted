import { Migration } from "@mikro-orm/migrations";

/**
 * Creates bym.notification, the yard's notification list behind the bell
 * (issue #257, `services/notifications/notifications.ts`).
 *
 * One row per thing the yard used to announce with a toast: a kind of job the
 * catch-up finished in a yard answer (`kind` `jobs`), or everything the
 * owner's yard load finished while they were away (`away`). `jobs` holds the
 * catch-up's `completed` entries as they were, for the client to word.
 * `baseid` is the outpost the jobs finished on, null for the main yard.
 * `read_at` stays null until the player clicks the notification.
 *
 * The server keeps the newest 20 per player and nothing older than 7 days,
 * pruned on every write. The rows go with their player.
 */
export class CreateNotificationTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."notification" (
        "id"         bigserial    PRIMARY KEY,
        "userid"     integer      NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "baseid"     varchar(255) NULL,
        "kind"       text         NOT NULL,
        "jobs"       jsonb        NOT NULL,
        "read_at"    timestamptz  NULL,
        "created_at" timestamptz  NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "notification_userid_created_at" ON "bym"."notification" ("userid", "created_at");`,
    );
  }
}
