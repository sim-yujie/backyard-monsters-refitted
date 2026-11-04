import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { tribeEditorEnabled } from "../../config/TribeEditorConfig.js";
import { WORLD_SIZE } from "../../config/MapRoom2Config.js";
import { Save } from "../../database/models/save.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { getFlags } from "../../game-data/flags.js";
import { storeItems } from "../../game-data/store/storeItems.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import { verifyUserAuth } from "../../middleware/auth.js";
import { logRequest } from "../../middleware/logRequest.js";
import { postgres } from "../../server.js";
import {
  TRIBE_IDS,
  TRIBE_OF,
  isTribeId,
  originalLayoutLevels,
  rememberSavedLayout,
  savedLayouts,
  tribeLayoutFor,
  tribeLevels,
  type TribeId,
} from "../../services/maproom/v2/tribeLayouts.js";
import type { SaveData } from "../../types/EntityData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";

/**
 * The tribe yard editor's routes (local servers only, `TribeEditorConfig.ts`).
 *
 *   GET  /api/:apiVersion/dev/tribe-editor/status          the tribes, their levels, what is saved
 *   GET  /api/:apiVersion/dev/tribe-editor/yard?tribe&level the yard a camp of that level uses now
 *   POST /api/:apiVersion/dev/tribe-editor/save             "Save as <Tribe> level <N>"
 *   POST /api/:apiVersion/dev/tribe-editor/reset            "Reset attacked camps": drops the LOCAL
 *                                                           database's stored rows of this tribe and level
 *
 * The web client edits the yard in the browser (`web/src/game/tribeEditor`):
 * nothing here reads or writes the player's own rows. A save writes the yard
 * into `game-data/tribes/v2/levels/<tribe>.ts` for the lead to commit, and
 * camps of that level (and the levels above it up to the next saved yard)
 * use it at once (`tribeLayouts.ts`).
 */

const PREFIX = "/api/:apiVersion/dev/tribe-editor";

/** The folder the per-level data files live in; `TRIBE_EDITOR_DATA_DIR` moves it (tests). */
export const levelsDir = (env: Record<string, string | undefined> = process.env): string =>
  env.TRIBE_EDITOR_DATA_DIR ??
  fileURLToPath(new URL("../../game-data/tribes/v2/levels/", import.meta.url));

/** The tribes' display names (`Tribes.ts`). */
const tribeName = (tribe: TribeId): string => TRIBE_OF[tribe];

/** 404 unless the editor is on: a second lock behind the routes not being registered at all. */
const refuseUnlessOn = (ctx: Context): boolean => {
  if (tribeEditorEnabled()) return false;
  ctx.status = Status.NOT_FOUND;
  ctx.body = { error: "Not found" };
  return true;
};

/** What the picker lists: each tribe, its camp levels, and which have a yard of their own. */
export const editorStatus = () => ({
  error: 0,
  enabled: true,
  tribes: TRIBE_IDS.map((id) => ({
    id,
    name: tribeName(id),
    levels: tribeLevels(id),
    originals: [...originalLayoutLevels(id).keys()],
    saved: Object.keys(savedLayouts(id))
      .map(Number)
      .sort((a, b) => a - b),
  })),
});

const YardQuerySchema = z.object({
  tribe: z.string().refine(isTribeId, "Unknown tribe"),
  level: z.coerce.number().int().min(1).max(99),
});

/** A deep copy, so an edit never reaches the shared layout objects. */
const copy = <T>(value: T): T => structuredClone(value);

/**
 * The yard for the editor, shaped like the owner's build-mode `/base/load`
 * answer, so the yard screen opens it as if it were the player's own. The
 * player's row is never read: every field comes from the tribe's layout.
 */
export const editorYard = (tribe: TribeId, level: number, userid: number) => {
  const pick = tribeLayoutFor(tribe, level);
  const now = getCurrentDateTime();
  const save = copy(pick.save) as Record<string, unknown>;
  return {
    error: 0,
    tribe,
    level,
    from: pick.from,
    saved: pick.saved,
    yard: {
      ...save,
      buildingdata: save.buildingdata as Record<string, unknown>,
      baseid: "0",
      type: "main",
      userid,
      level,
      name: `${tribeName(tribe)} level ${level}`,
      buildinghealthdata: {},
      outposts: [],
      credits: 0,
      relationship: 0,
      canattack: false,
      flags: getFlags(),
      worldsize: WORLD_SIZE,
      storeitems: storeItems,
      currenttime: now,
      savetime: now,
      onboarding: { guide: { state: "done" }, camp: "removed", goalsReady: 0, tips: {} },
    },
  };
};

/** The building keys a camp yard keeps; job timers and the like are dropped. */
const BUILDING_KEYS = ["X", "Y", "t", "l", "id", "m", "cP", "pr", "st", "rCP", "fort"] as const;

const BuildingSchema = z
  .object({
    X: z.coerce.number(),
    Y: z.coerce.number(),
    t: z.coerce.number().int().positive(),
    l: z.coerce.number().int().min(0).max(20).optional(),
    id: z.coerce.number().int().min(0),
    m: z.record(z.string(), z.coerce.number().int().min(0)).optional(),
  })
  .passthrough();

/** A structured field: `jsonBody.ts` re-stringifies a JSON body's objects, so it may arrive as a string. */
const parsedJson = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, schema);

const SaveBodySchema = z.object({
  tribe: z.string().refine(isTribeId, "Unknown tribe"),
  level: z.coerce.number().int().min(1).max(99),
  buildingdata: parsedJson(z.record(z.string(), BuildingSchema)),
  /** Optional slices the editor may also change; absent ones keep the layout's. */
  academy: parsedJson(z.record(z.string(), z.unknown())).optional(),
  monsters: parsedJson(z.record(z.string(), z.unknown())).optional(),
  lockerdata: parsedJson(z.record(z.string(), z.unknown())).optional(),
});

/** Parses a save request's body (exported for tests). */
export const parseSaveBody = (body: unknown) => SaveBodySchema.safeParse(body);

/** One building as the data file keeps it. */
export const cleanBuilding = (raw: Record<string, unknown>): Record<string, unknown> => {
  const kept: Record<string, unknown> = {};
  for (const key of BUILDING_KEYS) if (raw[key] !== undefined) kept[key] = raw[key];
  return kept;
};

/** The yard saved for a level: the layout it was edited from, with the edited slices over it. */
export const savedYard = (body: z.infer<typeof SaveBodySchema>): SaveData => {
  const tribe = body.tribe as TribeId;
  const base = copy(tribeLayoutFor(tribe, body.level).save) as Record<string, unknown>;
  const buildingdata: Record<string, unknown> = {};
  for (const [key, building] of Object.entries(body.buildingdata)) {
    buildingdata[key] = cleanBuilding(building as Record<string, unknown>);
  }
  return {
    ...base,
    buildingdata,
    buildinghealthdata: {},
    ...(body.academy && { academy: body.academy }),
    ...(body.monsters && { monsters: body.monsters }),
    ...(body.lockerdata && { lockerdata: body.lockerdata }),
  } as SaveData;
};

/** The source of `levels/<tribe>.ts` for these saved yards. */
export const levelsFileSource = (tribe: TribeId, levels: Record<number, SaveData>): string => {
  const sorted: Record<number, SaveData> = {};
  for (const level of Object.keys(levels).map(Number).sort((a, b) => a - b)) sorted[level] = levels[level]!;
  return `import type { SaveData } from "../../../../types/EntityData.js";

/**
 * ${tribe} camp yards saved by the tribe yard editor, by level (written by
 * \`controllers/tribeEditor/tribeEditor.ts\`; see \`services/maproom/v2/tribeLayouts.ts\`).
 * A level listed here replaces the yard camps of exactly that level use; a level
 * not listed uses the nearest yard below it.
 */
export const ${tribe}Levels: Record<number, SaveData> = ${JSON.stringify(sorted, null, 2)};
`;
};

/** Writes the tribe's data file with this level's yard added (or replaced). */
export const writeSavedYard = async (
  tribe: TribeId,
  level: number,
  yard: SaveData,
  dir: string = levelsDir(),
): Promise<string> => {
  const levels = { ...savedLayouts(tribe), [level]: yard };
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${tribe}.ts`);
  await writeFile(file, levelsFileSource(tribe, levels), "utf8");
  rememberSavedLayout(tribe, level, yard);
  return file;
};

/** The parts of a stored camp row {@link isStoredCampOf} looks at. */
export interface StoredCampRow {
  type?: string | null;
  wmid?: number | null;
  level?: number | null;
  userid?: number | null;
  worldid?: string | null;
  baseid?: string | number | null;
}

/**
 * Whether a stored row is a Map Room 2 camp of this tribe and level, and
 * nothing else: a `tribe` row with no owner, in a world, with the 14-digit
 * Map Room 2 base id whose cell (its last six digits) belongs to the tribe,
 * and the tribe's `wmid` (`tribeSaveV2.ts`). Map Room 1 camps (no world) and
 * Map Room 3 ones (15 digits) never match, nor does any player's yard.
 */
export const isStoredCampOf = (row: StoredCampRow, tribe: TribeId, level: number): boolean => {
  const index = TRIBE_IDS.indexOf(tribe);
  const baseid = String(row.baseid ?? "");
  if (row.type !== "tribe" || row.userid !== 0 || !row.worldid) return false;
  if (row.wmid !== index * 10 + 1 || row.level !== level) return false;
  if (!/^\d{14}$/.test(baseid)) return false;
  const cellX = Number(baseid.slice(-6, -3));
  const cellY = Number(baseid.slice(-3));
  return (cellX + cellY) % TRIBE_IDS.length === index;
};

/** The few database calls {@link resetStoredCamps} makes (a MikroORM entity manager). */
export interface CampRowStore {
  find: (entity: typeof Save, where: Record<string, unknown>) => Promise<StoredCampRow[]>;
  remove: (row: StoredCampRow) => unknown;
  flush: () => Promise<void>;
}

/**
 * "Reset attacked camps": a camp keeps its stored row (and the yard it was
 * made with) once someone opened or attacked it, so a newly saved yard only
 * reaches camps nobody touched yet. This drops the LOCAL database's stored
 * rows of this tribe's camps of exactly this level, so each one is made again
 * from the saved yard the next time it is opened (the same thing the 12-hour
 * camp refresh does in `baseModeView.ts`). Live never reaches it: the route
 * exists only while the editor is on (`TribeEditorConfig.ts`).
 */
export const resetStoredCamps = async (
  tribe: TribeId,
  level: number,
  store: CampRowStore = postgres.em as unknown as CampRowStore,
): Promise<number> => {
  const index = TRIBE_IDS.indexOf(tribe);
  const rows = await store.find(Save, { type: "tribe", wmid: index * 10 + 1, level, userid: 0 });
  const camps = rows.filter((row) => isStoredCampOf(row, tribe, level));
  for (const row of camps) store.remove(row);
  if (camps.length > 0) await store.flush();
  return camps.length;
};

const ResetBodySchema = z.object({
  tribe: z.string().refine(isTribeId, "Unknown tribe"),
  level: z.coerce.number().int().min(1).max(99),
});

const status = async (ctx: Context) => {
  if (refuseUnlessOn(ctx)) return;
  ctx.status = Status.OK;
  ctx.body = editorStatus();
};

const yard = async (ctx: Context) => {
  if (refuseUnlessOn(ctx)) return;
  const parsed = YardQuerySchema.safeParse(ctx.query);
  if (!parsed.success) {
    ctx.status = Status.BAD_REQUEST;
    ctx.body = { error: "Pick a Map Room 2 tribe and a level." };
    return;
  }
  ctx.status = Status.OK;
  ctx.body = editorYard(parsed.data.tribe as TribeId, parsed.data.level, ctx.authUser.userid);
};

/** "Save as <Tribe> level <N>" (exported for tests). */
export const save = async (ctx: Context) => {
  if (refuseUnlessOn(ctx)) return;
  const parsed = parseSaveBody(ctx.request.body);
  if (!parsed.success) {
    ctx.status = Status.BAD_REQUEST;
    ctx.body = { error: `The yard could not be saved: ${parsed.error.issues[0]?.message ?? "bad request"}` };
    return;
  }
  const tribe = parsed.data.tribe as TribeId;
  const { level } = parsed.data;
  const yard = savedYard(parsed.data);
  const file = path.join(levelsDir(), `${tribe}.ts`);
  rememberSavedLayout(tribe, level, yard);
  // The data file is part of the server's code, so a `bun --watch` server (the
  // owner's local game) restarts the moment it changes and would cut this reply
  // off (the editor then showed "status 500"): answer first, then write the file
  // once the reply has gone out.
  ctx.res.once("finish", () => {
    writeSavedYard(tribe, level, yard).then(
      (written) => logger.info(`Tribe yard editor: saved ${tribeName(tribe)} level ${level} to ${written}`),
      (error: unknown) => logger.error(`Tribe yard editor: could not write ${file}: ${String(error)}`),
    );
  });
  ctx.status = Status.OK;
  ctx.body = {
    ...editorStatus(),
    tribe,
    level,
    file: path.relative(process.cwd(), file),
    buildings: Object.keys(parsed.data.buildingdata).length,
  };
};

const reset = async (ctx: Context) => {
  if (refuseUnlessOn(ctx)) return;
  const parsed = ResetBodySchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    ctx.status = Status.BAD_REQUEST;
    ctx.body = { error: "Pick a Map Room 2 tribe and a level." };
    return;
  }
  const tribe = parsed.data.tribe as TribeId;
  const { level } = parsed.data;
  const removed = await resetStoredCamps(tribe, level);
  logger.info(`Tribe yard editor: reset ${removed} stored ${tribeName(tribe)} level ${level} camps (local database)`);
  ctx.status = Status.OK;
  ctx.body = { error: 0, tribe, level, removed };
};

/**
 * Mounts the editor's routes, only when the editor is on. Returns whether it
 * did, so `app.routes.ts` can log it.
 */
export const registerTribeEditorRoutes = (router: Router, enabled: boolean = tribeEditorEnabled()): boolean => {
  if (!enabled) return false;
  router.get(`${PREFIX}/status`, apiVersion, verifyUserAuth, logRequest, status);
  router.get(`${PREFIX}/yard`, apiVersion, verifyUserAuth, logRequest, yard);
  router.post(`${PREFIX}/save`, apiVersion, verifyUserAuth, logRequest, save);
  router.post(`${PREFIX}/reset`, apiVersion, verifyUserAuth, logRequest, reset);
  return true;
};
