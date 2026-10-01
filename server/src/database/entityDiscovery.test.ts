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
    } finally {
      await orm.close();
    }
  });
});
