import { layoutInvalidErr } from "../../errors/errors.js";
import { footprintOf, MUSHROOM_TYPE } from "../../game-data/buildingFootprints.js";
import {
  LAYOUT_NAME_MAX,
  LAYOUT_NODE_MAX,
  LAYOUT_SLOTS,
  LayoutPayloadSchema,
  type LayoutNode,
  type LayoutPayload,
} from "../../schemas/YardPlannerSchemas.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import {
  overlaps,
  rectOf,
  sweepOverlaps,
  withinBounds,
  type FootprintRect,
} from "./layoutGeometry.js";

/**
 * Every rule the server enforces on a layout, in one place, so that saving a
 * layout and applying one cannot drift apart
 * (`docs/design/yard-planner-redesign.md` §5.2).
 *
 * Nothing here touches the database: callers hand in the save's `buildingdata`
 * and the bounds to measure against, which is what lets Apply check the plot
 * the player actually has while a save checks the plot the layout was drawn for.
 */

/**
 * How many offending ids an error message names before it stops.
 *
 * Shared with the batch routes (`wallUpgrade.ts`, `trapRearm.ts`) so that every
 * Yard Planner rejection reads the same way and carries the same amount of
 * detail.
 */
export const MAX_LISTED = 5;

/** `1, 2, 3, 4, 5 and 7 more` — a readable prefix of a list of ids or indexes. */
export const listIds = (ids: number[]): string => {
  const shown = ids.slice(0, MAX_LISTED).join(", ");
  return ids.length > MAX_LISTED ? `${shown} and ${ids.length - MAX_LISTED} more` : shown;
};

/** A route's `:slot` parameter, or the legacy `slotid` form field. */
export const parseSlot = (raw: unknown): number => {
  const slot = Number(raw);
  if (!Number.isInteger(slot) || slot < 0 || slot >= LAYOUT_SLOTS) {
    throw layoutInvalidErr(
      `That layout slot does not exist. Pick a slot from 0 to ${LAYOUT_SLOTS - 1}.`,
      { slot: raw }
    );
  }
  return slot;
};

/** A layout name: trimmed, non-empty, and short enough for the slot list. */
export const parseName = (raw: unknown): string => {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length < 1 || name.length > LAYOUT_NAME_MAX) {
    throw layoutInvalidErr(
      `A layout name has to be between 1 and ${LAYOUT_NAME_MAX} characters.`,
      { name: raw }
    );
  }
  return name;
};

/** The `data` form field: a JSON string holding a version 2 payload. */
export const parsePayload = (raw: unknown): LayoutPayload => {
  if (typeof raw !== "string" || raw.length === 0) {
    throw layoutInvalidErr("That layout is missing its data.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw layoutInvalidErr("That layout could not be read. Please try saving it again.");
  }

  const parsed = LayoutPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    const nodeCount = (decoded as { nodes?: unknown })?.nodes;
    if (Array.isArray(nodeCount) && nodeCount.length > LAYOUT_NODE_MAX) {
      throw layoutInvalidErr(
        `That layout has too many buildings in it. The limit is ${LAYOUT_NODE_MAX}.`,
        { nodes: nodeCount.length }
      );
    }
    throw layoutInvalidErr("That layout is not in a format this server understands.", {
      issues: parsed.error.issues.slice(0, MAX_LISTED).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
};

/**
 * Checks every node against the caller's own buildings.
 *
 * A node has to name a building the caller owns, of the same type, and no
 * building may be listed twice. Ids the save does not have are reported back so
 * the client can say which ones went missing rather than failing silently.
 */
export const checkNodesOwned = (
  nodes: LayoutNode[],
  buildingdata: BuildingDataMap | null | undefined
): void => {
  const buildings = buildingdata ?? {};
  const unknown: number[] = [];
  const mismatched: number[] = [];
  const duplicated: number[] = [];
  const seen = new Set<number>();

  for (const node of nodes) {
    if (seen.has(node.id)) duplicated.push(node.id);
    seen.add(node.id);

    const building = buildings[String(node.id)] as BuildingData | undefined;
    if (!building) unknown.push(node.id);
    else if (Number(building.t) !== node.t) mismatched.push(node.id);
  }

  if (unknown.length > 0) {
    throw layoutInvalidErr(
      `This layout refers to ${unknown.length} building${
        unknown.length === 1 ? "" : "s"
      } that are no longer in your yard (${listIds(unknown)}).`,
      { unknown: unknown.slice(0, MAX_LISTED) }
    );
  }
  if (mismatched.length > 0) {
    throw layoutInvalidErr(
      `This layout has the wrong building type for ${listIds(mismatched)}.`,
      { mismatched: mismatched.slice(0, MAX_LISTED) }
    );
  }
  if (duplicated.length > 0) {
    throw layoutInvalidErr(`This layout lists ${listIds(duplicated)} more than once.`, {
      duplicated: duplicated.slice(0, MAX_LISTED),
    });
  }
};

/**
 * Checks positions: inside the plot for `expansion`, and no two footprints on
 * the same cells. `obstacles` are fixed rectangles nothing may overlap, which
 * is how Apply keeps buildings off mushrooms.
 */
export const checkNodePlacement = (
  nodes: LayoutNode[],
  expansion: number,
  obstacles: FootprintRect[] = []
): void => {
  const outside: number[] = [];
  const placed: { id: number; rect: FootprintRect }[] = [];

  for (const node of nodes) {
    const rect = rectOf(node.t, node.x, node.y);
    if (!withinBounds(rect, node.t, expansion)) outside.push(node.id);
    placed.push({ id: node.id, rect });
  }

  if (outside.length > 0) {
    throw layoutInvalidErr(
      `${outside.length} building${
        outside.length === 1 ? " does" : "s do"
      } not fit inside your yard (${listIds(outside)}).`,
      { outOfBounds: outside.slice(0, MAX_LISTED), expansion }
    );
  }

  const collision = sweepOverlaps(placed.map(({ id, rect }) => ({ key: id, rect })));
  if (collision) {
    throw layoutInvalidErr(
      `Two buildings in this layout are on top of each other (${collision[0]} and ${collision[1]}).`,
      { overlapping: [collision[0], collision[1]] }
    );
  }

  if (obstacles.length === 0) return;

  const blocked = placed.filter((entry) =>
    obstacles.some((obstacle) => overlaps(entry.rect, obstacle))
  );
  if (blocked.length > 0) {
    const ids = blocked.map((entry) => entry.id);
    throw layoutInvalidErr(
      `${ids.length} building${
        ids.length === 1 ? " is" : "s are"
      } sitting on a mushroom (${listIds(ids)}). Clear the mushroom or move ${
        ids.length === 1 ? "it" : "them"
      }.`,
      { blocked: ids.slice(0, MAX_LISTED) }
    );
  }
};

/**
 * Buildings in the yard that the layout does not place.
 *
 * Decorations are exempt, because the Flash planner recycled unplaced
 * decorations into storage instead of blocking
 * (`com/monsters/baseplanner/BasePlanner.as:113-122`), and so are mushrooms,
 * which the planner skips entirely (`client/scripts/BASE.as:5097-5109`).
 */
export const unplacedBuildings = (
  nodes: LayoutNode[],
  buildingdata: BuildingDataMap | null | undefined
): number[] => {
  const placed = new Set(nodes.map((node) => node.id));
  const unplaced: number[] = [];

  for (const [key, building] of Object.entries(buildingdata ?? {})) {
    const type = Number((building as BuildingData).t);
    if (type === MUSHROOM_TYPE || footprintOf(type).decoration) continue;

    const id = Number((building as BuildingData).id ?? key);
    if (!placed.has(id)) unplaced.push(id);
  }
  return unplaced.sort((a, b) => a - b);
};
