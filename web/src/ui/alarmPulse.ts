import { effectsQuality, type EffectsQuality } from "@/game/attack/juice";
import type { Popup } from "@/ui/Popup";
import "@/ui/styles/alarm-pulse.css";

/**
 * The alarm glow (owner's request, 25 Oct): the warning window's own border
 * and a red and orange glow round it pulse about once a second while a raid's
 * warning is up, the wild monster alert or Moloch's. It lives on the popup's
 * scrim, laid exactly over the window, so it goes when the popup closes; it
 * never takes a tap and makes no sound.
 *
 * - "Effects: Low" (Account Settings > Game effects, and a phone's own
 *   start) draws it thinner and fainter.
 * - When the device asks for less motion it stays lit without pulsing.
 */

/** Whether the device asks for less motion. */
const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface AlarmPulseOptions {
  readonly quality?: EffectsQuality;
  readonly still?: boolean;
}

/** Makes `popup`'s border pulse with the alarm glow for as long as it is open. */
export const alarmPulse = (popup: Popup, options: AlarmPulseOptions = {}): HTMLElement => {
  const glow = document.createElement("div");
  glow.className = "alarm-pulse";
  if ((options.quality ?? effectsQuality()) === "low") glow.classList.add("alarm-pulse--low");
  if (options.still ?? reducedMotion()) glow.classList.add("alarm-pulse--still");
  glow.setAttribute("aria-hidden", "true");
  popup.backdrop.classList.add("popup-backdrop--alarm");
  popup.backdrop.append(glow);
  return glow;
};
