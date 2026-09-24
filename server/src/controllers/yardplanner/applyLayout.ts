import { Status } from "../../enums/StatusCodes.js";
import { layoutUnplacedErr } from "../../errors/errors.js";
import { advanceBuildingTimers } from "../../services/base/advanceBuildingTimers.js";
import { Operation, updateResources } from "../../services/base/updateResources.js";
import { ApplyLayoutSchema } from "../../schemas/YardPlannerSchemas.js";
import {
  currentExpansion,
  mushroomRects,
} from "../../services/yardplanner/layoutGeometry.js";
import { walkUpgrades, type UpgradeWalk } from "../../services/yardplanner/startUpgrades.js";
import {
  checkNodesOwned,
  checkNodePlacement,
  parsePayload,
  unplacedBuildings,
} from "../../services/yardplanner/validateLayout.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { postgres } from "../../server.js";
import type { BuildingData } from "../../types/BuildingData.js";
import type { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";
import { debitOf } from "./upgradeWalls.js";

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
 * - Mushrooms are obstacles. They are not buildings and the planner skips them
 *   (`client/scripts/BASE.as:5097-5109`), but they still occupy their cells.
 * - Every non-decoration building has to be in the layout. Apply stays hard
 *   blocked while any is unplaced, with no auto-place
 *   (`docs/design/yard-planner-redesign.md` §8, decision Q4), because a
 *   building left where it was can collide with one the layout moves onto it.
 *
 * Buildings under construction, upgrading or fortifying may be moved, matching
 * the original, which never looked at build state before calling `moveTo`. Of
 * a moved building only `X` and `Y` change; no resource or level is touched.
 * Countdowns across the whole yard are brought forward to now, because
 * `savetime` moves and a countdown is read as remaining time from it.
 *
 * With `startUpgrades=1` the request does one thing more: after the moves, it
 * walks the nodes' `plan` fields and starts as many of them as the yard's free
 * workers and resources allow (`services/yardplanner/startUpgrades.ts`). That
 * happens inside the same `flush`, so the moves, the new countdowns, the
 * charge and the `savetime` move land together or not at all, and the player's
 * Apply stays one transaction rather than two.
 *
 * The upgrade half is **partial by design**. Moves are still all or nothing —
 * any placement fault throws before a byte is written — but a planned upgrade
 * the yard cannot start now is a row in the report, never a refusal of the
 * whole request (`docs/design/planner-upgrades.md` §3.2). The only plan that
 * does refuse the request is a malformed one: a target past the top of a
 * type's ladder, raised as a 400 carrying `planLevel`.
 *
 * @param {Context} ctx - The Koa context object, which includes the authenticated user.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 */
export const applyLayout: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);
  const save = user.save!;

  const body = ApplyLayoutSchema.parse(ctx.request.body ?? {});
  const payload = parsePayload(body.data);

  checkNodesOwned(payload.nodes, save.buildingdata);

  const unplaced = unplacedBuildings(payload.nodes, save.buildingdata);
  if (unplaced.length > 0) throw layoutUnplacedErr(unplaced);

  checkNodePlacement(
    payload.nodes,
    currentExpansion(save.storedata),
    mushroomRects(save.mushrooms)
  );

  // Bring the countdowns forward before `savetime` moves, or every running job
  // is handed the elapsed time a second time when the base is next loaded. Same
  // sequence as the attack path (`controllers/base/save/baseSave.ts:213-218`).
  const now = getCurrentDateTime();
  let buildingdata = advanceBuildingTimers(
    save.buildingdata ?? {},
    save.buildinghealthdata,
    now - Number(save.savetime ?? now)
  );
  let moved = 0;

  for (const node of payload.nodes) {
    const building = buildingdata[String(node.id)] as BuildingData | undefined;
    if (!building) continue;
    if (Number(building.X) === node.x && Number(building.Y) === node.y) continue;

    buildingdata[String(node.id)] = { ...building, X: node.x, Y: node.y };
    moved++;
  }

  // The walk reads the yard the moves have just written, so the report and the
  // `buildingdata` that comes back describe the same yard. Nothing in it reads
  // a position, so the order is for consistency rather than for correctness.
  let upgrades: UpgradeWalk | null = null;
  if (body.startUpgrades === 1) {
    upgrades = walkUpgrades(
      {
        buildingdata,
        buildinghealthdata: save.buildinghealthdata,
        resources: save.resources,
        storedata: save.storedata,
      },
      payload.nodes,
      now
    );

    buildingdata = upgrades.buildingdata;
    save.resources = updateResources(
      debitOf(upgrades.cost),
      { ...(save.resources ?? {}) },
      Operation.SUBTRACT
    );
    save.points = String(Number(save.points ?? "0") + upgrades.points);
  }

  save.buildingdata = buildingdata;
  save.savetime = now;

  postgres.em.persist(save);
  await postgres.em.flush();

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    moved,
    buildingdata,
    resources: save.resources,
    upgrades: upgrades && report(upgrades),
  };
};

/**
 * The walk's result without the new `buildingdata`, which the response already
 * carries at the top level and which is the largest thing in a save.
 */
const report = (walk: UpgradeWalk) => ({
  started: walk.started,
  finished: walk.finished,
  waiting: walk.waiting,
  skipped: walk.skipped,
  cost: walk.cost,
  points: walk.points,
  workers: walk.workers,
});
