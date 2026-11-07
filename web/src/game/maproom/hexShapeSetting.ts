import { fetchMapSettings } from "@/api/account";
import type { HexShape } from "@/game/HexGrid";
import { noteTiltAnswer } from "./tiltSetting";

/**
 * The shape from the account's settings, keeping the tilt answer that came in
 * the same response, so the map's first open asks the account once, not twice.
 */
const fetchShapeAndTilt = async (): Promise<HexShape> => {
  const { hexShape, tilt } = await fetchMapSettings();
  noteTiltAnswer(tilt);
  return hexShape;
};

/**
 * The world's hex shape as the server names it (`MR2_HEX_SHAPE`, MR2 look
 * plan step 1, sent as `mapHexShape` in the account's settings block).
 *
 * The map asks before it draws or picks a cell, because picking, the range
 * line and the fog all have to measure the way the server's rules do. The
 * switch only changes with a server restart, so the first answer is kept for
 * the rest of the page's life and later map opens do not wait for it. A
 * failed fetch answers flat (today's grid) and is asked again next time.
 */
let known: HexShape | null = null;

export const loadHexShape = async (fetch: () => Promise<HexShape> = fetchShapeAndTilt): Promise<HexShape> => {
  if (known) return known;
  try {
    known = await fetch();
    return known;
  } catch {
    return "flat";
  }
};

/** Forgets the kept answer (tests). */
export const forgetHexShape = (): void => {
  known = null;
};
