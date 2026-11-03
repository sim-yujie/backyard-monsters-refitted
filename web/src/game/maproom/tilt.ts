import type { Point } from "@/game/HexGrid";
import type { Quality } from "@/game/quality";

/**
 * The tilted camera for Modern Map Room 2 (owner, 3 Nov 2026: "like Civ V",
 * the same tilt at every zoom). On by default in Modern at the medium strength
 * when the server's MR2_TILT switch allows it; each player can switch their
 * map flat (an account setting, `tiltSetting.ts`). Classic is always flat.
 *
 * The map is still drawn flat, exactly as without the tilt, into a texture
 * (`TiltView.ts`); that picture is then laid on the ground plane and seen
 * through a pinhole camera pitched `pitchDeg` away from straight down, so land
 * at the top of the screen is further away and smaller.
 *
 * Three spaces, and this file only ever converts between the first two:
 *
 * - **screen**: CSS pixels on the canvas, top-left origin; what the player sees.
 * - **flat**: the screen the map would have without the tilt, same size, same
 *   origin. `Camera` lives entirely here, so its pan, zoom-about-cursor and
 *   drag-pinning work unchanged once pointer positions are run through
 *   {@link Tilt.toFlat} first (`Camera.setPointerMap`).
 * - **world**: map pixels, from flat via `Camera.screenToWorld`; then the hex
 *   rule (`ground.ts` `pickCell`, today flat-top) turns a world point into a
 *   cell. Keeping the tilt out of that last step means a different hex layout
 *   (pointy-top) only replaces the last step.
 *
 * The camera model: the ground point under the middle of the screen stays
 * there, at the same horizontal scale as the flat map. With `c = cos(pitch)`
 * and `k = tan(pitch) / f`, where `f` is the focal length in pixels for the
 * vertical field of view, and X, Y the flat offsets from the screen middle:
 *
 *     screen = middle + (X, c·Y) / (1 − k·c·Y)
 *     flat   = middle + (u, v / c) / (1 + k·v)      (u, v: screen offsets)
 *
 * Both are one projective map (a homography), so the four corners of the flat
 * picture fix it completely, which is what `PerspectiveMesh` is given.
 */

export type TiltStrength = "off" | "light" | "medium" | "strong";

export const TILT_STRENGTHS: readonly TiltStrength[] = ["off", "light", "medium", "strong"];

/**
 * Degrees away from looking straight down. Strong is the Civ V-like 45°.
 * The field of view sets how much smaller the far edge is: at 36° vertical a
 * cell at the top of the screen is about half the width of one at the bottom
 * when strong, two thirds when medium, four fifths when light.
 */
export const TILT_PITCH_DEG: Record<Exclude<TiltStrength, "off">, number> = {
  light: 20,
  medium: 32,
  strong: 45,
};

export const TILT_FOV_DEG = 36;

export interface FlatRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class Tilt {
  private readonly c: number;
  private readonly k: number;
  private readonly cx: number;
  private readonly cy: number;

  constructor(
    readonly pitchDeg: number,
    readonly width: number,
    readonly height: number,
    readonly fovDeg: number = TILT_FOV_DEG,
  ) {
    const pitch = (pitchDeg * Math.PI) / 180;
    const focal = height / 2 / Math.tan((fovDeg * Math.PI) / 360);
    this.c = Math.cos(pitch);
    this.k = Math.tan(pitch) / focal;
    this.cx = width / 2;
    this.cy = height / 2;
  }

  /** Where a flat-screen point is seen on the real screen. */
  toScreen(flat: Point): Point {
    const x = flat.x - this.cx;
    const y = flat.y - this.cy;
    const d = 1 - this.k * this.c * y;
    return { x: this.cx + x / d, y: this.cy + (this.c * y) / d };
  }

  /** The flat-screen point seen at a real screen point (undoes the tilt). */
  toFlat(screen: Point): Point {
    const u = screen.x - this.cx;
    const v = screen.y - this.cy;
    const e = 1 + this.k * v;
    return { x: this.cx + u / e, y: this.cy + v / (this.c * e) };
  }

  /**
   * The flat rectangle the whole real screen shows: wider than the screen at
   * the top (far away), narrower at the bottom; this is its bounding box, the
   * area to draw and to fetch zones for.
   */
  flatBounds(): FlatRect {
    const topLeft = this.toFlat({ x: 0, y: 0 });
    const topRight = this.toFlat({ x: this.width, y: 0 });
    const bottom = this.toFlat({ x: 0, y: this.height });
    return { left: topLeft.x, right: topRight.x, top: topLeft.y, bottom: bottom.y };
  }

  /** How many screen pixels one flat pixel covers at a screen height, horizontally. */
  scaleAt(screenY: number): number {
    return 1 + this.k * (screenY - this.cy);
  }
}

/** Builds the tilt for a strength, or null for "off" (the flat map). */
export const tiltFor = (strength: TiltStrength, width: number, height: number): Tilt | null =>
  strength === "off" ? null : new Tilt(TILT_PITCH_DEG[strength], width, height);

/**
 * The owner's pick (3 Nov 2026): medium, camera 32° from straight down, far
 * cells about two thirds the width of near ones. What "tilted" means for a
 * player; the other strengths stay for samples and tests.
 */
export const DEFAULT_TILT: Exclude<TiltStrength, "off"> = "medium";

/** Where this browser keeps a strength for testing: "off", "light", "medium" or "strong". */
export const MR2_TILT_KEY = "bymr.mr2Tilt";

const isStrength = (value: unknown): value is TiltStrength =>
  typeof value === "string" && (TILT_STRENGTHS as readonly string[]).includes(value);

/**
 * A strength forced for testing and samples, over the account's choice:
 * `?mr2tilt=` on the page address, then this browser's `bymr.mr2Tilt`, then
 * the build's `VITE_MR2_TILT`. Null when none of them names a strength.
 */
export const readTiltOverride = (
  search: string = typeof location === "object" ? location.search : "",
  store: Pick<Storage, "getItem"> | null = safeStorage(),
  build: string | undefined = import.meta.env.VITE_MR2_TILT,
): TiltStrength | null => {
  const asked = new URLSearchParams(search).get("mr2tilt");
  if (isStrength(asked)) return asked;
  let kept: string | null = null;
  try {
    kept = store?.getItem(MR2_TILT_KEY) ?? null;
  } catch {
    kept = null;
  }
  if (isStrength(kept)) return kept;
  return isStrength(build) ? build : null;
};

/** The account's side of the switch (`tiltSetting.ts`). */
export interface TiltChoice {
  /** The server's MR2_TILT switch lets the map tilt at all. */
  readonly allowed: boolean;
  /** The player's own choice: tilted unless they switched the map flat. */
  readonly tilted: boolean;
}

/**
 * The strength the map opens at (MR2 look plan step 4, owner 3 Nov 2026:
 * opt-out). Classic is always flat, whatever else says; then a testing
 * override; then the server must allow it and the player must not have
 * switched it off, which gives the medium tilt.
 */
export const decideTilt = (options: {
  classic: boolean;
  override: TiltStrength | null;
  choice: TiltChoice;
}): TiltStrength => {
  if (options.classic) return "off";
  if (options.override) return options.override;
  return options.choice.allowed && options.choice.tilted ? DEFAULT_TILT : "off";
};

/**
 * The furthest the tilted map may zoom out: the whole flat area the tilted
 * screen shows (wider than the screen at the top) must still fit inside the
 * world, so the top of the screen and its corners never show empty space
 * beyond the map. Never below the flat map's own floor.
 */
export const tiltMinZoom = (tilt: Tilt, world: { width: number; height: number }, floor: number): number => {
  const seen = tilt.flatBounds();
  return Math.max(floor, (seen.right - seen.left) / world.width, (seen.bottom - seen.top) / world.height);
};

/** Quality Low draws the tilted picture at half resolution (owner, question 2); High and Medium in full. */
export const tiltTextureResolution = (base: number, level: Quality): number => (level === "low" ? base / 2 : base);

/**
 * The four corners of the tilted screen on the map, clockwise from top-left:
 * the minimap's view box, a trapezoid wider at the top. `flatToWorld` is the
 * camera's `screenToWorld`.
 */
export const tiltViewQuad = (tilt: Tilt, flatToWorld: (flat: Point) => Point): Point[] =>
  [
    { x: 0, y: 0 },
    { x: tilt.width, y: 0 },
    { x: tilt.width, y: tilt.height },
    { x: 0, y: tilt.height },
  ].map((corner) => flatToWorld(tilt.toFlat(corner)));

const safeStorage = (): Storage | null => {
  try {
    return typeof window === "object" ? window.localStorage : null;
  } catch {
    return null;
  }
};
