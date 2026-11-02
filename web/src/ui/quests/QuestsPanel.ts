import type { QuestPeriod, QuestSetView, QuestsView, QuestView } from "@/api/quests";
import { showPortrait, type Portrait } from "@/game/portraits";
import {
  BONUS_PICTURE,
  canSwap,
  lootResource,
  pictureFillsTile,
  progressShare,
  progressText,
  questHint,
  questPicture,
  questTitle,
  tabClaimable,
} from "@/game/quests/questsModel";
import { eventsArt } from "@/ui/events/eventsArt";
import { rewardBadge } from "@/ui/events/EventsPanel";
import { formatCountdown } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { resourceIcon } from "@/ui/resourceIcon";
import { el, refusalNote } from "./dom";
import { loginCard, nextDayText } from "./loginCard";
import "./quests.css";

/**
 * The Quests window (beta 6, owner decision 8): one window with tabs.
 *
 * - **Today**: the 7-day login card on top with its Claim, then the 5 daily
 *   quests (picture, words naming what they are about, a progress bar, the
 *   reward, Claim / done / the one free Swap), the all-5 bonus, and the
 *   countdown to 00:00 UTC.
 * - **Weekly**: the 3 weekly quests, the all-3 bonus, and the countdown to
 *   Monday 00:00 UTC.
 *
 * A view only: the plugin (`game/yard/plugins/quests.ts`) reads, claims,
 * swaps and calls {@link QuestsPanel.tick} every second. More tabs (Goals,
 * Achievements, Event) can be added to {@link QUESTS_TABS} later.
 */

export type QuestsTab = "today" | "weekly";

export const QUESTS_TABS: readonly { readonly id: QuestsTab; readonly label: string }[] = [
  { id: "today", label: "Today" },
  { id: "weekly", label: "Weekly" },
];

export type QuestsPanelView =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "list";
      readonly quests: QuestsView;
      /** Server time, unix s. */
      readonly now: number;
      /** The claim or swap waiting on the server, by key. */
      readonly busy: string | null;
      readonly refusal: { readonly key: string; readonly message: string } | null;
    };

export interface QuestsPanelOptions {
  onClaimLogin(): void;
  onClaim(period: QuestPeriod, slot: number): void;
  onClaimBonus(period: QuestPeriod): void;
  onSwap(slot: number): void;
  onRetry(): void;
  onClose(): void;
  /** The tab to open on; Today by default. */
  readonly tab?: QuestsTab;
}

/** The keys a claim or swap goes by. */
export const questKey = (period: QuestPeriod, slot: number): string => `${period}:${slot}`;
export const bonusKey = (period: QuestPeriod): string => `bonus:${period}`;
export const swapKey = (slot: number): string => `swap:${slot}`;

/** "Resets in 5h 3m". */
export const resetText = (seconds: number): string =>
  seconds > 0 ? `Resets in ${formatCountdown(seconds)}` : "New quests: reopen Quests";

/**
 * The quest's picture on its tile. Every row's picture sits on the same
 * framed tile (owner, 2 Nov: "some quest images are white background while
 * some aren't"): see-through Flash art stands on the tile, the painted
 * monster squares fill it.
 */
const pictureTile = (art: Portrait): HTMLElement => {
  const frame = el("span", "quest__frame");
  const image = el("img", pictureFillsTile(art) ? "quest__picture quest__picture--fill" : "quest__picture");
  image.alt = "";
  image.decoding = "async";
  image.loading = "lazy";
  showPortrait(image, art);
  frame.append(image);
  return frame;
};

/**
 * A row's progress bar with its figures written on it ("2/3"), so the
 * figures never push the reward about.
 */
const progressBar = (label: string, have: number, need: number, share: number, figures: string): HTMLElement => {
  const bar = el("span", "quest__bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(need));
  bar.setAttribute("aria-valuenow", String(Math.min(have, need)));
  const fill = el("span", "quest__fill");
  fill.style.width = `${Math.round(share * 1000) / 10}%`;
  bar.append(fill, el("span", "quest__count", figures));
  return bar;
};

export class QuestsPanel {
  readonly element: HTMLElement;
  private readonly panel: Panel;
  private readonly options: QuestsPanelOptions;
  private readonly tabButtons = new Map<QuestsTab, HTMLButtonElement>();
  private readonly pane: HTMLElement;
  private active: QuestsTab;
  private last: QuestsPanelView = { kind: "loading" };

  constructor(options: QuestsPanelOptions) {
    this.options = options;
    this.active = options.tab ?? "today";
    this.panel = new Panel({
      title: "Quests",
      className: "quests-panel",
      closeOnEscape: true,
      onClose: () => options.onClose(),
    });
    this.element = this.panel.element;

    const strip = el("div", "tabs quests-tabs");
    strip.setAttribute("role", "tablist");
    strip.setAttribute("aria-label", "Quests");
    for (const { id, label } of QUESTS_TABS) {
      const tab = el("button", "tabs__tab quests-tabs__tab");
      tab.type = "button";
      tab.id = `quests-tab-${id}`;
      tab.dataset["tab"] = id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "quests-pane");
      const count = el("span", "quests-tabs__count");
      count.hidden = true;
      tab.append(el("span", "quests-tabs__label", label), count);
      tab.addEventListener("click", () => this.show(id));
      strip.append(tab);
      this.tabButtons.set(id, tab);
    }
    strip.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const ids = QUESTS_TABS.map((tab) => tab.id);
      const at = ids.indexOf(this.active);
      const next = ids[(at + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]!;
      this.show(next);
      this.tabButtons.get(next)?.focus();
      event.preventDefault();
    });

    this.pane = el("div", "quests-pane");
    this.pane.id = "quests-pane";
    this.pane.setAttribute("role", "tabpanel");
    this.panel.setContent(strip, this.pane);
    this.show(this.active);
  }

  get activeTab(): QuestsTab {
    return this.active;
  }

  mount(container: HTMLElement): this {
    this.panel.mount(container);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /** Brings a tab forward. */
  show(tab: QuestsTab): void {
    this.active = tab;
    this.element.dataset["tab"] = tab;
    for (const [id, button] of this.tabButtons) {
      const on = id === tab;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
    }
    this.pane.setAttribute("aria-labelledby", `quests-tab-${tab}`);
    this.pane.scrollTop = 0;
    this.render(this.last);
  }

  /** Moves the countdowns on to `now` (server time, unix s). */
  tick(now: number): void {
    for (const line of this.element.querySelectorAll<HTMLElement>("[data-resets-at]")) {
      line.textContent = resetText(Number(line.dataset["resetsAt"]) - now);
    }
    for (const line of this.element.querySelectorAll<HTMLElement>("[data-next-day]")) {
      line.textContent = nextDayText(Number(line.dataset["nextDay"]) - now);
    }
  }

  render(view: QuestsPanelView): void {
    this.last = view;
    if (view.kind === "loading") {
      this.pane.replaceChildren(el("p", "quests-status", "Loading quests…"));
      return;
    }
    if (view.kind === "error") {
      const retry = el("button", "btn quests-status__retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => this.options.onRetry());
      const box = el("div", "quests-status");
      box.append(el("p", "quests-status__text", view.message), retry);
      this.pane.replaceChildren(box);
      return;
    }

    for (const { id, label } of QUESTS_TABS) {
      const count = tabClaimable(view.quests, id);
      const button = this.tabButtons.get(id)!;
      const badge = button.querySelector<HTMLElement>(".quests-tabs__count")!;
      badge.hidden = count === 0;
      badge.textContent = String(count);
      button.setAttribute("aria-label", count > 0 ? `${label}, ${count} to claim` : label);
    }

    // Keep the scroll where it was: a claim re-renders the whole tab.
    const scroll = this.pane.scrollTop;
    this.pane.replaceChildren(...(this.active === "today" ? this.today(view) : this.weekly(view)));
    this.pane.scrollTop = scroll;
  }

  private today(view: Extract<QuestsPanelView, { kind: "list" }>): HTMLElement[] {
    const { quests } = view;
    return [
      loginCard({
        login: quests.login,
        nextDayAt: quests.nextDayAt,
        now: view.now,
        busy: view.busy,
        refusal: view.refusal,
        onClaim: () => this.options.onClaimLogin(),
      }),
      this.questSet("daily", "Daily quests", quests.daily, quests.nextDayAt, quests.daily.swapsLeft, view),
    ];
  }

  private weekly(view: Extract<QuestsPanelView, { kind: "list" }>): HTMLElement[] {
    const { quests } = view;
    return [this.questSet("weekly", "Weekly quests", quests.weekly, quests.nextWeekAt, 0, view)];
  }

  private questSet(
    period: QuestPeriod,
    title: string,
    set: QuestSetView,
    resetsAt: number,
    swapsLeft: number,
    view: Extract<QuestsPanelView, { kind: "list" }>,
  ): HTMLElement {
    const section = el("section", `quests-set quests-set--${period}`);
    section.dataset["period"] = period;
    const head = el("div", "quests-section__head");
    const reset = el("span", "quests-section__reset");
    reset.append(eventsArt("clock", 14, "quests-section__clock"));
    const resetWords = el("span", "", resetText(resetsAt - view.now));
    resetWords.dataset["resetsAt"] = String(resetsAt);
    reset.append(resetWords);
    head.append(el("h3", "quests-section__title", title), reset);
    section.append(head);

    if (set.quests.length === 0) {
      section.append(el("p", "quests-status", "No quests yet. Unlock more of your yard to get some."));
      return section;
    }

    const list = el("ol", "quests-list");
    for (const quest of set.quests) {
      list.append(this.row(period, quest, swapsLeft, view));
      const refused = view.refusal?.key;
      if (refused === questKey(period, quest.slot) || (period === "daily" && refused === swapKey(quest.slot))) {
        const item = el("li", "quests-list__note");
        item.append(refusalNote(view.refusal!.message));
        list.append(item);
      }
    }
    list.append(this.bonusRow(period, set, view));
    if (view.refusal?.key === bonusKey(period)) {
      const item = el("li", "quests-list__note");
      item.append(refusalNote(view.refusal.message));
      list.append(item);
    }
    section.append(list);
    if (period === "daily" && swapsLeft > 0 && set.quests.some((quest) => canSwap(quest, swapsLeft))) {
      section.append(el("p", "quests-set__swap-note", "1 free swap a day: tap Swap on a quest you don't like."));
    }
    return section;
  }

  private row(period: QuestPeriod, quest: QuestView, swapsLeft: number, view: Extract<QuestsPanelView, { kind: "list" }>): HTMLElement {
    const state = quest.claimed ? "claimed" : quest.ready ? "ready" : "open";
    const row = el("li", `quest quest--${state}`);
    row.dataset["slot"] = String(quest.slot);
    row.dataset["kind"] = quest.kind;
    const title = questTitle(quest);

    const art = el("span", "quest__art");
    art.append(pictureTile(questPicture(quest)));
    const loot = lootResource(quest.kind);
    if (loot) art.append(resourceIcon(loot, { decorative: true, tooltip: false }));

    const main = el("div", "quest__main");
    main.append(el("span", "quest__title", title));
    const hint = questHint(quest);
    if (hint) main.append(el("span", "quest__hint", hint));
    main.append(progressBar(title, quest.have, quest.need, progressShare(quest), progressText(quest)));

    // The reward has its own column, the same place on every row (owner,
    // 2 Nov: it sat on the bar's line on some rows and under it on others).
    const rewards = el("div", "quest__rewards");
    for (const reward of quest.rewards) rewards.append(rewardBadge(reward));

    const action = el("div", "quest__action");
    const key = questKey(period, quest.slot);
    if (quest.claimed) {
      action.append(eventsArt("tick", 22, "quest__done"));
      row.setAttribute("aria-label", `${title}: claimed`);
    } else if (quest.ready) {
      const claim = el("button", "btn btn--primary quests-claim quest__claim", "Claim");
      claim.type = "button";
      claim.dataset["claim"] = key;
      claim.setAttribute("aria-label", `Claim: ${title}`);
      claim.disabled = view.busy !== null;
      if (view.busy === key) claim.classList.add("quests-claim--busy");
      claim.addEventListener("click", () => this.options.onClaim(period, quest.slot));
      action.append(claim);
    } else if (period === "daily" && canSwap(quest, swapsLeft)) {
      const swap = el("button", "btn btn--ghost quest__swap", "Swap");
      swap.type = "button";
      swap.dataset["swap"] = String(quest.slot);
      swap.title = "Swap for another quest (1 free a day)";
      swap.setAttribute("aria-label", `Swap: ${title}`);
      swap.disabled = view.busy !== null;
      swap.addEventListener("click", () => this.options.onSwap(quest.slot));
      action.append(swap);
    }
    row.append(art, main, rewards, action);
    return row;
  }

  private bonusRow(period: QuestPeriod, set: QuestSetView, view: Extract<QuestsPanelView, { kind: "list" }>): HTMLElement {
    const total = set.quests.length;
    const done = set.quests.filter((quest) => quest.claimed || quest.have >= quest.need).length;
    const { bonus } = set;
    const state = bonus.claimed ? "claimed" : bonus.ready ? "ready" : "open";
    const row = el("li", `quest quest--bonus quest--${state}`);
    row.dataset["bonus"] = period;
    const title = `All ${total} done`;

    const art = el("span", "quest__art");
    art.append(pictureTile(BONUS_PICTURE));
    const main = el("div", "quest__main");
    main.append(el("span", "quest__title", title));
    main.append(progressBar(title, done, total, total > 0 ? done / total : 0, `${done}/${total}`));
    const rewards = el("div", "quest__rewards");
    rewards.append(rewardBadge({ kind: "shiny", amount: bonus.shiny }));

    const action = el("div", "quest__action");
    if (bonus.claimed) {
      action.append(eventsArt("tick", 22, "quest__done"));
    } else if (bonus.ready) {
      const key = bonusKey(period);
      const claim = el("button", "btn btn--primary quests-claim quest__claim", "Claim");
      claim.type = "button";
      claim.dataset["claim"] = key;
      claim.setAttribute("aria-label", `Claim: ${title}, ${bonus.shiny} Shiny`);
      claim.disabled = view.busy !== null;
      if (view.busy === key) claim.classList.add("quests-claim--busy");
      claim.addEventListener("click", () => this.options.onClaimBonus(period));
      action.append(claim);
    }
    row.append(art, main, rewards, action);
    return row;
  }
}
