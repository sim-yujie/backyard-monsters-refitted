import { Migration } from "@mikro-orm/migrations";

/**
 * The two `attack_logs` indexes the model has always named
 * (`models/attacklogs.model.ts`) but no migration made, so every read of one
 * player's attacks (the game's Attack log and the dashboard's) read the whole
 * table. Same names MikroORM gives them, so a schema diff sees no change.
 * The table is small and only written when an attack starts, so a plain
 * (locking) build takes a moment.
 */
export class Migration20261113_AddAttackLogIndexes extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      CREATE INDEX IF NOT EXISTS attack_logs_attacker_userid_attacktime_index
      ON bym.attack_logs (attacker_userid, attacktime)
    `);
    await this.execute(`
      CREATE INDEX IF NOT EXISTS attack_logs_defender_userid_attacktime_index
      ON bym.attack_logs (defender_userid, attacktime)
    `);
  }

  async down(): Promise<void> {
    await this.execute(`DROP INDEX IF EXISTS bym.attack_logs_attacker_userid_attacktime_index`);
    await this.execute(`DROP INDEX IF EXISTS bym.attack_logs_defender_userid_attacktime_index`);
  }
}
