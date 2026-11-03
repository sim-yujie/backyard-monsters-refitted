import { afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

mock.module("../../server.js", () => ({ postgres: {}, redis: {} }));

const { tribeEditorEnabled } = await import("../../config/TribeEditorConfig.js");
const {
  cleanBuilding,
  editorStatus,
  parseSaveBody,
  editorYard,
  isStoredCampOf,
  resetStoredCamps,
  levelsFileSource,
  registerTribeEditorRoutes,
  save,
  savedYard,
  writeSavedYard,
} = await import("./tribeEditor.js");
const { forgetSavedLayouts, tribeLayoutFor } = await import("../../services/maproom/v2/tribeLayouts.js");
const { kozu } = await import("../../game-data/tribes/v2/kozu.js");

const dirs: string[] = [];
afterEach(() => {
  forgetSavedLayouts();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A router that only records what was mounted. */
const recordingRouter = () => {
  const mounted: string[] = [];
  const router = {
    get: (route: string) => mounted.push(`GET ${route}`),
    post: (route: string) => mounted.push(`POST ${route}`),
  };
  return { router: router as never, mounted };
};

describe("tribe yard editor switch", () => {
  test("on only with TRIBE_EDITOR on, ENV local and no production NODE_ENV", () => {
    expect(tribeEditorEnabled({ TRIBE_EDITOR: "on", ENV: "local" })).toBe(true);
    expect(tribeEditorEnabled({ TRIBE_EDITOR: "true", ENV: "local", NODE_ENV: "development" })).toBe(true);
    expect(tribeEditorEnabled({ ENV: "local" })).toBe(false);
    expect(tribeEditorEnabled({ TRIBE_EDITOR: "off", ENV: "local" })).toBe(false);
    expect(tribeEditorEnabled({ TRIBE_EDITOR: "on", ENV: "production" })).toBe(false);
    expect(tribeEditorEnabled({ TRIBE_EDITOR: "on" })).toBe(false);
    expect(tribeEditorEnabled({ TRIBE_EDITOR: "on", ENV: "local", NODE_ENV: "production" })).toBe(false);
  });

  test("off, no route is mounted; on, the four editor routes are", () => {
    const off = recordingRouter();
    expect(registerTribeEditorRoutes(off.router, false)).toBe(false);
    expect(off.mounted).toEqual([]);

    const on = recordingRouter();
    expect(registerTribeEditorRoutes(on.router, true)).toBe(true);
    expect(on.mounted).toEqual([
      "GET /api/:apiVersion/dev/tribe-editor/status",
      "GET /api/:apiVersion/dev/tribe-editor/yard",
      "POST /api/:apiVersion/dev/tribe-editor/save",
      "POST /api/:apiVersion/dev/tribe-editor/reset",
    ]);
  });

  test("the routes file mounts the editor only through the switch", () => {
    const routes = readFileSync(new URL("../../app.routes.ts", import.meta.url), "utf8");
    expect(routes).toContain("registerTribeEditorRoutes(router);");
    expect(routes).not.toContain("dev/tribe-editor");
  });

  test("the test environment (like CI and the live server) has it off", () => {
    expect(tribeEditorEnabled({ ...process.env, TRIBE_EDITOR: undefined })).toBe(false);
  });
});

describe("tribe yard editor data", () => {
  test("status lists the four Map Room 2 tribes with their camp levels", () => {
    const status = editorStatus();
    expect(status.tribes.map((tribe) => [tribe.id, tribe.levels[0], tribe.levels.at(-1), tribe.originals])).toEqual([
      ["legionnaire", 25, 41, [25, 32, 39]],
      ["kozu", 30, 42, [29, 37]],
      ["abunaki", 27, 43, [25, 35]],
      ["dreadnaught", 28, 44, [25, 35]],
    ]);
    expect(status.tribes.every((tribe) => tribe.saved.length === 0)).toBe(true);
  });

  test("the editor's yard is a copy of the layout the level uses, shaped as the owner's own", () => {
    const answer = editorYard("kozu", 33, 2503);
    expect(answer.from).toBe(29);
    expect(answer.saved).toBe(false);
    expect(answer.yard.buildingdata).toEqual(kozu[0]!.buildingdata as Record<string, unknown>);
    expect(answer.yard.buildingdata).not.toBe(kozu[0]!.buildingdata);
    expect(answer.yard).toMatchObject({ baseid: "0", type: "main", userid: 2503, level: 33, outposts: [] });
  });

  test("a save body reads its yard whether sent as an object or as the JSON string the server's edge makes of it", () => {
    const buildingdata = { "3": { X: 1, Y: 2, t: 22, l: 2, id: 3, m: { C5: 4 } } };
    for (const sent of [buildingdata, JSON.stringify(buildingdata)]) {
      const parsed = parseSaveBody({ tribe: "abunaki", level: "30", buildingdata: sent });
      expect(parsed.success).toBe(true);
      expect(parsed.data!.buildingdata["3"]).toMatchObject({ X: 1, t: 22, m: { C5: 4 } });
    }
    expect(parseSaveBody({ tribe: "moloch", level: 30, buildingdata }).success).toBe(false);
  });

  test("a building keeps its place, type, level, id and garrison; job timers are dropped", () => {
    expect(cleanBuilding({ X: 10, Y: -20, t: 22, l: 3, id: 7, m: { C5: 4 }, cB: 99, rIP: 1 })).toEqual({
      X: 10,
      Y: -20,
      t: 22,
      l: 3,
      id: 7,
      m: { C5: 4 },
    });
  });

  test("saving writes the level's yard into the tribe's data file and camps use it at once", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tribe-editor-"));
    dirs.push(dir);
    const yard = savedYard({
      tribe: "kozu",
      level: 31,
      buildingdata: { "0": { X: 0, Y: 0, t: 14, l: 9, id: 0 }, "5": { X: 40, Y: 40, t: 22, l: 2, id: 5, m: { C8: 6 } } },
    });
    // The rest of the save comes from the layout it was edited from.
    expect(yard.resources).toEqual(kozu[0]!.resources);

    const file = await writeSavedYard("kozu", 31, yard, dir);
    expect(path.basename(file)).toBe("kozu.ts");
    const source = readFileSync(file, "utf8");
    expect(source).toContain("export const kozuLevels: Record<number, SaveData> = {");
    expect(source).toContain('"31": {');
    expect(source).toContain('"C8": 6');

    expect(tribeLayoutFor("kozu", 30).save).toBe(kozu[0]!);
    expect(tribeLayoutFor("kozu", 31).save).toBe(yard);
    expect(tribeLayoutFor("kozu", 36).save).toBe(yard);
    expect(tribeLayoutFor("kozu", 37).save).toBe(kozu[1]!);
    expect(editorStatus().tribes.find((tribe) => tribe.id === "kozu")!.saved).toEqual([31]);
  });

  test("the save route answers before it writes the data file (a watching server restarts on the write)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tribe-editor-route-"));
    dirs.push(dir);
    const keys = ["TRIBE_EDITOR", "ENV", "TRIBE_EDITOR_DATA_DIR"] as const;
    const before = keys.map((key) => process.env[key]);
    Object.assign(process.env, { TRIBE_EDITOR: "on", ENV: "local", TRIBE_EDITOR_DATA_DIR: dir });
    try {
      const res = new EventEmitter();
      const ctx = {
        request: { body: { tribe: "kozu", level: 31, buildingdata: { "0": { X: 0, Y: 0, t: 14, l: 9, id: 0 } } } },
        res,
        status: 0,
        body: undefined as unknown,
      };
      await save(ctx as never);
      const file = path.join(dir, "kozu.ts");
      expect(ctx.status).toBe(200);
      expect((ctx.body as { level: number }).level).toBe(31);
      // Camps use the yard at once, but the file waits for the reply to go out.
      expect(tribeLayoutFor("kozu", 31).saved).toBe(true);
      expect(existsSync(file)).toBe(false);

      res.emit("finish");
      for (let i = 0; i < 50 && !existsSync(file); i++) await Bun.sleep(10);
      expect(readFileSync(file, "utf8")).toContain('"31": {');
    } finally {
      keys.forEach((key, i) => {
        if (before[i] === undefined) delete process.env[key];
        else process.env[key] = before[i];
      });
    }
  });

  test("the data file source lists levels in order and reads back as the same yards", async () => {
    const source = levelsFileSource("legionnaire", {
      40: { name: "b" } as never,
      26: { name: "a" } as never,
    });
    expect(source.indexOf('"26"')).toBeLessThan(source.indexOf('"40"'));
    const dir = mkdtempSync(path.join(tmpdir(), "tribe-editor-src-"));
    dirs.push(dir);
    const file = path.join(dir, "legionnaire.ts");
    await Bun.write(file, source.replace('import type { SaveData } from "../../../../types/EntityData.js";', "type SaveData = unknown;"));
    const loaded = await import(file);
    expect(loaded.legionnaireLevels).toEqual({ 26: { name: "a" }, 40: { name: "b" } });
  });
});

describe("reset attacked camps (local database)", () => {
  // Cell (238,208): (238+208) % 4 = 2, Abunakki; the world hash is 8 digits.
  const camp = { type: "tribe", wmid: 21, level: 31, userid: 0, worldid: "w-1", baseid: "12345678238208" };

  test("matches only a Map Room 2 camp row of that tribe and level", () => {
    expect(isStoredCampOf(camp, "abunaki", 31)).toBe(true);
    expect(isStoredCampOf({ ...camp, baseid: 12345678238208 as never }, "abunaki", 31)).toBe(true);
    expect(isStoredCampOf(camp, "abunaki", 32)).toBe(false);
    expect(isStoredCampOf(camp, "kozu", 31)).toBe(false);
    expect(isStoredCampOf({ ...camp, type: "main" }, "abunaki", 31)).toBe(false);
    expect(isStoredCampOf({ ...camp, userid: 2503 }, "abunaki", 31)).toBe(false);
    expect(isStoredCampOf({ ...camp, worldid: null }, "abunaki", 31)).toBe(false);
    // Map Room 3's 15-digit ids and a cell of another tribe never match.
    expect(isStoredCampOf({ ...camp, baseid: "312345678238208" }, "abunaki", 31)).toBe(false);
    expect(isStoredCampOf({ ...camp, baseid: "12345678238209" }, "abunaki", 31)).toBe(false);
  });

  test("removes the matching rows and leaves every other row", async () => {
    const other = { ...camp, baseid: "12345678238209" };
    const removed: unknown[] = [];
    let asked: Record<string, unknown> = {};
    let flushed = 0;
    const store = {
      find: async (_entity: unknown, where: Record<string, unknown>) => {
        asked = where;
        return [camp, other];
      },
      remove: (row: unknown) => removed.push(row),
      flush: async () => {
        flushed += 1;
      },
    };
    expect(await resetStoredCamps("abunaki", 31, store as never)).toBe(1);
    expect(asked).toEqual({ type: "tribe", wmid: 21, level: 31, userid: 0 });
    expect(removed).toEqual([camp]);
    expect(flushed).toBe(1);

    const none = { ...store, find: async () => [] };
    flushed = 0;
    expect(await resetStoredCamps("kozu", 40, none as never)).toBe(0);
    expect(flushed).toBe(0);
  });
});
