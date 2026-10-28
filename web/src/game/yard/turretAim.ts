/**
 * Where a 3D tower's turret points in each cell of its strip, and where its
 * muzzle is (owner, 28 Oct 2026: "ensure the projectiles shot out are from
 * the nozzle and the angle of fire is correct").
 *
 * The 3D art measures, for every cell, the screen direction its barrel points
 * (base to tip, projected) and the muzzle tip's place from the turret's
 * pivot (`turretAimData.ts`, from `export3d.py`). Cell k of a row is the
 * turret turned to ground bearing `360 k / headings` (0 down-right on screen,
 * 45 at the viewer, as the yard's +x and +y). A tower shows the cell nearest
 * the bearing from it to its target on the ground, which the yard knows
 * exactly (a raised barrel's screen angle jumps near "facing the viewer", so
 * picking by it could show a barrel 40 degrees off), and the shot leaves from
 * that cell's muzzle. A barrel or head keeps one tilt and turns only left
 * and right (owner, 28 Oct 2026: "Rather than overcomplicating the cannon
 * barrel, can't we do calculation and modify the projectile direction rather
 * than turning the head up and down"): `towerFx.ts` works out the shot's path
 * from the muzzle to the target, a Cannon shell lobbed in an arc from its
 * raised barrel.
 *
 * Pure arithmetic: `towerFx.ts` asks it which cell to show and where shots
 * start.
 */

/** A strip's aim, one cell per heading. */
export interface TurretAim {
  /** Cells in the strip, one per heading. */
  readonly headings: number;
  /**
   * Screen degrees each cell's barrel points, base to tip: 0 right, 90 down.
   * As the art measured it; the game picks cells by ground bearing.
   */
  readonly aim: readonly number[];
  /**
   * Game px from the pivot to each cell's muzzle tip on screen, `[dx, dy]`
   * per cell, flattened. Absent until the art measures it: shots then leave
   * from where they always did.
   */
  readonly muzzle?: readonly number[];
  /** Degrees down the barrel or head points, the one tilt it was rendered at; negative: raised. */
  readonly tilt?: number;
  /** The 3D camera's height, degrees. */
  readonly elevation?: number;
}

/** The gap between two screen angles in degrees, 0 to 180. */
export const angleGap = (a: number, b: number): number => {
  const gap = Math.abs((((a - b) % 360) + 360) % 360);
  return gap > 180 ? 360 - gap : gap;
};

/** The ground bearing a cell's turret faces, degrees: cell k at `360 k / headings`. */
export const cellBearing = (aim: TurretAim, cell: number): number =>
  ((cell % aim.headings) * 360) / aim.headings;

/**
 * The cell whose turret faces nearest ground bearing `degrees` (0 down-right
 * on screen, 45 at the viewer); the higher heading on a tie.
 */
export const bearingCell = (aim: TurretAim, degrees: number): number => {
  const turned = (((degrees % 360) + 360) % 360) * (aim.headings / 360);
  return Math.round(turned) % aim.headings;
};

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

/** The game's ground is drawn as seen from 30 degrees up: a height looks `cos 30` as tall on screen. */
const SEEN_HEIGHT = Math.cos(Math.PI / 6);

/**
 * How far a shell fired `tilt` degrees down (negative: raised) flies above
 * the straight line from the muzzle to where it lands, screen px: `arc *
 * share * (1 - share)` at `share` of the way along (`arcLift`). `ground` is
 * the game px along the ground from under the muzzle to where it lands (a
 * step `dx`, `dy` on screen is `hypot(dx, 2 dy)` long), `drop` the screen
 * px the muzzle stands above that point. A shell leaving at angle `a` from
 * height `h` and landing `d` away flies `y = h + x tan a - (h + d tan a)
 * x² / d²`, which is `(d tan a + h) s (1 - s)` above the straight line, `s =
 * x / d`: it leaves along the barrel and comes down on its target. 0 for a
 * barrel that is not raised, which fires straight.
 */
export const shellArc = (tilt: number, ground: number, drop: number): number => {
  if (tilt >= 0) return 0;
  return Math.max(0, ground * Math.tan((-tilt * Math.PI) / 180) * SEEN_HEIGHT + drop);
};

/** Screen px a shell with `arc` (`shellArc`) flies above its straight line, `share` (0 to 1) of the way along. */
export const arcLift = (arc: number, share: number): number => {
  const s = Math.min(1, Math.max(0, share));
  return arc * s * (1 - s);
};
