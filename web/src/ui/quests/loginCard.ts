import type { QuestsView } from "@/api/quests";
import { loginDays, type LoginDay } from "@/game/quests/questsModel";
import { eventsArt } from "@/ui/events/eventsArt";
import { formatCountdown } from "@/ui/format";
import { resourceIcon } from "@/ui/resourceIcon";
import { el, refusalNote } from "./dom";

/**
 * The 7-day login card (owner decision 3): seven days with their Shiny,
 * today's lit, and one Claim. Shared by the Today tab and the pop-up on the
 * first yard load of the UTC day.
 *
 * Owner, 2 Nov ("can the daily login portion be improved UI/UX wise?"): each
 * day reads at a glance by its state alone (claimed: dimmed with a green
 * tick; today: raised, glowing and tappable; tomorrow, once today is
 * claimed: a clock; later: plain), day 7 is the big gold prize, and the
 * strip under the days is today's Claim with its Shiny, or, once claimed,
 * the time left to the next day. A phone held upright shows the days in two
 * rows (1-4, then 5, 6 and a wide day 7) so the Shiny stays big.
 */

/** The claim's key, for `busy` and `refusal`. */
export const LOGIN_KEY = "login";

export interface LoginCardOptions {
  readonly login: QuestsView["login"];
  /** The next 00:00 UTC, unix s, for "Next day in …". */
  readonly nextDayAt: number;
  /** Server time, unix s. */
  readonly now: number;
  /** The claim waiting on the server, by key. */
  readonly busy: string | null;
  readonly refusal: { readonly key: string; readonly message: string } | null;
  onClaim(): void;
}

/** "Next day in 5h 3m". */
export const nextDayText = (seconds: number): string =>
  seconds > 0 ? `Next day in ${formatCountdown(seconds)}` : "Next day is ready";

const STATUS: Readonly<Record<LoginDay["state"], string>> = {
  claimed: "claimed",
  today: "ready to claim",
  next: "tomorrow",
  later: "later",
};

const dayTile = (day: LoginDay, last: boolean, options: LoginCardOptions): HTMLElement => {
  const tile = el("li", `quests-day quests-day--${day.state}${last ? " quests-day--last" : ""}`);
  tile.dataset["day"] = String(day.day);
  tile.setAttribute("aria-label", `Day ${day.day}, ${day.shiny} Shiny, ${STATUS[day.state]}`);
  tile.title = `Day ${day.day}: ${day.shiny} Shiny`;

  const prize = el("span", "quests-day__prize");
  prize.append(resourceIcon("shiny", { decorative: true, tooltip: false }), el("span", "quests-day__shiny", String(day.shiny)));
  tile.append(el("span", "quests-day__label", String(day.day)), prize);

  if (day.state === "claimed") {
    const mark = el("span", "quests-day__mark");
    mark.append(eventsArt("tick", 14, "quests-day__tick"));
    tile.append(mark);
  } else if (day.state === "next") {
    const soon = el("span", "quests-day__soon");
    soon.append(eventsArt("clock", 12, "quests-day__clock"));
    tile.append(soon);
  } else if (day.state === "today") {
    // The day itself claims too: the big button under the days is the one
    // keyboards and screen readers use, so this one stays out of their way.
    tile.addEventListener("click", () => {
      if (options.busy === null) options.onClaim();
    });
  }
  return tile;
};

export const loginCard = (options: LoginCardOptions): HTMLElement => {
  const { login } = options;
  const section = el("section", `quests-login quests-login--${login.claimedToday ? "done" : "ready"}`);
  const head = el("div", "quests-section__head");
  head.append(
    el("h3", "quests-section__title", "Daily login"),
    el("span", "quests-section__count", `${login.onCard}/${login.shiny.length}`),
  );

  const grid = el("ol", "quests-login__days");
  for (const day of loginDays(login)) grid.append(dayTile(day, day.day === login.shiny.length, options));
  section.append(head, grid);

  if (!login.claimedToday) {
    const shiny = login.shiny[login.day - 1] ?? 0;
    const button = el("button", "btn btn--primary quests-claim quests-login__claim");
    button.type = "button";
    button.dataset["claim"] = LOGIN_KEY;
    button.setAttribute("aria-label", `Claim day ${login.day}: ${shiny} Shiny`);
    button.append(
      el("span", "quests-claim__label", "Claim"),
      resourceIcon("shiny", { decorative: true, tooltip: false }),
      el("span", "quests-claim__figure", `+${shiny}`),
    );
    button.disabled = options.busy !== null;
    if (options.busy === LOGIN_KEY) button.classList.add("quests-claim--busy");
    button.addEventListener("click", () => options.onClaim());
    section.append(button);
  } else {
    const note = el("p", "quests-login__note");
    const words = el("span", "quests-login__wait", nextDayText(options.nextDayAt - options.now));
    words.dataset["nextDay"] = String(options.nextDayAt);
    note.append(eventsArt("clock", 18, "quests-login__clock"), words);
    section.append(note);
  }
  if (options.refusal?.key === LOGIN_KEY) section.append(refusalNote(options.refusal.message));
  return section;
};
