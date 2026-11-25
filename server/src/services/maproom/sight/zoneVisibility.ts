import { MAP_HEIGHT, MAP_WIDTH, type HexShape } from "../../../game-rules/maproom/range.js";
import { isVisible, type RevealedCell, type SightSource } from "../../../game-rules/maproom/sight.js";

/**
 * Which cells of one `getarea` zone a sight shows (Map Room 2 fog of war,
 * `docs/design/fog-of-war.md` §5.1), asking the shared rule (`isVisible`)
 * about only the circles and always-visible cells that can touch the zone.
 *
 * Testing every cell against the whole sight cost up to ~13 ms of blocking
 * CPU per zone for a big empire in a big alliance (1,612 circles and 1,612
 * always-visible cells, map-lag diagnosis, 25 Nov 2026), most of it on zones
 * nothing reaches. One pass over the sight first keeps only what can reach
 * the zone; the shared rule then decides each cell exactly as before, so the
 * answer is the same (`zoneVisibility.test.ts` compares the two for an
 * owner-size sight, both hex shapes: in CI on every cell of the sight's area,
 * both seams and sampled zones; with `SIGHT_FULL_WORLD=1` on every cell of
 * the world).
 *
 * Why the narrowing never drops a circle that reaches: one hex step moves at
 * most one column and one row, so a cell within `reach` steps of a circle's
 * centre (on any of the nine world copies `hexDistance` measures across) is
 * within `reach` columns and rows of it, and so within `reach` of it around
 * the world's wrap. The margin covers a centre off the whole-number grid,
 * where a step's row or column can be off by up to half a cell.
 */

/** Extra columns and rows a circle is kept for beyond its reach (see above). */
const MARGIN = 2;

/**
 * How far `p` is from the nearest of the `span + 1` whole positions
 * `start..start+span`, around a world `size` wide. 0 when it is one of them.
 * NaN when `p` is not a number (then every `<=` test fails, as `isVisible`'s
 * own comparisons do).
 */
const distanceAround = (p: number, start: number, span: number, size: number): number => {
  const ahead = (((p - start) % size) + size) % size;
  if (ahead <= span) return 0;
  return Math.min(ahead - span, size - ahead);
};

/**
 * The circles and always-visible cells of a sight that can touch the cells
 * `x..x+width`, `y..y+height` (wrapped onto the world, as `getarea` tests
 * them). A superset: the caller still asks `isVisible` about each cell.
 */
export const sightNear = <S extends SightSource, R extends RevealedCell>(
  sources: readonly S[],
  revealed: readonly R[],
  x: number,
  y: number,
  width: number,
  height: number,
): { sources: S[]; revealed: R[] } => {
  const near = (cell: { x: number; y: number }, reach: number): boolean =>
    distanceAround(cell.x, x, width, MAP_WIDTH) <= reach && distanceAround(cell.y, y, height, MAP_HEIGHT) <= reach;

  return {
    // `inReach` lights nothing for a reach that is not above 0.
    sources: sources.filter((source) => source.reach > 0 && near(source, Number(source.reach) + MARGIN)),
    // A revealed cell lights only its own exact coordinates.
    revealed: revealed.filter((cell) => near(cell, 0)),
  };
};

/** `x,y` as a key of {@link zoneVisibility}'s answer. */
export const zoneCellKey = (x: number, y: number): string => `${x},${y}`;

/**
 * Each cell of a `getarea` zone (`x..x+width`, `y..y+height`, unwrapped, the
 * same keys `getarea` reads) mapped to whether the sight shows it: the
 * cell's wrapped coordinates against the shared rule, as `getarea` always
 * asked it, over only the part of the sight that can reach the zone.
 */
export const zoneVisibility = (
  sight: { sources: readonly SightSource[]; revealed: readonly RevealedCell[] },
  x: number,
  y: number,
  width: number,
  height: number,
  shape: HexShape,
): Map<string, boolean> => {
  const near = sightNear(sight.sources, sight.revealed, x, y, width, height);
  const visibility = new Map<string, boolean>();
  for (let cellX = x; cellX <= x + width; cellX++) {
    for (let cellY = y; cellY <= y + height; cellY++) {
      const wrapped = { x: wrap(cellX, MAP_WIDTH), y: wrap(cellY, MAP_HEIGHT) };
      visibility.set(zoneCellKey(cellX, cellY), isVisible(wrapped, near.sources, near.revealed, shape));
    }
  }
  return visibility;
};

/** A zone coordinate onto the world's `0..size-1` (a zone can run past the edge). */
const wrap = (n: number, size: number): number => ((n % size) + size) % size;
