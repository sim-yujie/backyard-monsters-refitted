import { Status } from "../../enums/StatusCodes.js";
import { layoutUnplacedErr } from "../../errors/errors.js";
import { ApplyLayoutSchema } from "../../schemas/YardPlannerSchemas.js";
import {
  currentExpansion,
  mushroomRects,
} from "../../services/yardplanner/layoutGeometry.js";
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
 * the original, which never looked at build state before calling `moveTo`.
 * Only `X` and `Y` are written: no resource, level or timer is touched.
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

  const buildingdata = { ...(save.buildingdata ?? {}) };
  let moved = 0;

  for (const node of payload.nodes) {
    const building = buildingdata[String(node.id)] as BuildingData | undefined;
    if (!building) continue;
    if (Number(building.X) === node.x && Number(building.Y) === node.y) continue;

    buildingdata[String(node.id)] = { ...building, X: node.x, Y: node.y };
    moved++;
  }

  save.buildingdata = buildingdata;
  save.savetime = getCurrentDateTime();

  postgres.em.persist(save);
  await postgres.em.flush();

  ctx.status = Status.OK;
  ctx.body = { error: 0, moved, buildingdata };
};
