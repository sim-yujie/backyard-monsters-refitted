/**
 * A tileable noise field, used as the alpha mask that blends one ground
 * texture into another.
 *
 * The Flash client builds its ground from seven grass images by drawing the
 * first one and then compositing the other six over it through
 * `BitmapData.perlinNoise(50 * n, 25 * n, 2, seed + n, true, false, ALPHA,
 * true)` — six soft, seeded, tiling masks at progressively coarser feature
 * sizes (`client/scripts/MAPBG.as:100-105`).
 *
 * `perlinNoise` is a specific Flash implementation whose output cannot be
 * reproduced from the ActionScript, so this is value noise with the same
 * parameters: the same feature size, the same two octaves, the same seeding,
 * and the same wrapping so the 1000 x 500 block still tiles seamlessly. The
 * result is a different field of the same character, which is what the blend
 * needs — the alternative, picking one texture outright per 200 x 100 cell,
 * gives a hard checkerboard that reads as a bug.
 */

/** A small deterministic generator. Same shape as the one in YardGround. */
const seeded = (seed: number): (() => number) => {
  let state = (Math.trunc(seed) || 1) >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

/** Smoothstep, so lattice cells meet with no visible crease. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/** One octave: a wrapping lattice of random values, smoothly interpolated. */
const octave = (
  width: number,
  height: number,
  cellWidth: number,
  cellHeight: number,
  seed: number,
): ((x: number, y: number) => number) => {
  // At least two cells on each axis, or the interpolation has nothing to do.
  const columns = Math.max(2, Math.round(width / cellWidth));
  const rows = Math.max(2, Math.round(height / cellHeight));

  const random = seeded(seed);
  const lattice = new Float32Array(columns * rows);
  for (let i = 0; i < lattice.length; i++) lattice[i] = random();

  const at = (column: number, row: number): number =>
    // Wrapping the indices is what makes the block tile.
    lattice[(((row % rows) + rows) % rows) * columns + (((column % columns) + columns) % columns)] ??
    0;

  return (x: number, y: number): number => {
    const fx = (x / width) * columns;
    const fy = (y / height) * rows;
    const column = Math.floor(fx);
    const row = Math.floor(fy);
    const tx = ease(fx - column);
    const ty = ease(fy - row);

    const top = at(column, row) * (1 - tx) + at(column + 1, row) * tx;
    const bottom = at(column, row + 1) * (1 - tx) + at(column + 1, row + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
};

/**
 * An alpha-only mask of `width` x `height`, opaque where the overlaying
 * texture should show through.
 *
 * `cellWidth` and `cellHeight` are the feature size, matching `perlinNoise`'s
 * first two arguments. Two octaves, the second at half the size and half the
 * weight, as `perlinNoise(..., 2, ...)` does.
 */
export const noiseMask = (
  width: number,
  height: number,
  cellWidth: number,
  cellHeight: number,
  seed: number,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return canvas;

  const coarse = octave(width, height, cellWidth, cellHeight, seed);
  const fine = octave(width, height, cellWidth / 2, cellHeight / 2, seed * 7 + 13);

  const image = context.createImageData(width, height);
  const pixels = image.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = coarse(x, y) * (2 / 3) + fine(x, y) * (1 / 3);
      const offset = (y * width + x) * 4;
      // The colour channels are never read; only alpha carries the mask.
      pixels[offset + 3] = Math.round(Math.min(Math.max(value, 0), 1) * 255);
    }
  }

  context.putImageData(image, 0, 0);
  return canvas;
};
