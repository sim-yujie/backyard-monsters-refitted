import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../mikro-orm.config.js";

/**
 * `db:init` builds a fresh database with `schema:create`, from the entities,
 * then runs the migrations. A table the entity builds first makes its
 * migration's `CREATE TABLE IF NOT EXISTS` a no-op, so the new install loses
 * what only the migration carries: CHECKs, defaults (the bot sweep's raw
 * `INSERT INTO bym.bot_job` needs `payload` and `created_at` defaults), index
 * order. `schemaGenerator.skipTables` leaves those tables to their migration;
 * this keeps that list honest. Needs no database.
 */
describe("schema:create and the migration-owned tables", () => {
  const skipTables = (ormConfig.schemaGenerator?.skipTables ?? []) as string[];
  const migrationsDir = path.join(import.meta.dirname, "migrations");
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(path.join(migrationsDir, file), "utf8"));

  test("the bot tables are among them", () => {
    expect(skipTables).toEqual(expect.arrayContaining(["bot", "bot_job", "friend", "friend_request"]));
  });

  test("a migration creates every skipped table", () => {
    for (const table of skipTables) {
      const creates = new RegExp(`create table (if not exists )?"?bym"?\\."?${table}"?\\s*\\(`, "i");
      expect({ table, created: migrations.some((sql) => creates.test(sql)) }).toEqual({ table, created: true });
    }
  });

  test("the generated schema leaves the skipped tables out and keeps the rest", async () => {
    const orm = await MikroORM.init({ ...ormConfig, host: "127.0.0.1", port: 1, debug: false, pool: { min: 0, max: 1 } });
    try {
      const sql = await orm.schema.getCreateSchemaSQL();
      const created = [...sql.matchAll(/create table "bym"\."(\w+)"/gi)].map((match) => match[1]);
      for (const table of skipTables) expect(created).not.toContain(table);
      expect(created).toEqual(expect.arrayContaining(["user", "save", "maproom", "alliance"]));
      // Live has this default from its migration; the entity carries it too.
      const maproom = sql.split(/create table /i).find((part) => part.startsWith(`"bym"."maproom"`));
      expect(maproom?.split("\n").find((line) => line.includes(`"dropped_neighbours"`))).toMatch(/default '\[\]'/i);
    } finally {
      await orm.close(true);
    }
  });
});
