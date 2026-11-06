import { Migration } from "@mikro-orm/migrations";

/**
 * Player profiles (beta 7, owner 6 Nov 2026, grill Q27-28): a short bio and
 * an optional photo, with "Report inappropriate image". `services/profile/`.
 *
 * - `bym.player_profile`: one row per player who wrote a bio or uploaded a
 *   photo. `photo` is the server's own 128x128 JPEG (`services/profile/photo.ts`,
 *   ~6-12 KB), kept in the database rather than on disk so it is in the
 *   nightly backup and survives a restart or a redeploy of the server's
 *   container with nothing else to set up. `photo_version` goes up with
 *   every upload: the picture's address carries it, so a new photo is never
 *   served from an old cached copy. `photo_at` is the last upload, for the
 *   one-change-a-day rule. `photo_hidden`: hidden after enough reports, until
 *   the owner reviews it; `photo_kept_version`: the upload the owner looked at
 *   and kept, which reports no longer hide. `upload_blocked`: the owner
 *   stopped this player uploading.
 * - `bym.photo_report`: one player's report of one upload of another's
 *   photo (`photo_version`), once each. `resolved_at`/`outcome`/`resolved_by`
 *   say how it was closed: `kept`, `removed`, `blocked` (the owner) or
 *   `replaced` (the player uploaded a new photo first).
 *
 * Only adds. Rows are written by raw SQL that sets every NOT NULL column.
 */
export class CreatePlayerProfile extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."player_profile" (
        "userid"             integer      PRIMARY KEY,
        "bio"                varchar(200) NOT NULL DEFAULT '',
        "photo"              bytea        NULL,
        "photo_version"      integer      NOT NULL DEFAULT 0,
        "photo_at"           timestamptz  NULL,
        "photo_hidden"       boolean      NOT NULL DEFAULT false,
        "photo_kept_version" integer      NULL,
        "upload_blocked"     boolean      NOT NULL DEFAULT false,
        "updated_at"         timestamptz  NOT NULL DEFAULT now()
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."photo_report" (
        "id"            bigserial    PRIMARY KEY,
        "reporter_id"   integer      NOT NULL,
        "reported_id"   integer      NOT NULL,
        "photo_version" integer      NOT NULL,
        "created_at"    timestamptz  NOT NULL DEFAULT now(),
        "resolved_at"   timestamptz  NULL,
        "outcome"       varchar(12)  NULL,
        "resolved_by"   integer      NULL
      );
    `);
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "photo_report_once" ON "bym"."photo_report" ("reporter_id", "reported_id", "photo_version");`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "photo_report_open" ON "bym"."photo_report" ("reported_id") WHERE "resolved_at" IS NULL;`,
    );
    this.addSql(`CREATE INDEX IF NOT EXISTS "photo_report_resolved_at" ON "bym"."photo_report" ("resolved_at");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "bym"."photo_report";`);
    this.addSql(`DROP TABLE IF EXISTS "bym"."player_profile";`);
  }
}
