import { Migration } from "@mikro-orm/migrations";

/**
 * The moderator chat filter (owner, 24 Nov 2026; `services/chat/chatFilter.ts`).
 *
 * - `bym.chat_watch_word`: the watched words the dashboard's Chat filter tab
 *   edits. `kind` is `always` (watched anywhere), `near` (FB, Facebook: only
 *   right next to a `context` word) or `context` (group, gc, add, join,
 *   link). Seeded with the owner's list. The chat server reads it every
 *   minute and when the dashboard changes it.
 * - `bym.chat_flag` gains the filter's facts: `tags` (`newLink`, `invite`,
 *   `watched`, `hidden`, comma separated; null for a word-filter flag),
 *   `hidden` (nobody but the sender saw the line), `line_id` (the chat
 *   line's id, for Remove), `yard_age_h` (a new player's main yard age in
 *   hours when they said it; null for older players) and `removed_at` /
 *   `removed_by` (a moderator took the line out of chat). A flag the filter
 *   alone raised has `severity` `filter`.
 *
 * Only adds.
 */
export class AddChatFilter extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."chat_watch_word" (
        "id"         serial       PRIMARY KEY,
        "word"       varchar(40)  NOT NULL,
        "kind"       varchar(8)   NOT NULL,
        "added_by"   integer      NULL,
        "created_at" timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "chat_watch_word_once" UNIQUE ("word", "kind")
      );
    `);
    this.addSql(`
      INSERT INTO "bym"."chat_watch_word" ("word", "kind") VALUES
        ('private server', 'always'), ('telegram', 'always'), ('tele', 'always'), ('tg', 'always'), ('t.me', 'always'),
        ('fb', 'near'), ('facebook', 'near'),
        ('group', 'context'), ('gc', 'context'), ('add', 'context'), ('join', 'context'), ('link', 'context')
      ON CONFLICT DO NOTHING;
    `);
    this.addSql(`ALTER TABLE "bym"."chat_flag" ADD COLUMN IF NOT EXISTS "tags" varchar(40) NULL;`);
    this.addSql(`ALTER TABLE "bym"."chat_flag" ADD COLUMN IF NOT EXISTS "hidden" boolean NOT NULL DEFAULT false;`);
    this.addSql(`ALTER TABLE "bym"."chat_flag" ADD COLUMN IF NOT EXISTS "line_id" varchar(24) NULL;`);
    this.addSql(`ALTER TABLE "bym"."chat_flag" ADD COLUMN IF NOT EXISTS "yard_age_h" integer NULL;`);
    this.addSql(`ALTER TABLE "bym"."chat_flag" ADD COLUMN IF NOT EXISTS "removed_at" timestamptz NULL;`);
    this.addSql(`ALTER TABLE "bym"."chat_flag" ADD COLUMN IF NOT EXISTS "removed_by" integer NULL;`);
  }

  async down(): Promise<void> {
    for (const column of ["tags", "hidden", "line_id", "yard_age_h", "removed_at", "removed_by"]) {
      this.addSql(`ALTER TABLE "bym"."chat_flag" DROP COLUMN IF EXISTS "${column}";`);
    }
    this.addSql(`DROP TABLE IF EXISTS "bym"."chat_watch_word";`);
  }
}
