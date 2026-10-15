import { describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../mikro-orm.config.js";

/**
 * `db:init` builds a fresh database with `schema:create`, from the entities,
 * and `CreateBotTables` then skips the tables it finds. So the entities must
 * carry the defaults the bot sweep relies on: its raw `INSERT INTO bym.bot_job`
 * leaves out `payload` and `created_at`. Without them the live sweep failed on
 * every run with a not-null violation on `payload`. Needs no database.
 */
describe("bot table defaults in the generated schema", () => {
  test("bot_job.payload and the created_at columns have a default", async () => {
    const orm = await MikroORM.init({ ...ormConfig, host: "127.0.0.1", port: 1, debug: false, pool: { min: 0, max: 1 } });
    try {
      const sql = await orm.schema.getCreateSchemaSQL();
      const columnLine = (table: string, column: string) => {
        const create = sql.split(/create table /i).find((part) => part.startsWith(`"bym"."${table}"`));
        const line = create?.split("\n").find((one) => one.includes(`"${column}"`) && !one.includes("constraint"));
        return line ?? `${table}.${column} not found in:\n${create}`;
      };
      expect(columnLine("bot_job", "payload")).toMatch(/default '\{\}'/i);
      expect(columnLine("bot_job", "created_at")).toMatch(/default now\(\)/i);
      expect(columnLine("bot", "created_at")).toMatch(/default now\(\)/i);
    } finally {
      await orm.close(true);
    }
  });
});
