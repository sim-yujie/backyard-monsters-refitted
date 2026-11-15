import {
  nextDailyReset,
  pillCountdown,
  rowTimeText,
  serverTimeText,
  type ResetRow,
} from "@/game/resetClock";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import "@/ui/styles/reset-clock.css";
// The round look it shares with Bob's "?".
import "@/ui/styles/tips.css";

/**
 * The reset clock (beta 8, owner 15 Nov 2026, corner option C): a round
 * hourglass button beside Bob's floating "?" on the yard, its twin in shape
 * and size, and on a tap a short list of every reset with its own countdown
 * (`game/resetClock.ts`). No words or numbers on the button (the corner was
 * "wayy too cluttered"); the list says what each reset is and when.
 *
 * It only shows times: what it reads, and when it is hidden (the guided
 * start), is its plugin's (`game/yard/plugins/resetClock.ts`).
 */

/**
 * The button's picture. A painted round "reset" arrow is still to be made;
 * the painted hourglass stands in until then (one name to change).
 */
export const RESET_CLOCK_ICON: GameIconName = "time";

/** How often the countdowns move. */
const TICK_MS = 1_000;

export interface ResetClockTimers {
  every(callback: () => void, ms: number): unknown;
  stop(handle: unknown): void;
}

const browserTimers: ResetClockTimers = {
  every: (callback, ms) => setInterval(callback, ms),
  stop: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface ResetClockOptions {
  /** The server's clock, unix seconds. */
  now(): number;
  /** The resets that apply at `now`. */
  rows(now: number): readonly ResetRow[];
  timers?: ResetClockTimers;
}

let nextId = 0;

export class ResetClock {
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  /** The daily reset's countdown the button's label says. */
  private label = "";
  private readonly list: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly rowsBox: HTMLElement;
  private readonly options: ResetClockOptions;
  private readonly timers: ResetClockTimers;
  private readonly timer: unknown;
  /** The rows drawn last, as a key: the list is rebuilt only when it changes. */
  private rowsKey = "";

  private readonly onDocumentDown = (event: Event): void => {
    if (event.target instanceof Node && this.element.contains(event.target)) return;
    this.close();
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    this.close();
    this.button.focus();
  };

  constructor(options: ResetClockOptions) {
    this.options = options;
    this.timers = options.timers ?? browserTimers;
    const listId = `reset-clock-list-${++nextId}`;

    this.element = document.createElement("div");
    this.element.className = "reset-clock";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "reset-clock__button";
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-controls", listId);
    this.button.title = "Resets";
    this.button.append(gameIcon(RESET_CLOCK_ICON, { size: 24, decorative: true, className: "reset-clock__icon" }));
    this.button.addEventListener("click", () => this.toggle());

    this.list = document.createElement("div");
    this.list.className = "reset-clock__list";
    this.list.id = listId;
    this.list.setAttribute("role", "group");
    this.list.setAttribute("aria-label", "Resets");
    this.list.hidden = true;
    this.heading = document.createElement("p");
    this.heading.className = "reset-clock__heading";
    this.rowsBox = document.createElement("ul");
    this.rowsBox.className = "reset-clock__rows";
    this.list.append(this.heading, this.rowsBox);

    this.element.append(this.button, this.list);
    this.render();
    this.timer = this.timers.every(() => this.render(), TICK_MS);
  }

  get open(): boolean {
    return !this.list.hidden;
  }

  /** Hidden while the guided start runs; hiding also shuts the list. */
  setHidden(hidden: boolean): void {
    if (hidden) this.close();
    this.element.hidden = hidden;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    if (this.open || this.element.hidden) return;
    this.list.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.rowsKey = "";
    this.render();
    document.addEventListener("pointerdown", this.onDocumentDown, true);
    document.addEventListener("keydown", this.onKey);
  }

  close(): void {
    if (!this.open) return;
    this.list.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.onDocumentDown, true);
    document.removeEventListener("keydown", this.onKey);
  }

  /** The button's label (the daily reset's countdown), and the list's rows while it is open. */
  render(): void {
    const now = this.options.now();
    const left = pillCountdown(nextDailyReset(now) - now);
    if (this.label !== left) {
      this.label = left;
      this.button.setAttribute("aria-label", `Daily reset in ${left}. Show every reset`);
    }
    if (this.open) this.renderList(now);
  }

  private renderList(now: number): void {
    this.heading.textContent = `Resets (server time ${serverTimeText(now)})`;
    const rows = this.options.rows(now);
    const key = rows.map((row) => `${row.id}:${row.phase}:${row.at}:${row.title}:${row.detail ?? ""}`).join("|");
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.rowsBox.replaceChildren(...rows.map((row) => this.rowElement(row)));
    }
    rows.forEach((row, index) => {
      const time = this.rowsBox.children[index]?.querySelector(".reset-clock__left");
      const text = rowTimeText(row, now);
      if (time && time.textContent !== text) time.textContent = text;
    });
  }

  private rowElement(row: ResetRow): HTMLElement {
    const item = document.createElement("li");
    item.className = "reset-clock__row";
    item.dataset["reset"] = row.id;
    const name = document.createElement("span");
    name.className = "reset-clock__name";
    const title = document.createElement("span");
    title.className = "reset-clock__title";
    title.textContent = row.title;
    name.append(title);
    if (row.detail) {
      const detail = document.createElement("small");
      detail.className = "reset-clock__detail";
      detail.textContent = row.detail;
      name.append(detail);
    }
    const left = document.createElement("span");
    left.className = "reset-clock__left";
    item.append(name, left);
    return item;
  }

  destroy(): void {
    this.close();
    this.timers.stop(this.timer);
    this.element.remove();
  }
}
