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
import { fetchCoins, type CoinsAnswer, type WeekendCoins } from "@/api/eventCoins";
import { coinBalance } from "@/game/eventCoins";
import { coinAmount, coinWords } from "./coinUi";
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

/** The pop-up's class, for tests and for "something else has the screen" checks. */
export const WEEKEND_POPUP_CLASS = "weekend-popup";

export interface WeekendPopupOptions {
  readonly container: HTMLElement;
  readonly run: WeekendRun;
  /** The server's clock now. */
  readonly now: number;
  readonly onClose?: () => void;
  /** Reads the coin purse and this weekend's awards (`GET /bm/coins`); tests pass their own. */
  readonly loadCoins?: () => Promise<CoinsAnswer | null>;
}

/** What each weekend part pays before the server says (`server/.../weekendCoins.ts` WEEKEND_COINS). */
const WEEKEND_COIN_DEFAULTS = { played: 25, boost: 75 } as const;

/**
 * The pop-up's coin rows (event coins, beta 7): "Play [coin] 25" and
 * "Boost [coin] 75", a tick on each one paid this weekend, and the purse.
 * Drawn at once from the defaults and the last balance seen, then filled
 * from `GET /bm/coins`.
 */
export class WeekendCoinRows {
  readonly element: HTMLElement;
  private readonly rows: Record<"played" | "boost", { row: HTMLElement; amount: HTMLElement; tick: HTMLElement }>;
  private readonly purse: HTMLElement;

  constructor(run: Pick<WeekendRun, "id">) {
    this.element = el("div", "weekend-coins");
    const list = el("ul", "weekend-coins__rows");
    list.setAttribute("aria-label", "Event coins this weekend");
    const row = (part: "played" | "boost", words: string, icon: GameIconName) => {
      const item = el("li", "weekend-coins__row");
      item.dataset["part"] = part;
      const what = el("span", "weekend-coins__what");
      what.append(gameIcon(icon, { size: 16, decorative: true }), words);
      const amount = el("span", "weekend-coins__amount");
      const tick = el("span", "weekend-coins__tick", "✓");
      tick.setAttribute("aria-label", "Paid");
      tick.hidden = true;
      item.append(what, amount, tick);
      list.append(item);
      return { row: item, amount, tick };
    };
    this.rows = { played: row("played", "Play", "time"), boost: row("boost", "Boost", WEEKEND_ICON[run.id]) };
    this.purse = el("p", "weekend-coins__purse");
    this.element.append(list, this.purse);
    this.update(null, coinBalance());
  }

  /** Paid ticks and amounts from the server (null: none yet), and the purse (null: unknown, hidden). */
  update(weekend: WeekendCoins | null, balance: number | null): void {
    for (const part of ["played", "boost"] as const) {
      const { row, amount, tick } = this.rows[part];
      const coins = weekend?.coins[part] ?? WEEKEND_COIN_DEFAULTS[part];
      const paid = weekend?.[part] === true;
      amount.replaceChildren(coinAmount(coins, { decorative: true }));
      row.setAttribute("aria-label", `${part === "played" ? "Play" : "Boost"}: ${coinWords(coins)}${paid ? ", paid" : ""}`);
      row.classList.toggle("weekend-coins__row--paid", paid);
      tick.hidden = !paid;
    }
    this.purse.hidden = balance === null;
    if (balance !== null) this.purse.replaceChildren("You have ", coinAmount(balance));
  }
}

/**
 * The Friday pop-up (and the same box from the banner): big icon, the
 * event's name, its one line, and when. "Starts in 14h" before Saturday,
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
  const done = el("button", "btn btn--primary weekend-popup__done", "OK");
  done.type = "button";
  done.addEventListener("click", () => popup.close());
  const coins = new WeekendCoinRows(run);
  body.append(hero, el("h3", "weekend-popup__title", run.title), el("p", "weekend-popup__line", run.line), when, coins.element, done);
  popup.setContent(body).mount(options.container);
  (options.loadCoins ?? fetchCoins)()
    .then((answer) => {
      // An announced weekend has no paid parts yet: the defaults stand.
      if (answer) coins.update(answer.weekend, answer.balance);
    })
    .catch(() => {
      // Offline or refused: the defaults and the last balance stay.
    });
  done.focus({ preventScroll: true });
  return popup;
};
