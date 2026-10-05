import type { AttackEndReason, AttackSessionState } from "@/game/attack/AttackSession";
import { picksOf, type BaiterRun } from "@/game/baiter/baiterSession";
import { championEntry } from "@/game/yard/championCatalogue";
import { monsterName } from "@/ui/attack/ArmyPanel";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import "@/ui/styles/baiter.css";

/**
 * The Baiter scene's two pieces of UI (issue #126): the dock panel that says
 * what is attacking while it runs, and the summary when it is over.
 */

/** The docked panel: the test army, each at its level, and that nothing is saved. */
export class BaiterDock {
  readonly element: HTMLElement;
  private readonly panel: Panel;
  private readonly progress: HTMLElement;

  constructor(run: BaiterRun) {
    this.panel = new Panel({ title: "Practice attack", closable: false, className: "map-panel baiter-dock" });
    this.element = this.panel.element;

    const from = document.createElement("p");
    from.className = "baiter__note";
    from.textContent = "Your test army, against your yard as it is now.";

    const list = document.createElement("ul");
    list.className = "baiter__list";
    list.setAttribute("aria-label", "The attacking army");
    const row = (label: string, detail: string): void => {
      const item = document.createElement("li");
      item.className = "baiter-dock__row";
      const name = document.createElement("span");
      name.className = "baiter__monster";
      name.textContent = label;
      const amount = document.createElement("span");
      amount.className = "baiter__each";
      amount.textContent = detail;
      item.append(name, amount);
      list.append(item);
    };
    for (const [id, count] of Object.entries(picksOf(run.army))) {
      row(`${monsterName(id)} L${run.army.monsters[id]?.level ?? 1}`, `× ${formatAmount(count)}`);
    }
    for (const champion of run.army.champions) {
      row(`${championEntry(champion.t)?.name ?? "Champion"} L${champion.l}`, "champion");
    }

    this.progress = document.createElement("p");
    this.progress.className = "baiter__figures";
    this.progress.setAttribute("aria-live", "polite");

    const note = document.createElement("p");
    note.className = "baiter__note";
    note.textContent = "Only practice: your yard, its traps and your resources stay as they are.";

    this.panel.setContent(from, list, this.progress, note);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
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
