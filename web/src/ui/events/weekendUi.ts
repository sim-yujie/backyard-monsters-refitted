import {
  runningWeekend,
  shorterBy,
  weekendNow,
  weekendPercent,
  type WeekendEventId,
  type WeekendRun,
} from "@/game/weekend";
import { formatCountdown } from "@/ui/format";
import { gameIcon, iconChip, type GameIconName } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import "./weekend.css";

/**
 * The weekend event on screen (`game/weekend.ts`): the banner while one runs,
 * the Friday pop-up, and the small "−30%" chip beside a price or a time it
 * lowers. Short words, painted icons (owner: icons over words); the plates
 * follow the Classic/Modern style through `skin.css`.
 */

/**
 * Each event's painted icon (`ui/gameIcon.ts`). ASSUMED until the owner asks
 * for new art: the level-up arrow for upgrades, the mixed resource pile for
 * loot, the clock for training and research, the winged shoe for hatching.
 */
export const WEEKEND_ICON: Readonly<Record<WeekendEventId, GameIconName>> = {
  builders: "levelup",
  plunder: "income",
  study: "time",
  hatch: "speed",
};

/** "−30%" (a minus sign, not a hyphen) or "+30%" for loot. */
export const weekendAmount = (run: Pick<WeekendRun, "id" | "percent">): string =>
  run.id === "plunder" ? `+${run.percent}%` : `−${run.percent}%`;

/**
 * The chip beside a lowered price or time, or null when `id` is not running
 * at `t`. Hovering it names the event.
 */
export const weekendChip = (id: WeekendEventId, t: number = weekendNow()): HTMLElement | null => {
  const run = runningWeekend(t);
  if (!run || run.id !== id) return null;
  return iconChip(WEEKEND_ICON[id], weekendAmount(run), {
    label: `${run.title}: ${run.line}`,
    className: "weekend-chip",
  });
};

/**
 * A lowered time or price with its event's chip, kept together on one line
 * (`.weekend-with-chip`), so a long line wraps before them rather than leaving
 * the chip alone under it. Just the text when no chip.
 */
export const withWeekendChip = (text: string, chip: HTMLElement | null): Node | string => {
  if (!chip) return text;
  const span = document.createElement("span");
  span.className = "weekend-with-chip";
  span.append(text, " ", chip);
  return span;
};

/** A Study Weekend's training or research time: what the server will write. */
export const studySeconds = (seconds: number, t: number = weekendNow()): number =>
  shorterBy(seconds, weekendPercent("study", t));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/**
 * The banner while an event runs: icon, title, "−30%" and the time left.
 * On a phone the title folds away (CSS). Pressing it opens the pop-up.
 */
export class WeekendBanner {
  readonly element: HTMLButtonElement;
  private readonly icon: HTMLElement;
  private readonly title: HTMLElement;
  private readonly amount: HTMLElement;
  private readonly left: HTMLElement;
  private run: WeekendRun | null = null;
  private iconOf: WeekendEventId | null = null;

  constructor(onOpen: (run: WeekendRun) => void) {
    this.element = el("button", "weekend-banner");
    this.element.type = "button";
    this.element.hidden = true;
    this.icon = el("span", "weekend-banner__icon");
    this.title = el("span", "weekend-banner__title");
    this.amount = el("span", "weekend-banner__amount");
    this.left = el("span", "weekend-banner__left");
    // The countdown changes each minute: not read out each time.
    this.left.setAttribute("aria-hidden", "true");
    this.element.append(this.icon, this.title, this.amount, this.left);
    this.element.addEventListener("click", () => {
      if (this.run) onOpen(this.run);
    });
  }

  /** Shows `run` (or hides with null), its time left read at `now`. */
  update(run: WeekendRun | null, now: number): void {
    this.run = run;
    this.element.hidden = run === null;
    if (!run) return;
    if (this.iconOf !== run.id) {
      this.icon.replaceChildren(gameIcon(WEEKEND_ICON[run.id], { size: 32, decorative: true }));
      this.iconOf = run.id;
    }
    this.element.dataset["event"] = run.id;
    this.title.textContent = run.title;
    this.amount.textContent = weekendAmount(run);
    this.left.replaceChildren(gameIcon("time", { size: 16, decorative: true }), formatCountdown(run.endsAt - now));
    this.element.setAttribute("aria-label", `${run.title}: ${run.line}. Ends in ${formatCountdown(run.endsAt - now)}.`);
    this.element.title = run.line;
  }
}

/**
 * What every weekend event pays (owner, 12 Nov 2026: "builder's weekend pay
 * glimmer"; `server/src/services/events/weekendCoins.ts` WEEKEND_COINS):
 * 25 Glimmers the first time the yard loads that weekend, 75 the first time
 * the boost is used. The pop-up says it in one line.
 */
export const WEEKEND_GLIMMERS_LINE = "Play this weekend for 25 Glimmers, use the boost for 75 more.";

/** The pop-up's class, for tests and for "something else has the screen" checks. */
export const WEEKEND_POPUP_CLASS = "weekend-popup";

export interface WeekendPopupOptions {
  readonly container: HTMLElement;
  readonly run: WeekendRun;
  /** The server's clock now. */
  readonly now: number;
  readonly onClose?: () => void;
}

/**
 * The Friday pop-up (and the same box from the banner): big icon, the
 * event's name, its one line, what it pays in Glimmers, and when. "Starts in 14h" before Saturday,
 * "Ends in 1d 4h" while it runs.
 */
export const openWeekendPopup = (options: WeekendPopupOptions): Popup => {
  const { run, now } = options;
  const running = run.startsAt <= now;
  const popup = new Popup({
    title: running ? "Weekend event" : "This weekend",
    className: WEEKEND_POPUP_CLASS,
    ...(options.onClose && { onClose: options.onClose }),
  });
  const body = el("div", "weekend-popup__body");
  body.dataset["event"] = run.id;
  const hero = el("div", "weekend-popup__hero");
  // Drawn at 72 px: the srcset then fetches the 64 px or larger file.
  const icon = gameIcon(WEEKEND_ICON[run.id], { size: 32, decorative: true, className: "weekend-popup__icon" });
  icon.width = 72;
  icon.height = 72;
  icon.sizes = "72px";
  hero.append(icon);
  const badge = el("span", "weekend-popup__amount", weekendAmount(run));
  hero.append(badge);
  const when = el("p", "weekend-popup__when");
  when.append(
    gameIcon("time", { size: 16, decorative: true }),
    running ? `Ends in ${formatCountdown(run.endsAt - now)}` : `Starts in ${formatCountdown(run.startsAt - now)}`,
  );
  const glimmers = el("p", "weekend-popup__coins");
  glimmers.append(gameIcon("eventcoin", { size: 16, decorative: true }), WEEKEND_GLIMMERS_LINE);
  const done = el("button", "btn btn--primary weekend-popup__done", "OK");
  done.type = "button";
  done.addEventListener("click", () => popup.close());
  body.append(hero, el("h3", "weekend-popup__title", run.title), el("p", "weekend-popup__line", run.line), glimmers, when, done);
  popup.setContent(body).mount(options.container);
  done.focus({ preventScroll: true });
  return popup;
};
