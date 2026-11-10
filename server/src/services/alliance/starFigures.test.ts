import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import {
  allConstellations,
  loadStarFigures,
  parseFigure,
  parseFigureChange,
  readFigures,
  saveStarFigure,
  SETTING_KEY,
} from "./starFigures.js";

const stars = (): [number, number][] => Array.from({ length: 10 }, (_, i) => [10 + i * 15, 20 + i * 10] as [number, number]);

describe("star figures", () => {
  test("every type's constellations are listed, 12 in all", () => {
    const list = allConstellations();
    expect(list).toHaveLength(12);
    expect(new Set(list.map((c) => c.id)).size).toBe(12);
  });

  test("a good figure is kept, rounded, its lines sorted and without repeats", () => {
    const figure = parseFigure({ stars: [[10.04, 20.06], ...stars().slice(1)], lines: [[1, 0], [0, 1], [2, 3]] });
    expect(figure?.stars[0]).toEqual([10, 20.1]);
    expect(figure?.lines).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  test("a bad figure is refused", () => {
    expect(parseFigure(null)).toBeNull();
    expect(parseFigure({ stars: stars().slice(0, 9), lines: [] })).toBeNull();
    expect(parseFigure({ stars: [[201, 10], ...stars().slice(1)], lines: [] })).toBeNull();
    expect(parseFigure({ stars: [[-1, 10], ...stars().slice(1)], lines: [] })).toBeNull();
    expect(parseFigure({ stars: stars(), lines: [[0, 0]] })).toBeNull();
    expect(parseFigure({ stars: stars(), lines: [[0, 10]] })).toBeNull();
    expect(parseFigure({ stars: stars(), lines: [[0.5, 1]] })).toBeNull();
    expect(parseFigure({ stars: [["a", 1], ...stars().slice(1)], lines: [] })).toBeNull();
  });

  test("the stored object keeps only good figures of known constellations", () => {
    const good = { stars: stars(), lines: [[0, 1]] };
    expect(Object.keys(readFigures({ pokey: good, nobody: good, brain: { stars: [] } }))).toEqual(["pokey"]);
    expect(readFigures(JSON.stringify({ pokey: good })).pokey?.lines).toEqual([[0, 1]]);
    expect(readFigures(null)).toEqual({});
  });

  test("an editor change names a known constellation", () => {
    expect(parseFigureChange({ id: "nobody", reset: true }).ok).toBe(false);
    expect(parseFigureChange({ id: "pokey", reset: true })).toEqual({ ok: true, change: { id: "pokey", reset: true } });
    expect(parseFigureChange({ id: "pokey", figure: { stars: [], lines: [] } }).ok).toBe(false);
    expect(parseFigureChange({ id: "pokey", figure: { stars: stars(), lines: [] } }).ok).toBe(true);
    // As the server's JSON body step hands it on: the object as a string.
    expect(parseFigureChange({ id: "pokey", figure: JSON.stringify({ stars: stars(), lines: [] }) }).ok).toBe(true);
    expect(parseFigureChange({ id: "pokey", figure: "{nope" }).ok).toBe(false);
  });
});

/**
 * Save and reset against a real Postgres. Opt-in: runs only when
 * ALLIANCE_TEST_DB names a throwaway database with the migrations applied;
 * refuses the shared `bym`. Puts back whatever row was there.
 */
const dbName = process.env.ALLIANCE_TEST_DB;

describe.skipIf(!dbName)("star figures on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  let saved: { value: unknown }[] = [];

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("ALLIANCE_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    saved = await em().execute(`SELECT value FROM bym.game_setting WHERE key = ?`, [SETTING_KEY]);
    await em().execute(`DELETE FROM bym.game_setting WHERE key = ?`, [SETTING_KEY]);
  });

  afterAll(async () => {
    if (!orm) return;
    await em().execute(`DELETE FROM bym.game_setting WHERE key = ?`, [SETTING_KEY]);
    if (saved[0]) {
      await em().execute(`INSERT INTO bym.game_setting (key, value) VALUES (?, ?::jsonb)`, [
        SETTING_KEY,
        JSON.stringify(saved[0].value),
      ]);
    }
    await orm.close();
  });

  test("two saves keep both figures; a reset drops one", async () => {
    expect(await loadStarFigures(em())).toEqual({});
    await saveStarFigure(em(), { id: "pokey", figure: { stars: stars(), lines: [[0, 1]] } }, 1);
    const both = await saveStarFigure(em(), { id: "brain", figure: { stars: stars(), lines: [[2, 3]] } }, 1);
    expect(Object.keys(both).sort()).toEqual(["brain", "pokey"]);
    const after = await saveStarFigure(em(), { id: "pokey", reset: true }, 1);
    expect(Object.keys(after)).toEqual(["brain"]);
    expect(after.brain?.lines).toEqual([[2, 3]]);
  });
});
