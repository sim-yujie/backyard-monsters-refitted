/**
 * The visible half of error handling.
 *
 * Nothing the player can act on should only reach the console: a lost
 * connection, a rate limit or an expired session all change what the map is
 * doing, so they get a line at the top of the screen. Notices are keyed, so a
 * repeating failure updates one line instead of stacking twenty.
 */

export type NoticeLevel = "error" | "warning" | "info";

export interface NoticeOptions {
  level?: NoticeLevel;
  /** Removes the notice after this many milliseconds. Omit to keep it. */
  timeoutMs?: number;
  /** Label for a button on the notice, e.g. "Retry". */
  actionLabel?: string;
  onAction?: () => void;
}

interface LiveNotice {
  element: HTMLElement;
  text: HTMLElement;
  timer: number | undefined;
}

export class Notices {
  readonly element: HTMLElement;

  private readonly live = new Map<string, LiveNotice>();

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "map-dock map-dock--top-centre";
    // Announced rather than read on focus: these appear without the player
    // having touched anything.
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
  }

  /** Shows or replaces the notice under `key`. */
  show(key: string, message: string, options: NoticeOptions = {}): void {
    const existing = this.live.get(key);
    if (existing) {
      existing.text.textContent = message;
      this.resetTimer(key, existing, options.timeoutMs);
      return;
    }

    const element = document.createElement("div");
    element.className = `notice notice--${options.level ?? "error"}`;

    const text = document.createElement("span");
    text.className = "notice__text";
    text.textContent = message;
    element.append(text);

    if (options.actionLabel && options.onAction) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn btn--ghost";
      action.textContent = options.actionLabel;
      action.addEventListener("click", options.onAction);
      element.append(action);
    }

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "btn btn--ghost btn--icon";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => this.clear(key));
    element.append(dismiss);

    this.element.append(element);
    const notice: LiveNotice = { element, text, timer: undefined };
    this.live.set(key, notice);
    this.resetTimer(key, notice, options.timeoutMs);
  }

  /** Removes the notice under `key`, if it is showing. */
  clear(key: string): void {
    const notice = this.live.get(key);
    if (!notice) return;
    if (notice.timer !== undefined) window.clearTimeout(notice.timer);
    notice.element.remove();
    this.live.delete(key);
  }

  clearAll(): void {
    for (const key of [...this.live.keys()]) this.clear(key);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  destroy(): void {
    this.clearAll();
    this.element.remove();
  }

  private resetTimer(key: string, notice: LiveNotice, timeoutMs: number | undefined): void {
    if (notice.timer !== undefined) window.clearTimeout(notice.timer);
    notice.timer =
      timeoutMs === undefined ? undefined : window.setTimeout(() => this.clear(key), timeoutMs);
  }
}
