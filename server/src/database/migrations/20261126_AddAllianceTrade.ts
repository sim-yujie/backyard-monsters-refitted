import { Migration } from "@mikro-orm/migrations";

const TYPES_BEFORE = [
  "message",
  "joined",
  "left",
  "kicked",
  "promoted",
  "created",
  "relationship",
  "powerup_activated",
  "powerup_purchase",
  "officer",
  "demoted",
  "type_changed",
  "renamed",
  "takeover",
  "under_attack",
  "star_lit",
  "goal_set",
  "goal_done",
  "star_suggested",
];
const NEW_TYPES = ["trade_ask", "trade_done"];

const typeCheck = (types: string[]) => `
  ALTER TABLE bym.alliance_message
  ADD CONSTRAINT alliance_message_type_check
  CHECK (message_type IN (${types.map((type) => `'${type}'`).join(", ")}))
`;

/**
 * Trading between alliance members (beta 7 alliances phase 3, design v5
 * §12a, §12b; `services/alliance/trade.ts`).
 *
 * - `alliance_trade_request`: a member's Ask (what should arrive), open for
 *   24 hours; one open request per player (partial unique index).
 * - `alliance_trade`: every trade done. One send and one receive per player
 *   per UTC day, held by two unique indexes so two trades at once cannot
 *   both pass.
 * - New feed lines: a request posted (with Give in chat) and a trade done.
 *
 * Only adds.
 */
export class Migration20261126_AddAllianceTrade extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.alliance_trade_request (
        id SERIAL PRIMARY KEY,
        alliance_id INT NOT NULL REFERENCES bym.alliance(id) ON DELETE CASCADE,
        userid INT NOT NULL,
        amounts JSONB NOT NULL,
        reason VARCHAR(16),
        status VARCHAR(12) NOT NULL DEFAULT 'open',
        created_at INT NOT NULL,
        expires_at INT NOT NULL,
        given_by INT,
        closed_at INT
      )`);
    await this.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS alliance_trade_request_one_open ON bym.alliance_trade_request (userid) WHERE status = 'open'`
    );
    await this.execute(
      `CREATE INDEX IF NOT EXISTS alliance_trade_request_alliance ON bym.alliance_trade_request (alliance_id, status, created_at)`
    );
    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.alliance_trade (
        id SERIAL PRIMARY KEY,
        alliance_id INT NOT NULL REFERENCES bym.alliance(id) ON DELETE CASCADE,
        from_userid INT NOT NULL,
        to_userid INT NOT NULL,
        request_id INT,
        sent JSONB NOT NULL,
        arrived JSONB NOT NULL,
        lost_full JSONB NOT NULL,
        day DATE NOT NULL,
        created_at INT NOT NULL
      )`);
    await this.execute(`CREATE UNIQUE INDEX IF NOT EXISTS alliance_trade_send_day ON bym.alliance_trade (from_userid, day)`);
    await this.execute(`CREATE UNIQUE INDEX IF NOT EXISTS alliance_trade_receive_day ON bym.alliance_trade (to_userid, day)`);
    await this.execute(`CREATE INDEX IF NOT EXISTS alliance_trade_alliance ON bym.alliance_trade (alliance_id, created_at)`);
    await this.execute(`ALTER TABLE bym.alliance_message DROP CONSTRAINT IF EXISTS alliance_message_type_check`);
    await this.execute(typeCheck([...TYPES_BEFORE, ...NEW_TYPES]));
  }

  async down(): Promise<void> {
    await this.execute(`DELETE FROM bym.alliance_message WHERE message_type IN (${NEW_TYPES.map((t) => `'${t}'`).join(", ")})`);
    await this.execute(`ALTER TABLE bym.alliance_message DROP CONSTRAINT IF EXISTS alliance_message_type_check`);
    await this.execute(typeCheck(TYPES_BEFORE));
    await this.execute(`DROP TABLE IF EXISTS bym.alliance_trade`);
    await this.execute(`DROP TABLE IF EXISTS bym.alliance_trade_request`);
  }
}
