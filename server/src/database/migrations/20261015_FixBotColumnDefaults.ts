import { Migration } from "@mikro-orm/migrations";

/**
 * Gives `bot_job.payload`, `bot_job.created_at` and `bot.created_at` the
 * defaults `CreateBotTables` meant them to have. A database that `db:init`
 * built with `schema:create` got these tables from the entities (which had no
 * defaults), and `CreateBotTables` then skipped them (`IF NOT EXISTS`). The bot
 * sweep inserts jobs without those columns, so every run failed with a
 * not-null violation on `payload`. Setting a default changes no row and is
 * safe to run again.
 */
export class FixBotColumnDefaults extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."bot_job" ALTER COLUMN "payload" SET DEFAULT '{}';`);
    this.addSql(`ALTER TABLE "bym"."bot_job" ALTER COLUMN "created_at" SET DEFAULT now();`);
    this.addSql(`ALTER TABLE "bym"."bot" ALTER COLUMN "created_at" SET DEFAULT now();`);
  }
}
