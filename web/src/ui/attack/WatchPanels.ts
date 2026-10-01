import type { AttackSessionState } from "@/game/attack/AttackSession";
import type { AttackSummary } from "@/game/attack/attackSave";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";

/**
 * Watch's two pieces of UI (issue #221): the dock panel while an
 * auto-attack's battle plays back, and the panel when it is over. Nothing on
 * the screen is saved: the result already landed when the attack ran.
 */

/** The docked panel: what is playing, and that it is only a replay. */
export class WatchDock {
  readonly element: HTMLElement;
  private readonly panel: Panel;
  private readonly progress: HTMLElement;

  constructor(name: string) {
    this.panel = new Panel({ title: "Replay", closable: false, className: "map-panel watch-dock" });
    this.element = this.panel.element;

    const what = document.createElement("p");
    what.className = "watch__note";
    what.textContent = `Your auto-attack on the ${name} camp, as the server fought it.`;

    this.progress = document.createElement("p");
    this.progress.className = "watch__figures";
    this.progress.setAttribute("aria-live", "polite");

    const note = document.createElement("p");
    note.className = "u-muted watch__note";
    note.textContent = "Only a replay: the result was saved when the attack ran.";

    this.panel.setContent(what, this.progress, note);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  update(state: AttackSessionState): void {
    this.progress.textContent =
      `${formatAmount(state.creepsAlive)} attacking · ${formatAmount(state.creepsKilled)} lost · ` +
      `${Math.floor(state.damagePercent)}% damage`;
  }

  destroy(): void {
    this.panel.close();
  }
}

export interface WatchSummaryOptions {
  readonly summary: AttackSummary;
  readonly onAgain: () => void;
  readonly onBack: () => void;
}

/** The end of the replay: how the battle went, Watch again and Back to map. */
export class WatchSummaryPanel {
  readonly element: HTMLElement;
  private readonly panel: Panel;

  constructor(options: WatchSummaryOptions) {
    const { summary } = options;
    this.element = document.createElement("div");
    this.element.className = "popup-backdrop attack-end__backdrop";
    this.panel = new Panel({ title: "Replay over", closable: false, className: "map-panel attack-end watch-summary" });
    this.panel.element.setAttribute("role", "dialog");
    this.panel.element.setAttribute("aria-modal", "true");

    const outcome = document.createElement("p");
    outcome.className = "attack-end__outcome";
    outcome.textContent = summary.outcome;

    const stats = document.createElement("dl");
    stats.className = "attack-end__stats";
    const stat = (label: string, value: string): void => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      stats.append(dt, dd);
    };
    stat("Damage", `${Math.floor(summary.damagePercent)}%`);
    stat("Buildings destroyed", `${summary.buildingsDestroyed} of ${summary.buildingsTotal}`);
    stat("Monsters lost", `${summary.monstersLost} of ${summary.monstersSent} sent`);

    const note = document.createElement("p");
    note.className = "u-muted";
    note.textContent = "This was a replay. The result was saved when the attack ran.";

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--ghost watch-summary__again";
    again.textContent = "Watch again";
    again.addEventListener("click", options.onAgain);

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn--primary watch-summary__back";
    back.textContent = "Back to map";
    back.addEventListener("click", options.onBack);

    const actions = document.createElement("div");
    actions.className = "attack-end__actions";
    actions.append(again, back);

    this.panel.setContent(outcome, stats, note, actions);
    this.element.append(this.panel.element);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    this.element.querySelector<HTMLButtonElement>(".watch-summary__back")?.focus();
    return this;
  }

  close(): void {
    this.panel.close();
    this.element.remove();
  }
}
