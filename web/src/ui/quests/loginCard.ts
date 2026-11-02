import type { QuestsView } from "@/api/quests";
import { loginDays } from "@/game/quests/questsModel";
import { eventsArt } from "@/ui/events/eventsArt";
import { formatCountdown } from "@/ui/format";
import { resourceIcon } from "@/ui/resourceIcon";
import { el, refusalNote } from "./dom";

/**
 * The 7-day login card (owner decision 3): a row of seven days with their
 * Shiny, today's lit, and one Claim. Shared by the Today tab and the pop-up
 * on the first yard load of the UTC day.
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

export const loginCard = (options: LoginCardOptions): HTMLElement => {
  const { login } = options;
  const section = el("section", "quests-login");
  const head = el("div", "quests-section__head");
  head.append(
    el("h3", "quests-section__title", "Daily login"),
    el("span", "quests-section__count", `${login.onCard}/${login.shiny.length}`),
  );

  const grid = el("ol", "quests-login__days");
  for (const day of loginDays(login)) {
    const tile = el("li", `quests-day quests-day--${day.state}${day.day === login.shiny.length ? " quests-day--last" : ""}`);
    tile.dataset["day"] = String(day.day);
    const status =
      day.state === "claimed" ? "claimed" : day.state === "today" ? "ready to claim" : day.state === "next" ? "tomorrow" : "later";
    tile.setAttribute("aria-label", `Day ${day.day}, ${day.shiny} Shiny, ${status}`);
    tile.title = `Day ${day.day}: ${day.shiny} Shiny`;
    tile.append(
      el("span", "quests-day__label", `${day.day}`),
      resourceIcon("shiny", { decorative: true, tooltip: false }),
      el("span", "quests-day__shiny", String(day.shiny)),
    );
    if (day.state === "claimed") tile.append(eventsArt("tick", 16, "quests-day__mark"));
    grid.append(tile);
  }
  section.append(head, grid);

  if (!login.claimedToday) {
    const shiny = login.shiny[login.day - 1] ?? 0;
    const button = el("button", "btn btn--primary quests-claim quests-login__claim");
    button.type = "button";
    button.dataset["claim"] = LOGIN_KEY;
    button.setAttribute("aria-label", `Claim day ${login.day}: ${shiny} Shiny`);
    button.append(
      el("span", "quests-claim__label", `Claim day ${login.day}`),
      resourceIcon("shiny", { decorative: true, tooltip: false }),
      el("span", "quests-claim__figure", `+${shiny}`),
    );
    button.disabled = options.busy !== null;
    if (options.busy === LOGIN_KEY) button.classList.add("quests-claim--busy");
    button.addEventListener("click", () => options.onClaim());
    section.append(button);
  } else {
    const note = el("p", "quests-login__note", nextDayText(options.nextDayAt - options.now));
    note.dataset["nextDay"] = String(options.nextDayAt);
    section.append(note);
  }
  if (options.refusal?.key === LOGIN_KEY) section.append(refusalNote(options.refusal.message));
  return section;
};
