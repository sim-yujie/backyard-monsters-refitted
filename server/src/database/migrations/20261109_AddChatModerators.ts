import { Migration } from "@mikro-orm/migrations";

/**
 * Chat moderators (owner, 7 Nov 2026): players the owner names on the
 * dashboard's Moderators list. Their chat lines carry a blue [Mod] badge;
 * they get no other powers (`services/admin/chatModerators.ts`).
 *
 * - `bym.chat_moderator`: one row per moderator, who added them and when.
 *   Removing a moderator deletes the row; the dashboard action is in the
 *   server log ("Dashboard: mod add/remove ...").
 *
 * Only adds. Rows are written by raw SQL that sets every NOT NULL column.
 */
export class AddChatModerators extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."chat_moderator" (
        "userid"     integer     PRIMARY KEY REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "added_by"   integer     NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "bym"."chat_moderator";`);
  }
}
