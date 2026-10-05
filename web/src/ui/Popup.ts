import { Panel, type PanelOptions } from "./Panel";

export interface PopupOptions extends PanelOptions {
  /** Close when the scrim behind the popup is clicked. Defaults to true. */
  closeOnBackdrop?: boolean;
  /**
   * Whether Escape and the scrim may close it. Defaults to true; false for a
   * question that must be answered (the raid alert, #226), which then has no
   * close button either unless `closable` says so.
   */
  dismissable?: boolean;
}

/** Elements that can hold keyboard focus, in document order. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Open popups, oldest first: the newest is the one Escape closes. */
const openPopups: Popup[] = [];

/**
 * Escape with focus on the page itself closes the newest popup (#191). A click
 * on a popup's text, or a button that disables itself once pressed, leaves
 * focus on `<body>`, where the popup's own handler never hears the key: Escape
 * then went to whatever the page behind does with it (the map closed its cell
 * panel) and the dialog stayed. Heard in the capture phase so nothing behind
 * the modal acts on the key first; focus anywhere else keeps its own Escape.
 */
const onPageEscape = (event: KeyboardEvent): void => {
  if (event.key !== "Escape") return;
  const newest = openPopups[openPopups.length - 1];
  if (!newest) return;
  if (event.target !== document.body && event.target !== document.documentElement) return;
  event.stopPropagation();
  if (newest.dismissable) newest.close();
};

/**
 * A modal dialog: a Panel on a scrim, with Escape to close and focus kept
 * inside while it is open.
 *
 * The trap is a keydown handler rather than the `inert` attribute so the page
 * behind stays rendered and scroll position is untouched; Tab past either end
 * of the focusable list wraps to the other end.
 */
export class Popup extends Panel {
  readonly backdrop: HTMLElement;
  /** Whether Escape and the scrim may close it (`PopupOptions.dismissable`). */
  readonly dismissable: boolean;

  /** Focus is returned here on close, so the keyboard does not jump to the top. */
  private previouslyFocused: HTMLElement | null = null;
  private dismissed = false;

  constructor(options: PopupOptions) {
    const dismissable = options.dismissable ?? true;
    super({ ...options, closeOnEscape: false, ...(dismissable ? {} : { closable: options.closable ?? false }) });
    this.dismissable = dismissable;

    this.backdrop = document.createElement("div");
    this.backdrop.className = "popup-backdrop";
    this.backdrop.append(this.element);

    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "true");

    if (dismissable && (options.closeOnBackdrop ?? true)) {
      this.backdrop.addEventListener("pointerdown", (event) => {
        if (event.target === this.backdrop) this.close();
      });
    }

    this.backdrop.addEventListener("keydown", this.handleModalKeydown);
  }

  /**
   * Adds the popup to a container and moves focus into it.
   *
   * Pass the overlay's `modal` layer so the popup stacks above panels and the
   * HUD.
   */
  override mount(container: HTMLElement): this {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    container.append(this.backdrop);
    if (openPopups.length === 0) window.addEventListener("keydown", onPageEscape, true);
    openPopups.push(this);
    this.focusFirst();
    return this;
  }

  override close(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.backdrop.removeEventListener("keydown", this.handleModalKeydown);
    this.backdrop.remove();
    const index = openPopups.indexOf(this);
    if (index >= 0) openPopups.splice(index, 1);
    if (openPopups.length === 0) window.removeEventListener("keydown", onPageEscape, true);
    super.close();
    this.previouslyFocused?.focus?.();
    this.previouslyFocused = null;
  }

  /** Focuses the first control in the body, or the panel itself if there is none. */
  focusFirst(): void {
    const first = this.focusable()[0];
    if (first) {
      first.focus();
      return;
    }
    this.element.tabIndex = -1;
    this.element.focus();
  }

  /** Visible, focusable descendants in document order. */
  private focusable(): HTMLElement[] {
    return [...this.element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) =>
        !element.hasAttribute("hidden") &&
        element.getAttribute("aria-hidden") !== "true" &&
        (element.offsetWidth > 0 ||
          element.offsetHeight > 0 ||
          element === document.activeElement),
    );
  }

  private readonly handleModalKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (this.dismissable) this.close();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = this.focusable();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }

    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
