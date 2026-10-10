import { Migration } from "@mikro-orm/migrations";
import { townHallColumnValue } from "../../services/yard/townHallColumn.js";

/**
 * Adds save.thlevel: the main yard's Town Hall level, so Map Room 2 can draw
 * each player's home cell with the hall picture for that level without
 * loading every cell's `buildingdata` blob. `Save` keeps it in step on every
 * write (`syncTownHallLevel`). 0 means no hall, or not worked out yet.
 *
 * The backfill reads each main save's blob once, here, and writes only the
 * rows whose hall is above 0.
 */
export class AddTownHallLevelToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "thlevel" int NOT NULL DEFAULT 0;
    `);
    const rows = (await this.execute(
      `SELECT "basesaveid", "buildingdata" FROM "bym"."save" WHERE "type" = 'main'`
    )) as { basesaveid: number | string; buildingdata: unknown }[];
    for (const row of rows) {
      const level = townHallColumnValue(row.buildingdata);
      if (level > 0) {
        this.addSql(`UPDATE "bym"."save" SET "thlevel" = ${level} WHERE "basesaveid" = ${Number(row.basesaveid)};`);
      }
    }
  }
}
