import {
  onWeekendChange,
  runningWeekend,
  shorterBy,
  weekendCheckin,
  weekendNow,
  weekendPercent,
  type WeekendCheckin,
  type WeekendEventId,
  type WeekendRun,
} from "@/game/weekend";
import { formatCountdown } from "@/ui/format";
import { gameIcon, iconChip, type GameIconName } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import { coinAmount, coinWords } from "./coinUi";
import { eventsArt } from "./eventsArt";
import "./weekend.css";

/**
 * The weekend event on screen (`game/weekend.ts`): the Friday pop-up and the
 * small "−30%" chip beside a price or a time it lowers. Short words, painted
 * icons (owner: icons over words). While one runs it is a card on the Events
 * page (`ui/events/EventsPanel.ts`), not a banner on the yard (owner, 13 Nov
 * 2026).
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
 * What a weekend event pays (owner, 13 Nov 2026: "Check in on the event
 * itself to receive 50 glimmer each day";
 * `server/src/services/events/weekendCoins.ts`): a check-in once per event
 * day, from its card on the Events page or its pop-up. Shown before the
 * client has heard the player's own check-in.
 */
export const WEEKEND_CHECKIN_GLIMMERS = 50;

/** The check-in button's class (tests, and focus in the pop-up). */
export const WEEKEND_CHECKIN_BUTTON = "weekend-checkin__button";

export interface WeekendCheckinBlockOptions {
  /** The player's check-in for the run, or null when not known (the Friday pop-up, an older server). */
  readonly checkin: WeekendCheckin | null;
  /** The server's clock now. */
  readonly now: number;
  /** Checks in; null where it cannot be done (an outpost, the Inferno): the block then says where. */
  readonly onCheckIn: (() => void) | null;
  /** A check-in is on its way: the button waits. */
  readonly busy?: boolean;
  /** Why the last check-in failed, under the button. */
  readonly error?: string | null;
}

/** "Next in 13h 20m", or "Done" on the last day. */
export const checkinNextText = (nextAt: number | null, now: number): string =>
  nextAt === null ? "Done" : `Next in ${formatCountdown(Math.max(0, nextAt - now))}`;

/** One day's mark: a tick once checked in, else its number; today ringed, a missed day dim. */
const dayMark = (mark: WeekendCheckin["marks"][number], today: number): HTMLElement => {
  const state = mark.claimed ? "claimed" : mark.day === today ? "today" : mark.day < today ? "missed" : "later";
  const item = el("li", `weekend-checkin__day weekend-checkin__day--${state}`);
  item.dataset["day"] = String(mark.day);
  const words = { claimed: "checked in", today: "check in today", missed: "missed", later: "to come" }[state];
  item.title = `Day ${mark.day}: ${words}`;
  item.setAttribute("aria-label", item.title);
  if (mark.claimed) item.append(eventsArt("tick", 14, "weekend-checkin__tick"));
  else item.textContent = String(mark.day);
  return item;
};

/**
 * The weekend's check-in (owner, 13 Nov 2026), on its Events card and in its
 * pop-up: the run's days as small marks, then "Check in [glimmer] 50" while
 * today waits, or a tick and the time to the next one once done. Icons and
 * numbers, few words.
 */
export const weekendCheckinBlock = (options: WeekendCheckinBlockOptions): HTMLElement => {
  const { checkin, now } = options;
  const block = el("div", "weekend-checkin");
  block.dataset["checkin"] = !checkin ? "unknown" : checkin.claimedToday ? "done" : "waiting";
  if (!checkin) {
    // Before Saturday, or not heard yet: what it pays.
    const line = el("p", "weekend-checkin__info");
    line.append(coinAmount(WEEKEND_CHECKIN_GLIMMERS, { size: 16, decorative: true }), el("span", "", "each day"));
    line.setAttribute("aria-label", `${coinWords(WEEKEND_CHECKIN_GLIMMERS)} each day you check in`);
    block.append(line);
    return block;
  }
  if (checkin.marks.length > 0) {
    const days = el("ol", "weekend-checkin__days");
    days.setAttribute("aria-label", "Check-in days");
    for (const mark of checkin.marks) days.append(dayMark(mark, checkin.day));
    block.append(days);
  }
  if (checkin.claimedToday) {
    const done = el("p", "weekend-checkin__done");
    const next = el("span", "weekend-checkin__next", checkinNextText(checkin.nextAt, now));
    if (checkin.nextAt !== null) next.dataset["checkinNext"] = String(checkin.nextAt);
    done.append(eventsArt("tick", 18, "weekend-checkin__tick"), next);
    block.append(done);
  } else if (options.onCheckIn) {
    const button = el("button", `btn btn--primary ${WEEKEND_CHECKIN_BUTTON}`);
    button.type = "button";
    const words = `Check in: ${coinWords(checkin.amount)}`;
    button.setAttribute("aria-label", words);
    button.title = words;
    button.append(el("span", "weekend-checkin__label", "Check in"), coinAmount(checkin.amount, { size: 24, decorative: true }));
    button.disabled = options.busy === true;
    if (options.busy) button.classList.add("weekend-checkin__button--busy");
    const onCheckIn = options.onCheckIn;
    button.addEventListener("click", () => onCheckIn());
    block.append(button);
  } else {
    // An outpost or the Inferno: the check-in is on the main yard.
    const line = el("p", "weekend-checkin__info");
    line.append(coinAmount(checkin.amount, { size: 16, decorative: true }), el("span", "", "Check in on your main yard"));
    block.append(line);
  }
  if (options.error) block.append(el("p", "weekend-checkin__error", options.error));
  return block;
};

/** Moves the block's "Next in" on to `now`. */
export const tickCheckin = (root: ParentNode, now: number): void => {
  for (const line of root.querySelectorAll<HTMLElement>("[data-checkin-next]")) {
    line.textContent = checkinNextText(Number(line.dataset["checkinNext"]), now);
  }
};

/** The pop-up's class, for tests and for "something else has the screen" checks. */
export const WEEKEND_POPUP_CLASS = "weekend-popup";

export interface WeekendPopupOptions {
  readonly container: HTMLElement;
  readonly run: WeekendRun;
  /** The server's clock now. */
  readonly now: number;
  /**
   * Checks in (`api/weekend.ts` `checkInWeekend`) and settles with a
   * refusal's message, or null. Absent where the check-in cannot be made
   * (an outpost, the Inferno).
   */
  readonly onCheckIn?: () => Promise<string | null>;
  readonly onClose?: () => void;
}

/**
 * The Friday pop-up (and the same box from the Events page's weekend card): big icon, the
 * event's name, its one line, its daily check-in (50 Glimmers a day), and when. "Starts in 14h" before Saturday,
 * "Ends in 1d 4h" while it runs.
 */
export const openWeekendPopup = (options: WeekendPopupOptions): Popup => {
  const { run, now } = options;
  const running = run.startsAt <= now;
  let stopPopup = (): void => {};
  const popup = new Popup({
    title: running ? "Weekend event" : "This weekend",
    className: WEEKEND_POPUP_CLASS,
    onClose: () => {
      stopPopup();
      options.onClose?.();
    },
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
  // The check-in, redrawn when it changes (a check-in here, on the Events
  // page or in another tab); its "Next in" moves each second.
  const slot = el("div", "weekend-popup__checkin");
  let busy = false;
  let error: string | null = null;
  const draw = (): void => {
    const at = Math.max(now, weekendNow());
    const checkin = running ? weekendCheckin(run, at) : null;
    slot.replaceChildren(weekendCheckinBlock({ checkin, now: at, onCheckIn: checkIn, busy, error }));
  };
  const onCheckIn = options.onCheckIn;
  const checkIn = onCheckIn
    ? (): void => {
        if (busy) return;
        busy = true;
        error = null;
        draw();
        void onCheckIn().then((message) => {
          busy = false;
          error = message;
          if (!closed) draw();
        });
      }
    : null;
  let closed = false;
  draw();
  const stopWatching = onWeekendChange(draw);
  const timer = window.setInterval(() => tickCheckin(slot, weekendNow()), 1_000);
  const done = el("button", "btn weekend-popup__done", "OK");
  done.type = "button";
  done.addEventListener("click", () => popup.close());
  body.append(hero, el("h3", "weekend-popup__title", run.title), el("p", "weekend-popup__line", run.line), slot, when, done);
  popup.setContent(body).mount(options.container);
  // The check-in first while it waits, else OK.
  const first = slot.querySelector<HTMLButtonElement>(`.${WEEKEND_CHECKIN_BUTTON}`) ?? done;
  first.focus({ preventScroll: true });
  stopPopup = () => {
    closed = true;
    stopWatching();
    window.clearInterval(timer);
  };
  return popup;
};
