import { classicLook } from "@/game/classicLook";
import type { Effect } from "./EffectsPlayer";

/**
 * Flash's UI sounds, back on the game's buttons (owner, 2026-11-08): the
 * short `click1` on a press, `close` as a window shuts and `error1` on a
 * refusal (`client/scripts/SOUNDS.as:48,56,73`).
 *
 * Flash called `SOUNDS.Play("click1")` by hand in 118 places and
 * `SOUNDS.Play("close")` in 51 windows' `Hide`. Here one listener on the
 * page does it for every button, tab, menu item, link and tick box, so a new
 * window gets its sounds without asking: {@link installUiSounds}. One press
 * finds one element (the nearest pressable one), so a button inside a tab
 * clicks once, and a label's click on its tick box clicks once, on the box.
 *
 * Nothing sounds on a disabled or `aria-disabled` button. An element (or a
 * part of the page around it) can say which sound it wants with
 * `data-ui-sound`: `"click"`, `"close"`, `"error"` (a locked tile that still
 * explains itself when tapped) or `"none"`.
 *
 * The sounds go through the game's effects player (`sound.ts`), so the sound
 * effects switch, its slider and the browser's first-press rule all hold.
 */

/**
 * Whether the Modern look plays Flash's UI sounds too. Modern had no UI
 * sounds of its own, so both looks use Flash's; false keeps them to Classic.
 */
export const UI_SOUNDS_IN_MODERN = true;

export type UiSound = "click" | "close" | "error";

/** The effect each UI sound plays (`EffectsPlayer.ts`). */
export const UI_SOUND_EFFECT: Readonly<Record<UiSound, Effect>> = {
  click: "click1",
  close: "close",
  error: "error1",
};

/** What a press can land on that Flash would have clicked for. */
export const PRESSABLE = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="option"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
].join(", ");

const CLOSE_LABEL = /^close\b/i;
const CLOSE_CLASS = /(?:^|__|-)close$/;
const CLOSE_GLYPHS = new Set(["×", "✕", "✖"]);

const isUiSound = (value: string | null): value is UiSound =>
  value === "click" || value === "close" || value === "error";

/** A window's close button: "Close…" as its label or tooltip, a `…__close` class, or a lone ×. */
export const isCloseButton = (element: Element): boolean => {
  if (CLOSE_LABEL.test(element.getAttribute("aria-label") ?? "")) return true;
  if (CLOSE_LABEL.test(element.getAttribute("title") ?? "")) return true;
  for (const name of Array.from(element.classList)) if (CLOSE_CLASS.test(name)) return true;
  return CLOSE_GLYPHS.has((element.textContent ?? "").trim());
};

/** The sound a press on `target` makes, or null for none. */
export const uiSoundFor = (target: EventTarget | null): UiSound | null => {
  const element = target as Element | null;
  if (!element || typeof element.closest !== "function") return null;
  const pressed = element.closest(PRESSABLE);
  if (!pressed) return null;
  const marked = pressed.closest("[data-ui-sound]")?.getAttribute("data-ui-sound") ?? null;
  if (marked === "none") return null;
  if (pressed.matches(":disabled")) return null;
  // Asked for by name: a locked tile's refusal is still heard.
  if (isUiSound(marked)) return marked;
  if (pressed.closest('[aria-disabled="true"], [inert]')) return null;
  return isCloseButton(pressed) ? "close" : "click";
};

/** Where the listener goes: the page, or a stand-in in tests. */
export interface UiSoundTarget {
  addEventListener(type: "click", listener: (event: Event) => void, options: AddEventListenerOptions): void;
  removeEventListener(type: "click", listener: (event: Event) => void, options: EventListenerOptions): void;
}

export interface UiSoundOptions {
  /** Plays one effect (`sound.ts`'s `playEffect`, which minds the switches). */
  readonly play: (effect: Effect) => void;
  /** Whether UI sounds are on for the look on show; by default {@link uiSoundsOn}. */
  readonly enabled?: () => boolean;
  /**
   * Only a player's own presses (true by default): a script clicking a tab
   * open makes no sound. Tests' made-up clicks are never trusted.
   */
  readonly trustedOnly?: boolean;
}

/** Whether UI sounds are on for the look: always in Classic, in Modern while {@link UI_SOUNDS_IN_MODERN}. */
export const uiSoundsOn = (classic: boolean = classicLook()): boolean => classic || UI_SOUNDS_IN_MODERN;

/**
 * Listens for every press on `root` and plays its UI sound. Heard first
 * (capture), so a handler that stops the click still clicks. Returns the
 * undo.
 */
export const installUiSounds = (root: UiSoundTarget, options: UiSoundOptions): (() => void) => {
  const enabled = options.enabled ?? (() => uiSoundsOn());
  const trustedOnly = options.trustedOnly ?? true;
  const onClick = (event: Event): void => {
    if (trustedOnly && !event.isTrusted) return;
    if (!enabled()) return;
    const sound = uiSoundFor(event.target);
    if (sound) options.play(UI_SOUND_EFFECT[sound]);
  };
  root.addEventListener("click", onClick, { capture: true, passive: true });
  return () => root.removeEventListener("click", onClick, { capture: true });
};
