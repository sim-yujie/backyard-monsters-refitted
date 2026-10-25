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
      // The achievements' record (issue #204), against its migration.
      const achievements = orm.getMetadata().getByClassName("Save").properties.achievements;
      expect(achievements.columnTypes).toEqual(["jsonb"]);
      expect(achievements.nullable).toBe(true);

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
        quiet_since: { type: "timestamptz", nullable: true },
        state: { type: "text", nullable: false },
        created_at: { type: "timestamptz", nullable: false },
        retired_at: { type: "timestamptz", nullable: true },
        grow_drops: { type: "int", nullable: false },
        yard_version: { type: "int", nullable: false },
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
      // The notification list (issue #257), against its migration.
      expect(columns("Notification")).toEqual({
        id: { type: "bigserial", nullable: false },
        userid: { type: "int", nullable: false },
        baseid: { type: "varchar(255)", nullable: true },
        kind: { type: "text", nullable: false },
        jobs: { type: "jsonb", nullable: false },
        read_at: { type: "timestamptz", nullable: true },
        created_at: { type: "timestamptz", nullable: false },
      });
      // Defence replays (issue #358), against their migration.
      expect(columns("DefenceReplay")).toEqual({
        id: { type: "bigserial", nullable: false },
        defender_userid: { type: "int", nullable: false },
        baseid: { type: "varchar(255)", nullable: false },
        map_version: { type: "smallint", nullable: false },
        attacker_userid: { type: "int", nullable: false },
        attacker_username: { type: "varchar(255)", nullable: false },
        attacker_pic_square: { type: "text", nullable: true },
        attacked_at: { type: "timestamptz", nullable: false },
        landed_at: { type: "timestamptz", nullable: false },
        damage_before: { type: "int", nullable: false },
        damage_after: { type: "int", nullable: false },
        loot: { type: "jsonb", nullable: false },
        housed_lost: { type: "int", nullable: false },
        attacker_left: { type: "boolean", nullable: false },
        rules_version: { type: "varchar(32)", nullable: false },
        replay: { type: "bytea", nullable: true },
        replay_bytes: { type: "int", nullable: false },
      });
      expect(columns("Message").replayid).toEqual({ type: "bigint", nullable: true });
      expect(columns("User").last_seen_at).toEqual({ type: "timestamptz", nullable: true });
      // The friends tables and privacy switches (issue #368), against their migration.
      expect(columns("Friend")).toEqual({
        userid: { type: "int", nullable: false },
        friend_userid: { type: "int", nullable: false },
        created_at: { type: "timestamptz", nullable: false },
      });
      expect(columns("FriendRequest")).toEqual({
        id: { type: "bigserial", nullable: false },
        from_userid: { type: "int", nullable: false },
        to_userid: { type: "int", nullable: false },
        status: { type: "text", nullable: false },
        created_at: { type: "timestamptz", nullable: false },
        answered_at: { type: "timestamptz", nullable: true },
      });
      expect(columns("User").hide_online).toEqual({ type: "boolean", nullable: false });
      expect(columns("User").friend_requests_off).toEqual({ type: "boolean", nullable: false });
      // The attack cap's dropped neighbours (issue #247), against its migration.
      expect(columns("Maproom").dropped_neighbours).toEqual({ type: "jsonb", nullable: false });
      // The Inferno progress row (docs/design/inferno.md §3.1), against its migration.
      expect(columns("InfernoProgress")).toEqual({
        userid: { type: "int", nullable: false },
        emergence_level: { type: "smallint", nullable: false },
        emergence_last_at: { type: "timestamptz", nullable: true },
        descent_destroyed: { type: "jsonb", nullable: false },
        descent_best: { type: "jsonb", nullable: false },
        descent_yards: { type: "jsonb", nullable: false },
        descent_passed_at: { type: "timestamptz", nullable: true },
        inferno_baseid: { type: "varchar(255)", nullable: true },
        korath_unlocked_at: { type: "timestamptz", nullable: true },
        korath_notice_at: { type: "timestamptz", nullable: true },
        popups_seen: { type: "jsonb", nullable: false },
        created_at: { type: "timestamptz", nullable: false },
        updated_at: { type: "timestamptz", nullable: false },
      });
    } finally {
      await orm.close();
    }
  });
});
