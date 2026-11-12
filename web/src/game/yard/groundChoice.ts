import { classicLook } from "@/game/classicLook";
import { quality as downloadQuality, type Quality } from "@/game/quality";

/**
 * The yard ground the player picks (owner, 12 Nov 2026: "improved background
 * for the yard... several options so my players can choose"), in Settings,
 * Look and sound.
 *
 * ## One list per look
 *
 * Classic is Flash's art, and Flash already had this: subscribers picked the
 * yard's tiles from four swatches, grass, rock, sand and crater
 * (`ExtraTilesReward.as`, `SubscriptionControlPanelPopup.as:58-80`,
 * `MAP.swapIntBG`). So Classic offers exactly those four, drawn from Flash's
 * own tiles (`server/public/assets/yardbg/`), Flash grass first. Modern offers
 * the new painted grounds (Codex, `design/yard-bg` on feat/yard-backgrounds),
 * Meadow first, with Flash's grass kept as "Original". Each look remembers
 * its own pick, so switching the Style never shows a ground from the other
 * look.
 *
 * ## Where it shows
 *
 * Every surface yard this player looks at: their own yard and planner, their
 * outposts, and the yards they visit or attack. It is the viewer's ground, not
 * the yard owner's (Flash's swap only ever changed what the subscriber saw).
 * An Inferno yard keeps its lava. During an event the grass grounds (Original,
 * Meadow) take the event's dress, as Flash's grass always did; a player who
 * picked another ground keeps it.
 *
 * Kept in this browser, like the Style and the Quality.
 */

export type GroundId = "original" | "meadow" | "autumn" | "desert" | "snow" | "swamp" | "rock" | "sand" | "crater";

/** One ground's art: the images blended into one block, as `MAPBG.MakeTile` blends Flash's. */
export interface GroundSpec {
  readonly id: GroundId;
  /** Its name under the swatch and in the tooltip. */
  readonly name: string;
  /** Folder under the game server's `/assets/`. */
  readonly root: string;
  /** The images, in blend order: the first is laid solid, each later one over it through noise. */
  readonly files: readonly string[];
  /** One image, in world pixels. */
  readonly tile: readonly [width: number, height: number];
  /** Images across and down one block; the block is what repeats. */
  readonly repeat: readonly [columns: number, rows: number];
  /**
   * Painted at 2x with `@1.5x` and 1x copies, picked by the Quality setting
   * (`quality.ts`); Flash's tiles are 1x only.
   */
  readonly painted: boolean;
  /**
   * Per later image, a `[low, high]` ramp on its noise mask: patches with soft
   * edges instead of an even blend (fallen leaves in drifts, mud in pools).
   * Absent or null: the soft blend Flash used.
   */
  readonly ramps?: readonly (readonly [number, number] | null)[];
  /** The flat colour under the tiles, shown until they arrive. */
  readonly fill: number;
  /** Ground light enough that the white range ring would vanish: the ring is drawn in this instead. */
  readonly rangeInk?: number;
  /** The grass grounds, which an event re-dresses. */
  readonly grass?: boolean;
}

/** The seven Flash grass images in `MAPBG` order (g1 is isograss1, and so on). */
export const FLASH_GRASS_FILES = [
  "2174_isograss1_isograss1.png",
  "2175_isograss2_isograss2.png",
  "2172_isograss3_isograss3.png",
  "2173_isograss4_isograss4.png",
  "2177_isograss5_isograss5.png",
  "2178_isograss6_isograss6.png",
  "2176_isograss7_isograss7.png",
] as const;

const FLASH = { tile: [200, 100], repeat: [5, 5], painted: false } as const;
const PAINTED = { tile: [400, 200], repeat: [2, 2], painted: true } as const;
const LAYERS = ["layer1", "layer2", "layer3", "layer4"] as const;

export const GROUNDS: Readonly<Record<GroundId, GroundSpec>> = {
  original: {
    id: "original",
    name: "Original",
    root: "/assets/yardbg/grass/",
    files: FLASH_GRASS_FILES,
    ...FLASH,
    fill: 0x4a7a3a,
    grass: true,
  },
  // Flash's other three (`MAPBG.as:39-75`). Rock is Flash's three rock images
  // with its first two grass images over them, as MAPBG does.
  rock: {
    id: "rock",
    name: "Rocky",
    root: "/assets/yardbg/",
    files: [
      "rock/2180_isorock1_isorock1.png",
      "rock/2182_isorock2_isorock2.png",
      "rock/2181_isorock3_isorock3.png",
      "grass/2174_isograss1_isograss1.png",
      "grass/2175_isograss2_isograss2.png",
    ],
    ...FLASH,
    fill: 0x56703c,
  },
  sand: {
    id: "sand",
    name: "Sand",
    root: "/assets/yardbg/sand/",
    files: [
      "2167_isosand1_isosand1.png",
      "2168_isosand2_isosand2.png",
      "2164_isosand3_isosand3.png",
      "2166_isosand4_isosand4.png",
    ],
    ...FLASH,
    fill: 0xc19a68,
  },
  crater: {
    id: "crater",
    name: "Crater",
    root: "/assets/yardbg/crater/",
    files: ["2179_isocrater1_isocrater1.png"],
    ...FLASH,
    fill: 0x56645e,
  },
  meadow: {
    id: "meadow",
    name: "Meadow",
    root: "/assets/yardbg/meadow/",
    files: LAYERS,
    ...PAINTED,
    fill: 0x557f22,
    grass: true,
  },
  autumn: {
    id: "autumn",
    name: "Autumn",
    root: "/assets/yardbg/autumn/",
    files: LAYERS,
    ...PAINTED,
    ramps: [null, [0.42, 0.62], [0.5, 0.7]],
    fill: 0x6e5422,
  },
  desert: {
    id: "desert",
    name: "Desert",
    root: "/assets/yardbg/desert/",
    files: LAYERS,
    ...PAINTED,
    fill: 0xb08c64,
  },
  snow: {
    id: "snow",
    name: "Snow",
    root: "/assets/yardbg/snow/",
    files: LAYERS,
    ...PAINTED,
    fill: 0xa9b6c6,
    rangeInk: 0x173250,
  },
  swamp: {
    id: "swamp",
    name: "Swamp",
    root: "/assets/yardbg/swamp/",
    files: LAYERS,
    ...PAINTED,
    ramps: [[0.35, 0.6], null, [0.45, 0.65]],
    fill: 0x3a3a1c,
  },
};

/** The swatches each look offers, its default first. */
export const MODERN_GROUNDS: readonly GroundId[] = ["meadow", "original", "autumn", "desert", "snow", "swamp"];
export const CLASSIC_GROUNDS: readonly GroundId[] = ["original", "rock", "sand", "crater"];

/** Where this browser keeps each look's pick. */
export const GROUND_KEY = "bymr.ground";
export const CLASSIC_GROUND_KEY = "bymr.ground.classic";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The grounds a look offers. */
export const groundsFor = (classic: boolean): readonly GroundId[] => (classic ? CLASSIC_GROUNDS : MODERN_GROUNDS);

const keyFor = (classic: boolean): string => (classic ? CLASSIC_GROUND_KEY : GROUND_KEY);

/** A look's saved pick; its default when nothing, or something it does not offer, is saved. */
export const savedGround = (classic: boolean, store: Storage | null = storage()): GroundId => {
  const offered = groundsFor(classic);
  const fallback = offered[0] ?? "original";
  try {
    const value = store?.getItem(keyFor(classic));
    return offered.find((id) => id === value) ?? fallback;
  } catch {
    return fallback;
  }
};

/** Saves a look's pick. True if it was saved; a ground the look does not offer is refused. */
export const saveGround = (classic: boolean, id: GroundId, store: Storage | null = storage()): boolean => {
  if (!groundsFor(classic).includes(id)) return false;
  try {
    if (id === groundsFor(classic)[0]) store?.removeItem(keyFor(classic));
    else store?.setItem(keyFor(classic), id);
    return store !== null;
  } catch {
    return false;
  }
};

type Listener = (id: GroundId) => void;
const listeners = new Set<Listener>();
let current: GroundId | null = null;

/** The ground this page shows: the pick of the look in use. */
export const currentGround = (): GroundId => (current ??= savedGround(classicLook()));

/**
 * Picks a ground for the look in use: saves it and re-dresses any yard on
 * screen at once. True if it was saved (the yard changes either way).
 */
export const pickGround = (id: GroundId, store: Storage | null = storage()): boolean => {
  const saved = saveGround(classicLook(), id, store);
  if (!groundsFor(classicLook()).includes(id)) return false;
  if (id !== currentGround()) {
    current = id;
    for (const listener of listeners) listener(id);
  }
  return saved;
};

/** Calls `listener` whenever the ground changes. Returns the unsubscribe. */
export const onGroundChange = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Forgets the page's ground so the next read takes the saved one again; for tests. */
export const resetGroundForTests = (): void => {
  current = null;
};

/** The file suffix and its pixels per world pixel, by Quality, for a painted ground. */
export const paintedCopy = (level: Quality = downloadQuality()): { suffix: string; scale: number } =>
  level === "high" ? { suffix: "@2x", scale: 2 } : level === "medium" ? { suffix: "@1.5x", scale: 1.5 } : { suffix: "", scale: 1 };

/** The URLs of a ground's images and the scale they are painted at. */
export const groundUrls = (spec: GroundSpec, level: Quality = downloadQuality()): { urls: string[]; scale: number } => {
  if (!spec.painted) return { urls: spec.files.map((file) => spec.root + file), scale: 1 };
  const { suffix, scale } = paintedCopy(level);
  return { urls: spec.files.map((file) => `${spec.root}${file}${suffix}.webp`), scale };
};

/** The swatch picture of a ground, served with the UI (`public/ui/grounds/`). */
export const groundSwatchUrl = (id: GroundId): string => `${import.meta.env.BASE_URL}ui/grounds/${id}.webp`;
