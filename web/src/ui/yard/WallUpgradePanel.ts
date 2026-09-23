import { maxLevel, townHallLevel, WALL_TYPES } from "@/game/yard/buildingCosts";
import type { PlanNode } from "@/game/yard/planner/placement";
import {
  effectiveLevel,
  heldResources,
  isShort,
  wallBatchPreview,
  wallTargets,
  type WallBatchPreview,
} from "@/game/yard/planner/summary";
import type { Yard } from "@/game/yard/yardModel";
import { Panel } from "@/ui/Panel";
import { costRows } from "./costRows";

/**
 * Batch wall upgrade: pick a target level, read what it costs, confirm
 * (plan §3.3, decision Q1).
 *
 * The whole panel is a preview of one server call. Nothing here charges
 * anything or changes the plan — Confirm hands the eligible ids and the target
 * to the caller, which posts them, and the yard comes back from the server.
 *
 * ## Why the levels are buttons and not a dropdown
 *
 * There are four of them, at most, and each one has a different answer to "can
 * I have this" — a level the Town Hall does not reach is disabled with the
 * reason in its tooltip rather than hidden, because a level that vanishes tells
 * the player nothing about how to get it. Clicking one re-previews; it does not
 * act.
 *
 * ## Why the walls already at the target are shown rather than dropped
 *
 * The server refuses a batch containing a wall that is already at the target
 * (plan §2.4, `alreadyAtLevel`), so the panel pre-filters them. Saying so in
 * the sentence is what keeps "34 of 40" from reading as a bug.
 */

export interface WallUpgradePanelOptions {
  /** The current selection. Anything that is not a wall is ignored. */
  nodes: readonly PlanNode[];
  yard: Yard;
  /** Confirm: the ids the server should raise, and the level to raise them to. */
  onConfirm: (ids: number[], level: number) => void;
  onClose: () => void;
}

/** Wall type 17's ladder tops out here; the targets run from 2 to this. */
const WALL_LADDER_TYPE = 17;

export const wallUpgradePanel = (options: WallUpgradePanelOptions): Panel => {
  const walls = options.nodes.filter((node) => !node.fixed && WALL_TYPES.includes(node.type));
  const hall = townHallLevel(options.yard);
  const targets = wallTargets();
  const top = maxLevel(WALL_LADDER_TYPE);

  const panel = new Panel({
    title: "Upgrade walls",
    className: "map-panel planner-walls",
    onClose: options.onClose,
  });

  // The highest level the hall allows, so the panel opens on the answer the
  // player almost always wants rather than on the cheapest one.
  let target =
    targets.filter((entry) => entry.need <= hall).at(-1)?.level ?? targets[0]?.level ?? 2;

  const held = document.createElement("p");
  held.className = "planner-walls__held u-muted";
  held.textContent = describeHoldings(walls);

  const levelRow = document.createElement("div");
  levelRow.className = "planner-walls__levels";
  levelRow.setAttribute("role", "group");
  levelRow.setAttribute("aria-label", "Target level");

  const levelLabel = document.createElement("span");
  levelLabel.className = "planner-walls__levels-label";
  levelLabel.textContent = "Raise to";
  levelRow.append(levelLabel);

  const preview = document.createElement("p");
  preview.className = "planner-walls__preview";

  const costs = document.createElement("dl");
  costs.className = "cell-facts planner-walls__costs";

  const note = document.createElement("p");
  note.className = "planner-walls__note u-muted";

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "btn btn--primary";
  confirm.textContent = "Confirm";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn--ghost";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => panel.close());

  const footer = document.createElement("div");
  footer.className = "planner-walls__actions";
  footer.append(confirm, cancel);

  const buttons = new Map<number, HTMLButtonElement>();
  for (const entry of targets) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "btn btn--ghost planner-walls__level";
    element.textContent = `Level ${entry.level}`;
    element.dataset["level"] = String(entry.level);

    const gated = entry.need > hall;
    element.disabled = gated;
    element.title = gated
      ? `Needs Town Hall ${entry.need}; yours is ${hall === 0 ? "missing" : `level ${hall}`}.`
      : `Take every selected wall to level ${entry.level}.`;

    element.addEventListener("click", () => {
      target = entry.level;
      render();
    });

    buttons.set(entry.level, element);
    levelRow.append(element);
  }

  // Everything the hall allows is out of reach: there is no target to pick.
  if (targets.every((entry) => entry.need > hall)) {
    const none = document.createElement("span");
    none.className = "u-muted";
    none.textContent = "Your Town Hall is not high enough for any wall upgrade yet.";
    levelRow.append(none);
  }

  const render = (): void => {
    const result = wallBatchPreview(walls, target, options.yard);

    for (const [level, element] of buttons) {
      element.setAttribute("aria-pressed", String(level === target));
    }

    preview.textContent = describePreview(result, target, top);
    costs.replaceChildren(
      ...costRows(result.cost, heldResources(options.yard.resources), result.shortfall),
    );
    note.textContent =
      result.eligible.length === 0
        ? ""
        : `${result.steps} ${result.steps === 1 ? "step" : "steps"} of five seconds each, so every wall finishes the moment the server takes the payment.`;

    const blocked =
      result.eligible.length === 0 || isShort(result.shortfall) || result.gate !== null;
    confirm.disabled = blocked;
    confirm.title = result.gate
      ? `Needs Town Hall ${result.gate.need}.`
      : result.eligible.length === 0
        ? "Nothing selected would change."
        : isShort(result.shortfall)
          ? "You cannot afford this yet."
          : `Raise ${result.eligible.length} ${result.eligible.length === 1 ? "wall" : "walls"} to level ${target}.`;

    confirm.onclick = blocked ? null : () => options.onConfirm([...result.eligible], target);
  };

  render();
  panel.setContent(held, levelRow, preview, costs, note, footer);
  return panel;
};

/** "40 walls selected: 34 at level 1, 6 at level 5." */
const describeHoldings = (walls: readonly PlanNode[]): string => {
  if (walls.length === 0) return "No walls are selected.";

  const byLevel = new Map<number, number>();
  for (const wall of walls) {
    const level = effectiveLevel(wall);
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  }
  const parts = [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, count]) => `${count} at level ${level}`);

  return `${walls.length} ${walls.length === 1 ? "wall" : "walls"} selected: ${parts.join(", ")}.`;
};

/**
 * The design's own sentence, which names the from-level only when every
 * eligible wall shares one. A mixed selection has no single "from", and
 * inventing one would be a number the player could not check.
 */
const describePreview = (
  result: WallBatchPreview,
  target: number,
  top: number,
): string => {
  const total = result.eligible.length + result.skipped.length;
  if (total === 0) return "Nothing selected is a wall.";

  const tail =
    result.skipped.length > 0
      ? ` ${result.skipped.length} already at level ${target}${target < top ? " or higher" : ""}.`
      : "";

  if (result.eligible.length === 0) {
    return `Nothing to do: all ${total} are already at level ${target}${target < top ? " or higher" : ""}.`;
  }

  return `${result.eligible.length} of ${total} ${total === 1 ? "wall" : "walls"} will go to level ${target}.${tail}`;
};
