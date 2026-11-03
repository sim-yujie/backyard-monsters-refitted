import type { Quality } from "@/game/quality";

/**
 * How alive Map Room 2 is (owner, 3 Nov 2026: "make the map live/animated like
 * in Civ").
 *
 * - Classic looks exactly as Flash did, and Flash's map stood still: `off`.
 * - Quality Low is for slow internet and slow PCs: `off`, and none of the
 *   living map's art is downloaded.
 * - Quality Medium: `reduced`, the water and the yards' smoke at half the
 *   animation rate, from the smaller copies of the art, and no clouds or birds.
 * - Quality High: `full`.
 */
export type LiveLevel = "off" | "reduced" | "full";

export const liveLevelFor = (classic: boolean, quality: Quality): LiveLevel => {
  if (classic || quality === "low") return "off";
  return quality === "medium" ? "reduced" : "full";
};

/** What a level draws, and how often the animation steps. */
export interface LivePlan {
  readonly level: LiveLevel;
  /** Glints moving on the water. */
  readonly water: boolean;
  /** Foam washing along the shores. */
  readonly foam: boolean;
  /** Smoke over yards, outposts and tribe camps. */
  readonly smoke: boolean;
  /** Cloud shadows drifting over the near map, and clouds over the far map. */
  readonly clouds: boolean;
  /** Now and then a few gulls fly across. */
  readonly birds: boolean;
  /**
   * Seconds between animation steps. The map is redrawn every frame anyway
   * (Pixi's ticker), so this only paces the water sheet's redraw and the
   * smoke's moves: 30 steps a second on High, 15 on Medium.
   */
  readonly stepSeconds: number;
  /** Pixels per world point in the water sheet: sharper glints on High. */
  readonly waterResolution: number;
  /** Which copy of the art to download: the `@2x` on High, the half-size on Medium. */
  readonly artSuffix: "@2x" | "";
}

const PLANS: Record<LiveLevel, LivePlan> = {
  off: {
    level: "off",
    water: false,
    foam: false,
    smoke: false,
    clouds: false,
    birds: false,
    stepSeconds: Number.POSITIVE_INFINITY,
    waterResolution: 1,
    artSuffix: "",
  },
  reduced: {
    level: "reduced",
    water: true,
    foam: true,
    smoke: true,
    clouds: false,
    birds: false,
    stepSeconds: 1 / 15,
    waterResolution: 1,
    artSuffix: "",
  },
  full: {
    level: "full",
    water: true,
    foam: true,
    smoke: true,
    clouds: true,
    birds: true,
    stepSeconds: 1 / 30,
    waterResolution: 1.5,
    artSuffix: "@2x",
  },
};

export const planFor = (level: LiveLevel): LivePlan => PLANS[level];
