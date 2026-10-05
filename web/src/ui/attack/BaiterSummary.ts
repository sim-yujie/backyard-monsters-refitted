import type { AttackSessionState } from "@/game/attack/AttackSession";
import { picksOf, type BaiterRun } from "@/game/baiter/baiterSession";
import { championEntry } from "@/game/yard/championCatalogue";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import "@/ui/styles/baiter.css";

/**
 * The Baiter scene's dock panel (issue #126): what is attacking while it
 * runs. The report when it is over is `TestReport.ts` (#22, WP4).
 */

/**
 * The docked panel above the army panel (#22, WP3): names the test, says
 * nothing is saved, and keeps count while it runs. The army itself, each row
 * at its level, is in the army panel below it.
 */
export class BaiterDock {
  readonly element: HTMLElement;
  private readonly panel: Panel;
  private readonly progress: HTMLElement;

  /** `replay`: a finished test played back (#22, WP5), on the yard as it was then. */
  constructor(run: BaiterRun, replay = false) {
    this.panel = new Panel({
      title: replay ? "Test replay" : "Test attack",
      closable: false,
      className: "map-panel baiter-dock",
    });
    this.element = this.panel.element;

    const note = document.createElement("p");
    note.className = "baiter__note";
    note.textContent = replay
      ? "Replay of a test, on your yard as it was then. Nothing is saved."
      : "Test attack: nothing is saved. Your yard, its traps and your resources stay as they are.";

    const army = document.createElement("p");
    army.className = "baiter__note";
    const sent = Object.values(picksOf(run.army)).reduce((sum, count) => sum + count, 0);
    const champions = run.army.champions.map((champion) => championEntry(champion.t)?.name ?? "Champion");
    army.textContent =
      `${formatAmount(sent)} monsters` + (champions.length > 0 ? ` and ${champions.join(" and ")}` : "") +
      (replay ? "." : ". Tap the yard to drop them.");

    this.progress = document.createElement("p");
    this.progress.className = "baiter__figures";
    this.progress.setAttribute("aria-live", "polite");

    this.panel.setContent(note, army, this.progress);
  }

  /** Goes first in the dock, above the army panel. */
  mount(container: HTMLElement): this {
    container.prepend(this.element);
    return this;
  }

  update(state: AttackSessionState): void {
    this.progress.textContent =
      `${formatAmount(state.creepsAlive)} attacking · ${formatAmount(state.creepsKilled)} beaten · ` +
      `${Math.floor(state.damagePercent)}% damage`;
  }

  destroy(): void {
    this.panel.close();
  }
}
