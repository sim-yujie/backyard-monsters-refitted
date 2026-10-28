import type { EventReward, EventView, LadderView } from "@/api/events";
import {
  calendarDays,
  claimableTiers,
  countdownText,
  krallenPrizeText,
  rewardText,
  shortAmount,
  sortEvents,
  type CalendarDayView,
} from "@/game/events/eventsModel";
import { championPortrait, showPortrait } from "@/game/portraits";
import { ArtState, resolveArt } from "@/game/yard/buildingArt";
import { typeName } from "@/game/yard/planner/summary";
import { formatAmount, formatCountdown } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { resourceIcon, RESOURCE_KEYS } from "@/ui/resourceIcon";
import { eventsArt } from "./eventsArt";
import "./events.css";

/**
 * The Events page: every event on now with its banner, a countdown to its
 * end and its daily login calendar (14 days, one claim per UTC day), its
 * collection ladder when it has one, then "Coming up" with a countdown to
 * each start.
 *
 * A view only: the plugin (`game/yard/plugins/events.ts`) reads the list,
 * claims, and calls {@link EventsPanel.tick} every second so the countdowns
 * run on the server's clock.
 *
 * The ladder is drawn from the list's `ladder` (server `events.ts`): an event
 * that gets one (the pumpkin hunt) shows it here with no change to this file.
 * An event that pays Krallen (the monthly Krallen Hunt) draws its one tier as
 * a progress bar toward the goal instead, with the prize for this player's
 * Krallen level, why they cannot take part yet, and the claim. Such an event
 * stays listed after its end while its reward can still be claimed.
 * Anything else an event needs on the page goes in the slot
 * `.events-card__extra[data-event=<id>]` through {@link EVENT_EXTRAS}.
 */

/** What an event's own feature can add to its card, keyed by event kind. */
export type EventExtra = (event: EventView) => HTMLElement | null;
export const EVENT_EXTRAS = new Map<string, EventExtra>();

/** A claim's key: `calendar:<event>` or `tier:<event>:<index>`. */
export const calendarKey = (event: string): string => `calendar:${event}`;
export const tierKey = (event: string, tier: number): string => `tier:${event}:${tier}`;

export type EventsPanelView =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "list";
      readonly events: readonly EventView[];
      /** Server time, unix s. */
      readonly now: number;
      /** The claim waiting on the server, by key. */
      readonly claiming: string | null;
      /** A refusal to show under its claim. */
      readonly refusal: { readonly key: string; readonly message: string } | null;
    };

export interface EventsPanelOptions {
  onClaimCalendar(event: EventView): void;
  onClaimTier(event: EventView, tier: number): void;
  onRetry(): void;
  onClose(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** A decoration's name, as the yard names it. */
const decorationName = (type: number): string => typeName(type);

/** The words for a list of rewards: "10,000 Twigs, 10,000 Pebbles + 25 Shiny". */
export const rewardsText = (rewards: readonly EventReward[]): string =>
  rewards.map((reward) => rewardText(reward, decorationName)).join(" + ");

/**
 * A claim's notice: "Day 3 claimed" and the rewards as the panel's own
 * pictures and short figures, "[twig][pebble] 1K"; the full words
 * ("Day 3 claimed: 1,000 Twigs + 1,000 Pebbles") on hover and for a screen
 * reader.
 */
export const claimedLine = (title: string, rewards: readonly EventReward[]): HTMLElement => {
  const words = rewards.length > 0 ? `${title}: ${rewardsText(rewards)}` : title;
  const line = el("span", "events-claimed");
  line.setAttribute("role", "img");
  line.setAttribute("aria-label", words);
  line.title = words;
  line.append(el("span", "events-claimed__title", title), ...rewards.map(rewardBadge));
  return line;
};

/** A small picture for one reward, and its short figure. */
const rewardBadge = (reward: EventReward): HTMLElement => {
  const badge = el("span", `events-reward events-reward--${reward.kind}`);
  const pictures = el("span", "events-reward__pictures");
  let figure = "";
  switch (reward.kind) {
    case "resources": {
      const amounts = RESOURCE_KEYS.flatMap((key) => {
        const amount = reward.amounts[key] ?? 0;
        return amount > 0 ? [[key, amount] as const] : [];
      });
      for (const [key] of amounts) pictures.append(resourceIcon(key, { decorative: true }));
      const values = [...new Set(amounts.map(([, amount]) => amount))];
      figure = values.map((amount) => shortAmount(amount)).join("/");
      break;
    }
    case "shiny":
      pictures.append(resourceIcon("shiny", { decorative: true }));
      figure = shortAmount(reward.amount);
      break;
    case "speedup":
      pictures.append(eventsArt("clock", 20));
      figure = `${reward.item === "SP3" ? "-2h" : "-1h"}${reward.count > 1 ? ` x${reward.count}` : ""}`;
      break;
    case "shopItem":
      pictures.append(eventsArt("tools", 20));
      figure = reward.item === "BST" ? "7d" : "";
      break;
    case "krallen":
      pictures.append(krallenPicture(1, "icon", "events-reward__image"));
      break;
    case "decoration": {
      const art = resolveArt(reward.type, 1, ArtState.DEFAULT);
      if (art) {
        const image = el("img", "events-reward__image");
        image.src = art.top.url;
        image.alt = "";
        image.decoding = "async";
        pictures.append(image);
      } else {
        pictures.append(eventsArt("gift", 20));
      }
      figure = reward.count > 1 ? `x${reward.count}` : "";
      break;
    }
  }
  badge.append(pictures);
  if (figure) badge.append(el("span", "events-reward__figure", figure));
  return badge;
};

/** Krallen's portrait at a level. */
const krallenPicture = (level: number, size: "card" | "icon", className: string): HTMLImageElement => {
  const image = el("img", className);
  showPortrait(image, championPortrait("G5", level, size));
  image.alt = "";
  image.decoding = "async";
  return image;
};

/** The event's banner picture; nothing when it has none or the file is missing. */
const banner = (event: EventView): HTMLElement[] => {
  if (!event.banner) return [];
  const band = el("div", `events-card__banner events-card__banner--${event.kind}`);
  const image = el("img", "events-card__banner-image");
  image.src = event.banner;
  image.alt = "";
  image.decoding = "async";
  image.addEventListener("error", () => band.remove(), { once: true });
  band.append(image);
  return [band];
};

/** A countdown line the panel's `tick` keeps running. */
const countdown = (event: EventView, now: number): HTMLElement => {
  const line = el("p", "events-card__countdown", countdownText(event, now));
  line.dataset["countdown"] = event.status;
  line.dataset["startsAt"] = String(event.startsAt);
  line.dataset["endsAt"] = String(event.endsAt);
  if (event.claimUntil !== null) line.dataset["claimUntil"] = String(event.claimUntil);
  return line;
};

export class EventsPanel {
  readonly element: HTMLElement;
  private readonly panel: Panel;
  private readonly options: EventsPanelOptions;

  constructor(options: EventsPanelOptions) {
    this.options = options;
    this.panel = new Panel({
      title: "Events",
      className: "events-panel",
      closeOnEscape: true,
      onClose: () => options.onClose(),
    });
    this.element = this.panel.element;
    this.render({ kind: "loading" });
  }

  mount(container: HTMLElement): this {
    this.panel.mount(container);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /** Moves every countdown on to `now` (server time, unix s). */
  tick(now: number): void {
    for (const line of this.element.querySelectorAll<HTMLElement>("[data-countdown]")) {
      const { countdown: status, startsAt, endsAt, claimUntil } = line.dataset;
      line.textContent = countdownText(
        {
          status: status === "active" || status === "ended" ? status : "upcoming",
          startsAt: Number(startsAt),
          endsAt: Number(endsAt),
          claimUntil: claimUntil === undefined ? null : Number(claimUntil),
        },
        now,
      );
    }
    for (const line of this.element.querySelectorAll<HTMLElement>("[data-next-at]")) {
      line.textContent = nextText(Number(line.dataset["nextAt"]) - now);
    }
  }

  render(view: EventsPanelView): void {
    if (view.kind === "loading") {
      this.panel.setContent(el("p", "events-status", "Loading events…"));
      return;
    }
    if (view.kind === "error") {
      const retry = el("button", "btn events-status__retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => this.options.onRetry());
      const box = el("div", "events-status");
      box.append(el("p", "events-status__text", view.message), retry);
      this.panel.setContent(box);
      return;
    }

    const { active, upcoming } = sortEvents(view.events);
    const sections: HTMLElement[] = [];
    for (const event of active) sections.push(this.activeCard(event, view));
    if (active.length === 0) sections.push(el("p", "events-status", "No event is on right now."));
    if (upcoming.length > 0) {
      const section = el("section", "events-upcoming");
      const list = el("ul", "events-upcoming__list");
      for (const event of upcoming) {
        const item = el("li", "events-upcoming__item");
        item.dataset["event"] = event.id;
        item.append(
          el("h4", "events-upcoming__title", event.title),
          el("p", "events-upcoming__text", event.text),
          countdown(event, view.now),
        );
        list.append(item);
      }
      section.append(el("h3", "events-section__title", "Coming up"), list);
      sections.push(section);
    }
    // Keep the scroll where it was: a claim re-renders the whole page.
    const scroll = this.panel.body.scrollTop;
    this.panel.setContent(...sections);
    this.panel.body.scrollTop = scroll;
  }

  private activeCard(event: EventView, view: Extract<EventsPanelView, { kind: "list" }>): HTMLElement {
    const ended = event.status === "ended" ? " events-card--ended" : "";
    const card = el("article", `events-card events-card--${event.kind}${ended}`);
    card.dataset["event"] = event.id;
    const head = el("div", "events-card__head");
    head.append(el("h3", "events-card__title", event.title), countdown(event, view.now));
    card.append(...banner(event), head, el("p", "events-card__text", event.text));
    if (event.calendar) card.append(this.calendar(event, view));
    // The collection ladder's place (the pumpkin hunt): drawn when the event has one.
    if (event.ladder && event.krallen) card.append(this.krallenHunt(event, event.ladder, event.krallen, view));
    else if (event.ladder) card.append(this.ladder(event, event.ladder, view));
    const extra = el("div", "events-card__extra");
    extra.dataset["event"] = event.id;
    const own = EVENT_EXTRAS.get(event.kind)?.(event);
    if (own) extra.append(own);
    card.append(extra);
    return card;
  }

  private calendar(event: EventView, view: Extract<EventsPanelView, { kind: "list" }>): HTMLElement {
    const calendar = event.calendar!;
    const section = el("section", "events-calendar");
    const total = calendar.days.length;
    const title = el("div", "events-calendar__head");
    title.append(
      el("h4", "events-section__title", "Daily treats"),
      el("span", "events-calendar__count", `${calendar.claimed} / ${total} claimed`),
    );
    const grid = el("ol", "events-calendar__grid");
    const days = calendarDays(calendar);
    for (const day of days) grid.append(this.dayTile(day));
    section.append(title);

    const key = calendarKey(event.id);
    const today = days.find((day) => day.state === "today");
    if (today) {
      const button = el("button", "btn btn--primary events-claim");
      button.type = "button";
      button.dataset["claim"] = key;
      button.append(
        el("span", "events-claim__label", `Claim day ${today.day}`),
        el("span", "events-claim__what", rewardsText(today.rewards)),
      );
      button.disabled = view.claiming !== null;
      if (view.claiming === key) button.classList.add("events-claim--busy");
      button.addEventListener("click", () => this.options.onClaimCalendar(event));
      section.append(button);
    } else if (calendar.claimed >= total) {
      section.append(el("p", "events-calendar__note", "Every treat claimed. See you next event!"));
    } else if (calendar.nextAt !== null) {
      const note = el("p", "events-calendar__note", nextText(calendar.nextAt - view.now));
      note.dataset["nextAt"] = String(calendar.nextAt);
      section.append(note);
    }
    if (view.refusal?.key === key) section.append(refusalNote(view.refusal.message));
    // The claim first, the days under it: on a short screen the button must not hide below the fold.
    section.append(grid);
    return section;
  }

  private dayTile(day: CalendarDayView): HTMLElement {
    const tile = el("li", `events-day events-day--${day.state}`);
    tile.dataset["day"] = String(day.day);
    const words = rewardsText(day.rewards);
    const status =
      day.state === "claimed"
        ? "claimed"
        : day.state === "today"
          ? "ready to claim"
          : day.state === "tomorrow"
            ? "opens tomorrow"
            : "not open yet";
    tile.title = `Day ${day.day}: ${words}`;
    tile.setAttribute("aria-label", `Day ${day.day}, ${status}: ${words}`);
    const label = el("span", "events-day__label", `Day ${day.day}`);
    const rewards = el("span", "events-day__rewards");
    for (const reward of day.rewards) rewards.append(rewardBadge(reward));
    tile.append(label, rewards);
    if (day.state === "claimed") tile.append(eventsArt("tick", 18, "events-day__mark"));
    return tile;
  }

  private ladder(event: EventView, ladder: LadderView, view: Extract<EventsPanelView, { kind: "list" }>): HTMLElement {
    const section = el("section", "events-ladder");
    const head = el("div", "events-calendar__head");
    head.append(
      el("h4", "events-section__title", ladder.label),
      el("span", "events-calendar__count", shortAmount(ladder.counter)),
    );
    const list = el("ol", "events-ladder__list");
    const ready = new Set(claimableTiers(ladder));
    ladder.tiers.forEach((tier, index) => {
      const key = tierKey(event.id, index);
      const row = el("li", `events-tier${tier.claimed ? " events-tier--claimed" : ready.has(index) ? " events-tier--ready" : ""}`);
      row.dataset["tier"] = String(index);
      const need = el("span", "events-tier__need", `${shortAmount(Math.min(ladder.counter, tier.need))} / ${shortAmount(tier.need)}`);
      const rewards = el("span", "events-tier__rewards");
      for (const reward of tier.rewards) rewards.append(rewardBadge(reward));
      rewards.title = rewardsText(tier.rewards);
      row.append(need, rewards);
      if (tier.claimed) {
        row.append(eventsArt("tick", 18, "events-tier__mark"));
      } else if (ready.has(index)) {
        const button = el("button", "btn btn--primary events-tier__claim", "Claim");
        button.type = "button";
        button.dataset["claim"] = key;
        button.disabled = view.claiming !== null;
        button.addEventListener("click", () => this.options.onClaimTier(event, index));
        row.append(button);
      } else {
        row.append(eventsArt("lock", 18, "events-tier__mark"));
      }
      list.append(row);
      if (view.refusal?.key === key) list.append(refusalNote(view.refusal.message));
    });
    section.append(head, list);
    return section;
  }

  /** The Krallen Hunt: the prize, then the bar toward the goal and the claim, or why the player cannot take part. */
  private krallenHunt(
    event: EventView,
    ladder: LadderView,
    krallen: NonNullable<EventView["krallen"]>,
    view: Extract<EventsPanelView, { kind: "list" }>,
  ): HTMLElement {
    const section = el("section", "events-krallen");
    const tier = ladder.tiers[0];
    const maxed = krallen.level >= krallen.maxLevel;

    const prize = el("div", `events-krallen__prize${maxed ? " events-krallen__prize--maxed" : ""}`);
    const words = el("div", "events-krallen__words");
    // Claimed this month: the line says what the next hunt pays.
    const prizeText = tier?.claimed && !maxed ? `Next hunt: ${krallenPrizeText(krallen)}` : krallenPrizeText(krallen);
    words.append(el("h4", "events-section__title", "The prize"), el("p", "events-krallen__prize-text", prizeText));
    // Her level now, when the prize line does not already say it in other words.
    if (krallen.level > 0 && !maxed) words.append(el("p", "events-krallen__level", `Your Krallen is level ${krallen.level}`));
    prize.append(krallenPicture(Math.max(1, krallen.level), "card", "events-krallen__portrait"), words);
    section.append(prize);

    if (event.locked !== null) {
      const note = el("p", "events-krallen__locked");
      note.append(eventsArt("lock", 18, "events-krallen__lock"), el("span", "", event.locked));
      section.append(note);
      return section;
    }
    if (!tier) return section;

    const progress = el("div", "events-krallen__progress");
    const head = el("div", "events-calendar__head");
    const reached = Math.min(ladder.counter, tier.need);
    head.append(
      el("h4", "events-section__title", ladder.label),
      el("span", "events-calendar__count", `${shortAmount(reached)} / ${shortAmount(tier.need)}`),
    );
    const share = tier.need > 0 ? reached / tier.need : 1;
    const bar = el("div", "events-krallen__bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", ladder.label);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(tier.need));
    bar.setAttribute("aria-valuenow", String(reached));
    bar.setAttribute("aria-valuetext", `${formatAmount(ladder.counter)} of ${formatAmount(tier.need)}`);
    const fill = el("span", "events-krallen__fill");
    fill.style.width = `${Math.round(share * 1000) / 10}%`;
    bar.append(fill);
    progress.append(head, bar);
    section.append(progress);

    const key = tierKey(event.id, 0);
    if (tier.claimed) {
      const done = el("p", "events-krallen__done");
      done.append(eventsArt("tick", 18, "events-krallen__tick"), el("span", "", "Prize claimed. The next hunt starts on the 15th."));
      section.append(done);
    } else if (ladder.counter >= tier.need && !maxed) {
      const button = el("button", "btn btn--primary events-claim events-krallen__claim");
      button.type = "button";
      button.dataset["claim"] = key;
      button.append(
        el("span", "events-claim__label", krallen.level > 0 ? `Raise Krallen to level ${krallen.level + 1}` : "Claim Krallen"),
        el("span", "events-claim__what", "Goal reached!"),
      );
      button.disabled = view.claiming !== null;
      if (view.claiming === key) button.classList.add("events-claim--busy");
      button.addEventListener("click", () => this.options.onClaimTier(event, 0));
      section.append(button);
    }
    if (view.refusal?.key === key) section.append(refusalNote(view.refusal.message));
    return section;
  }
}

/** "Next treat in 5h 3m". */
export const nextText = (seconds: number): string =>
  seconds > 0 ? `Next treat in ${formatCountdown(seconds)}` : "Next treat is ready: reopen Events";

const refusalNote = (message: string): HTMLElement => {
  const note = el("p", "events-refusal", message);
  note.setAttribute("role", "alert");
  return note;
};
