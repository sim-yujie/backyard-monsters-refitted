import { Status } from "../../enums/StatusCodes.js";
import { layoutInvalidErr, layoutUnplacedErr } from "../../errors/errors.js";
import { advanceBuildingTimers } from "../../services/base/advanceBuildingTimers.js";
import { healChampions } from "../../services/yard/catchUpChampions.js";
import { ApplyLayoutSchema } from "../../schemas/YardPlannerSchemas.js";
import { currentExpansion } from "../../services/yardplanner/layoutGeometry.js";
import { syncBaseValue, syncDerivedLevels } from "../../services/yard/derivedLevels.js";
import { nextBuildingId } from "../../services/yard/build.js";
import { TROJAN_HORSE_TYPE } from "../../game-data/buildingFootprints.js";
import { moveMushroomsOffBuildings } from "../../services/yard/mushrooms.js";
import {
  isDecoration,
  placedDecoration,
  storeDecoration,
  storedCount,
  takeDecoration,
} from "../../services/yard/decor.js";
import { yardKindOf } from "../../services/yardplanner/costs.js";
import {
  checkNodesOwned,
  checkNodePlacement,
  checkStoragePlacements,
  parsePayload,
  unplacedBuildings,
} from "../../services/yardplanner/validateLayout.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";
import { onPlannerYard } from "./plannerYard.js";

/**
 * `POST /bm/yardplanner/apply` — move the caller's buildings to the positions a
 * layout names.
 *
 * This is the first yard change the server makes itself. In the Flash client
 * Apply was pure client work: `BASE.applyTemplate` moved each foundation and an
 * ordinary base save carried the result over, so the server never knew a layout
 * had been applied and could not check one (`client/scripts/BASE.as:5025-5041`,
 * `docs/specs/base-building.md` §8). Here the client sends the layout and the
 * server does the moving.
 *
 * Three rules differ from a plain save to a slot:
 *
 * - Positions are measured against the plot the player actually owns
 *   (`storedata.ENL.q`), never the expansion the layout claims.
 * - Mushrooms never block (#263, owner decision 2026-10-04). They are not
 *   buildings and the planner skips them (`client/scripts/BASE.as:5097-5109`);
 *   any mushroom a building lands on pops up on free ground before the save is
 *   written (`moveMushroomsOffBuildings`), and the answer carries `mushrooms`
 *   so the client draws them where the server put them.
 * - Every non-decoration building has to be in the layout. Apply stays hard
 *   blocked while any is unplaced, with no auto-place
 *   (`docs/design/yard-planner-redesign.md` §8, decision Q4), because a
 *   building left where it was can collide with one the layout moves onto it.
 *   A slot may hold a half-finished plan with buildings in the drawer
 *   (`stored`); Apply ignores that list, so those buildings count as unplaced.
 *
 * Buildings under construction, upgrading or fortifying may be moved, matching
 * the original, which never looked at build state before calling `moveTo`. Of
 * a moved building only `X` and `Y` change; no resource or level is touched.
 * Countdowns across the whole yard are brought forward to now, because
 * `savetime` moves and a countdown is read as remaining time from it.
 *
 * Apply never upgrades anything. Until 2026-11-03 it could also start the
 * layout's planned upgrades (`startUpgrades=1`), one job per building on as
 * many buildings as there were free workers; the owner removed that ("There
 * shouldnt be a way to queue upgrades at once"). An older client that still
 * sends `startUpgrades` and `plan` fields gets its moves and nothing else, and
 * `upgrades: null` in the answer, which those clients already read as "nothing
 * was started".
 *
 * Decorations and storage (#128, as the Flash planner did it,
 * `com/monsters/baseplanner/BasePlanner.as:113-122`): every decoration the
 * layout leaves unplaced goes into storage, as a recycle would put it; and the
 * layout's `fromStorage` entries come out of storage as new, finished
 * decorations, inside the plot. The storing happens first, so one Apply can
 * lift a flag into the drawer and put a stored flag down elsewhere.
 *
 * With a `baseid` naming one of the caller's Map Room 2 outposts it applies
 * the layout to that outpost, charging the main pool (`plannerYard.ts`); with
 * the caller's Inferno `baseid`, to the Inferno yard. Moves are all or
 * nothing: any placement fault throws before a byte is written.
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const applyLayout: KoaController = async (ctx) => {
  const user: User = ctx.authUser;

  const answer = await onPlannerYard(user, ctx.request.body, (save, now) =>
    applyTo(save, ctx.request.body, now)
  );

  ctx.status = Status.OK;
  ctx.body = answer;
};

/** Apply's work on one yard (the controller comment); writes nothing but the save it is handed. */
const applyTo = (save: Save, raw: unknown, now: number) => {
  const body = ApplyLayoutSchema.parse(raw ?? {});
  const payload = parsePayload(body.data);

  checkNodesOwned(payload.nodes, save.buildingdata);

  const unplaced = unplacedBuildings(payload.nodes, save.buildingdata);
  if (unplaced.length > 0) throw layoutUnplacedErr(unplaced);

  // The Inferno yard's own yardage (`ENLI`) and footprints (Under Hall 160,
  // Academy 80).
  const kind = yardKindOf(save);
  const expansion = currentExpansion(save.storedata, kind);
  checkNodePlacement(payload.nodes, expansion, save.buildingdata, kind);

  // Decoration storage is the main yard's alone: an outpost or the Inferno
  // takes nothing out of it.
  const fromStorage = payload.fromStorage ?? [];
  if (fromStorage.length > 0 && kind !== "main") {
    throw layoutInvalidErr("Decorations go in your main yard.", { fromStorage: fromStorage.length });
  }
  checkStoragePlacements(fromStorage, payload.nodes, expansion, kind);

  // Bring the countdowns forward before `savetime` moves, or every running job
  // is handed the elapsed time a second time when the base is next loaded. Same
  // sequence as the attack path (`controllers/base/save/baseSave.ts:213-218`).
  let buildingdata = advanceBuildingTimers(
    save.buildingdata ?? {},
    save.buildinghealthdata,
    now - Number(save.savetime ?? now)
  );
  let moved = 0;
  const storage = storeAndPlace(save, buildingdata, payload.nodes, fromStorage);
  buildingdata = storage.buildingdata;

  for (const node of payload.nodes) {
    const building = buildingdata[String(node.id)] as BuildingData | undefined;
    if (!building) continue;
    // The Trojan Horse never moves through Apply, even if a forged layout
    // lists it (`docs/design/trojan-horse.md` §7, issue #324).
    if (Number(building.t) === TROJAN_HORSE_TYPE) continue;
    if (Number(building.X) === node.x && Number(building.Y) === node.y) continue;

    buildingdata[String(node.id)] = { ...building, X: node.x, Y: node.y };
    moved++;
  }

  save.buildingdata = buildingdata;
  save.buildinghealthdata = storage.buildinghealthdata;
  save.researchdata = storage.researchdata;
  moveMushroomsOffBuildings(save);
  syncDerivedLevels(save);
  syncBaseValue(save);
  // The caged champions keep the healing `savetime` moves past.
  healChampions(save, Number(save.savetime), now);
  save.savetime = now;

  return {
    error: 0,
    moved,
    stored: storage.stored,
    placed: storage.placed,
    buildingdata,
    buildinghealthdata: storage.buildinghealthdata,
    researchdata: storage.researchdata,
    resources: save.resources,
    mushrooms: save.mushrooms ?? {},
    // Read by older clients, which may still ask for planned upgrades.
    upgrades: null,
  };
};

/**
 * The storage half of Apply (#128): unplaced decorations in, `fromStorage`
 * out. New ids start above every id the save had before, so a stored
 * decoration's id is never handed to a new one in the same Apply.
 */
const storeAndPlace = (
  save: Save,
  buildingdata: BuildingDataMap,
  nodes: readonly { id: number }[],
  fromStorage: readonly { t: number; x: number; y: number }[]
) => {
  const listed = new Set(nodes.map((node) => node.id));
  let nextId = nextBuildingId(save);
  const next: BuildingDataMap = { ...buildingdata };
  const health: BuildingHealthData = { ...(save.buildinghealthdata ?? {}) };
  let researchdata: JsonObject = { ...(save.researchdata ?? {}) };
  const stored: number[] = [];
  const placed: number[] = [];

  for (const [key, building] of Object.entries(buildingdata)) {
    const id = Number((building as BuildingData).id ?? key);
    if (listed.has(id) || !isDecoration(Number((building as BuildingData).t))) continue;
    researchdata = storeDecoration(researchdata, building as BuildingData);
    delete next[key];
    delete health[key];
    stored.push(id);
  }

  const short: number[] = [];
  for (const [index, placement] of fromStorage.entries()) {
    if (storedCount(researchdata, placement.t) < 1) {
      short.push(index);
      continue;
    }
    const taken = takeDecoration(researchdata, placement.t);
    researchdata = taken.researchdata;
    const id = nextId++;
    next[String(id)] = placedDecoration(id, { type: placement.t, x: placement.x, y: placement.y }, taken.level);
    placed.push(id);
  }
  if (short.length > 0) {
    throw layoutInvalidErr("Some of those decorations are not in your storage any more.", {
      fromStorageNotInStorage: short.slice(0, 5),
    });
  }

  return { buildingdata: next, buildinghealthdata: health, researchdata, stored, placed };
};
