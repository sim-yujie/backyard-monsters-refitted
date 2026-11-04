/**
 * Hills and cliffs on the painted ground (Map Room 2 Modern look, plan step 5): the numbers the
 * shader (`hillsShader.ts`) uses, and the TypeScript twin of its height field for the tests.
 */

/** The radius (regular-hex units, corner radius 1) of each cell's bump in the smooth height field. */
export const HILL_RADIUS = 2;

/**
 * How steep a slope looks in the light: hex units of rise per height unit. The server's heights
 * change by about 9 between neighbours (median) and 22 in the steepest tenth. The smooth field
 * averages them over about three cells, so its slopes are gentler than that; at 0.045 (step 5) the
 * hills barely showed (step 10's scorecard: 30%). MR2 step 11: over four times that, so an
 * ordinary slope shades by 15-30% like mock-up B's rolling hills, and the steep ones reach the
 * clamps below.
 */
export const HILL_LIGHT = 0.2;

/** The light's range on the slopes: the far side of a steep hill and the side facing the sun. */
export const HILL_DARKEST = 0.66;
export const HILL_BRIGHTEST = 1.35;

/**
 * A cliff stands between two land neighbours this many height units apart (the server's heights
 * run 100..192 on land). At 26 (step 5) about one neighbour pair in forty was this steep and cliffs
 * were rare (step 10's scorecard: 30%). MR2 step 11 lowers it so long cliffs show, often several
 * pairs in a row, which the shader joins into one rock face like mock-up B's; at 19 short single
 * faces scattered over the meadows like scars.
 */
export const CLIFF_DROP = 22;

/**
 * A full face's depth down the screen, in hex units (corner radius 1), for the tallest strip: step 5
 * drew 1.5 but the faces were cut off near the low cell's middle; step 11 finds them below that too
 * on High (`hillsShader.ts` `cliffAbove`, `joinCliffs`) and paints them taller, about a cell high
 * as in mock-up B.
 */
export const CLIFF_FACE = 2.2;

/** Where the cliff sheet (`cliffs@4x.webp`, `web/tools/mr2-paint/build.py`) keeps its strips. */
export interface CliffStrip {
  /** The strip's top row and height, as shares of the sheet's height. */
  readonly top: number;
  readonly height: number;
  /** Its face depth against the tallest strip's (its painted height over the tallest's). */
  readonly depth: number;
}

/** The sheet is 1024 x 1024 at High; the strips sit in its top half, the pieces in the bottom half. */
const SHEET = 1024;
export const CLIFF_STRIP_PIXELS: readonly { top: number; height: number }[] = [
  { top: 8, height: 214 },
  { top: 238, height: 107 },
  { top: 361, height: 122 },
];
export const CLIFF_PIECES_TOP = 512;

export const CLIFF_STRIPS: readonly CliffStrip[] = CLIFF_STRIP_PIXELS.map(({ top, height }) => ({
  top: top / SHEET,
  height: height / SHEET,
  depth: height / CLIFF_STRIP_PIXELS[0]!.height,
}));

/** One cell for {@link heightField}: its centre in regular-hex units and its height. */
export interface HillCell {
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

/**
 * The smooth height field at (x, y) and its slope, from the cells round it (the shader passes the
 * point's own cell and its six neighbours). Water counts as the shore's height (98).
 */
export const heightField = (cells: readonly HillCell[], x: number, y: number): { height: number; dx: number; dy: number } => {
  const r2max = HILL_RADIUS * HILL_RADIUS;
  let sw = 0;
  let sh = 0;
  let sgx = 0;
  let sgy = 0;
  let sghx = 0;
  let sghy = 0;
  for (const cell of cells) {
    const dx = x - cell.x;
    const dy = y - cell.y;
    const r2 = (dx * dx + dy * dy) / r2max;
    if (r2 >= 1) continue;
    const height = Math.max(cell.height, 98);
    const u = 1 - r2;
    const w = u * u * u;
    const g = (-6 / r2max) * u * u;
    sw += w;
    sh += w * height;
    sgx += g * dx;
    sgy += g * dy;
    sghx += g * dx * height;
    sghy += g * dy * height;
  }
  if (sw < 1e-4) return { height: 100, dx: 0, dy: 0 };
  const height = sh / sw;
  return { height, dx: (sghx - height * sgx) / sw, dy: (sghy - height * sgy) / sw };
};

/** Whether two land neighbours have a cliff between them. */
export const isCliff = (a: number, b: number): boolean => a > 99 && b > 99 && Math.abs(a - b) >= CLIFF_DROP;
