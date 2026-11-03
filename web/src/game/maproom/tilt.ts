import type { Point } from "@/game/HexGrid";

/**
 * The tilted camera for Modern Map Room 2 (owner, 3 Nov 2026: "like Civ V",
 * the same tilt at every zoom). A prototype behind the MR2_TILT switch.
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

/** Where this browser remembers the switch, for testing: "light", "medium" or "strong". */
export const MR2_TILT_KEY = "bymr.mr2Tilt";

const isStrength = (value: unknown): value is TiltStrength =>
  typeof value === "string" && (TILT_STRENGTHS as readonly string[]).includes(value);

/**
 * Reads the MR2_TILT switch: `?mr2tilt=` on the page address, then this
 * browser's `bymr.mr2Tilt`, then the build's `VITE_MR2_TILT`. Off unless one
 * of them names a strength. The scene also turns it off in Classic.
 */
export const readMr2Tilt = (
  search: string = typeof location === "object" ? location.search : "",
  store: Pick<Storage, "getItem"> | null = safeStorage(),
  build: string | undefined = import.meta.env.VITE_MR2_TILT,
): TiltStrength => {
  const asked = new URLSearchParams(search).get("mr2tilt");
  if (isStrength(asked)) return asked;
  let kept: string | null = null;
  try {
    kept = store?.getItem(MR2_TILT_KEY) ?? null;
  } catch {
    kept = null;
  }
  if (isStrength(kept)) return kept;
  return isStrength(build) ? build : "off";
};

const safeStorage = (): Storage | null => {
  try {
    return typeof window === "object" ? window.localStorage : null;
  } catch {
    return null;
  }
};
