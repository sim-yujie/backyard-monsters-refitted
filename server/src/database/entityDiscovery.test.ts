import { describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../mikro-orm.config.js";

/**
 * Startup runs MikroORM entity discovery over every entity before it touches
 * the database, and a property it cannot type stops the server cold (#227:
 * `onboarding` had a `null` initializer and no `type`, so the server failed
 * with "Please provide either 'type' or 'entity' attribute in
 * Save.onboarding"). This runs the same discovery on the real config. The
 * port points nowhere, so it needs no database: discovery never connects.
 */
describe("entity discovery", () => {
  test("every entity in the ORM config discovers", async () => {
    const orm = await MikroORM.init({
      ...ormConfig,
      host: "127.0.0.1",
      port: 1,
      debug: false,
      pool: { min: 0, max: 1 },
    });

    try {
      const names = [...orm.getMetadata().getAll().values()].map((meta) => meta.className);
      for (const entity of ormConfig.entities!) {
        expect(names).toContain((entity as { name: string }).name);
      }
      const onboarding = orm.getMetadata().getByClassName("Save").properties.onboarding;
      expect(onboarding.columnTypes).toEqual(["jsonb"]);
      expect(onboarding.nullable).toBe(true);

      // The bot tables (issue #235): every column the entities map is one the
      // migration creates, with the type it creates, so a load never asks
      // for a column that is not there.
      const columns = (className: string) =>
        Object.fromEntries(
          Object.values(orm.getMetadata().getByClassName(className).properties).map((prop) => [
            prop.fieldNames[0],
            { type: prop.columnTypes[0], nullable: !!prop.nullable },
          ])
        );
      expect(columns("Bot")).toEqual({
        userid: { type: "int", nullable: false },
        seed: { type: "bigint", nullable: false },
        persona: { type: "text", nullable: false },
        level: { type: "int", nullable: false },
        level_since: { type: "timestamptz", nullable: false },
        state: { type: "text", nullable: false },
        created_at: { type: "timestamptz", nullable: false },
        retired_at: { type: "timestamptz", nullable: true },
      });
      expect(columns("BotJob")).toEqual({
        id: { type: "bigserial", nullable: false },
        bot_userid: { type: "int", nullable: false },
        kind: { type: "text", nullable: false },
        target_userid: { type: "int", nullable: true },
        due_at: { type: "timestamptz", nullable: false },
        giveup_at: { type: "timestamptz", nullable: true },
        attempts: { type: "int", nullable: false },
        payload: { type: "jsonb", nullable: false },
        created_at: { type: "timestamptz", nullable: false },
      });
      expect(columns("User").last_seen_at).toEqual({ type: "timestamptz", nullable: true });
    } finally {
      await orm.close();
    }
  });
});
