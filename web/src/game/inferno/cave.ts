import type { BaseLoadResponse } from "@/api/types";
import type { InfernoLoadState } from "@/api/inferno";
import { YARD_MARGIN, toIso, yardSize } from "@/game/yard/YardGrid";
import {
  CAVERN_NOTES,
  ENTER_CAVERN_FAIL,
} from "./emergenceText";

/**
 * Moloch's cave on the main yard (`docs/design/inferno.md` §2.2, WP 1.10):
 * where it stands, how big the yard's world must be to hold it, and what a
 * tap on it does. The server decides its level and when it goes up (WP 1.8);
 * this only draws and answers what the load said.
 */

/** The Inferno Cavern's building type (`INFERNOPORTAL.as:17`). */
export const CAVE_TYPE = 127;

/**
 * Its fixed spot, yard units: outside the plot, up and to the left
 * (`INFERNOPORTAL.AddPortal`, `INFERNOPORTAL.as:201`). Flash's "What's New"
 * calls it "a strange structure just outside the boundaries of your base".
 */
export const CAVE_SPOT = { x: -1200, y: -150 } as const;

/** Its footprint, yard units (`INFERNOPORTAL.as:18`). */
export const CAVE_FOOTPRINT = { width: 190, height: 160 } as const;

/** One level per emergence raid (`INFERNO_EMERGENCE_EVENT.as` `_maxLevel`). */
export const CAVE_MAX_LEVEL = 5;

/** The hall the cave answers to (`INFERNO_EMERGENCE_EVENT.TOWN_HALL_LEVEL_REQUIREMENT`). */
export const CAVE_TOWN_HALL = 5;

/**
 * The biggest the cave's art ever gets, world pixels around its isometric
 * origin: level 5's top (`top.5.v2.png`, 363 x 335 at -160,-172) and shadow
 * (`shadow.5.v2.jpg`, 365 x 169 at -169,0), from `buildingArtData.ts`'s
 * type 127 row.
 */
const CAVE_ART_BOX = { left: -169, top: -172 } as const;

/** Grass beyond the cave's art, so the camera can bring it in from the world's edge. */
const CAVE_HEADROOM = 200;

/**
 * The main yard's margin while the cave shows: enough for the cave, which
 * stands far outside a small plot (1000 x 800 reaches 900 px left of centre,
 * the cave 1,219), and never less than {@link YARD_MARGIN}. "Zoom to fit"
 * still frames the plot alone (`yardFitRect`); the cave is a pan away.
 */
export const caveYardMargin = (expansionLevel: number): number => {
  const [width, height] = yardSize(expansionLevel);
  const extentX = (width + height) / 2;
  const extentY = extentX / 2;
  const origin = toIso(CAVE_SPOT.x, CAVE_SPOT.y);
  const needX = -(origin.x + CAVE_ART_BOX.left) - extentX;
  const needY = -(origin.y + CAVE_ART_BOX.top) - extentY;
  return Math.max(YARD_MARGIN, Math.ceil(Math.max(needX, needY) + CAVE_HEADROOM));
};

/** The load's Inferno state when the cave shows on this yard, else null. */
export const caveState = (save: Pick<BaseLoadResponse, "infernostate">): InfernoLoadState | null => {
  const state = save.infernostate;
  return state?.cave?.shown ? state : null;
};

/** The middle of the cave's footprint, yard units: where the camera looks. */
export const caveCentre = (): { x: number; y: number } => ({
  x: CAVE_SPOT.x + CAVE_FOOTPRINT.width / 2,
  y: CAVE_SPOT.y + CAVE_FOOTPRINT.height / 2,
});

/** What a tap on the cave opens. */
export type CaveTap =
  /** The cave is open: Enter Cavern, Transfer Monsters. */
  | { readonly kind: "menu" }
  /** A note from Moloch's side of things; `upgrade` offers the Town Hall. */
  | { readonly kind: "note"; readonly text: string; readonly upgrade: boolean }
  /** Nothing while Moloch's raid is under way. */
  | { readonly kind: "none" };

/**
 * A tap on the cave (`INFERNOPORTAL.Click`, `INFERNOPORTAL.as:219-226`): the
 * menu once it is at level 5 and the hall at 5; otherwise the note for its
 * level (`INFERNO_EMERGENCE_POPUPS.ShowRSVP`), with "Upgrade Now" while the
 * hall is below 5. The Facebook RSVP button of the 2012 event is gone, as
 * Flash's own post-event branch hides it.
 */
export const caveTap = (level: number, townHall: number, raidRunning: boolean): CaveTap => {
  if (level >= CAVE_MAX_LEVEL && townHall >= CAVE_TOWN_HALL) return { kind: "menu" };
  if (raidRunning) return { kind: "none" };
  const text = level >= CAVE_MAX_LEVEL ? ENTER_CAVERN_FAIL : (CAVERN_NOTES[Math.max(level, 1) - 1] ?? CAVERN_NOTES[0]!);
  return { kind: "note", text, upgrade: townHall < CAVE_TOWN_HALL };
};

/** Seconds before the camera turns to the cave on a raise (`_FOCUS_DELAY`). */
export const FOCUS_DELAY_MS = 3_000;

/** Seconds from the earthquake to Moloch's raid (`_ATTACK_DELAY`). */
export const ATTACK_DELAY_MS = 3_000;

/** Flash's shake: `BASE.Shake(100)`, one step a frame. */
export const SHAKE_FRAMES = 100;

/** Flash's stage frame rate, so the shake lasts as long as it did there. */
export const SHAKE_FPS = 40;

/**
 * One frame of the earthquake (`BASE.ShakeB`, `BASE.as:4402-4412`): a jolt of
 * up to a tenth of the frames left either way, so it starts at about 10 px and
 * dies away. `random` is in [0, 1).
 */
export const shakeOffset = (framesLeft: number, random: () => number): { x: number; y: number } => {
  if (framesLeft <= 0) return { x: 0, y: 0 };
  const jolt = (): number => Math.trunc(framesLeft / 10 - random() * (framesLeft / 5));
  return { x: jolt(), y: jolt() };
};
