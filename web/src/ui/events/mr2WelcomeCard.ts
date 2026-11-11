import type { Mr2WelcomeStatus } from "@/api/events";
import { FIRST_OPEN_ART } from "@/game/maproom/takeover";
import { STARTER_KIT_SUMMARIES } from "@/game/yard/starterKits";
import { gameIcon } from "@/ui/gameIcon";
import { eventsArt } from "./eventsArt";

/**
 * The "Frontier Pass" card on the Events page (owner, 9 Nov 2026; 7 sets in
 * 10 days, owner 11 Nov): while the player's 10 days run, the days left, a
 * timeline of the 10 days (the days gone, today lit, the days left, and the
 * days a reward was used), the cheap wild takeover and the free Regular kit,
 * each with how many are left of 7 and today's state (Ready today, Used
 * today, back tomorrow, or All used), a Go to Map Room 2 button while one is
 * ready, and a "?" that opens a short note. Short words, pictures and numbers
 * (owner prefers little text).
 *
 * The server decides everything (`GET /bm/events` `mr2Welcome`). The card
 * stays all 10 days, rewards used or not (owner, 9 Nov: it left once both
 * were used); null only when the days are over, and then there is no card.
 * The days count from the player's own start (launch, or the day they joined
 * Map Room 2 after it); a reward used today is back at the daily reset (UTC
 * midnight), which the panel's tick shows without a new answer.
 */

const DAY = 86_400;

/** The pass's length in days (server `MR2_WELCOME_DAYS`). */
export const WELCOME_DAYS = 10;

/** How many of each reward the pass gives, one a day at most (server `MR2_WELCOME_SETS`). */
export const WELCOME_SETS = 7;

export const WELCOME_TITLE = "Frontier Pass";

/** The "?" note: one lead line, then one line per reward and one for the days. */
export const WELCOME_HELP = {
  lead: `Frontier Pass: ${WELCOME_SETS} sets over your first ${WELCOME_DAYS} days in Map Room 2.`,
  takeover: "Wild camp takeover: 10% of the resources. Paying Shiny does not use it.",
  kit: "Regular Starter Kit free, on any outpost. Builds over time, no worker.",
  days: `1 set a day, on any ${WELCOME_SETS} of the ${WELCOME_DAYS} days. New day at 00:00 UTC.`,
} as const;

/** The state words on a reward. */
export const WELCOME_STATE_TEXT = {
  ready: "Ready today",
  today: "Used today, back tomorrow",
  done: "All used",
} as const;

type RewardState = keyof typeof WELCOME_STATE_TEXT;

/** "8 days left", "1 day left", from the server's end and clock. */
export const welcomeDaysText = (endsAt: number, now: number): string => {
  const days = Math.max(1, Math.ceil((endsAt - now) / DAY));
  return days === 1 ? "1 day left" : `${days} days left`;
};

/** "5/7 left". */
export const welcomeLeftText = (left: number, sets: number): string => `${left}/${sets} left`;

/** Which of the 10 days `at` falls on: 1 on the first day, 10 on the last (kept inside them). */
export const welcomeDay = (startsAt: number, at: number): number =>
  Math.min(WELCOME_DAYS, Math.max(1, Math.floor((at - startsAt) / DAY) + 1));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const picture = (src: string, alt: string): HTMLImageElement => {
  const image = el("img", "events-welcome__picture");
  image.src = src;
  image.alt = alt;
  image.width = 44;
  image.height = 44;
  image.decoding = "async";
  return image;
};

const KIT_THUMBNAIL = STARTER_KIT_SUMMARIES.find((kit) => kit.id === 1)?.thumbnail ?? "";

const REWARD_STATES: readonly RewardState[] = ["ready", "today", "done"];

/** Puts `state`'s mark and words on a reward row. */
const paintRewardState = (row: HTMLElement, state: RewardState): void => {
  row.dataset["state"] = state;
  for (const name of REWARD_STATES) row.classList.toggle(`events-welcome__reward--${name}`, name === state);
  const chip = row.querySelector<HTMLElement>(".events-welcome__state");
  if (!chip) return;
  chip.className = `events-welcome__state events-welcome__state--${state}`;
  // A gift while ready, a clock until tomorrow, the claimed tick once all are used.
  const mark =
    state === "ready"
      ? eventsArt("gift", 16, "events-welcome__state-mark")
      : state === "today"
        ? gameIcon("time", { size: 16, decorative: true, className: "events-welcome__state-mark" })
        : eventsArt("tick", 16, "events-welcome__state-mark");
  chip.replaceChildren(mark, el("span", "", WELCOME_STATE_TEXT[state]));
};

/**
 * Brings a reward used today back at the daily reset (the panel's tick): a
 * row waiting on `data-back-at` turns Ready today once `now` reaches it.
 */
export const paintWelcomeReward = (row: HTMLElement, now: number): void => {
  const backAt = Number(row.dataset["backAt"]);
  if (!Number.isFinite(backAt) || now < backAt) return;
  delete row.dataset["backAt"];
  paintRewardState(row, "ready");
};

/** One reward row: its picture, its short name and figure, how many are left of 7, and today's state. */
const reward = (
  src: string,
  alt: string,
  name: string,
  figure: string,
  key: string,
  left: number,
  sets: number,
  usedToday: boolean,
  nextDayAt: number,
  now: number,
): HTMLElement => {
  const row = el("li", "events-welcome__reward");
  row.dataset["reward"] = key;
  const words = el("div", "events-welcome__words");
  const figures = el("span", "events-welcome__figures");
  figures.append(el("span", "events-welcome__figure", figure), el("span", "events-welcome__left", welcomeLeftText(left, sets)));
  words.append(el("span", "events-welcome__name", name), figures);
  row.append(picture(src, alt), words, el("span", "events-welcome__state"));
  const state: RewardState = left <= 0 ? "done" : usedToday ? "today" : "ready";
  paintRewardState(row, state);
  if (state === "today") {
    row.dataset["backAt"] = String(nextDayAt);
    paintWelcomeReward(row, now);
  }
  return row;
};

/** A day mark's state: gone, today or still to come. */
const markState = (day: number, today: number): "gone" | "today" | "left" =>
  day < today ? "gone" : day === today ? "today" : "left";

const MARK_STATES = ["gone", "today", "left"] as const;

/**
 * Brings the timeline's marks to `now` (the panel's tick): the day that is
 * today lit, the days before it gone. Its own start is on the list.
 */
export const paintWelcomeTimeline = (timeline: HTMLElement, now: number): void => {
  const today = welcomeDay(Number(timeline.dataset["welcomeStart"]), now);
  timeline.setAttribute("aria-label", `Day ${today} of ${WELCOME_DAYS}`);
  for (const mark of timeline.querySelectorAll<HTMLElement>("[data-day]")) {
    const state = markState(Number(mark.dataset["day"]), today);
    for (const name of MARK_STATES) mark.classList.toggle(`events-welcome__mark--${name}`, name === state);
    if (state === "today") mark.setAttribute("aria-current", "date");
    else mark.removeAttribute("aria-current");
  }
};

/** A reward's picture and words, for the days it was used on the timeline. */
interface UsedKind {
  readonly key: string;
  readonly src: string;
  readonly words: string;
  readonly days: ReadonlySet<number>;
}

/**
 * The 10 days as marks in a row on a track: each day's number in a dot, the
 * days gone filled, today lit and bigger, the days left hollow; over each day
 * a reward was used, its picture (one per reward a day). Numbers and
 * pictures, no words (the words on hover and for a screen reader).
 */
const timeline = (status: Mr2WelcomeStatus, now: number): HTMLElement => {
  const list = el("ol", "events-welcome__timeline");
  list.dataset["welcomeStart"] = String(status.startsAt);
  const daysOf = (uses: readonly number[]) => new Set(uses.map((at) => welcomeDay(status.startsAt, at)));
  const kinds: UsedKind[] = [
    { key: "takeover", src: FIRST_OPEN_ART, words: "Wild camp takeover used", days: daysOf(status.takeoverUses) },
    { key: "kit", src: KIT_THUMBNAIL, words: "Regular Starter Kit used", days: daysOf(status.kitUses) },
  ];
  for (let day = 1; day <= WELCOME_DAYS; day++) {
    const mark = el("li", "events-welcome__mark");
    mark.dataset["day"] = String(day);
    const onDay = kinds.filter((kind) => kind.days.has(day));
    const slot = el("span", "events-welcome__mark-used");
    for (const kind of onDay) {
      const image = picture(kind.src, "");
      image.className = "events-welcome__mark-picture";
      image.dataset["usedReward"] = kind.key;
      image.width = 22;
      image.height = 22;
      slot.append(image);
    }
    const dot = el("span", "events-welcome__mark-dot", String(day));
    const words = [`Day ${day}`, onDay.map((kind) => kind.words).join(", ")].filter(Boolean).join(": ");
    mark.title = words;
    mark.setAttribute("aria-label", words);
    mark.append(slot, dot);
    list.append(mark);
  }
  paintWelcomeTimeline(list, now);
  return list;
};

const helpLine = (icon: HTMLElement, text: string): HTMLElement => {
  const line = el("li", "events-welcome__help-line");
  line.append(icon, el("span", "", text));
  return line;
};

/**
 * The card. `onGo` opens Map Room 2. The "?" shows and hides the note in
 * place, so it works the same on a phone.
 */
export const mr2WelcomeCard = (status: Mr2WelcomeStatus, now: number, onGo: () => void): HTMLElement => {
  const card = el("article", "events-card events-card--mr2-welcome");
  card.dataset["event"] = "mr2-welcome";

  const head = el("div", "events-card__head events-welcome__head");
  const title = el("h3", "events-card__title", WELCOME_TITLE);
  const days = el("p", "events-card__countdown events-welcome__days");
  days.append(gameIcon("time", { size: 24, decorative: true, className: "events-welcome__time" }));
  const daysText = el("span", "events-welcome__days-text", welcomeDaysText(status.endsAt, now));
  daysText.dataset["welcomeEnds"] = String(status.endsAt);
  days.append(daysText);

  const help = el("button", "btn btn--ghost events-welcome__help-button", "?");
  help.type = "button";
  help.setAttribute("aria-label", "What is the Frontier Pass?");
  help.setAttribute("aria-expanded", "false");
  help.title = "What is the Frontier Pass?";
  head.append(title, days, help);

  const note = el("div", "events-welcome__help");
  note.id = "events-welcome-help";
  note.hidden = true;
  help.setAttribute("aria-controls", note.id);
  const lines = el("ul", "events-welcome__help-lines");
  lines.append(
    helpLine(picture(FIRST_OPEN_ART, ""), WELCOME_HELP.takeover),
    helpLine(picture(KIT_THUMBNAIL, ""), WELCOME_HELP.kit),
    helpLine(gameIcon("time", { size: 24, decorative: true }), WELCOME_HELP.days),
  );
  note.append(el("p", "events-welcome__help-lead", WELCOME_HELP.lead), lines);
  help.addEventListener("click", () => {
    note.hidden = !note.hidden;
    help.setAttribute("aria-expanded", String(!note.hidden));
  });

  const sets = status.sets;
  const rewards = el("ul", "events-welcome__rewards");
  rewards.append(
    reward(FIRST_OPEN_ART, "An outpost", "Wild camp takeover", "10% price", "takeover", status.takeoverLeft, sets, status.takeoverToday, status.nextDayAt, now),
    reward(KIT_THUMBNAIL, "The Regular Starter Kit", "Regular Starter Kit", "Free", "kit", status.kitLeft, sets, status.kitToday, status.nextDayAt, now),
  );

  card.append(head, note, timeline(status, now), rewards);

  // Nothing ready today: nothing to do on Map Room 2 for the pass until tomorrow.
  if (status.takeover || status.kit) {
    const go = el("button", "btn btn--primary events-welcome__go", "Go to Map Room 2");
    go.type = "button";
    go.addEventListener("click", () => onGo());
    card.append(go);
  }
  return card;
};
