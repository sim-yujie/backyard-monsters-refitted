/**
 * Where a 3D tower's turret points in each cell of its strip, and where its
 * muzzle is (owner, 28 Oct 2026: "ensure the projectiles shot out are from
 * the nozzle and the angle of fire is correct").
 *
 * The 3D art measures, for every cell, the screen direction its barrel points
 * (base to tip, projected) and the muzzle tip's place from the turret's
 * pivot (`turretAimData.ts`, from `export3d.py`). A tower then shows the cell
 * whose barrel points along the line its shot is drawn on, and the shot
 * leaves from that cell's muzzle. The Laser's head is also rendered tilted
 * down by several steps, a row of headings per tilt: it takes the tilt that
 * points its lens at the spot it burns, from how high the lens is and how far
 * away the spot is on the ground.
 *
 * Pure arithmetic: `towerFx.ts` asks it which cell to show and where shots
 * start.
 */

/** A strip's aim, cell `row * headings + heading`, tilt rows level first. */
export interface TurretAim {
  /** Cells in one row (one tilt). */
  readonly headings: number;
  /** Screen degrees each cell's barrel points, base to tip: 0 right, 90 down. */
  readonly aim: readonly number[];
  /**
   * Game px from the pivot to each cell's muzzle tip on screen, `[dx, dy]`
   * per cell, flattened. Absent until the art measures it: shots then leave
   * from where they always did.
   */
  readonly muzzle?: readonly number[];
  /** Degrees down each row's head is tilted, top row first; absent for a strip of one row. */
  readonly pitch?: readonly number[];
  /**
   * How high the lens stands above the ground with the head level, in game
   * px measured like a distance across the screen (on screen it looks
   * `cos 30` as tall).
   */
  readonly lensHeight?: number;
  /** Game px from the pivot down to the ground under it, on screen. */
  readonly ground?: number;
  /** The 3D camera's height, degrees. */
  readonly elevation?: number;
}

/** The game's own camera: its ground is drawn 2:1, so heights are seen from 30 degrees up. */
const GAME_ELEVATION = 30;
const RADIANS = Math.PI / 180;

/** The gap between two screen angles in degrees, 0 to 180. */
export const angleGap = (a: number, b: number): number => {
  const gap = Math.abs((((a - b) % 360) + 360) % 360);
  return gap > 180 ? 360 - gap : gap;
};

/** How many tilt rows a strip has. */
export const tiltRows = (aim: TurretAim): number =>
  Math.max(1, Math.floor(aim.aim.length / aim.headings));

/**
 * The cell in tilt row `row` whose barrel points nearest `degrees` on screen;
 * the lower cell on a tie.
 */
export const aimCell = (aim: TurretAim, degrees: number, row = 0): number => {
  const first = Math.min(Math.max(0, row), tiltRows(aim) - 1) * aim.headings;
  let best = first;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let cell = first; cell < first + aim.headings; cell += 1) {
    const gap = angleGap(aim.aim[cell] ?? 0, degrees);
    if (gap < bestGap) {
      bestGap = gap;
      best = cell;
    }
  }
  return best;
};

/** The screen degrees a cell's barrel points. */
export const cellAim = (aim: TurretAim, cell: number): number => aim.aim[cell] ?? 0;

/** Game px from the pivot to a cell's muzzle tip, or null when the art has not measured it. */
export const muzzleOffset = (
  aim: TurretAim,
  cell: number,
): readonly [number, number] | null => {
  const muzzle = aim.muzzle;
  if (!muzzle) return null;
  const dx = muzzle[cell * 2];
  const dy = muzzle[cell * 2 + 1];
  return dx === undefined || dy === undefined ? null : [dx, dy];
};

/**
 * Degrees down a lens `lensHeight` up (game px, measured like a distance
 * across the screen) has to look to see a point `height` screen px up, `dx`,
 * `dy` screen px away along the ground. The game's ground is drawn 2:1, as
 * seen from 30 degrees up: a step `dx`, `dy` on screen is `hypot(dx, 2 dy)`
 * long, and a height looks `cos 30` as tall as it is.
 */
export const pitchDown = (
  lensHeight: number,
  height: number,
  dx: number,
  dy: number,
): number => {
  const ground = Math.hypot(dx, dy / Math.sin(GAME_ELEVATION * RADIANS));
  const rise = lensHeight - height / Math.cos(GAME_ELEVATION * RADIANS);
  return Math.atan2(rise, Math.max(ground, 1e-6)) / RADIANS;
};

/**
 * The tilt row whose head looks down nearest the way it must to point at a
 * point `height` screen px up, `dx`, `dy` screen px along the ground from
 * the ground under the pivot; row 0 for a strip of one row.
 */
export const tiltRow = (aim: TurretAim, dx: number, dy: number, height = 0): number => {
  const pitch = aim.pitch;
  if (!pitch || pitch.length < 2 || aim.lensHeight === undefined) return 0;
  const wanted = pitchDown(aim.lensHeight, height, dx, dy);
  let best = 0;
  for (let row = 1; row < Math.min(pitch.length, tiltRows(aim)); row += 1) {
    if (Math.abs((pitch[row] ?? 0) - wanted) < Math.abs((pitch[best] ?? 0) - wanted))
      best = row;
  }
  return best;
};
