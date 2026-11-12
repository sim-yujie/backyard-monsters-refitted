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
];
const NEW_TYPES = ["star_lit", "goal_set", "goal_done", "star_suggested"];

const typeCheck = (types: string[]) => `
  ALTER TABLE bym.alliance_message
  ADD CONSTRAINT alliance_message_type_check
  CHECK (message_type IN (${types.map((type) => `'${type}'`).join(", ")}))
`;

/**
 * Alliance points and territory (beta 7 alliances phase 2, design v5 §8, §11,
 * §16; `services/alliance/allianceProgress.ts`).
 *
 * - `alliance_contribution`: per member per UTC day, the daily-quest points
 *   they earned the alliance (capped) and what they added to weekly goals.
 * - `alliance_goal`: the week's goals (up to 5), one kind once a week.
 * - `alliance_territory`: per alliance per UTC day, outposts its members held
 *   at the daily tally, with the type it had then (one board per type).
 * - New feed lines: star lit, goal set, goal finished, star suggested.
 *
 * Only adds.
 */
export class Migration20261124_AddAllianceProgress extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.alliance_contribution (
        alliance_id INT NOT NULL REFERENCES bym.alliance(id) ON DELETE CASCADE,
        userid INT NOT NULL,
        day DATE NOT NULL,
        quest_points INT NOT NULL DEFAULT 0,
        goal_helps BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (alliance_id, userid, day)
      )`);
    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.alliance_goal (
        id SERIAL PRIMARY KEY,
        alliance_id INT NOT NULL REFERENCES bym.alliance(id) ON DELETE CASCADE,
        week DATE NOT NULL,
        kind VARCHAR(32) NOT NULL,
        tier VARCHAR(8) NOT NULL,
        target BIGINT NOT NULL,
        points INT NOT NULL,
        progress BIGINT NOT NULL DEFAULT 0,
        set_by INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        done_at TIMESTAMPTZ,
        UNIQUE (alliance_id, week, kind)
      )`);
    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.alliance_territory (
        alliance_id INT NOT NULL REFERENCES bym.alliance(id) ON DELETE CASCADE,
        day DATE NOT NULL,
        type VARCHAR(16) NOT NULL,
        outposts INT NOT NULL,
        PRIMARY KEY (alliance_id, day)
      )`);
    await this.execute(`CREATE INDEX IF NOT EXISTS alliance_territory_type_day ON bym.alliance_territory (type, day)`);
    await this.execute(`ALTER TABLE bym.alliance ADD COLUMN IF NOT EXISTS suggestions JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await this.execute(`ALTER TABLE bym.alliance_message DROP CONSTRAINT IF EXISTS alliance_message_type_check`);
    await this.execute(typeCheck([...TYPES_BEFORE, ...NEW_TYPES]));
  }

  async down(): Promise<void> {
    await this.execute(`DELETE FROM bym.alliance_message WHERE message_type IN (${NEW_TYPES.map((t) => `'${t}'`).join(", ")})`);
    await this.execute(`ALTER TABLE bym.alliance_message DROP CONSTRAINT IF EXISTS alliance_message_type_check`);
    await this.execute(typeCheck(TYPES_BEFORE));
    await this.execute(`DROP TABLE IF EXISTS bym.alliance_territory`);
    await this.execute(`DROP TABLE IF EXISTS bym.alliance_goal`);
    await this.execute(`DROP TABLE IF EXISTS bym.alliance_contribution`);
    await this.execute(`ALTER TABLE bym.alliance DROP COLUMN IF EXISTS suggestions`);
  }
}
