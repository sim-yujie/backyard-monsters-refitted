import { ArtState, resolveArt } from "@/game/yard/buildingArt";
import { maxLevel, townHallLevel, WALL_TYPES } from "@/game/yard/buildingCosts";
import type { PlanNode } from "@/game/yard/planner/placement";
import {
  effectiveLevel,
  heldResources,
  isShort,
  wallBatchPreview,
  wallTargets,
  type ResourceAmounts,
  type WallBatchPreview,
} from "@/game/yard/planner/summary";
import {
  affordableFill,
  followWallTarget,
  selectAllCheck,
  type WallTargetChoice,
} from "@/game/yard/planner/wallPick";
import type { Yard } from "@/game/yard/yardModel";
import { formatAmount, formatShort } from "@/ui/format";
import { gameIcon } from "@/ui/gameIcon";
import { Panel } from "@/ui/Panel";
import { RESOURCE_KEYS, resourceIcon, resourceName } from "@/ui/resourceIcon";

/**
 * Batch wall upgrade: choose the level, pick the walls, read the cost, upgrade
 * (plan §3.3, decision Q1; laid out again by the owner, 2026-11-04).
 *
 * The whole panel is a preview of one server call. Nothing here charges
 * anything or changes the plan — Upgrade hands the eligible ids and the target
 * to the caller, which posts them, and the yard comes back from the server.
 *
 * ## Top to bottom, in the order a player decides (owner, 2026-11-04)
 *
 * "it is more intuitive the user selects what level they want first, then what
 * they can afford or all if they have the resource and can afford it (or else
 * just grey it out)". So:
 *
 * 1. **Raise to**: four big buttons, Level 2 to 5, each with that level's wall
 *    picture. A level the hall has not earned, or one that would raise none of
 *    the picked walls, is greyed with the reason in its tooltip rather than
 *    hidden: a level that vanishes tells the player nothing about how to get it.
 * 2. **Select all / Affordable / Clear** (picking only): Select all is greyed
 *    when the yard cannot pay for every wall below the level, Affordable when
 *    it cannot pay for one, Clear when nothing is picked.
 * 3. The pick, and what it costs: resource icons and short figures (red when
 *    short; the whole figure in the tooltip), and the time.
 * 4. Upgrade N, greyed when it cannot be sent, and Cancel.
 *
 * ## Picking
 *
 * Given `pick`, the panel is the Upgrade walls mode's own: it stays open while
 * the player boxes and taps walls on the yard, and the scene hands it each new
 * pick (`setNodes`). The level follows the pick: one above the lowest wall
 * picked (or, with nothing picked, the lowest wall in the yard), the cheapest
 * step that means anything. A level the player pressed is kept while it still
 * raises a picked wall (`followWallTarget`).
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
  /** Upgrade: the ids the server should raise, and the level to raise them to. */
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

/** Each batch step takes this long, so every wall finishes as soon as it is paid for. */
const STEP_SECONDS = 5;

const isWall = (node: PlanNode): boolean => !node.fixed && WALL_TYPES.includes(node.type);

export const wallUpgradePanel = (options: WallUpgradePanelOptions): WallUpgradePanel => {
  const pick = options.pick;
  let yard = options.yard;
  let walls = options.nodes.filter(isWall);
  const hall = townHallLevel(yard);
  // The Inferno's walls climb the Inferno table, counted by the Under Hall.
  const kind = yard.kind;
  const hallWord = kind === "inferno" ? "Under Hall" : "Town Hall";
  const realm = kind === "inferno" ? "inferno" : "surface";
  const targets = wallTargets(kind);
  const top = maxLevel(WALL_LADDER_TYPE, kind);
  const picked = pick ? "picked" : "selected";

  const panel = new Panel({
    title: "Upgrade walls",
    className: pick ? "map-panel planner-walls planner-walls--pick" : "map-panel planner-walls",
    onClose: options.onClose,
  });

  const allowed = targets.filter((entry) => entry.need <= hall);
  // Not picking: the highest the hall allows, the answer a player who
  // selected their walls first almost always wants. Picking: the level
  // follows the pick (see "Picking" above).
  let choice: WallTargetChoice = {
    target: allowed.at(-1)?.level ?? targets[0]?.level ?? 2,
    manual: false,
  };
  const follow = (): void => {
    if (pick) choice = followWallTarget(choice, walls, pick.allWalls(), allowed, yard);
  };
  follow();
  let target = choice.target;

  const content: HTMLElement[] = [];

  /* ── 1. Raise to: the level first ───────────────────────────────────── */

  const levelHeading = document.createElement("h3");
  levelHeading.className = "planner-walls__heading";
  levelHeading.id = `planner-walls-levels-${Math.random().toString(36).slice(2, 8)}`;
  levelHeading.textContent = "Raise to";

  const levelRow = document.createElement("div");
  levelRow.className = "planner-walls__levels";
  levelRow.setAttribute("role", "group");
  levelRow.setAttribute("aria-labelledby", levelHeading.id);

  const buttons = new Map<number, HTMLButtonElement>();
  for (const entry of targets) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "btn btn--outline planner-walls__level";
    element.dataset["level"] = String(entry.level);
    element.append(...levelFace(entry.level, kind));
    element.addEventListener("click", () => {
      choice = { target: entry.level, manual: true };
      target = entry.level;
      render();
    });
    buttons.set(entry.level, element);
    levelRow.append(element);
  }
  content.push(levelHeading, levelRow);

  // Everything the hall allows is out of reach: there is no target to pick.
  if (allowed.length === 0) {
    const none = document.createElement("p");
    none.className = "planner-walls__gate u-muted";
    none.textContent = `Your ${hallWord} is not high enough for any wall upgrade yet.`;
    content.push(none);
  }

  /* ── 2. Which walls: all, what can be paid for, or none ─────────────── */

  const tools = document.createElement("div");
  tools.className = "planner-walls__tools";
  const all = toolButton("Select all");
  const afford = toolButton("Affordable");
  afford.classList.add("planner-walls__afford");
  const clear = toolButton("Clear");
  clear.title = "Pick no walls";
  let allIds: number[] = [];
  let affordIds: number[] = [];
  if (pick) {
    all.addEventListener("click", () => pick.onPick(allIds));
    afford.addEventListener("click", () => pick.onPick(affordIds));
    clear.addEventListener("click", () => pick.onPick([]));
    tools.append(all, afford, clear);
    content.push(tools);
  }

  /* ── 3. The pick and its cost ───────────────────────────────────────── */

  const held = document.createElement("p");
  held.className = "planner-walls__held";

  const hint = document.createElement("p");
  hint.className = "planner-walls__hint u-muted";
  hint.textContent = pick?.touch ? "Drag a box over walls, or tap one." : "Drag a box over walls, or click one.";

  const preview = document.createElement("p");
  preview.className = "planner-walls__preview u-muted";

  const costs = document.createElement("ul");
  costs.className = "planner-walls__costs";
  costs.setAttribute("aria-label", "Cost");

  const note = document.createElement("p");
  note.className = "planner-walls__note u-muted";

  content.push(held);
  if (pick) content.push(hint);
  content.push(preview, costs, note);

  /* ── 4. Upgrade ─────────────────────────────────────────────────────── */

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "btn btn--primary planner-walls__go";
  confirm.append(gameIcon("wallupgrade", { size: 24, decorative: true }));
  const confirmLabel = document.createElement("span");
  confirm.append(confirmLabel);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn--ghost";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => panel.close());

  const footer = document.createElement("div");
  footer.className = "planner-walls__actions";
  footer.append(confirm, cancel);
  content.push(footer);

  const render = (): void => {
    const result = wallBatchPreview(walls, target, yard);
    const short = isShort(result.shortfall);
    // With nothing picked, a level is judged against the whole yard.
    const judged = walls.length > 0 || !pick ? walls : pick.allWalls().filter(isWall);

    for (const entry of targets) {
      const element = buttons.get(entry.level);
      if (!element) continue;
      element.setAttribute("aria-pressed", String(entry.level === target));
      const gated = entry.need > hall;
      const raisesNone =
        !gated && judged.length > 0 && judged.every((wall) => effectiveLevel(wall) >= entry.level);
      element.disabled = gated || raisesNone;
      element.title = gated
        ? `Needs ${hallWord} ${entry.need}; yours is ${hall === 0 ? "missing" : `level ${hall}`}.`
        : raisesNone
          ? `Every ${walls.length > 0 ? `${picked} ` : ""}wall is already at level ${entry.level}${entry.level < top ? " or higher" : ""}.`
          : `Raise ${walls.length > 0 ? `the ${picked} walls` : "walls"} to level ${entry.level}.`;
    }

    if (pick) {
      const everything = pick.allWalls();
      const allCheck = selectAllCheck(everything, target, yard, hallWord);
      allIds = allCheck.ids;
      all.disabled = allCheck.reason !== null;
      all.title =
        allCheck.reason ??
        `Pick all ${allIds.length} ${allIds.length === 1 ? "wall" : "walls"} below level ${target}.`;

      const fill = affordableFill(walls, everything, target, yard);
      affordIds = fill.ids;
      afford.disabled = fill.reason !== null;
      afford.title = fill.reason ?? `Pick as many walls as you can pay for at level ${target}.`;
    }
    clear.disabled = walls.length === 0;

    held.textContent = describeHoldings(walls, picked);
    hint.hidden = walls.length > 0;
    preview.textContent = describePreview(result, target, top, picked);
    costs.replaceChildren(
      ...costChips(result.cost, heldResources(yard.resources), result.shortfall, realm),
      ...(result.eligible.length > 0 ? [timeChip(result.steps)] : []),
    );
    costs.hidden = result.eligible.length === 0;

    // The line a new player most needs: whether this pick can be paid for.
    note.textContent =
      result.eligible.length > 0 && short && result.gate === null
        ? pick
          ? "Not enough to upgrade all of these. Pick fewer, or press Affordable."
          : "Not enough to upgrade all of these."
        : "";
    note.classList.toggle("planner-walls__note--short", note.textContent !== "");
    note.hidden = note.textContent === "";

    const blocked = result.eligible.length === 0 || short || result.gate !== null;
    confirm.disabled = blocked;
    // Upgrade carries the count it will raise: "Upgrade 12".
    confirmLabel.textContent = result.eligible.length > 0 ? `Upgrade ${result.eligible.length}` : "Upgrade";
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
  panel.setContent(...content);

  return Object.assign(panel, {
    setNodes(nodes: readonly PlanNode[], next?: Yard): void {
      walls = nodes.filter(isWall);
      if (next) yard = next;
      follow();
      target = choice.target;
      render();
    },
  });
};

/** A level button's inside: that level's wall, then "Level N". */
const levelFace = (level: number, kind: Yard["kind"]): HTMLElement[] => {
  const name = document.createElement("span");
  name.className = "planner-walls__level-name";
  name.textContent = `Level ${level}`;

  const art = resolveArt(WALL_LADDER_TYPE, level, ArtState.DEFAULT, kind);
  const picture = art ? (art.still ?? art.top) : null;
  if (!picture || picture.frame) return [name];
  const image = document.createElement("img");
  image.className = "planner-walls__level-art";
  image.src = picture.url;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.setAttribute("decoding", "async");
  return [image, name];
};

const toolButton = (label: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "btn btn--outline planner-walls__tool";
  element.textContent = label;
  return element;
};

/** Words only a screen reader hears: the chip shows the short figure. */
const spoken = (text: string): HTMLElement => {
  const element = document.createElement("span");
  element.className = "planner-walls__sr";
  element.textContent = text;
  return element;
};

/**
 * One chip per resource the pick costs: its icon and a short figure, red when
 * the yard holds too little. The whole figures are in the tooltip and spoken.
 */
const costChips = (
  cost: ResourceAmounts,
  held: ResourceAmounts,
  shortfall: ResourceAmounts,
  realm: "surface" | "inferno",
): HTMLElement[] =>
  RESOURCE_KEYS.filter((key) => cost[key] > 0).map((key) => {
    const chip = document.createElement("li");
    chip.className = "planner-walls__cost";
    chip.dataset["key"] = key;
    const lacking = shortfall[key];
    const name = resourceName(key, realm).toLowerCase();
    const words =
      lacking > 0
        ? `${formatAmount(cost[key])} ${name} needed — you hold ${formatAmount(held[key])}, ${formatAmount(lacking)} short`
        : `${formatAmount(cost[key])} ${name} of ${formatAmount(held[key])}`;
    chip.title = words;
    if (lacking > 0) chip.classList.add("planner-cost__row--short", "planner-walls__cost--short");
    const figure = document.createElement("span");
    figure.className = "planner-walls__cost-value";
    figure.textContent = formatShort(cost[key]);
    figure.setAttribute("aria-hidden", "true");
    chip.append(resourceIcon(key, { decorative: true, tooltip: false, realm }), figure, spoken(words));
    return chip;
  });

/** The time chip: batch steps are short enough that the walls finish on payment. */
const timeChip = (steps: number): HTMLElement => {
  const chip = document.createElement("li");
  chip.className = "planner-walls__cost planner-walls__cost--time";
  const words = `${steps} ${steps === 1 ? "step" : "steps"} of ${STEP_SECONDS} seconds each: the walls finish as soon as you pay.`;
  chip.title = words;
  const figure = document.createElement("span");
  figure.className = "planner-walls__cost-value";
  figure.textContent = "Instant";
  figure.setAttribute("aria-hidden", "true");
  chip.append(gameIcon("time", { size: 24, decorative: true }), figure, spoken(words));
  return chip;
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
