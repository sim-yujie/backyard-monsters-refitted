import { Migration } from "@mikro-orm/migrations";
import { inferStarterKit } from "../../services/yard/inferStarterKit.js";

/**
 * Fills save.starterkit for outposts that took a Starter Kit before the column
 * existed (20261007_AddStarterKitToSave): they all read 0, so Map Room 2 drew
 * them as "No kit". The kit itself left no marker, so it is read back from the
 * outpost's layout (`inferStarterKit`). Outposts with no kit stay at 0.
 */
export class BackfillStarterKitOnOutposts extends Migration {
  async up(): Promise<void> {
    const rows = (await this.execute(
      `SELECT "basesaveid", "buildingdata" FROM "bym"."save" WHERE "type" = 'outpost' AND "starterkit" = 0`
    )) as { basesaveid: number | string; buildingdata: unknown }[];
    for (const row of rows) {
      let data = row.buildingdata;
      // MikroORM stores JSON double-encoded as a jsonb string on some rows.
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          continue;
        }
      }
      const kit = inferStarterKit(data as Record<string, never> | null);
      if (kit > 0) {
        this.addSql(`UPDATE "bym"."save" SET "starterkit" = ${kit} WHERE "basesaveid" = ${Number(row.basesaveid)};`);
      }
    }
  }
}
