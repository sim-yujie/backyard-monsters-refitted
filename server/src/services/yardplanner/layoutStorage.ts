import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import {
  LAYOUT_SLOTS,
  LAYOUT_VERSION,
  type Layout,
  type LayoutNode,
} from "../../schemas/YardPlannerSchemas.js";

/**
 * Reading and writing the `savetemplate` column.
 *
 * One column holds both formats. Version 2 entries are stored as the {@link Layout}
 * the new client sees. Version 1 entries are what the Flash planner wrote —
 * `{ slotid, name, data }` where `data` is a JSON *string* holding an
 * index-keyed object of `{ x, y, id, type }` nodes
 * (`client/scripts/com/monsters/baseplanner/BaseTemplate.as:27-35`,
 * `BasePlannerService.as:17`) — and are converted to v2 on read, never mutated
 * in place, so a read-only session does not rewrite the save
 * (`docs/design/yard-planner-redesign.md` §5.5).
 */

/** A version 1 row as the Flash client left it. */
interface LegacyEntry {
  slotid: number;
  name?: string;
  data?: unknown;
}

/** A version 1 node. `type` is what v2 calls `t`. */
interface LegacyNode {
  x?: unknown;
  y?: unknown;
  id?: unknown;
  type?: unknown;
}

const asInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

/** Converts one v1 node object into a v2 node, or null if it is unusable. */
const legacyNode = (raw: unknown): LayoutNode | null => {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as LegacyNode;
  const id = asInt(node.id);
  const t = asInt(node.type);
  const x = asInt(node.x);
  const y = asInt(node.y);
  if (id === null || t === null || x === null || y === null) return null;
  return { id, t, x, y };
};

/**
 * The v1 `data` field in either form the column can hold: the JSON string the
 * client posted, or an already-parsed object if something decoded it on the way in.
 */
export const parseLegacyNodes = (data: unknown): LayoutNode[] => {
  let parsed = data;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];

  const nodes: LayoutNode[] = [];
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    const node = legacyNode(value);
    if (node) nodes.push(node);
  }
  return nodes;
};

const isValidSlot = (slot: unknown): slot is number =>
  Number.isInteger(slot) && (slot as number) >= 0 && (slot as number) < LAYOUT_SLOTS;

/**
 * One stored entry as a {@link Layout}, or null when the row is neither format
 * or names a slot outside the ten. The old client already discarded
 * out-of-range slots on load (`BasePlannerService.as:40-50`), so dropping them
 * here loses nothing a player could see.
 */
const toLayout = (entry: unknown): Layout | null => {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;

  if (row.version === LAYOUT_VERSION && Array.isArray(row.nodes)) {
    const slot = asInt(row.slot);
    if (!isValidSlot(slot)) return null;
    return {
      slot,
      name: typeof row.name === "string" ? row.name : "",
      version: LAYOUT_VERSION,
      expansion: asInt(row.expansion) ?? 0,
      updatedAt: asInt(row.updatedAt) ?? 0,
      nodes: row.nodes as LayoutNode[],
    };
  }

  const legacy = row as unknown as LegacyEntry;
  const slot = asInt(legacy.slotid);
  if (!isValidSlot(slot)) return null;

  return {
    slot,
    name: typeof legacy.name === "string" ? legacy.name : "",
    version: LAYOUT_VERSION,
    // A v1 row never recorded the expansion level it was drawn for
    // (`BaseTemplateNode.as:6-12`), so the client is told the smallest plot and
    // shows its "designed for a smaller yard" banner rather than a wrong number.
    expansion: 0,
    updatedAt: 0,
        nodes: parseLegacyNodes(legacy.data),
  };
};

/** Every layout in the column, converted to v2 and ordered by slot. */
export const readLayouts = (savetemplate: unknown[] | null | undefined): Layout[] => {
  if (!Array.isArray(savetemplate)) return [];
  return savetemplate
    .map(toLayout)
    .filter((layout): layout is Layout => layout !== null)
    .sort((a, b) => a.slot - b.slot);
};

/** The slot an entry occupies, in either format. */
const slotOf = (entry: unknown): number | null => {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  return asInt(row.version === LAYOUT_VERSION ? row.slot : row.slotid);
};

/**
 * Replaces the entry for `layout.slot`, appending if the slot is empty.
 * Returns the new column contents; the caller persists it.
 */
export const writeLayout = (
  savetemplate: unknown[] | null | undefined,
  layout: Layout
): unknown[] => {
  const column = Array.isArray(savetemplate) ? [...savetemplate] : [];
  const index = column.findIndex((entry) => slotOf(entry) === layout.slot);
  if (index === -1) column.push(layout);
  else column[index] = layout;
  return column;
};

/** Drops every entry for `slot`, in either format. */
export const removeLayout = (
  savetemplate: unknown[] | null | undefined,
  slot: number
): unknown[] => {
  const column = Array.isArray(savetemplate) ? savetemplate : [];
  return column.filter((entry) => slotOf(entry) !== slot);
};

/** Builds a {@link Layout} ready to store, stamped with the current time. */
export const makeLayout = (
  slot: number,
  name: string,
  expansion: number,
  nodes: LayoutNode[]
): Layout => ({
  slot,
  name,
  version: LAYOUT_VERSION,
  expansion,
  updatedAt: getCurrentDateTime(),
  nodes,
});

/**
 * A layout in the shape the Flash client expects from `gettemplates`:
 * `data` is a JSON string of an index-keyed object, because the client runs
 * `JSON.parse(template.data)` on it (`BasePlannerService.as:48`).
 */
export const toLegacyEntry = (layout: Layout): LegacyEntry => {
  const data: Record<string, { x: number; y: number; id: number; type: number }> = {};
  layout.nodes.forEach((node, index) => {
    data[index] = { x: node.x, y: node.y, id: node.id, type: node.t };
  });
  return { slotid: layout.slot, name: layout.name, data: JSON.stringify(data) };
};
