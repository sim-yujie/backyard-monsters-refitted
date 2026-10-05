import type { AttackEndReason, AttackSessionState } from "@/game/attack/AttackSession";
import { picksOf, type BaiterRun } from "@/game/baiter/baiterSession";
import { championEntry } from "@/game/yard/championCatalogue";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import "@/ui/styles/baiter.css";

/**
 * The Baiter scene's two pieces of UI (issue #126): the dock panel that says
 * what is attacking while it runs, and the summary when it is over.
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

  constructor(run: BaiterRun) {
    this.panel = new Panel({ title: "Test attack", closable: false, className: "map-panel baiter-dock" });
    this.element = this.panel.element;

    const note = document.createElement("p");
    note.className = "baiter__note";
    note.textContent = "Test attack: nothing is saved. Your yard, its traps and your resources stay as they are.";

    const army = document.createElement("p");
    army.className = "baiter__note";
    const sent = Object.values(picksOf(run.army)).reduce((sum, count) => sum + count, 0);
    const champions = run.army.champions.map((champion) => championEntry(champion.t)?.name ?? "Champion");
    army.textContent =
      `${formatAmount(sent)} monsters` + (champions.length > 0 ? ` and ${champions.join(" and ")}` : "") +
      ". Tap the yard to drop them.";

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

/** How a practice attack went, for {@link BaiterSummaryPanel}. */
export interface BaiterOutcome {
  readonly endReason: AttackEndReason | null;
  readonly damagePercent: number;
  readonly buildingsDestroyed: number;
  readonly buildingsTotal: number;
  readonly attackersSent: number;
  readonly attackersBeaten: number;
  /** "Cannon Tower × 3", by type, most first. */
  readonly towersFired: readonly string[];
  readonly trapsFired: number;
}

/** The headline: how the yard held. */
export const outcomeText = (outcome: BaiterOutcome): string => {
  const damage = Math.floor(outcome.damagePercent);
  if (outcome.endReason === "destroyed") return "Your yard was overrun.";
  if (outcome.endReason === "exhausted") {
    return damage === 0
      ? "Your defences beat every attacker without a scratch."
      : `Your defences beat every attacker, at ${damage}% damage.`;
  }
  if (outcome.endReason === "retreat") return `You stopped the practice at ${damage}% damage.`;
  return `Time ran out at ${damage}% damage.`;
};

export interface BaiterSummaryOptions {
  readonly outcome: BaiterOutcome;
  readonly onAgain: () => void;
  readonly onBack: () => void;
}

/**
 * The end of a practice attack: the headline, damage, buildings destroyed,
 * attackers beaten, which towers fired and how many traps went off, and that
 * none of it was kept. Run again and Back to yard; like the attack's end
 * screen it has no Escape or scrim close, because there is nothing behind it
 * to go back to.
 */
export class BaiterSummaryPanel {
  readonly element: HTMLElement;
  private readonly panel: Panel;

  constructor(options: BaiterSummaryOptions) {
    const { outcome } = options;
    this.element = document.createElement("div");
    this.element.className = "popup-backdrop attack-end__backdrop";

    this.panel = new Panel({ title: "Practice over", closable: false, className: "map-panel attack-end baiter-summary" });
    this.panel.element.setAttribute("role", "dialog");
    this.panel.element.setAttribute("aria-modal", "true");

    const headline = document.createElement("p");
    headline.className = "attack-end__outcome";
    headline.textContent = outcomeText(outcome);

    const facts = document.createElement("dl");
    facts.className = "baiter-summary__facts";
    const fact = (label: string, value: string): void => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      facts.append(dt, dd);
    };
    fact("Damage", `${Math.floor(outcome.damagePercent)}%`);
    fact("Buildings destroyed", `${outcome.buildingsDestroyed} of ${outcome.buildingsTotal}`);
    fact("Attackers beaten", `${outcome.attackersBeaten} of ${outcome.attackersSent}`);
    fact("Towers that fired", outcome.towersFired.length === 0 ? "None" : outcome.towersFired.join(", "));
    fact("Traps that went off", outcome.trapsFired === 0 ? "None" : String(outcome.trapsFired));

    const note = document.createElement("p");
    note.className = "baiter-summary__lead";
    note.textContent = "Nothing was saved: your yard, its traps and your resources are as they were.";

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--ghost baiter-summary__again";
    again.textContent = "Run again";
    again.addEventListener("click", () => options.onAgain());
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn--primary baiter-summary__back";
    back.textContent = "Back to yard";
    back.addEventListener("click", () => options.onBack());
    const actions = document.createElement("div");
    actions.className = "baiter-summary__actions";
    actions.append(again, back);

    this.panel.setContent(headline, facts, note, actions);
    this.element.append(this.panel.element);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    this.element.querySelector<HTMLButtonElement>(".baiter-summary__back")?.focus();
    return this;
  }

  close(): void {
    this.panel.close();
    this.element.remove();
  }
}
