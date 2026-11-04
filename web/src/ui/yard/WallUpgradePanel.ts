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
import { affordablePick } from "@/game/yard/planner/wallPick";
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
 * ## Picking (owner, 2026-11-04)
 *
 * Given `pick`, the panel is the Upgrade walls mode's own: it stays open while
 * the player boxes and taps walls on the yard, the scene hands it each new
 * pick (`setNodes`), and it adds Select all, Clear and Affordable. Affordable
 * trims a pick the yard cannot pay for down to one it can (or, with nothing
 * picked, picks as many walls as it can pay for), because the owner's players
 * are new and can rarely raise every wall at once. In this mode the level
 * starts one above the lowest wall in the yard, the cheapest step that means
 * anything, rather than at the highest the hall allows.
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

/** The Upgrade walls mode's controls: the pick lives in the scene, on the yard. */
export interface WallPickControls {
  /** Every wall on the plot: Select all, and Affordable with nothing picked. */
  allWalls: () => readonly PlanNode[];
  /** Replace the pick with these ids. The scene answers with `setNodes`. */
  onPick: (ids: number[]) => void;
  /** The screen is touched: the hint says "tap", not "click". */
  touch?: boolean;
}

export interface WallUpgradePanelOptions {
  /** The current selection. Anything that is not a wall is ignored. */
  nodes: readonly PlanNode[];
  yard: Yard;
  /** Confirm: the ids the server should raise, and the level to raise them to. */
  onConfirm: (ids: number[], level: number) => void;
  onClose: () => void;
  /** Present: the panel runs the Upgrade walls mode (see "Picking" above). */
  pick?: WallPickControls;
}

export type WallUpgradePanel = Panel & {
  /** A new pick (and the yard, when it changed): redraws the counts and the cost. */
  setNodes(nodes: readonly PlanNode[], yard?: Yard): void;
};

/** Wall type 17's ladder tops out here; the targets run from 2 to this. */
const WALL_LADDER_TYPE = 17;

const isWall = (node: PlanNode): boolean => !node.fixed && WALL_TYPES.includes(node.type);

export const wallUpgradePanel = (options: WallUpgradePanelOptions): WallUpgradePanel => {
  const pick = options.pick;
  let yard = options.yard;
  let walls = options.nodes.filter(isWall);
  const hall = townHallLevel(yard);
  // The Inferno's walls climb the Inferno table, counted by the Under Hall.
  const kind = yard.kind;
  const hallWord = kind === "inferno" ? "Under Hall" : "Town Hall";
  const targets = wallTargets(kind);
  const top = maxLevel(WALL_LADDER_TYPE, kind);
  const picked = pick ? "picked" : "selected";

  const panel = new Panel({
    title: "Upgrade walls",
    className: pick ? "map-panel planner-walls planner-walls--pick" : "map-panel planner-walls",
    onClose: options.onClose,
  });

  const allowed = targets.filter((entry) => entry.need <= hall);
  // Picking: one above the lowest wall in the yard, the cheapest step a new
  // player can take. Otherwise the highest the hall allows, the answer a
  // player who selected their walls first almost always wants.
  const lowest = pick
    ? Math.min(...pick.allWalls().map(effectiveLevel), Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;
  let target =
    (Number.isFinite(lowest)
      ? (allowed.find((entry) => entry.level > lowest) ?? allowed.at(-1))?.level
      : allowed.at(-1)?.level) ??
    targets[0]?.level ??
    2;

  const content: HTMLElement[] = [];

  /* ── Picking: the hint and the three pick buttons ──────────────────── */

  const tools = document.createElement("div");
  tools.className = "planner-walls__tools";
  const clear = toolButton("Clear", "Pick no walls");
  if (pick) {
    const hint = document.createElement("p");
    hint.className = "planner-walls__hint u-muted";
    hint.textContent = pick.touch
      ? "Drag a box over walls, or tap one."
      : "Drag a box over walls, or click one.";

    const all = toolButton("Select all", "Pick every wall in the yard");
    all.addEventListener("click", () => pick.onPick(pick.allWalls().map((node) => node.id)));

    clear.addEventListener("click", () => pick.onPick([]));

    const afford = toolButton(
      "Affordable",
      "Pick only as many walls as you can pay for (from your pick, or from every wall)",
    );
    afford.classList.add("planner-walls__afford");
    afford.addEventListener("click", () => {
      const from = walls.length > 0 ? walls : pick.allWalls();
      const ids = affordablePick(from, target, yard);
      if (ids.length === 0) {
        note.textContent = `You cannot afford a single wall at level ${target} yet.`;
        return;
      }
      pick.onPick(ids);
    });

    tools.append(all, clear, afford);
    content.push(hint, tools);
  }

  const held = document.createElement("p");
  held.className = "planner-walls__held u-muted";

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
      ? `Needs ${hallWord} ${entry.need}; yours is ${hall === 0 ? "missing" : `level ${hall}`}.`
      : `Take every ${picked} wall to level ${entry.level}.`;

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
    none.textContent = `Your ${hallWord} is not high enough for any wall upgrade yet.`;
    levelRow.append(none);
  }

  const render = (): void => {
    const result = wallBatchPreview(walls, target, yard);
    const short = isShort(result.shortfall);

    for (const [level, element] of buttons) {
      element.setAttribute("aria-pressed", String(level === target));
    }

    held.textContent = describeHoldings(walls, picked);
    preview.textContent = describePreview(result, target, top, picked);
    costs.replaceChildren(...costRows(result.cost, heldResources(yard.resources), result.shortfall));
    clear.disabled = walls.length === 0;

    if (pick) {
      // The line a new player most needs: whether this pick can be paid for.
      note.textContent =
        result.eligible.length > 0 && short && result.gate === null
          ? "Not enough to upgrade all of these. Pick fewer, or press Affordable."
          : "";
      note.classList.toggle("planner-walls__note--short", note.textContent !== "");
    } else {
      note.textContent =
        result.eligible.length === 0
          ? ""
          : `${result.steps} ${result.steps === 1 ? "step" : "steps"} of five seconds each, so every wall finishes the moment the server takes the payment.`;
    }

    const blocked = result.eligible.length === 0 || short || result.gate !== null;
    confirm.disabled = blocked;
    // Picking, Confirm carries the count it will raise: "Upgrade 12".
    confirm.textContent =
      pick && result.eligible.length > 0 ? `Upgrade ${result.eligible.length}` : "Confirm";
    confirm.title = result.gate
      ? `Needs ${hallWord} ${result.gate.need}.`
      : result.eligible.length === 0
        ? `Nothing ${picked} would change.`
        : short
          ? "You cannot afford this yet."
          : `Raise ${result.eligible.length} ${result.eligible.length === 1 ? "wall" : "walls"} to level ${target}.`;

    confirm.onclick = blocked ? null : () => options.onConfirm([...result.eligible], target);
  };

  render();
  panel.setContent(...content, held, levelRow, preview, costs, note, footer);

  return Object.assign(panel, {
    setNodes(nodes: readonly PlanNode[], next?: Yard): void {
      walls = nodes.filter(isWall);
      if (next) yard = next;
      render();
    },
  });
};

const toolButton = (label: string, title: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "btn btn--ghost planner-walls__tool";
  element.textContent = label;
  element.title = title;
  return element;
};

/** "40 walls selected: 34 at level 1, 6 at level 5." */
const describeHoldings = (walls: readonly PlanNode[], picked: string): string => {
  if (walls.length === 0) {
    return picked === "picked" ? "No walls picked yet." : "No walls are selected.";
  }

  const byLevel = new Map<number, number>();
  for (const wall of walls) {
    const level = effectiveLevel(wall);
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  }
  const parts = [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, count]) => `${count} at level ${level}`);

  return `${walls.length} ${walls.length === 1 ? "wall" : "walls"} ${picked}: ${parts.join(", ")}.`;
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
  picked: string,
): string => {
  const total = result.eligible.length + result.skipped.length;
  if (total === 0) {
    return picked === "picked" ? "Pick walls on the yard." : "Nothing selected is a wall.";
  }

  const tail =
    result.skipped.length > 0
      ? ` ${result.skipped.length} already at level ${target}${target < top ? " or higher" : ""}.`
      : "";

  if (result.eligible.length === 0) {
    return `Nothing to do: all ${total} are already at level ${target}${target < top ? " or higher" : ""}.`;
  }

  return `${result.eligible.length} of ${total} ${total === 1 ? "wall" : "walls"} will go to level ${target}.${tail}`;
};
