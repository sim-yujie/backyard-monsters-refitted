import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { tribeEditorEnabled } from "../../config/TribeEditorConfig.js";
import { WORLD_SIZE } from "../../config/MapRoom2Config.js";
import { Status } from "../../enums/StatusCodes.js";
import { getFlags } from "../../game-data/flags.js";
import { storeItems } from "../../game-data/store/storeItems.js";
import { apiVersion } from "../../middleware/apiVersioning.js";
import { verifyUserAuth } from "../../middleware/auth.js";
import { logRequest } from "../../middleware/logRequest.js";
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

const SaveBodySchema = z.object({
  tribe: z.string().refine(isTribeId, "Unknown tribe"),
  level: z.coerce.number().int().min(1).max(99),
  buildingdata: z.record(z.string(), BuildingSchema),
  /** Optional slices the editor may also change; absent ones keep the layout's. */
  academy: z.record(z.string(), z.unknown()).optional(),
  monsters: z.record(z.string(), z.unknown()).optional(),
  lockerdata: z.record(z.string(), z.unknown()).optional(),
});

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

const save = async (ctx: Context) => {
  if (refuseUnlessOn(ctx)) return;
  const parsed = SaveBodySchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    ctx.status = Status.BAD_REQUEST;
    ctx.body = { error: `The yard could not be saved: ${parsed.error.issues[0]?.message ?? "bad request"}` };
    return;
  }
  const tribe = parsed.data.tribe as TribeId;
  const { level } = parsed.data;
  const file = await writeSavedYard(tribe, level, savedYard(parsed.data));
  logger.info(`Tribe yard editor: saved ${tribeName(tribe)} level ${level} to ${file}`);
  ctx.status = Status.OK;
  ctx.body = {
    ...editorStatus(),
    tribe,
    level,
    file: path.relative(process.cwd(), file),
    buildings: Object.keys(parsed.data.buildingdata).length,
  };
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
  return true;
};
