import { LandFeature, landFeatureOf } from "@/game/combat/rules";

/**
 * Where a land feature's painted props stand on its hex (Map Room 2 land
 * features, design A of `docs/mr2-civ-study.md`).
 *
 * Owner, 3 Nov 2026: the map should look like the Codex mock-up (study
 * section 6): a forest hex FULL of trees, a marsh hex with goo pools and reed
 * clumps spread across it, a rock hex with boulder groups, a resource hex with
 * its glowing pile. Every land cell carries a camp or a yard at its centre, so
 * only the middle the camp's picture and badge (or the yard and its name
 * label) need is kept clear; the rest of the hex is filled.
 *
 * Pure: a feature and a cell in, a list of props out, the same on every
 * visit and every computer (a hash of the cell picks the spots, the pictures
 * and their sizes). `landSprites.ts` holds the pictures; `MapChunk.ts` puts one
 * sprite per prop into the chunk's own `features` layer.
 *
 * The hex top is 150 x 75 points (`CELL_WIDTH` x `CELL_HEIGHT`), its points
 * at (+-75, 0) and its flat edges at y = +-37.5; positions here are a prop's
 * foot, from the centre.
 */

/** The prop sheet's frames (`public/maproom/land/land-props@4x.webp`, 8 x 4). */
export const PROP_SHEET_COLUMNS = 8;
export const PROP_SHEET_ROWS = 4;

/** Frames of each kind of prop on the sheet. */
export const PROP_FRAMES = {
  /** Round broad-leaf trees and a bush. */
  leafy: [0, 1, 2, 3, 8, 9, 10],
  pines: [4, 5, 6, 7, 11],
  rocks: [12, 13, 14, 15, 16, 17, 18, 19],
  puddles: [20, 21],
  reeds: [22, 23],
  /** Twigs, pebbles, putty, goo: the big pile, then its small companion four frames on. */
  nodes: [24, 25, 26, 27],
  nodeSmall: [28, 29, 30, 31],
} as const;

/** Every tree frame. */
export const TREE_FRAMES: readonly number[] = [...PROP_FRAMES.leafy, ...PROP_FRAMES.pines];

/** One prop: a sheet frame, its foot on the hex, its size and facing. */
export interface LandProp {
  frame: number;
  x: number;
  y: number;
  scale: number;
  /** Drawn mirrored, so two cells with the same tree still differ. */
  flip: boolean;
}

/** The middle the camp or yard needs: an ellipse round its picture and badge... */
const CLEAR_X = 30;
const CLEAR_Y = 21;
const CLEAR_CENTRE_Y = -6;
/** ...and the strip under it where a yard's name label sits. */
const LABEL_HALF_WIDTH = 34;
const LABEL_TOP = 10;

/** Whether a foot at (x, y) stands on the hex, a few points in from its edge. */
const onHex = (x: number, y: number, margin: number): boolean =>
  Math.abs(y) <= 37.5 - margin && Math.abs(x) <= 75 - margin * 1.6 - Math.abs(y);

/** Whether (x, y) is in the middle kept for the camp or yard. */
export const inClearMiddle = (x: number, y: number): boolean =>
  (x / CLEAR_X) ** 2 + ((y - CLEAR_CENTRE_Y) / CLEAR_Y) ** 2 < 1 ||
  (Math.abs(x) < LABEL_HALF_WIDTH && y > LABEL_TOP);

/** The spots a prop may stand on: a staggered grid over the hex, minus the middle. */
const spotsOn = (
  stepX: number,
  stepY: number,
  margin: number,
): readonly { x: number; y: number }[] => {
  const spots: { x: number; y: number }[] = [];
  for (let row = 0, y = -37.5 + margin; y <= 37.5 - margin; row++, y += stepY) {
    for (let x = -75 + (row % 2 ? stepX / 2 : 0); x <= 75; x += stepX) {
      if (onHex(x, y, margin) && !inClearMiddle(x, y)) spots.push({ x, y });
    }
  }
  return spots;
};

/** Trees stand close (a canopy); rocks, pools and reeds a little apart. */
const TREE_SPOTS = spotsOn(13, 8, 3);
const WIDE_SPOTS = spotsOn(24, 12, 5);

/** A small integer hash of a cell and a salt, the same everywhere. */
export const cellHash = (col: number, row: number, salt = 0): number => {
  let h =
    Math.imul(col | 0, 0x27d4eb2d) ^
    Math.imul(row | 0, 0x165667b1) ^
    Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/** The spots in this cell's own shuffled order. */
const shuffled = <T>(items: readonly T[], col: number, row: number, salt: number): T[] => {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = cellHash(col, row, salt + i) % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
};

/** Up to +-`amount` points of wobble, so the grid never shows. */
const wobble = (col: number, row: number, salt: number, amount: number): number =>
  ((cellHash(col, row, salt) % 1000) / 1000 - 0.5) * 2 * amount;

const choose = (frames: readonly number[], col: number, row: number, salt: number): number =>
  frames[cellHash(col, row, salt) % frames.length]!;

/** A size between `low` and `high`, by the hash. */
const between = (col: number, row: number, salt: number, low: number, high: number): number =>
  low + ((cellHash(col, row, salt) % 1000) / 1000) * (high - low);

const at = (
  frame: number,
  spot: { x: number; y: number },
  col: number,
  row: number,
  salt: number,
  scale: number,
  jitter: number,
): LandProp => {
  let x = spot.x + wobble(col, row, salt, jitter);
  let y = spot.y + wobble(col, row, salt + 1, jitter / 2);
  // A wobble never carries a prop off the hex or into the middle.
  if (!onHex(x, y, 1) || inClearMiddle(x, y)) ({ x, y } = spot);
  return { frame, x, y, scale, flip: cellHash(col, row, salt + 2) % 2 === 1 };
};

/** A forest: trees on most of the hex, a pine wood, a broad-leaf wood or a mix. */
const forest = (col: number, row: number): LandProp[] => {
  const kind = cellHash(col, row, 1) % 3; // 0 pines, 1 mixed, 2 broad-leaf
  const spots = shuffled(TREE_SPOTS, col, row, 100);
  const count = Math.round(spots.length * 0.85);
  return spots.slice(0, count).map((spot, n) => {
    const pine =
      kind === 0
        ? cellHash(col, row, 300 + n) % 6 !== 0
        : kind === 1
          ? n % 2 === 0
          : cellHash(col, row, 300 + n) % 5 === 0;
    const frame = choose(pine ? PROP_FRAMES.pines : PROP_FRAMES.leafy, col, row, 400 + n);
    return at(frame, spot, col, row, 500 + n * 3, between(col, row, 600 + n, 0.5, 0.68), 3);
  });
};

/** Rocks: four or five boulder groups, a big stone with one or two smaller ones beside it. */
const rocks = (col: number, row: number): LandProp[] => {
  const props: LandProp[] = [];
  const groups = 4 + (cellHash(col, row, 1) % 2);
  shuffled(WIDE_SPOTS, col, row, 100)
    .slice(0, groups)
    .forEach((spot, g) => {
      props.push(
        at(
          choose(PROP_FRAMES.rocks, col, row, 200 + g),
          spot,
          col,
          row,
          300 + g * 9,
          between(col, row, 400 + g, 0.75, 0.95),
          3,
        ),
      );
      const extra = 1 + (cellHash(col, row, 450 + g) % 2);
      for (let k = 0; k < extra; k++) {
        const side = k === 0 ? 1 : -1;
        const near = { x: spot.x + side * 10, y: spot.y + 4 + k * 2 };
        if (!onHex(near.x, near.y, 3) || inClearMiddle(near.x, near.y)) continue;
        props.push(
          at(
            choose(PROP_FRAMES.rocks, col, row, 500 + g * 3 + k),
            near,
            col,
            row,
            600 + g * 9 + k * 3,
            between(col, row, 700 + g * 3 + k, 0.4, 0.55),
            2,
          ),
        );
      }
    });
  return props;
};

/** Marsh: goo pools and reed clumps spread across the hex. */
const marsh = (col: number, row: number): LandProp[] => {
  const spots = shuffled(WIDE_SPOTS, col, row, 100);
  const pools = 3 + (cellHash(col, row, 1) % 2);
  const reeds = 4 + (cellHash(col, row, 2) % 2);
  return spots
    .slice(0, pools + reeds)
    .map((spot, n) =>
      n < pools
        ? at(
            choose(PROP_FRAMES.puddles, col, row, 200 + n),
            spot,
            col,
            row,
            300 + n * 3,
            between(col, row, 400 + n, 0.7, 0.95),
            3,
          )
        : at(
            choose(PROP_FRAMES.reeds, col, row, 200 + n),
            spot,
            col,
            row,
            300 + n * 3,
            between(col, row, 400 + n, 0.6, 0.8),
            3,
          ),
    );
};

/** A resource node: its glowing pile on a front corner, a small one at the back. */
const node = (kind: number, col: number, row: number): LandProp[] => {
  const right = cellHash(col, row, 7) % 2 === 1;
  return [
    at(PROP_FRAMES.nodeSmall[kind]!, { x: right ? -40 : 40, y: -20 }, col, row, 20, 0.95, 3),
    at(PROP_FRAMES.nodes[kind]!, { x: right ? 46 : -46, y: 16 }, col, row, 23, 1.1, 3),
  ];
};

/**
 * The props of a feature on a cell, back to front (so later ones are drawn
 * over earlier ones). Open ground and an unknown feature have none.
 */
export const landProps = (feature: unknown, col: number, row: number): LandProp[] => {
  const id = landFeatureOf(feature);
  let props: LandProp[];
  switch (id) {
    case LandFeature.OPEN:
      return [];
    case LandFeature.FOREST:
      props = forest(col, row);
      break;
    case LandFeature.ROCKS:
      props = rocks(col, row);
      break;
    case LandFeature.MARSH:
      props = marsh(col, row);
      break;
    default:
      props = node(id - LandFeature.TWIG_NODE, col, row);
  }
  return props.sort((a, b) => a.y - b.y);
};
