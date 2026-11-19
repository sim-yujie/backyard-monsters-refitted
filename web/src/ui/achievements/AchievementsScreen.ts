import { achievementsApi, type AchievementsApi, type AchievementView } from "@/api/achievements";
import {
  badgeTier,
  earnedGroup,
  earnedText,
  FOOTER_TEXT,
  isSecret,
  progressRatio,
  progressText,
  rewardText,
  summaryText,
  toDoGroup,
} from "@/game/achievements/achievements";
import { centreWindow, type CentreWindow } from "@/ui/centreWindow";
import { Panel } from "@/ui/Panel";
import { resourceAmount } from "@/ui/resourceIcon";
import { achievementBadge, secretBadge } from "./badge";
import "./achievements.css";

/**
 * The achievements screen (`docs/design/achievements.md` §10.1, issue #204):
 * a docked panel like the mailbox, a full-height sheet on a phone.
 *
 * The player's own list only (another player's read-only view was removed,
 * owner 19 Nov 2026): "7 of 16 earned · 85 Shiny earned", then **To do**,
 * closest to done first, each with a bar, "Town Hall 4 / 5" and "+10 Shiny";
 * then **Earned**, newest first, each with its date. It ends in the §5.3 line
 * about the six left out. Every open fetches fresh; an answer that lands
 * after the screen closed is dropped.
 */

export interface AchievementsScreenOptions {
  /** The routes; the real ones unless a test swaps them. */
  readonly api?: AchievementsApi;
  /** After it closes; `hadFocus` when focus was inside it, so the opener can take it back. */
  readonly onClose?: (hadFocus: boolean) => void;
}

export const LOAD_FAILED = "Could not load achievements. Try again.";
export const ALL_DONE = "Every achievement here is earned.";
export const NONE_YET = "None yet.";

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class AchievementsScreen {
  readonly element: HTMLElement;

  private readonly api: AchievementsApi;
  private readonly options: AchievementsScreenOptions;
  private readonly panel: Panel;
  private readonly summary: HTMLElement;
  private readonly status: HTMLElement;
  private readonly groups: HTMLElement;
  private opened = false;
  private destroyed = false;
  /** Bumped by every fetch, so an answer for a view the player has left is dropped. */
  private generation = 0;

  /** Its place in the middle of the screen, one window at a time (`ui/centreWindow.ts`). */
  private readonly centre: CentreWindow;

  constructor(options: AchievementsScreenOptions = {}) {
    this.options = options;
    this.api = options.api ?? achievementsApi;

    // Not Panel's own close, which removes the element for good: the screen
    // opens and closes many times over one scene.
    this.panel = new Panel({ title: "Achievements", className: "ach-screen", closable: false });
    this.element = this.panel.element;
    this.centre = centreWindow(this.element, () => this.close());
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        this.close();
      }
    });
    const close = make("button", "btn btn--ghost btn--icon ach-screen__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close Achievements");
    close.addEventListener("click", () => this.close());
    this.panel.titlebar.append(close);

    this.summary = make("p", "ach-summary");
    this.status = make("div", "ach-status");
    this.status.setAttribute("role", "status");
    this.groups = make("div", "ach-groups");
    this.panel.setContent(this.summary, this.status, this.groups, make("p", "ach-footer", FOOTER_TEXT));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** The player's own list, fetched fresh. */
  async open(): Promise<void> {
    if (this.destroyed) return;
    const wasOpen = this.opened;
    this.opened = true;
    this.element.hidden = false;
    this.centre.opened();
    if (!wasOpen) this.element.querySelector<HTMLElement>(".ach-screen__close")?.focus();
    await this.refresh();
  }

  close(): void {
    if (!this.opened) return;
    const hadFocus = this.element.contains(document.activeElement);
    this.opened = false;
    this.generation++;
    this.element.hidden = true;
    this.centre.closed();
    this.options.onClose?.(hadFocus);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.element.remove();
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.summary.textContent = "";
    this.groups.replaceChildren();
    this.setStatus("Loading…");
    try {
      const state = await this.api.state();
      if (this.destroyed || generation !== this.generation) return;
      this.setStatus(null);
      this.summary.textContent = summaryText(state.earned, state.total, state.shinyEarned);
      this.groups.append(
        this.group("To do", toDoGroup(state.achievements).map((entry) => this.toDoRow(entry)), ALL_DONE),
        this.group("Earned", earnedGroup(state.achievements).map((entry) => this.earnedRow(entry)), NONE_YET),
      );
    } catch {
      if (this.destroyed || generation !== this.generation) return;
      this.setStatus(LOAD_FAILED, () => void this.refresh());
    }
  }

  /** The status line: loading, or a failure with Try again; null hides it. */
  private setStatus(text: string | null, retry?: () => void): void {
    this.status.replaceChildren();
    this.status.hidden = text === null;
    if (text === null) return;
    this.status.append(make("span", "ach-status__text", text));
    if (retry) {
      const again = make("button", "btn btn--ghost ach-status__retry", "Try again");
      again.type = "button";
      again.addEventListener("click", retry);
      this.status.append(again);
    }
  }

  private group(title: string, rows: HTMLElement[], empty: string): HTMLElement {
    const section = make("section", "ach-group");
    const heading = make("h3", "ach-group__title", title);
    heading.id = `ach-group-${Math.random().toString(36).slice(2, 9)}`;
    section.setAttribute("aria-labelledby", heading.id);
    const list = make("ul", "ach-group__rows");
    if (rows.length === 0) list.append(make("li", "ach-group__empty", empty));
    else list.append(...rows);
    section.append(heading, list);
    return section;
  }

  /** The badge, name and description every row starts with. */
  private row(entry: AchievementView, shiny: number | undefined): { row: HTMLElement; text: HTMLElement } {
    const earned = entry.status === "earned";
    const row = make("li", "ach-row");
    row.dataset["achievement"] = String(entry.id);
    row.dataset["status"] = entry.status;
    const text = make("div", "ach-row__text");
    if (isSecret(entry)) {
      // Hidden until earned (#299): "???" and a "?" medal, nothing else.
      row.classList.add("ach-row--hidden");
      row.dataset["hidden"] = "true";
      row.title = "Hidden until earned";
      text.append(make("span", "ach-row__name", "???"));
      row.append(secretBadge(entry.id), text);
      return { row, text };
    }
    if (entry.hidden) row.dataset["hidden"] = "true";
    text.append(make("span", "ach-row__name", entry.name), make("p", "ach-row__description", entry.description));
    row.append(achievementBadge(entry.id, badgeTier(shiny), earned), text);
    return { row, text };
  }

  private toDoRow(entry: AchievementView): HTMLElement {
    const { row, text } = this.row(entry, entry.shiny);
    if (isSecret(entry)) return row;
    const line = make("div", "ach-row__progress");
    const words = progressText(entry);
    const bar = make("span", "ach-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(entry.progress.target));
    bar.setAttribute("aria-valuenow", String(entry.progress.value));
    bar.setAttribute("aria-valuetext", words);
    const fill = make("span", "ach-bar__fill");
    fill.style.width = `${Math.round(progressRatio(entry.progress) * 100)}%`;
    bar.append(fill);
    line.append(bar, make("span", "ach-row__figures", words));
    text.append(line);
    if (entry.progress.parts?.length) {
      const parts = make("ul", "ach-parts");
      for (const part of entry.progress.parts) {
        const done = part.value >= part.target;
        const chip = make("li", done ? "ach-part ach-part--done" : "ach-part", part.label);
        chip.title = done ? `${part.label}: done` : `${part.label}: not yet`;
        parts.append(chip);
      }
      text.append(parts);
    }
    row.append(resourceAmount("shiny", rewardText(entry.shiny), { className: "ach-row__reward", decorative: true }));
    return row;
  }

  private earnedRow(entry: AchievementView): HTMLElement {
    const { row } = this.row(entry, entry.shiny);
    row.append(make("span", "ach-row__date", earnedText(entry.at)));
    return row;
  }
}
