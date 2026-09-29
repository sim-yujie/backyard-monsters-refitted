import { resourceAmount } from "@/ui/resourceIcon";

/**
 * A button that spends Shiny, pressed twice
 * (`docs/design/yard-buildings.md` §3.1: "A Shiny button needs a second tap
 * within 3 seconds instead of a dialog").
 *
 * Shiny spends cannot be undone, so one click must not spend. The first click
 * arms the button: it turns amber and reads "Tap again · [shiny] 58". A second
 * click within {@link ARM_WINDOW_MS} spends; otherwise it quietly disarms.
 * Leaving the button (blur) or pressing Escape disarms at once. The armed
 * text is also announced, so a keyboard or screen-reader player hears what
 * the second press will cost before making it.
 *
 * The element is long-lived: the panel keeps one per action and updates its
 * price and state in place every second, so an armed button survives the
 * panel's once-a-second countdown refresh and keeps focus.
 */

/** How long an armed button waits for the second tap. */
export const ARM_WINDOW_MS = 3_000;

export interface ShinyButtonTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: ShinyButtonTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (handle) => window.clearTimeout(handle as number),
};

export interface ShinyButtonOptions {
  /** What the spend does: "Instant", "Finish now", "−1 h". */
  readonly label: string;
  /**
   * What it is spent on, for the accessible name where the label alone is
   * not enough ("Buy" on every card of the Shop): "Buy More Yardage, 300
   * Shiny", "Tap again to spend 300 Shiny on More Yardage".
   */
  readonly what?: string;
  /** Spells a Shiny price as the shared amount helper spells amounts. */
  readonly spell: (price: number) => string;
  /** Runs on the second tap. */
  readonly onSpend: () => void;
  readonly className?: string;
  readonly timers?: ShinyButtonTimers;
}

export class ShinyButton {
  readonly element: HTMLButtonElement;

  private readonly label: string;
  private readonly what: string | undefined;
  private readonly spell: (price: number) => string;
  private readonly onSpend: () => void;
  private readonly timers: ShinyButtonTimers;
  private readonly labelNode: HTMLElement;
  private readonly priceNode: HTMLElement;
  private readonly live: HTMLElement;

  private price = 0;
  private reason: string | null = null;
  private busy = false;
  private armTimer: unknown = null;

  constructor(options: ShinyButtonOptions) {
    this.label = options.label;
    this.what = options.what;
    this.spell = options.spell;
    this.onSpend = options.onSpend;
    this.timers = options.timers ?? browserTimers;

    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = `btn shiny-button${options.className ? ` ${options.className}` : ""}`;

    this.labelNode = document.createElement("span");
    this.labelNode.className = "shiny-button__label";
    this.priceNode = document.createElement("span");
    this.priceNode.className = "shiny-button__price";
    // The armed state is announced through this, not through the button's own
    // name changing under the cursor, which screen readers do not all repeat.
    this.live = document.createElement("span");
    this.live.className = "u-visually-hidden";
    this.live.setAttribute("aria-live", "polite");
    this.element.append(this.labelNode, this.priceNode, this.live);

    this.element.addEventListener("click", this.onClick);
    this.element.addEventListener("blur", this.disarm);
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.armed) {
        event.stopPropagation();
        this.disarm();
      }
    });
    this.draw();
  }

  get armed(): boolean {
    return this.armTimer !== null;
  }

  /** The price on the button. A change while armed keeps it armed. */
  setPrice(price: number): void {
    if (price === this.price) return;
    this.price = price;
    this.draw();
  }

  /** Why the button cannot be pressed, or null. Disabling disarms. */
  setBlocked(reason: string | null): void {
    if (reason === this.reason) return;
    this.reason = reason;
    if (reason !== null) this.disarm();
    this.draw();
  }

  /** While the spend's own request runs. */
  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    if (busy) this.disarm();
    this.draw();
  }

  destroy(): void {
    this.disarm();
    this.element.remove();
  }

  private readonly onClick = (): void => {
    if (this.reason !== null || this.busy) return;
    if (!this.armed) {
      this.armTimer = this.timers.set(() => {
        this.armTimer = null;
        this.live.textContent = "";
        this.draw();
      }, ARM_WINDOW_MS);
      this.live.textContent = `Tap again to spend ${this.spell(this.price)} Shiny.`;
      this.draw();
      return;
    }
    this.disarm();
    this.onSpend();
  };

  private readonly disarm = (): void => {
    if (this.armTimer === null) return;
    this.timers.clear(this.armTimer);
    this.armTimer = null;
    this.live.textContent = "";
    this.draw();
  };

  private draw(): void {
    const armed = this.armed;
    const priceText = this.spell(this.price);
    this.labelNode.textContent = armed ? "Tap again" : this.label;
    this.priceNode.replaceChildren(resourceAmount("shiny", priceText, { decorative: true }));
    this.element.classList.toggle("shiny-button--armed", armed);
    this.element.disabled = this.reason !== null || this.busy;
    this.element.setAttribute("aria-pressed", armed ? "true" : "false");
    const name = armed
      ? `Tap again to spend ${priceText} Shiny on ${this.what ?? this.label}`
      : `${this.what ? `${this.label} ${this.what}` : this.label}, ${priceText} Shiny`;
    this.element.setAttribute("aria-label", this.reason ? `${name}. ${this.reason}` : name);
    this.element.title = this.reason ?? (armed ? "Tap again within 3 seconds to spend" : "");
  }
}
