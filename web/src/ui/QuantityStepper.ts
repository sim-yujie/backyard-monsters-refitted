/**
 * The shared quantity control: a number box between `−` and `+`, optional
 * bigger steps (`+5`, `+10`), and Fill
 * (`docs/design/yard-buildings.md` §4.4, decision D9). The attack's Army
 * panel uses it for each monster row and the Hatch tab for its batch size, so
 * the two screens hold, type and fill the same way.
 *
 * ## Hold to repeat
 *
 * A press on `−` or `+` steps once at once, then after a short wait repeats,
 * quickening the longer it is held (`HOLD_*` below). It runs on pointer
 * events so one code path serves a mouse and a finger, and it stops on
 * `pointerup`, `pointercancel` or the pointer leaving the button. A keyboard
 * activation arrives as a `click` with no pointer press before it and steps
 * once.
 *
 * ## Who owns the number
 *
 * The control holds no count of its own. It reads the owner's value, asks the
 * owner to set a new one (the owner clamps it) and asks the owner to redraw
 * after a typed figure is committed. The owner redraws through {@link sync},
 * which writes the box — unless the player is typing in it — and the
 * buttons' disabled states.
 */

/** Milliseconds a press must last before it starts repeating. */
export const HOLD_DELAY_MS = 350;
/** The first repeat interval, and the one it accelerates to. */
export const HOLD_START_MS = 120;
export const HOLD_FAST_MS = 40;
/** Milliseconds of holding over which the interval ramps from start to fast. */
export const HOLD_RAMP_MS = 2000;

/** How much ArrowUp/Down and PageUp/Down step the number box. */
const ARROW_STEP = 1;
const PAGE_STEP = 10;

/** The repeat interval after `heldMs` of holding: a straight ramp. */
export const holdInterval = (heldMs: number): number => {
  const progress = Math.min(1, Math.max(0, (heldMs - HOLD_DELAY_MS) / HOLD_RAMP_MS));
  return Math.round(HOLD_START_MS + (HOLD_FAST_MS - HOLD_START_MS) * progress);
};

/**
 * A button for {@link holdToRepeat}: a click that follows a pointer press is
 * swallowed (the press already stepped), so only an activation with no press
 * before it — the keyboard — runs `onClick`.
 */
export const stepButton = (
  className: string,
  text: string,
  onClick: () => void,
): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  element.addEventListener("click", (event) => {
    if (event.detail !== 0 && element.dataset["held"] === "1") {
      delete element.dataset["held"];
      return;
    }
    delete element.dataset["held"];
    onClick();
  });
  return element;
};

/**
 * Makes a button step once on press and keep stepping while held, faster the
 * longer it is held. Returns the cancel, for teardown.
 *
 * Pointer events so a mouse and a finger share one path. The first step is
 * on `pointerdown`; the `click` that follows the release is swallowed by the
 * button's own handler (see {@link stepButton}), which still steps once for a
 * keyboard activation.
 */
export const holdToRepeat = (element: HTMLButtonElement, step: () => void): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startedAt = 0;
  let pointerId: number | null = null;

  const stop = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pointerId !== null) {
      try {
        if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      } catch {
        // Already released; nothing to do.
      }
      pointerId = null;
    }
  };

  const tick = (): void => {
    if (element.disabled) {
      stop();
      return;
    }
    step();
    const held = Date.now() - startedAt;
    timer = setTimeout(tick, holdInterval(held));
  };

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || element.disabled) return;
    stop();
    element.dataset["held"] = "1";
    pointerId = event.pointerId;
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic event with no pointer to capture; the leave handler covers it.
    }
    startedAt = Date.now();
    step();
    timer = setTimeout(tick, HOLD_DELAY_MS);
  };

  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
  element.addEventListener("pointerleave", stop);
  element.addEventListener("lostpointercapture", stop);
  // A long press on a touchscreen would otherwise open the context menu.
  element.addEventListener("contextmenu", (event) => event.preventDefault());

  return () => {
    stop();
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("pointerup", stop);
    element.removeEventListener("pointercancel", stop);
    element.removeEventListener("pointerleave", stop);
    element.removeEventListener("lostpointercapture", stop);
  };
};

export interface QuantityStepperOptions {
  /**
   * The BEM block its classes hang off: `<block>__controls`, `<block>__step`
   * (`--minus`, `--plus`), `<block>__count`, `<block>__fill`.
   */
  readonly block: string;
  /** The box's accessible name: "Pokey to send". */
  readonly inputLabel: string;
  /** The buttons' accessible names: "Fewer Pokey", "More Pokey". */
  readonly fewerLabel: string;
  readonly moreLabel: string;
  /** Fill's hover text. */
  readonly fillTitle: string;
  /**
   * Bigger steps offered as buttons between `+` and Fill, `+5` and `+10` for
   * the Hatch tab (#268). None when absent.
   */
  readonly jumps?: readonly number[];
  /** The owner's count now. */
  value(): number;
  /** Asks the owner for a new count; the owner clamps it. */
  set(value: number): void;
  /** Asks the owner to fill. */
  fill(): void;
  /**
   * Asks the owner to redraw with the box rewritten: after a typed figure is
   * committed (change, blur) and after an arrow key.
   */
  commit(): void;
}

/** What {@link QuantityStepper.sync} draws. */
export interface QuantityState {
  /** The figure the box shows. */
  readonly value: number;
  /** The box's maximum: `+` and Fill are disabled at it. */
  readonly max: number;
  /** Everything disabled. */
  readonly disabled: boolean;
  /** Whether the box's text may be replaced; not while the player types in it. */
  readonly rewrite: boolean;
}

export class QuantityStepper {
  /** The row of controls: `−`, the box, `+`, Fill. */
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly minus: HTMLButtonElement;
  readonly plus: HTMLButtonElement;
  /** The `+5`-style buttons, in `jumps` order. */
  readonly jumps: readonly HTMLButtonElement[];
  readonly fill: HTMLButtonElement;

  private readonly options: QuantityStepperOptions;
  private readonly cancelHolds: Array<() => void> = [];

  constructor(options: QuantityStepperOptions) {
    this.options = options;
    const { block } = options;

    // The shared look is `qty-stepper` (ui.css); the block's own classes place it.
    this.element = document.createElement("span");
    this.element.className = `qty-stepper ${block}__controls`;

    this.minus = stepButton(`btn qty-stepper__step ${block}__step ${block}__step--minus`, "−", () =>
      this.step(-1),
    );
    this.minus.setAttribute("aria-label", options.fewerLabel);
    this.cancelHolds.push(holdToRepeat(this.minus, () => this.step(-1)));

    const input = document.createElement("input");
    input.type = "number";
    input.className = `field__input qty-stepper__count ${block}__count`;
    input.min = "0";
    input.step = "1";
    input.inputMode = "numeric";
    input.setAttribute("aria-label", options.inputLabel);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (input.value === "" || !Number.isFinite(value)) return;
      options.set(value);
    });
    input.addEventListener("change", () => options.commit());
    input.addEventListener("blur", () => options.commit());
    input.addEventListener("keydown", (event) => {
      const delta =
        event.key === "ArrowUp"
          ? ARROW_STEP
          : event.key === "ArrowDown"
            ? -ARROW_STEP
            : event.key === "PageUp"
              ? PAGE_STEP
              : event.key === "PageDown"
                ? -PAGE_STEP
                : 0;
      if (delta === 0) return;
      event.preventDefault();
      this.step(delta);
      options.commit();
    });
    input.addEventListener("focus", () => input.select());
    this.input = input;

    this.plus = stepButton(`btn qty-stepper__step ${block}__step ${block}__step--plus`, "+", () =>
      this.step(1),
    );
    this.plus.setAttribute("aria-label", options.moreLabel);
    this.cancelHolds.push(holdToRepeat(this.plus, () => this.step(1)));

    this.jumps = (options.jumps ?? []).map((size) => {
      const jump = stepButton(`btn qty-stepper__step qty-stepper__jump ${block}__jump`, `+${size}`, () =>
        this.step(size),
      );
      jump.setAttribute("aria-label", `${size} more`);
      return jump;
    });

    this.fill = stepButton(`btn btn--outline qty-stepper__fill ${block}__fill`, "Fill", () => options.fill());
    this.fill.title = options.fillTitle;

    this.element.append(this.minus, input, this.plus, ...this.jumps, this.fill);
  }

  /** Draws the owner's state: the box (when it may be rewritten), its maximum and the buttons. */
  sync(state: QuantityState): void {
    if (state.rewrite) this.input.value = String(state.value);
    this.input.max = String(state.max);
    this.input.disabled = state.disabled;
    this.minus.disabled = state.disabled || state.value <= 0;
    this.plus.disabled = state.disabled || state.value >= state.max;
    for (const jump of this.jumps) jump.disabled = this.plus.disabled;
    this.fill.disabled = state.disabled || state.value >= state.max;
  }

  /** Stops any hold in progress and unhooks the buttons. */
  destroy(): void {
    for (const cancel of this.cancelHolds.splice(0)) cancel();
  }

  private step(delta: number): void {
    this.options.set(this.options.value() + delta);
  }
}
