import { LATEST_RELEASE } from "@/data/changelog";
import { recentErrors } from "./errorLog";
import { currentScreenName } from "./screenCapture";

/**
 * What a bug report carries besides the player's words, gathered when the
 * form opens: the game version (the newest "What's new" release), the screen
 * they were on, phone or computer, the browser, the screen size and the last
 * game errors (`errorLog.ts`).
 */

export interface ReportContext {
  readonly gameVersion: string;
  readonly screen: string;
  readonly device: "phone" | "computer";
  readonly userAgent: string;
  readonly screenSize: string;
  readonly errors: readonly string[];
}

/** A touch screen whose shorter side is phone-sized. */
export const deviceKind = (win: Window = window): "phone" | "computer" => {
  const coarse = win.matchMedia?.("(pointer: coarse)").matches ?? false;
  const shorter = Math.min(win.screen?.width ?? win.innerWidth, win.screen?.height ?? win.innerHeight);
  return coarse && shorter < 768 ? "phone" : "computer";
};

/** "390x844 window, 1170x2532 screen at 3x". */
export const screenSizeText = (win: Window = window): string => {
  const ratio = Math.round((win.devicePixelRatio || 1) * 100) / 100;
  const screen = win.screen ? `, ${win.screen.width}x${win.screen.height} screen` : "";
  return `${win.innerWidth}x${win.innerHeight} window${screen} at ${ratio}x`;
};

export const reportContext = (win: Window = window): ReportContext => ({
  gameVersion: LATEST_RELEASE?.version ?? "",
  screen: currentScreenName(),
  device: deviceKind(win),
  userAgent: win.navigator?.userAgent ?? "",
  screenSize: screenSizeText(win),
  errors: recentErrors(),
});
