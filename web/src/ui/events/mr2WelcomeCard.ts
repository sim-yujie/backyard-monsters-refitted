import type { Mr2WelcomeStatus } from "@/api/events";
import { FIRST_OPEN_ART } from "@/game/maproom/takeover";
import { STARTER_KIT_SUMMARIES } from "@/game/yard/starterKits";
import { gameIcon } from "@/ui/gameIcon";
import { eventsArt } from "./eventsArt";

/**
 * The "New to Map Room 2" card on the Events page (owner, 9 Nov 2026): while
 * the player's 10 days run, the days left, the cheap first wild takeover and
 * the free Regular kit (each Ready or Used), a Go to Map Room 2 button, and a
 * "?" that opens a short note on why the takeover is so cheap and the kit
 * free. Short words, pictures and numbers (owner prefers little text).
 *
 * The server decides everything (`GET /bm/events` `mr2Welcome`, null when the
 * days are over or both rewards are used, and then there is no card).
 */

const DAY = 86_400;

export const WELCOME_TITLE = "New to Map Room 2";

/** The "?" note: one lead line, then one line per reward and one for the days. */
export const WELCOME_HELP = {
  lead: "A head start for new Map Room 2 players.",
  takeover: "1st wild camp takeover: 10% of the resources. Shiny price as usual.",
  kit: "1 Regular Starter Kit free, on any outpost. Builds over time, no worker.",
  days: "10 days from joining Map Room 2. Once each.",
} as const;

/** "8 days left", "1 day left", from the server's end and clock. */
export const welcomeDaysText = (endsAt: number, now: number): string => {
  const days = Math.max(1, Math.ceil((endsAt - now) / DAY));
  return days === 1 ? "1 day left" : `${days} days left`;
};

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

/** One reward row: its picture, its short name and figure, Ready or Used. */
const reward = (src: string, alt: string, name: string, figure: string, ready: boolean, key: string): HTMLElement => {
  const row = el("li", `events-welcome__reward${ready ? "" : " events-welcome__reward--used"}`);
  row.dataset["reward"] = key;
  const words = el("div", "events-welcome__words");
  words.append(el("span", "events-welcome__name", name), el("span", "events-welcome__figure", figure));
  // A gift and "Ready", or the claimed tick and "Used": the mark carries it, the word is short.
  const state = el("span", `events-welcome__state events-welcome__state--${ready ? "ready" : "used"}`);
  state.append(eventsArt(ready ? "gift" : "tick", 16, "events-welcome__state-mark"), el("span", "", ready ? "Ready" : "Used"));
  row.append(picture(src, alt), words, state);
  return row;
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
  help.setAttribute("aria-label", "Why is this so cheap?");
  help.setAttribute("aria-expanded", "false");
  help.title = "Why is this so cheap?";
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

  const rewards = el("ul", "events-welcome__rewards");
  rewards.append(
    reward(FIRST_OPEN_ART, "An outpost", "Wild camp takeover", "10% price", status.takeover, "takeover"),
    reward(KIT_THUMBNAIL, "The Regular Starter Kit", "Regular Starter Kit", "Free", status.kit, "kit"),
  );

  const go = el("button", "btn btn--primary events-welcome__go", "Go to Map Room 2");
  go.type = "button";
  go.addEventListener("click", () => onGo());

  card.append(head, note, rewards, go);
  return card;
};
