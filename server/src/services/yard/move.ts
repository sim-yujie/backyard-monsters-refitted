import { TROJAN_HORSE_TYPE } from "../../game-data/buildingFootprints.js";
import type { BuildingData } from "../../types/BuildingData.js";
import { placementGate, type BuildSave } from "./build.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * `POST /bm/yard/move`: one building picked up and put down elsewhere
 * (`docs/design/inferno.md` §5, WP 1.15), the yard's Move button
 * (`BFOUNDATION.StartMove` / `StopMoveB`, `client/scripts/BFOUNDATION.as:2760-2800`).
 *
 * Flash offers Move on every building but an immobile one
 * (`BUILDINGINFO.as:269`, `isImmobile` in the props: the Trojan Horse, the
 * Inferno cave and the three Map Room 3 structures, `YARD_PROPS.as:3041`,
 * `:6791`, `:7788-7903`, `INFERNOYARDPROPS.as:2409`, `:5929`), and puts the
 * building back where it was when the new spot is blocked (`BASE.BuildBlockers`).
 * Here the new spot takes the build's own placement rule (gate 6,
 * {@link placementGate}): inside the plot, clear of every other building, in
 * the yard's own footprints. A building still being built or upgraded may move:
 * Flash never checked (the Yard Planner's Apply moves them too,
 * `controllers/yardplanner/applyLayout.ts`). Nothing is paid and no countdown
 * changes; only `X` and `Y` do.
 *
 * Pure: no database, no clock.
 */

/** Building types Flash never lets move (the file comment). */
export const IMMOBILE_TYPES: ReadonlySet<number> = new Set([TROJAN_HORSE_TYPE, 127, 138, 139, 140]);

/** What a move answers with. */
export interface MoveReport {
  id: number;
  x: number;
  y: number;
}

/**
 * Moves one building.
 *
 * @param save - The caught-up yard (read only).
 * @param request - The building and its footprint's new origin.
 * @throws 400 `badRequest` for an id not in the yard; `409 immobile` for a
 *   building that never moves; gate 6's `409 placement`.
 */
export const planMove = (save: BuildSave, request: { id: number; x: number; y: number }) => {
  const { id, x, y } = request;
  const key = String(id);
  const building = save.buildingdata?.[key];
  if (!building) throw yardBadRequestErr("That building is not in your yard.", { id });

  const type = Number(building.t);
  if (IMMOBILE_TYPES.has(type)) throw yardRefusedErr("immobile", "That building cannot be moved.", { id });

  placementGate(save, { type, x, y }, id);

  const moved: BuildingData = { ...building, X: x, Y: y };
  const report: MoveReport = { id, x, y };
  return { report, slices: { buildingdata: { ...save.buildingdata, [key]: moved } } };
};
