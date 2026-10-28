import { Migration } from "@mikro-orm/migrations";

/**
 * The in-game announcements the owner writes on the dashboard
 * (`services/announcements/announcements.ts`):
 *
 * - `bym.announcement`: a title and plain text, a draft or published, with
 *   an optional start and end time. Players see the published ones in date.
 * - `bym.announcement_image`: its pictures (JPEG, PNG or WebP bytes), in
 *   order. They go with the announcement.
 * - `bym.announcement_dismissal`: which player pressed "Got it" on which
 *   announcement, so it does not pop up again on any device. It goes with
 *   the player's account or the announcement.
 *
 * Additive only.
 */
export class CreateAnnouncementTables extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."announcement" (
        "id"           bigserial   PRIMARY KEY,
        "title"        text        NOT NULL,
        "body"         text        NOT NULL,
        "status"       text        NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published')),
        "starts_at"    timestamptz NULL,
        "ends_at"      timestamptz NULL,
        "published_at" timestamptz NULL,
        "created_by"   integer     NULL,
        "updated_by"   integer     NULL,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "announcement_published" ON "bym"."announcement" ("published_at") WHERE "status" = 'published';`,
    );

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."announcement_image" (
        "id"              bigserial   PRIMARY KEY,
        "announcement_id" bigint      NOT NULL REFERENCES "bym"."announcement" ("id") ON DELETE CASCADE,
        "position"        smallint    NOT NULL DEFAULT 0,
        "type"            text        NOT NULL,
        "bytes"           bytea       NOT NULL,
        "created_at"      timestamptz NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "announcement_image_announcement" ON "bym"."announcement_image" ("announcement_id", "position");`,
    );

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."announcement_dismissal" (
        "userid"          integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "announcement_id" bigint      NOT NULL REFERENCES "bym"."announcement" ("id") ON DELETE CASCADE,
        "dismissed_at"    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("userid", "announcement_id")
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "announcement_dismissal_announcement" ON "bym"."announcement_dismissal" ("announcement_id");`,
    );
  }
}
