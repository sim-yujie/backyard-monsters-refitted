import { Panel, type PanelOptions } from "./Panel";

export interface PopupOptions extends PanelOptions {
  /** Close when the scrim behind the popup is clicked. Defaults to true. */
  closeOnBackdrop?: boolean;
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

  /** Focus is returned here on close, so the keyboard does not jump to the top. */
  private previouslyFocused: HTMLElement | null = null;
  private dismissed = false;

  constructor(options: PopupOptions) {
    super({ ...options, closeOnEscape: false });

    this.backdrop = document.createElement("div");
    this.backdrop.className = "popup-backdrop";
    this.backdrop.append(this.element);

    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "true");

    if (options.closeOnBackdrop ?? true) {
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
    this.focusFirst();
    return this;
  }

  override close(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.backdrop.removeEventListener("keydown", this.handleModalKeydown);
    this.backdrop.remove();
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
      this.close();
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
