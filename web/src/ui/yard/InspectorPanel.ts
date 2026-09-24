import type { UpgradeCost } from "@/api/types";
import type { CostStep } from "@/game/yard/buildingCostData";
import {
  costOf,
  instantCost,
  sumCosts,
  upgradeSteps,
  WALL_TYPES,
} from "@/game/yard/buildingCosts";
import type { PlanNode } from "@/game/yard/planner/placement";
import {
  heldResources,
  shortfallOf,
  summariseSelection,
  typeName,
} from "@/game/yard/planner/summary";
import { ladderFor, type Ladder, type LadderGate } from "@/game/yard/planner/upgrades";
import type { Yard, YardBuilding } from "@/game/yard/yardModel";
import { formatAmount, formatCountdown } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { costRows } from "./costRows";
import { describeCost } from "./upgradeText";

/**
 * The inspector: one selected building's ladder, and what planning a step on
 * it would cost (design §4.1, `docs/design/planner-upgrades.md` §5.2).
 *
 * This is where upgrades live now. The yard screen's own `BuildingPanel` stays
 * the read-only inspector outside the planner, with its Upgrade button still
 * disabled, because the yard is read-only and the planner is where a level is
 * chosen, queued and paid for.
 *
 * ## Why every gated level is still a button
 *
 * A player raising their Town Hall in the same plan wants the tower behind it
 * queued too, so a target whose steps need a building they do not have yet is
 * offered with the gate named in its tooltip rather than disabled (§8, Q5).
 * Apply reports what it could not start, and the checklist warns before that.
 * The wall panel does the opposite — it disables a gated level — because that
 * panel *acts* on Confirm and this one only plans.
 *
 * What is refused outright is what F1 rule 3 refuses: a busy building, a
 * damaged one, and a session that may not be edited at all. Those disable the
 * whole ladder with the reason on every button, because the answer is the same
 * for all of them and a row of buttons that each say something different about
 * one broken building is noise.
 *
 * ## Redrawing
 *
 * `show` rebuilds the body from the nodes and the yard it is handed. It keeps
 * no copy of either: the session owns the plan, and an inspector holding its
 * own idea of a building's level is the one way this panel could lie.
 */

/** One `dt`/`dd` pair of the single-building view. */
interface FactRow {
  readonly term: string;
  readonly value: string;
  readonly className?: string;
}

export interface InspectorPanelOptions {
  /** Plans a target on every named building, or clears it with `null`. */
  onPlan: (ids: readonly number[], level: number | null) => void;
  /** Opens the batch wall panel: what a multi-selection of walls gets (§1.3). */
  onUpgradeWalls: () => void;
  onClose: () => void;
  /**
   * A read-only session (design §8, Q5) may open the inspector and read every
   * ladder; it may not plan. The buttons stay visible and disabled rather than
   * being left out, because the costs are the whole reason to look at another
   * player's yard in the planner.
   */
  readOnly?: boolean;
}

export class InspectorPanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly options: InspectorPanelOptions;
  private readonly readOnly: boolean;

  constructor(options: InspectorPanelOptions) {
    this.options = options;
    this.readOnly = options.readOnly ?? false;
    this.panel = new Panel({
      title: "Building",
      className: "map-panel planner-inspector",
      onClose: options.onClose,
    });
    this.element = this.panel.element;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** Redraws for the current selection. */
  show(nodes: readonly PlanNode[], yard: Yard): void {
    const only = nodes.length === 1 ? nodes[0] : undefined;
    if (only) this.showOne(only, yard);
    else this.showMany(nodes, yard);
  }

  close(): void {
    this.panel.close();
  }

  /* ── One building ───────────────────────────────────────────────────── */

  private showOne(node: PlanNode, yard: Yard): void {
    const building = yard.buildings.find((one) => one.id === node.id) ?? null;
    const ladder = ladderFor(node, yard);
    this.panel.setTitle(typeName(node.type));

    const facts = document.createElement("dl");
    facts.className = "cell-facts";
    for (const row of this.factsFor(node, ladder, building)) {
      const dt = document.createElement("dt");
      dt.textContent = row.term;
      const dd = document.createElement("dd");
      dd.textContent = row.value;
      if (row.className) dd.className = row.className;
      facts.append(dt, dd);
    }

    this.panel.setContent(
      facts,
      this.ladderRow(node, ladder),
      this.planRow(node, ladder),
    );
  }

  /** Every `dt`/`dd` pair the single-building view shows, in order. */
  private factsFor(node: PlanNode, ladder: Ladder, building: YardBuilding | null): FactRow[] {
    const rows: FactRow[] = [];

    rows.push({
      term: "Level",
      value:
        node.level === 0
          ? "Under construction"
          : ladder.max > 0
            ? `${node.level} of ${ladder.max}`
            : String(node.level),
    });

    const now = ladder.healthNow;
    if (now !== null) {
      const hp = building?.hp ?? null;
      rows.push({
        term: "Health",
        value:
          hp === null ? now.toLocaleString() : `${hp.toLocaleString()} of ${now.toLocaleString()}`,
        ...(hp === null ? {} : { className: "is-danger" }),
      });
    }

    const countdown = building?.countdown ?? null;
    if (countdown) {
      rows.push({
        term:
          countdown.kind === "build"
            ? "Building"
            : countdown.kind === "upgrade"
              ? "Upgrading"
              : countdown.kind === "fortify"
                ? "Fortifying"
                : "Rebuilding",
        value: `${formatCountdown(countdown.endsAt - Date.now() / 1000)} left`,
        className: "is-info",
      });
    }

    // The next step, priced on its own: the ladder's own numbers are
    // cumulative, which is the right answer for a button and the wrong one for
    // "what happens if I press once".
    const step = costOf(node.type, Math.max(node.level, 1));
    if (step && ladder.healthNext !== null) {
      rows.push({ term: "Next level", value: `Health ${ladder.healthNext.toLocaleString()}` });
      rows.push({
        term: "Next step",
        value: `${describeCost(stepAmounts(step))}, ${formatCountdown(step[4])}`,
      });
      rows.push({ term: "Shiny", value: formatAmount(instantCost(step)) });
    }

    rows.push({ term: "Position", value: `${node.x}, ${node.y}` });
    rows.push({ term: "Type id", value: String(node.type) });
    return rows;
  }

  /** The row of target buttons, `L2` … `Max`. */
  private ladderRow(node: PlanNode, ladder: Ladder): HTMLElement {
    const row = document.createElement("div");
    row.className = "planner-inspector__ladder";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Plan an upgrade");

    const label = document.createElement("span");
    label.className = "planner-inspector__ladder-label";
    label.textContent = "Plan to";
    row.append(label);

    const stop = this.blockedReason(ladder);
    if (ladder.steps.length === 0) {
      const none = document.createElement("span");
      none.className = "u-muted";
      none.textContent =
        ladder.max === 0
          ? "This building has no upgrade ladder."
          : "Already at the top of its ladder.";
      row.append(none);
      return row;
    }

    for (const step of ladder.steps) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost planner-inspector__level";
      button.textContent = step.level === ladder.max ? `Max (L${step.level})` : `L${step.level}`;
      button.dataset["level"] = String(step.level);
      button.setAttribute("aria-pressed", String(node.plan?.level === step.level));

      const price = `${describeCost(amounts(step.cost))}, ${formatCountdown(step.cost.time)} of work, ${formatAmount(step.shiny)} shiny`;
      const gate = describeGate(step.gate);
      button.disabled = stop !== null;
      button.title =
        stop ??
        `Take it to level ${step.level}: ${price}.${gate ? ` ${gate}` : ""}`;

      if (stop === null) {
        button.addEventListener("click", () => this.options.onPlan([node.id], step.level));
      }
      row.append(button);
    }

    return row;
  }

  /** Why nothing on this ladder can be planned, or null when it can. */
  private blockedReason(ladder: Ladder): string | null {
    if (this.readOnly) return "This yard is not yours to plan.";
    switch (ladder.blocked) {
      case "busy":
        return "This building is already on a job. Wait for it to finish.";
      case "damaged":
        return "Repair this building before upgrading it.";
      case "maxed":
        return "This building is at the top of its ladder.";
      default:
        return null;
    }
  }

  /** "Planned: L3 → L5, 2 steps, …", the gate note, and Clear. */
  private planRow(node: PlanNode, ladder: Ladder): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "planner-inspector__plan";

    const line = document.createElement("p");
    line.className = "planner-inspector__plan-line";

    const plan = node.plan;
    if (!plan) {
      line.textContent = "Nothing planned.";
      wrapper.append(line);
      return wrapper;
    }

    const from = Math.max(node.level, 1);
    const run = upgradeSteps(node.type, from, plan.level);
    const total = sumCosts(run);
    line.textContent = `Planned: L${from} → L${plan.level}, ${run.length} ${run.length === 1 ? "step" : "steps"}, ${formatCountdown(total.time)}, ${describeCost(amounts(total))}.`;

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn btn--ghost planner-inspector__clear";
    clear.textContent = "Clear plan";
    clear.disabled = this.readOnly;
    clear.title = this.readOnly
      ? "This yard is not yours to plan."
      : "Take this building off the plan.";
    if (!this.readOnly) {
      clear.addEventListener("click", () => this.options.onPlan([node.id], null));
    }

    wrapper.append(line, clear);

    // Only one long step starts per Apply (§8, Q10), so a multi-step plan says
    // so here rather than leaving the player to wonder why one Apply did not
    // finish it.
    if (run.length > 1) {
      wrapper.append(
        note(
          "Apply starts one step at a time. The rest stays planned for the next Apply.",
        ),
      );
    }

    const step = ladder.steps.find((entry) => entry.level === plan.level);
    const gate = step ? describeGate(step.gate) : null;
    if (step && gate) {
      wrapper.append(
        note(
          step.firstStepGated
            ? `Nothing will start until this is met: ${gate} It stays planned.`
            : `The first step can start now; later steps wait. ${gate}`,
        ),
      );
    }

    return wrapper;
  }

  /* ── A multi-selection ──────────────────────────────────────────────── */

  /**
   * More than one building, or none: the cost table the bottom bar used to
   * carry, plus the batch wall button (§5.2).
   *
   * There is no per-building ladder here on purpose. The inspector plans one
   * building; walls in bulk are the batch route's job (§1.3, F2), and a ladder
   * over a mixed selection would have to invent a "from" level that no two of
   * them share.
   */
  private showMany(nodes: readonly PlanNode[], yard: Yard): void {
    this.panel.setTitle(
      nodes.length === 0 ? "Nothing selected" : `${nodes.length} buildings selected`,
    );

    const summary = summariseSelection(nodes, yard);
    const heading = document.createElement("p");
    heading.className = "planner-inspector__heading";
    heading.textContent =
      nodes.length === 0
        ? "Click a building to see its levels and plan an upgrade."
        : `What one more level would cost for all ${nodes.length}.`;

    const costs = document.createElement("dl");
    costs.className = "cell-facts planner-inspector__costs";
    costs.replaceChildren(
      ...costRows(
        summary.needed,
        heldResources(yard.resources),
        shortfallOf(summary.needed, heldResources(yard.resources)),
      ),
    );

    const actions = document.createElement("div");
    actions.className = "planner-inspector__actions";

    const walls = nodes.filter((node) => WALL_TYPES.includes(node.type)).length;
    if (walls > 0) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost planner-inspector__walls";
      button.textContent = `Upgrade ${walls} ${walls === 1 ? "wall" : "walls"}`;
      button.disabled = this.readOnly;
      button.title = this.readOnly
        ? "This yard is not yours to plan."
        : "Raise every selected wall to a higher level in one charged step.";
      if (!this.readOnly) button.addEventListener("click", this.options.onUpgradeWalls);
      actions.append(button);
    }

    const planned = nodes.filter((node) => node.plan !== null);
    if (planned.length > 0) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost planner-inspector__clear";
      button.textContent = `Clear ${planned.length} ${planned.length === 1 ? "plan" : "plans"}`;
      button.disabled = this.readOnly;
      button.title = this.readOnly
        ? "This yard is not yours to plan."
        : "Take every selected building off the plan.";
      if (!this.readOnly) {
        button.addEventListener("click", () =>
          this.options.onPlan(
            planned.map((node) => node.id),
            null,
          ),
        );
      }
      actions.append(button);
    }

    const maxed =
      summary.maxed > 0
        ? note(
            `${summary.maxed} of them ${summary.maxed === 1 ? "is" : "are"} already at the top of ${summary.maxed === 1 ? "its" : "their"} ladder.`,
          )
        : null;

    this.panel.setContent(
      heading,
      ...(nodes.length === 0 ? [] : [costs]),
      ...(maxed ? [maxed] : []),
      actions,
    );
  }
}

/** The four resource amounts of a cost step or a cost total. */
const amounts = (source: {
  readonly r1?: number;
  readonly r2?: number;
  readonly r3?: number;
  readonly r4?: number;
}): UpgradeCost => ({
  r1: source.r1 ?? 0,
  r2: source.r2 ?? 0,
  r3: source.r3 ?? 0,
  r4: source.r4 ?? 0,
});

/** A cost step's four amounts; a step is a tuple, not a record. */
const stepAmounts = (step: CostStep): UpgradeCost => ({
  r1: step[0],
  r2: step[1],
  r3: step[2],
  r4: step[3],
});

/** "Needs Town Hall 8." or the requirement list, or null when nothing gates it. */
const describeGate = (gate: LadderGate | null): string | null => {
  if (!gate) return null;
  if (gate.townHall) {
    return `Needs Town Hall ${gate.townHall.need}${gate.townHall.have > 0 ? `; yours is ${gate.townHall.have}` : ""}.`;
  }
  const list = (gate.requirements ?? [])
    .map(([type, count, level]) => `${count} × ${typeName(type)} at level ${level}`)
    .join(", ");
  return list ? `Needs ${list}.` : null;
};

const note = (text: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = "planner-inspector__note u-muted";
  element.textContent = text;
  return element;
};
