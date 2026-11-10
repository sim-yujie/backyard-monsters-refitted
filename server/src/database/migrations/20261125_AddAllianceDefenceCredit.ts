import { Migration } from "@mikro-orm/migrations";

/**
 * Fortress's "Outposts attacked but not taken" goal counts one held defence
 * per attacker per outpost per UTC day (`noteOutpostDefended` in
 * `services/alliance/allianceProgress.ts`): this table remembers which were
 * counted. Rows older than a week are dropped by the daily territory tally.
 *
 * Only adds.
 */
export class Migration20261125_AddAllianceDefenceCredit extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.alliance_defence_credit (
        outpost BIGINT NOT NULL,
        attacker INTEGER NOT NULL,
        day DATE NOT NULL,
        PRIMARY KEY (outpost, attacker, day)
      )
    `);
  }
}
