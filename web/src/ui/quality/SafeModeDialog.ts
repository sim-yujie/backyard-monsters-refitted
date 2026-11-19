import { Popup } from "@/ui/Popup";
import type { SafeModeCap } from "@/game/safeMode";

/**
 * Safe mode's one notice (`game/safeMode.ts`): the game did not load twice in
 * a row, so it started one Quality level lower. Shown once, on the page load
 * where it stepped down. Built as the "Slow internet?" suggestion is, in the
 * same classes.
 */

export const SAFE_MODE_TEXT = {
  title: "Safe mode",
  body: (level: string): string => `The game did not load twice, so Quality is now ${level}. Change it in Settings.`,
  level: { medium: "Medium", low: "Low" },
  ok: "OK",
} as const;

export interface SafeModeDialogOptions {
  /** Where the popup mounts: the modal layer. */
  readonly container: HTMLElement;
  /** The level the game stepped down to. */
  readonly level: SafeModeCap;
}

export const openSafeModeNotice = (options: SafeModeDialogOptions): Popup => {
  const popup = new Popup({ title: SAFE_MODE_TEXT.title, className: "slow-internet-popup safe-mode-popup" });
  const body = document.createElement("div");
  body.className = "slow-internet safe-mode";
  const words = document.createElement("p");
  words.textContent = SAFE_MODE_TEXT.body(SAFE_MODE_TEXT.level[options.level]);
  const foot = document.createElement("div");
  foot.className = "slow-internet__foot";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "btn btn--primary";
  ok.textContent = SAFE_MODE_TEXT.ok;
  ok.addEventListener("click", () => popup.close());
  foot.append(ok);
  body.append(words, foot);
  popup.setContent(body).mount(options.container);
  return popup;
};
