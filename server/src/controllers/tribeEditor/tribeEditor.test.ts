import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

mock.module("../../server.js", () => ({ postgres: {}, redis: {} }));

const { tribeEditorEnabled } = await import("../../config/TribeEditorConfig.js");
const {
  cleanBuilding,
  editorStatus,
  parseSaveBody,
  editorYard,
  levelsFileSource,
  registerTribeEditorRoutes,
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

  test("off, no route is mounted; on, the three editor routes are", () => {
    const off = recordingRouter();
    expect(registerTribeEditorRoutes(off.router, false)).toBe(false);
    expect(off.mounted).toEqual([]);

    const on = recordingRouter();
    expect(registerTribeEditorRoutes(on.router, true)).toBe(true);
    expect(on.mounted).toEqual([
      "GET /api/:apiVersion/dev/tribe-editor/status",
      "GET /api/:apiVersion/dev/tribe-editor/yard",
      "POST /api/:apiVersion/dev/tribe-editor/save",
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
      ["legionnaire", 25, 44, [25, 32, 39]],
      ["kozu", 29, 44, [29, 37]],
      ["abunaki", 25, 44, [25, 35]],
      ["dreadnaught", 25, 44, [25, 35]],
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
