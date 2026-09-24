/**
 * A small bubble that opens under a control on hover, focus or a long press.
 *
 * The planner's group tools are the reason this exists: "flip the selection
 * left to right about its own centre" fits in a `title`, but a moving picture
 * of the flip does not, and a native tooltip can hold only text. So the hint
 * gets a second home — one that can hold an `<svg>` — while the `title` stays
 * exactly where it was. Nothing here touches `title`, `aria-label` or the
 * accessible name, so a screen reader hears the same control it always did and
 * this is purely extra for a pointer.
 *
 * ## Three ways in, one way out
 *
 * A mouse opens it by hovering, after a short delay so that sweeping across a
 * toolbar does not strobe. A keyboard opens it on focus, immediately, because
 * arriving by Tab is already deliberate. A finger opens it by pressing and
 * holding, because a touch device has no hover at all and the alternative is
 * that these players never see the pictures. Any of Escape, a pointer leaving,
 * a press elsewhere, a scroll or the anchor losing focus closes it.
 *
 * ## Why it lives on `document.body`
 *
 * The planner's bars clip and wrap, and the toolbar sits at the very top of
 * the viewport, so a bubble parented to the button would be cut off by the bar
 * it belongs to. Fixed-positioned on the body it can flip above the control
 * when there is no room below, which is what the top bar always wants.
 *
 * ## Disabled controls
 *
 * Attach this to a **wrapper** around a button that can be disabled, not to
 * the button. Chrome dispatches no pointer events over a disabled control and
 * does not let them through to its ancestors either, so `planner.css` gives
 * disabled buttons inside `.planner-tip` `pointer-events: none` and the
 * wrapper receives the hover instead. That matters more than it sounds: a
 * disabled Mirror is exactly when a player most wants to know what Mirror
 * would have done.
 */

/** How long a mouse has to rest on the control before the bubble opens. */
const HOVER_DELAY_MS = 260;

/** How long a finger has to stay down before the bubble opens. */
const PRESS_DELAY_MS = 420;

/** How far a finger may drift during a press before it stops being one. */
const PRESS_SLOP_PX = 10;

/** How long a bubble opened by a finger stays up on its own. */
const PRESS_LIFETIME_MS = 6000;

/** Gap between the control and the bubble. */
const OFFSET_PX = 8;

export interface PopoverOptions {
  /**
   * Builds the contents, once per opening.
   *
   * Called every time rather than once so the bubble can read whatever the
   * control's state is *now* — a Mirror button's reason for being disabled
   * changes as the selection does — and so a looping animation restarts from
   * the top each time it is looked at.
   */
  readonly build: () => Node;
  /** Extra class on the bubble, for callers that want their own width. */
  readonly className?: string;
}

/** What `pointerType` a listener saw, for events jsdom builds without one. */
const pointerTypeOf = (event: Event): string =>
  typeof (event as PointerEvent).pointerType === "string"
    ? (event as PointerEvent).pointerType
    : "mouse";

/**
 * Opens `options.build()` under `anchor`. Returns a function that detaches it.
 *
 * The bubble is created on the first opening and reused after that, so a
 * toolbar of ten controls costs ten listeners and no elements until one is
 * pointed at.
 */
export const attachPopover = (anchor: HTMLElement, options: PopoverOptions): (() => void) => {
  let bubble: HTMLElement | null = null;
  let openTimer: number | undefined;
  let closeTimer: number | undefined;
  let pressOrigin: { x: number; y: number } | null = null;

  const clearTimers = (): void => {
    window.clearTimeout(openTimer);
    window.clearTimeout(closeTimer);
    openTimer = undefined;
    closeTimer = undefined;
  };

  const hide = (): void => {
    clearTimers();
    pressOrigin = null;
    if (!bubble) return;
    bubble.remove();
    anchor.removeAttribute("aria-describedby");
  };

  const place = (element: HTMLElement): void => {
    const box = anchor.getBoundingClientRect();
    const size = element.getBoundingClientRect();
    // jsdom reports every box as zero, so this lands at the top-left there and
    // the test looks at the contents rather than the geometry.
    const below = box.bottom + OFFSET_PX;
    const above = box.top - size.height - OFFSET_PX;
    const top = below + size.height <= window.innerHeight || above < 0 ? below : above;
    const maxLeft = Math.max(OFFSET_PX, window.innerWidth - size.width - OFFSET_PX);
    const centred = box.left + box.width / 2 - size.width / 2;
    const left = Math.min(Math.max(OFFSET_PX, centred), maxLeft);
    element.style.top = `${Math.round(top)}px`;
    element.style.left = `${Math.round(left)}px`;
  };

  const show = (): void => {
    clearTimers();
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = options.className ? `popover ${options.className}` : "popover";
      bubble.setAttribute("role", "tooltip");
      bubble.id = `popover-${Math.random().toString(36).slice(2, 9)}`;
    }
    bubble.replaceChildren(options.build());
    document.body.append(bubble);
    anchor.setAttribute("aria-describedby", bubble.id);
    place(bubble);
  };

  const openAfter = (delay: number): void => {
    clearTimers();
    openTimer = window.setTimeout(show, delay);
  };

  const onEnter = (event: Event): void => {
    if (pointerTypeOf(event) !== "mouse") return;
    openAfter(HOVER_DELAY_MS);
  };

  const onLeave = (): void => hide();

  const onFocus = (event: FocusEvent): void => {
    // Only a keyboard arrival. A click focuses too, and a bubble that opens
    // under the button you just pressed is in the way of the next press.
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    try {
      if (!target.matches(":focus-visible")) return;
    } catch {
      // A DOM that does not know the selector (jsdom): treat focus as
      // keyboard focus rather than losing the bubble altogether.
    }
    show();
  };

  const onDown = (event: Event): void => {
    const type = pointerTypeOf(event);
    if (type === "mouse") {
      hide();
      return;
    }
    const point = event as PointerEvent;
    pressOrigin = { x: point.clientX ?? 0, y: point.clientY ?? 0 };
    clearTimers();
    openTimer = window.setTimeout(() => {
      show();
      closeTimer = window.setTimeout(hide, PRESS_LIFETIME_MS);
    }, PRESS_DELAY_MS);
  };

  const onMove = (event: Event): void => {
    if (!pressOrigin) return;
    const point = event as PointerEvent;
    const dx = Math.abs((point.clientX ?? 0) - pressOrigin.x);
    const dy = Math.abs((point.clientY ?? 0) - pressOrigin.y);
    if (dx > PRESS_SLOP_PX || dy > PRESS_SLOP_PX) hide();
  };

  const onUp = (): void => {
    // A tap is not a press: only the timer that already fired leaves the
    // bubble up, and that one closes itself.
    if (pressOrigin && openTimer !== undefined) hide();
    pressOrigin = null;
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") hide();
  };

  const onDocumentDown = (event: Event): void => {
    if (event.target instanceof Node && anchor.contains(event.target)) return;
    hide();
  };

  anchor.addEventListener("pointerenter", onEnter);
  anchor.addEventListener("pointerleave", onLeave);
  anchor.addEventListener("pointerdown", onDown);
  anchor.addEventListener("pointermove", onMove);
  anchor.addEventListener("pointerup", onUp);
  anchor.addEventListener("pointercancel", onLeave);
  anchor.addEventListener("focusin", onFocus);
  anchor.addEventListener("focusout", onLeave);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onDocumentDown, true);
  window.addEventListener("scroll", onLeave, true);

  return (): void => {
    hide();
    bubble = null;
    anchor.removeEventListener("pointerenter", onEnter);
    anchor.removeEventListener("pointerleave", onLeave);
    anchor.removeEventListener("pointerdown", onDown);
    anchor.removeEventListener("pointermove", onMove);
    anchor.removeEventListener("pointerup", onUp);
    anchor.removeEventListener("pointercancel", onLeave);
    anchor.removeEventListener("focusin", onFocus);
    anchor.removeEventListener("focusout", onLeave);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDocumentDown, true);
    window.removeEventListener("scroll", onLeave, true);
  };
};
