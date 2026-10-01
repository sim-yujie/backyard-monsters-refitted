import type { GoalView } from "@/api/goals";
import { monsterPortrait } from "@/game/portraits";
import { tutTarget } from "@/game/guide/targets";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { resourceAmount } from "@/ui/resourceIcon";
import { REWARD_KEYS, type ClaimFigure } from "./claimFigure";
import "./goals.css";

/**
 * The Goals panel (`docs/design/tutorial.md` §6.3, issue #227): what is
 * ready to claim first, each with a Claim button that says what will
 * actually arrive (rewards are capped at storage, Q2); then the next five
 * open goals, with progress where a goal counts something; then a folded
 * list of what is claimed. Goals whose prereq is not claimed yet never reach
 * the client.
 *
 * A view only: the plugin (`game/yard/plugins/goals.ts`) fetches the list,
 * works out each figure, claims and plays the balls.
 */

/** How many open goals show under "Up next". */
export const NEXT_COUNT = 5;

/** The guide's names for the panel and its Claim buttons (package b points at them). */
export const GOALS_PANEL_TARGET = "goals-panel";
export const GOALS_CLAIM_TARGET = "goals-claim";

export type GoalsPanelView =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "list";
      readonly goals: readonly GoalView[];
      /** What each ready goal's claim would pay now. */
      readonly figures: ReadonlyMap<string, ClaimFigure>;
      /** The goal being claimed, whose button waits. */
      readonly claiming: string | null;
      /** A refusal to show, under its goal. */
      readonly refusal: { readonly id: string; readonly message: string } | null;
    };

export interface GoalsPanelOptions {
  onClaim(goal: GoalView, button: HTMLButtonElement): void;
  onRetry(): void;
  onClose(): void;
}

/** "10 Octo-oozes" (Flash's names take an s). */
export const monstersText = (count: number, name: string): string =>
  `${formatAmount(count)} ${count === 1 ? name : `${name}s`}`;

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

/** The monster reward: its small portrait and "10 Octo-oozes". */
const monsterChip = (goal: GoalView): HTMLElement | null => {
  if (!goal.monsters) return null;
  const chip = el("span", "goals-monsters");
  const portrait = monsterPortrait(goal.monsters.id, "icon");
  const image = el("img", "goals-monsters__image");
  image.src = portrait.src;
  image.alt = "";
  if (portrait.fallback) {
    const fallback = portrait.fallback;
    image.addEventListener("error", () => (image.src = fallback), { once: true });
  }
  chip.append(image, el("span", "goals-monsters__text", monstersText(goal.monsters.count, goal.monsters.name)));
  return chip;
};

/** The reward as listed: "icon 2,000 icon 2,000", and the monsters. */
const rewardRow = (goal: GoalView): HTMLElement => {
  const row = el("div", "goals-reward");
  for (const key of REWARD_KEYS) {
    if (goal.reward[key] > 0) row.append(resourceAmount(key, goal.reward[key]));
  }
  const monsters = monsterChip(goal);
  if (monsters) row.append(monsters);
  return row;
};

/**
 * The Claim button: "Claim" and what will land per resource, "+1,000"; a
 * resource the cap cuts is marked and the button ends "(storage full)".
 */
export const claimButton = (goal: GoalView, figure: ClaimFigure | undefined): HTMLButtonElement => {
  const button = tutTarget(el("button", "btn btn--primary goals-claim"), GOALS_CLAIM_TARGET);
  button.type = "button";
  button.dataset["goal"] = goal.id;
  button.append(el("span", "goals-claim__label", "Claim"));
  const amounts = el("span", "goals-claim__amounts");
  for (const key of REWARD_KEYS) {
    const reward = goal.reward[key];
    if (reward <= 0) continue;
    const credited = figure?.credited[key] ?? reward;
    const chip = resourceAmount(key, `+${formatAmount(credited)}`, { className: "goals-claim__amount" });
    if (credited < reward) {
      chip.classList.add("goals-claim__amount--capped");
      chip.title = `${formatAmount(reward)} reward, ${formatAmount(credited)} fits in storage`;
    }
    amounts.append(chip);
  }
  if (goal.monsters) {
    amounts.append(el("span", "goals-claim__amount", `+${monstersText(goal.monsters.count, goal.monsters.name)}`));
  }
  if (amounts.childElementCount > 0) button.append(amounts);
  if (figure?.capped) button.append(el("span", "goals-claim__full", " (storage full)"));
  return button;
};

export class GoalsPanel {
  readonly element: HTMLElement;
  private readonly panel: Panel;
  private readonly options: GoalsPanelOptions;
  private claimedOpen = false;

  constructor(options: GoalsPanelOptions) {
    this.options = options;
    this.panel = new Panel({
      title: "Goals",
      className: "goals-panel",
      closeOnEscape: true,
      onClose: () => options.onClose(),
    });
    this.element = tutTarget(this.panel.element, GOALS_PANEL_TARGET);
    this.render({ kind: "loading" });
  }

  /** The title row, where a tips "?" can go. */
  get header(): HTMLElement {
    return this.panel.titlebar;
  }

  mount(container: HTMLElement): this {
    this.panel.mount(container);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  render(view: GoalsPanelView): void {
    if (view.kind === "loading") {
      this.panel.setContent(el("p", "goals-status", "Loading your goals…"));
      return;
    }
    if (view.kind === "error") {
      const retry = el("button", "btn goals-status__retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => this.options.onRetry());
      const box = el("div", "goals-status");
      box.append(el("p", "goals-status__text", view.message), retry);
      this.panel.setContent(box);
      return;
    }

    const ready = view.goals.filter((goal) => goal.status === "ready");
    const next = view.goals.filter((goal) => goal.status === "open").slice(0, NEXT_COUNT);
    const claimed = view.goals.filter((goal) => goal.status === "claimed");
    const sections: HTMLElement[] = [];

    if (ready.length > 0) {
      sections.push(this.section("Ready to claim", ready.map((goal) => this.readyRow(goal, view))));
    }
    if (next.length > 0) {
      sections.push(this.section("Up next", next.map((goal) => this.openRow(goal))));
    }
    if (ready.length === 0 && next.length === 0) {
      sections.push(el("p", "goals-status", "Every goal is done. Nice work!"));
    }
    if (claimed.length > 0) sections.push(this.claimedList(claimed));
    this.panel.setContent(...sections);
  }

  private section(title: string, rows: HTMLElement[]): HTMLElement {
    const section = el("section", "goals-section");
    const list = el("ul", "goals-list");
    list.append(...rows);
    section.append(el("h3", "goals-section__title", title), list);
    return section;
  }

  private head(goal: GoalView, row: HTMLElement): void {
    row.append(el("h4", "goals-row__name", goal.name), el("p", "goals-row__description", goal.description));
  }

  private readyRow(goal: GoalView, view: Extract<GoalsPanelView, { kind: "list" }>): HTMLElement {
    const row = el("li", "goals-row goals-row--ready");
    row.dataset["goal"] = goal.id;
    this.head(goal, row);
    const button = claimButton(goal, view.figures.get(goal.id));
    const noRoom = goal.monsters !== undefined && goal.room === false;
    button.disabled = view.claiming !== null || noRoom;
    if (view.claiming === goal.id) button.classList.add("goals-claim--busy");
    button.addEventListener("click", () => this.options.onClaim(goal, button));
    row.append(button);
    if (noRoom && goal.monsters) {
      row.append(
        el(
          "p",
          "goals-row__note",
          `Make room in Housing for ${monstersText(goal.monsters.count, goal.monsters.name)}`,
        ),
      );
    }
    if (view.refusal?.id === goal.id) {
      const note = el("p", "goals-row__note goals-row__note--refused", view.refusal.message);
      note.setAttribute("role", "alert");
      row.append(note);
    }
    return row;
  }

  private openRow(goal: GoalView): HTMLElement {
    const row = el("li", "goals-row");
    row.dataset["goal"] = goal.id;
    this.head(goal, row);
    const foot = el("div", "goals-row__foot");
    foot.append(rewardRow(goal));
    if (goal.progress) {
      const { have, need } = goal.progress;
      foot.append(el("span", "goals-row__progress", `${formatAmount(Math.min(have, need))} / ${formatAmount(need)}`));
    }
    row.append(foot);
    return row;
  }

  private claimedList(claimed: readonly GoalView[]): HTMLElement {
    const details = el("details", "goals-claimed");
    details.open = this.claimedOpen;
    details.addEventListener("toggle", () => (this.claimedOpen = details.open));
    details.append(el("summary", "goals-claimed__summary", `Claimed (${claimed.length})`));
    const list = el("ul", "goals-claimed__list");
    for (const goal of claimed) {
      const item = el("li", "goals-claimed__item", goal.name);
      if (goal.baseline) item.title = "Done before Goals arrived";
      list.append(item);
    }
    details.append(list);
    return details;
  }
}
