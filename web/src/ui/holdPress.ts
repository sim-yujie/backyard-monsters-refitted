/**
 * Press and hold for a button whose steps belong to its owner, not to the
 * button: the Hatch tab's waiting stacks and the monster hatching now (owner,
 * 12 Nov 2026: "Holding the − sign will auto remove rather than requiring a
 * click for each monster").
 *
 * It repeats at {@link QuantityStepper}'s pace (`HOLD_*`, {@link holdInterval})
 * but differs from {@link holdToRepeat} in three ways:
 *
 * - The release is heard on the window, not on the button. The owner may
 *   redraw while the finger is down (a server answer arrives), and a button
 *   taken out of the page hears nothing more; the hold must still end.
 * - The owner hears the end, to send what the hold gathered in one request,
 *   and hears whether the browser took the touch away (`pointercancel`, a
 *   scroll that started on the button) before any repeat: a scroll is not a
 *   press, so what it stepped should be dropped.
 * - With `stepOnPress: false` nothing happens on the press itself: a tap
 *   steps on its release and a hold starts stepping after the delay. For a
 *   step that cannot be taken back (it reaches the server at once), so a
 *   finger that only meant to scroll the row costs nothing.
 *
 * A keyboard activation is a `click` with `detail` 0 and steps once, then
 * ends. A pointer's own click (`detail` ≥ 1) is ignored: its press already
 * did the work.
 */
import { HOLD_DELAY_MS, holdInterval } from "./QuantityStepper";

export interface HoldPressHandlers {
  /** One step. False when there is nothing more to step: the repeat stops and the hold waits for the release. */
  step(): boolean;
  /**
   * The press is over. `cancelled` when the browser took the pointer before
   * any repeat (or the press was torn down): drop what it stepped.
   */
  end(cancelled: boolean): void;
}

export interface HoldPressOptions {
  /** Step on the press itself (the default). False: a tap steps on release, a hold after the delay. */
  readonly stepOnPress?: boolean;
}

/** Hooks press and hold onto `element`. Returns the teardown, which cancels a hold in progress. */
export const holdPress = (
  element: HTMLButtonElement,
  handlers: HoldPressHandlers,
  options: HoldPressOptions = {},
): (() => void) => {
  const stepOnPress = options.stepOnPress ?? true;
  let holding = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startedAt = 0;
  let stepped = 0;
  let repeating = false;
  let exhausted = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const doStep = (): void => {
    stepped += 1;
    if (!handlers.step()) {
      exhausted = true;
      clearTimer();
    }
  };

  const finish = (cancelled: boolean): void => {
    if (!holding) return;
    holding = false;
    clearTimer();
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("blur", onCancel);
    handlers.end(cancelled);
  };

  const tick = (): void => {
    timer = null;
    if (!holding || exhausted) return;
    repeating = true;
    doStep();
    if (holding && !exhausted) timer = setTimeout(tick, holdInterval(Date.now() - startedAt));
  };

  function onUp(): void {
    if (!stepOnPress && stepped === 0) doStep();
    finish(false);
  }

  function onCancel(): void {
    finish(!repeating);
  }

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || element.disabled || holding) return;
    holding = true;
    stepped = 0;
    repeating = false;
    exhausted = false;
    startedAt = Date.now();
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic event with no pointer to capture; the window still hears the release.
    }
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", onCancel);
    if (stepOnPress) doStep();
    if (holding && !exhausted) timer = setTimeout(tick, HOLD_DELAY_MS);
  };

  const onClick = (event: MouseEvent): void => {
    if (event.detail !== 0 || holding || element.disabled) return;
    handlers.step();
    handlers.end(false);
  };

  // A long press on a touchscreen would otherwise open the context menu.
  const onMenu = (event: Event): void => event.preventDefault();

  element.addEventListener("pointerdown", onDown);
  element.addEventListener("click", onClick);
  element.addEventListener("contextmenu", onMenu);

  return () => {
    finish(true);
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("click", onClick);
    element.removeEventListener("contextmenu", onMenu);
  };
};
