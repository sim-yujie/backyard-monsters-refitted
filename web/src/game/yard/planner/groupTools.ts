import { snap, type Position } from "./placement";

/**
 * Mirror, align and distribute, as arithmetic and nothing else (design §3, F7).
 *
 * Every operation here takes a set of footprints and answers with the positions
 * they would end up at. Nothing is validated, nothing is committed and nothing
 * knows what a `Plan` is — `Plan.commitTargets` decides whether the answer is
 * legal, and refuses the whole set if it is not.
 *
 * ## Why mirroring is only a coordinate transform
 *
 * A footprint is a rectangle with no rotation field anywhere in the save
 * (`BaseTemplateNode.as:6-12`), and sprites have fixed facings, so a mirrored
 * layout is mechanically identical to its original: nothing changes shape and
 * nothing turns around. Design §3, F7 puts it as "mirrors positions, not
 * artwork".
 *
 * The origin is the footprint's top-left corner in yard units and a footprint
 * runs positively on both axes, so it covers `[x, x + width)`. Reflecting that
 * interval about a vertical axis at `cx` sends `[x, x + width)` to
 * `[2cx - x - width, 2cx - x)`, so the *new origin* is `2cx - x - width` and not
 * `2cx - x`. With `cx` the centre of the selection's own bounding box,
 * `2cx = minX + maxX`, which keeps the arithmetic in integers: every yard
 * coordinate and every footprint in the table is a whole number, so a mirror of
 * a grid-aligned selection lands back on the grid exactly.
 *
 * ## Why every result is snapped
 *
 * Most footprints are multiples of the 5-unit grid, but decorations take their
 * size from the props table (`BDECORATION.as:20-25`) and a few of those are not,
 * so a centre-align or an even distribution can land on a half unit. Snapping
 * keeps the plan on the grid the occupancy bitmap is addressed by. Snapping is
 * the one place a result can stop being an exact isometry, which is another
 * reason the caller re-validates rather than trusting the transform.
 */

/** One footprint, which is all these operations need of a building. */
export interface Footprint {
  readonly id: number;
  /** Yard units, the footprint's top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The half-open box a set of footprints covers, in yard units. */
export interface GroupExtent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export const GroupOp = {
  MIRROR_X: "mirror-x",
  MIRROR_Y: "mirror-y",
  ALIGN_LEFT: "align-left",
  ALIGN_RIGHT: "align-right",
  ALIGN_TOP: "align-top",
  ALIGN_BOTTOM: "align-bottom",
  ALIGN_CENTRE_X: "align-centre-x",
  ALIGN_CENTRE_Y: "align-centre-y",
  DISTRIBUTE_X: "distribute-x",
  DISTRIBUTE_Y: "distribute-y",
} as const;
export type GroupOp = (typeof GroupOp)[keyof typeof GroupOp];

export interface GroupOpInfo {
  /** What the toolbar button or the menu row says. */
  readonly menu: string;
  /** A sentence-case name, for the undo entry and the refusal notice. */
  readonly label: string;
  /** The tooltip, which is also the only place the rule is spelled out. */
  readonly hint: string;
  /** How many buildings have to be selected before it can do anything. */
  readonly minimum: number;
}

/**
 * Every operation, its wording and how big a selection it needs.
 *
 * The minimums are geometric facts rather than policy. Mirroring one building
 * about its own centre is the identity, so a mirror only starts to mean
 * something at two; aligning needs two edges to have one to align to; and
 * distributing holds the outermost two still and spaces what is between them,
 * so with two there is nothing between them to move.
 */
export const GROUP_OPS: Readonly<Record<GroupOp, GroupOpInfo>> = {
  [GroupOp.MIRROR_X]: {
    menu: "Mirror ↔",
    label: "Mirror left to right",
    hint: "Flip the selection left to right about its own centre (M). Positions mirror, artwork does not.",
    minimum: 2,
  },
  [GroupOp.MIRROR_Y]: {
    menu: "Mirror ↕",
    label: "Mirror top to bottom",
    hint: "Flip the selection top to bottom about its own centre (Shift+M). Positions mirror, artwork does not.",
    minimum: 2,
  },
  [GroupOp.ALIGN_LEFT]: {
    menu: "Left edges",
    label: "Align left",
    hint: "Put every left edge on the leftmost one",
    minimum: 2,
  },
  [GroupOp.ALIGN_RIGHT]: {
    menu: "Right edges",
    label: "Align right",
    hint: "Put every right edge on the rightmost one",
    minimum: 2,
  },
  [GroupOp.ALIGN_TOP]: {
    menu: "Top edges",
    label: "Align top",
    hint: "Put every top edge on the topmost one",
    minimum: 2,
  },
  [GroupOp.ALIGN_BOTTOM]: {
    menu: "Bottom edges",
    label: "Align bottom",
    hint: "Put every bottom edge on the bottommost one",
    minimum: 2,
  },
  [GroupOp.ALIGN_CENTRE_X]: {
    menu: "Centres across",
    label: "Align centres across",
    hint: "Put every footprint's centre on one vertical line",
    minimum: 2,
  },
  [GroupOp.ALIGN_CENTRE_Y]: {
    menu: "Centres down",
    label: "Align centres down",
    hint: "Put every footprint's centre on one horizontal line",
    minimum: 2,
  },
  [GroupOp.DISTRIBUTE_X]: {
    menu: "Evenly across",
    label: "Distribute across",
    hint: "Equal gaps left to right, with the outermost two left where they are",
    minimum: 3,
  },
  [GroupOp.DISTRIBUTE_Y]: {
    menu: "Evenly down",
    label: "Distribute down",
    hint: "Equal gaps top to bottom, with the outermost two left where they are",
    minimum: 3,
  },
};

/** The bounding box of a selection, in yard units. Empty sets are all zero. */
export const groupExtent = (nodes: readonly Footprint[]): GroupExtent => {
  if (nodes.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    if (node.x < minX) minX = node.x;
    if (node.x + node.width > maxX) maxX = node.x + node.width;
    if (node.y < minY) minY = node.y;
    if (node.y + node.height > maxY) maxY = node.y + node.height;
  }

  return { minX, maxX, minY, maxY };
};

/**
 * Where an operation would put each building that it moves.
 *
 * Buildings it would leave where they are are left out, so the map's size is
 * how many things would actually change and an empty map means "already like
 * that". The caller decides whether the answer is legal.
 */
export const groupTargets = (
  op: GroupOp,
  nodes: readonly Footprint[],
): Map<number, Position> => {
  if (nodes.length < GROUP_OPS[op].minimum) return new Map();

  switch (op) {
    case GroupOp.MIRROR_X:
    case GroupOp.MIRROR_Y:
      return mirror(op, nodes);
    case GroupOp.DISTRIBUTE_X:
    case GroupOp.DISTRIBUTE_Y:
      return distribute(op, nodes);
    default:
      return align(op, nodes);
  }
};

/* ── The three transforms ─────────────────────────────────────────────── */

const mirror = (
  op: typeof GroupOp.MIRROR_X | typeof GroupOp.MIRROR_Y,
  nodes: readonly Footprint[],
): Map<number, Position> => {
  const { minX, maxX, minY, maxY } = groupExtent(nodes);
  // `2 * centre` rather than the centre itself: the sum is exact where the
  // half is not, which is what keeps an odd-width selection on the grid.
  const twiceCentre = op === GroupOp.MIRROR_X ? minX + maxX : minY + maxY;

  return moves(nodes, (node) =>
    op === GroupOp.MIRROR_X
      ? { x: snap(twiceCentre - node.x - node.width), y: node.y }
      : { x: node.x, y: snap(twiceCentre - node.y - node.height) },
  );
};

const align = (op: GroupOp, nodes: readonly Footprint[]): Map<number, Position> => {
  const { minX, maxX, minY, maxY } = groupExtent(nodes);

  return moves(nodes, (node) => {
    switch (op) {
      case GroupOp.ALIGN_LEFT:
        return { x: minX, y: node.y };
      case GroupOp.ALIGN_RIGHT:
        return { x: snap(maxX - node.width), y: node.y };
      case GroupOp.ALIGN_TOP:
        return { x: node.x, y: minY };
      case GroupOp.ALIGN_BOTTOM:
        return { x: node.x, y: snap(maxY - node.height) };
      case GroupOp.ALIGN_CENTRE_X:
        return { x: snap((minX + maxX - node.width) / 2), y: node.y };
      case GroupOp.ALIGN_CENTRE_Y:
        return { x: node.x, y: snap((minY + maxY - node.height) / 2) };
      default:
        return { x: node.x, y: node.y };
    }
  });
};

/**
 * Equal gaps along one axis, with the outermost two left exactly where they are.
 *
 * The gap can come out negative when the selection already overlaps itself
 * along the axis; that is not special-cased, because the result is then refused
 * by the same overlap test every other move goes through, and a silent fallback
 * would leave the player wondering which of their buildings had moved.
 *
 * The running position is accumulated unsnapped and only the value written out
 * is snapped, so a row of twenty cannot drift by a rounding step per building.
 */
const distribute = (
  op: typeof GroupOp.DISTRIBUTE_X | typeof GroupOp.DISTRIBUTE_Y,
  nodes: readonly Footprint[],
): Map<number, Position> => {
  const across = op === GroupOp.DISTRIBUTE_X;
  const start = (node: Footprint): number => (across ? node.x : node.y);
  const length = (node: Footprint): number => (across ? node.width : node.height);

  // Ties broken by id so the order is the same every run: two buildings that
  // start level would otherwise swap places between two identical presses.
  const order = [...nodes].sort((a, b) => start(a) - start(b) || a.id - b.id);
  const first = order[0];
  const last = order[order.length - 1];
  if (!first || !last) return new Map();

  let occupied = 0;
  for (const node of order) occupied += length(node);
  const span = start(last) + length(last) - start(first);
  const gap = (span - occupied) / (order.length - 1);

  const targets = new Map<number, Position>();
  let cursor = start(first) + length(first) + gap;

  for (let index = 1; index < order.length - 1; index++) {
    const node = order[index];
    if (!node) continue;
    const at = snap(cursor);
    cursor += length(node) + gap;
    if (at === start(node)) continue;
    targets.set(node.id, across ? { x: at, y: node.y } : { x: node.x, y: at });
  }

  return targets;
};

/** Runs a transform over a selection, keeping only the buildings that move. */
const moves = (
  nodes: readonly Footprint[],
  to: (node: Footprint) => Position,
): Map<number, Position> => {
  const targets = new Map<number, Position>();
  for (const node of nodes) {
    const next = to(node);
    if (next.x === node.x && next.y === node.y) continue;
    targets.set(node.id, next);
  }
  return targets;
};
