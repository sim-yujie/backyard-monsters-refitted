/**
 * The star figures drawn over each constellation's monster (design v5 §9a;
 * owner 10 Nov: the stars must trace the monster).
 *
 * A figure lives in the Constellation tab's 200 x 170 box, where the monster's
 * 3:2 card picture fills the width (x 0-200, y 18.3-151.7). It has 10 stars as
 * [x, y], lit two by two in this order, and its lines as pairs of star
 * numbers: a line is lit when both its stars are.
 *
 * {@link BUILT_IN_FIGURES} are the game's own; the owner redraws any of them
 * with the star editor (`StarEditor.ts`), which saves to the server
 * (`server/src/services/alliance/starFigures.ts`). Every player's `myalliance`
 * answer carries those saved figures (`star_figures`), and they win over the
 * built-in ones. The editor's "Copy" gives the JSON to paste here when a
 * drawing should become the built-in one.
 */

export type StarPoint = readonly [number, number];

export interface StarFigure {
  readonly stars: readonly StarPoint[];
  readonly lines: readonly (readonly [number, number])[];
}

export const FIGURE_WIDTH = 200;
export const FIGURE_HEIGHT = 170;
export const FIGURE_STARS = 10;
/** Where the 3:2 monster picture sits in the box. */
export const ART_TOP = (FIGURE_HEIGHT - (FIGURE_WIDTH * 2) / 3) / 2;

/**
 * The monster each constellation is named after, by roster id
 * (`game/combat/rules/report.ts` MONSTER_NAMES), so its picture can sit
 * faintly behind its stars (owner, 10 Nov).
 */
export const CONSTELLATION_MONSTERS: Readonly<Record<string, string>> = {
  pokey: "C1",
  octoooze: "C2",
  bolt: "C3",
  ichi: "C6",
  bandito: "C7",
  fang: "C8",
  brain: "C9",
  crabatron: "C10",
  wormzer: "C13",
  teratorn: "C14",
  zafreeti: "C15",
  slimeattikus: "C17",
};

/** The game's figures, by constellation id; first pass traced over each monster's card (10 Nov). */
export const BUILT_IN_FIGURES: Readonly<Record<string, StarFigure>> = {
  pokey: {
    stars: [[103, 20], [147, 33], [180, 82], [162, 124], [110, 146], [55, 124], [42, 72], [55, 40], [80, 72], [117, 72]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], [8, 9]],
  },
  octoooze: {
    stars: [[87, 32], [104, 32], [95, 60], [72, 78], [140, 80], [27, 113], [57, 140], [97, 142], [158, 122], [188, 100]],
    lines: [[0, 2], [1, 2], [2, 3], [2, 4], [3, 4], [3, 5], [3, 6], [4, 7], [4, 8], [4, 9]],
  },
  bolt: {
    stars: [[100, 22], [75, 40], [123, 38], [97, 65], [67, 82], [70, 110], [90, 140], [133, 127], [125, 82], [158, 85]],
    lines: [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [5, 6], [6, 7], [7, 9], [8, 9], [3, 8]],
  },
  ichi: {
    stars: [[112, 24], [153, 32], [146, 55], [72, 53], [95, 85], [45, 115], [78, 138], [115, 100], [148, 112], [160, 78]],
    lines: [[3, 0], [0, 1], [1, 2], [1, 9], [9, 8], [8, 7], [7, 6], [7, 4], [4, 3], [4, 5]],
  },
  bandito: {
    stars: [[85, 23], [88, 48], [140, 43], [153, 64], [167, 93], [80, 85], [62, 120], [110, 105], [130, 142], [55, 140]],
    lines: [[0, 1], [1, 5], [5, 6], [6, 9], [0, 2], [2, 3], [3, 4], [4, 8], [8, 7], [7, 5]],
  },
  fang: {
    stars: [[124, 30], [150, 50], [125, 68], [73, 67], [100, 90], [32, 128], [60, 138], [132, 135], [162, 130], [100, 110]],
    lines: [[0, 1], [1, 2], [2, 3], [2, 4], [3, 4], [4, 9], [9, 5], [9, 6], [9, 7], [9, 8]],
  },
  brain: {
    stars: [[110, 25], [148, 45], [68, 52], [80, 83], [18, 107], [27, 135], [82, 140], [108, 140], [165, 127], [175, 90]],
    lines: [[2, 0], [0, 1], [2, 3], [3, 4], [4, 5], [3, 6], [3, 7], [1, 9], [9, 8]],
  },
  crabatron: {
    stars: [[97, 32], [115, 35], [100, 62], [58, 28], [150, 37], [38, 82], [177, 88], [90, 88], [55, 132], [110, 135]],
    lines: [[0, 2], [1, 2], [2, 3], [2, 4], [3, 5], [4, 6], [2, 7], [7, 8], [7, 9]],
  },
  wormzer: {
    stars: [[95, 24], [95, 45], [52, 85], [45, 118], [73, 142], [97, 100], [133, 127], [178, 100], [145, 70], [125, 55]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 6], [6, 7], [7, 8], [8, 9], [9, 1], [1, 5]],
  },
  teratorn: {
    stars: [[97, 26], [78, 30], [85, 82], [178, 38], [160, 90], [110, 80], [75, 128], [125, 110], [142, 142], [170, 125]],
    lines: [[0, 1], [1, 2], [0, 3], [3, 4], [0, 5], [5, 6], [5, 7], [7, 8], [7, 9]],
  },
  zafreeti: {
    stars: [[110, 24], [143, 22], [80, 63], [148, 62], [97, 97], [97, 125], [72, 146], [107, 138], [160, 93], [147, 146]],
    lines: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [4, 5], [5, 7], [2, 6], [3, 8], [8, 9]],
  },
  slimeattikus: {
    stars: [[73, 31], [107, 41], [37, 55], [145, 58], [67, 92], [120, 95], [15, 100], [172, 107], [80, 133], [130, 135]],
    lines: [[0, 1], [0, 2], [1, 3], [2, 6], [3, 7], [4, 5], [6, 8], [8, 9], [9, 7]],
  },
};

/** A path through 10 places: the figure for a constellation the game has no drawing for. */
const pathFigure = (stars: readonly StarPoint[]): StarFigure => ({
  stars,
  lines: stars.slice(1).map((_, i) => [i, i + 1] as const),
});

/** Placeholder figures, one per slot, for a constellation with no drawing. */
const PLACEHOLDERS: readonly StarFigure[] = [
  pathFigure([[30, 120], [55, 95], [80, 105], [100, 75], [125, 60], [150, 70], [170, 45], [140, 100], [115, 125], [85, 140]]),
  pathFigure([[25, 60], [50, 45], [80, 55], [100, 85], [95, 120], [125, 130], [150, 110], [170, 80], [155, 50], [120, 35]]),
  pathFigure([[40, 40], [65, 65], [60, 100], [85, 125], [115, 115], [140, 130], [165, 105], [150, 75], [120, 70], [100, 40]]),
  pathFigure([[30, 90], [55, 70], [85, 80], [110, 55], [140, 45], [165, 65], [150, 95], [125, 110], [95, 130], [65, 125]]),
];

const inBox = (point: unknown): point is StarPoint =>
  Array.isArray(point) &&
  point.length === 2 &&
  typeof point[0] === "number" &&
  typeof point[1] === "number" &&
  point[0] >= 0 &&
  point[0] <= FIGURE_WIDTH &&
  point[1] >= 0 &&
  point[1] <= FIGURE_HEIGHT;

const isLine = (line: unknown): line is readonly [number, number] =>
  Array.isArray(line) &&
  line.length === 2 &&
  line.every((n) => Number.isInteger(n) && n >= 0 && n < FIGURE_STARS) &&
  line[0] !== line[1];

/** Whether a value from the server is a figure the tab can draw. */
export const isStarFigure = (raw: unknown): raw is StarFigure => {
  if (typeof raw !== "object" || raw === null) return false;
  const { stars, lines } = raw as { stars?: unknown; lines?: unknown };
  return Array.isArray(stars) && stars.length === FIGURE_STARS && stars.every(inBox) && Array.isArray(lines) && lines.every(isLine);
};

/** The figure to draw: the owner's saved one, else the built-in one, else a placeholder for the slot. */
export const figureFor = (id: string, slot: number, saved?: Readonly<Record<string, unknown>> | null): StarFigure => {
  const mine = saved?.[id];
  if (isStarFigure(mine)) return mine;
  return BUILT_IN_FIGURES[id] ?? PLACEHOLDERS[slot % PLACEHOLDERS.length]!;
};
