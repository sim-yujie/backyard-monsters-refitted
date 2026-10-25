import { effectsQuality, type EffectsQuality } from "@/game/attack/juice";
import type { Popup } from "@/ui/Popup";
import "@/ui/styles/alarm-pulse.css";

/**
 * The alarm glow (owner's request, 25 Oct): a red and orange glow along the
 * screen's edges that pulses about once a second while a raid's warning is
 * up, the wild monster alert or Moloch's. It lives on the popup's scrim, so it
 * goes when the popup closes; it never takes a tap and makes no sound.
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

/** Puts the alarm glow around the screen for as long as `popup` is open. */
export const alarmPulse = (popup: Popup, options: AlarmPulseOptions = {}): HTMLElement => {
  const glow = document.createElement("div");
  glow.className = "alarm-pulse";
  if ((options.quality ?? effectsQuality()) === "low") glow.classList.add("alarm-pulse--low");
  if (options.still ?? reducedMotion()) glow.classList.add("alarm-pulse--still");
  glow.setAttribute("aria-hidden", "true");
  popup.backdrop.append(glow);
  return glow;
};
