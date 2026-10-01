import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { BaseLoadResponse } from "@/api/types";
import {
  BAITER_ROSTER,
  attackSize,
  budgetOf,
  clampPicks,
  costOf,
  directionsOf,
  levelsFor,
  maxOf,
  type BaiterDirection,
  type BaiterLevels,
  type BaiterRun,
} from "@/game/baiter/baiterSession";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { monsterName } from "@/ui/attack/ArmyPanel";
import { formatAmount } from "@/ui/format";
import { monsterPicture } from "@/ui/monsters/LockerTab";
import { QuantityStepper } from "@/ui/QuantityStepper";
import "@/ui/styles/baiter.css";

/**
 * The Wild Monster Baiter's controls, inside its building panel (issue #126,
 * `docs/design/yard-buildings.md` §8.1): Flash's baiter popup
 * (`client/scripts/MONSTERBAITERPOPUP.as`) as a practice attack.
 *
 * Top to bottom: where the attack comes from (the corners, and the sides from
 * level 3), which stats the attackers fight with (level 1, as the original's
 * wild attack, or the player's academy levels, Q5), the attack size against
 * the level's budget, one row per monster C1–C14 with a stepper whose Fill
 * takes as many as still fit, then Clear and **Run**. Run hands the attack to
 * the Baiter scene; nothing here talks to the server.
 *
 * The army, the direction and the levels choice are kept for the session, as
 * Flash kept its queue (`MONSTERBAITER.Export`), so a second run starts from
 * the first one's picks.
 */

export interface BaiterPanelOptions {
  /** The Baiter's level: the budget and the directions. */
  readonly level: number;
  /** The own yard as it stands now, read when Run is pressed. */
  readonly save: () => BaseLoadResponse;
  /** Why no attack can start now (the Baiter is damaged or busy), or null. */
  readonly blocked: string | null;
  readonly onRun: (run: BaiterRun) => void;
}

/** What the last panel was set to, for the next one this session. */
let remembered: {
  picks: Record<string, number>;
  direction: string;
  levels: BaiterLevels;
} = { picks: {}, direction: "tl", levels: "wild" };

/** For tests: forget what earlier panels were set to. */
export const resetBaiterMemory = (): void => {
  remembered = { picks: {}, direction: "tl", levels: "wild" };
};

/** Where each direction sits in the 3 x 3 compass, row by row. */
const COMPASS: readonly (string | null)[] = ["tl", "t", "tr", "l", null, "r", "bl", "b", "br"];
const ARROWS: Readonly<Record<string, string>> = {
  tl: "↖",
  t: "↑",
  tr: "↗",
  l: "←",
  r: "→",
  bl: "↙",
  b: "↓",
  br: "↘",
};

export class BaiterPanel {
  readonly element: HTMLElement;

  private readonly options: BaiterPanelOptions;
  private readonly budget: number;
  private readonly directions: readonly BaiterDirection[];
  private readonly directionButtons = new Map<string, HTMLButtonElement>();
  private readonly levelButtons = new Map<BaiterLevels, HTMLButtonElement>();
  private readonly figures: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly steppers = new Map<string, QuantityStepper>();
  private readonly eachLabels = new Map<string, HTMLElement>();
  private readonly clearButton: HTMLButtonElement;
  private readonly runButton: HTMLButtonElement;

  private picks: Record<string, number>;
  private direction: BaiterDirection;
  private levelsChoice: BaiterLevels;

  constructor(options: BaiterPanelOptions) {
    this.options = options;
    this.budget = budgetOf(options.level);
    this.directions = directionsOf(options.level);
    this.direction =
      this.directions.find((one) => one.id === remembered.direction) ?? this.directions[0]!;
    this.levelsChoice = remembered.levels;
    this.picks = clampPicks(remembered.picks, this.budget, this.levels());

    this.element = document.createElement("section");
    this.element.className = "baiter";
    this.element.setAttribute("aria-label", "Practice attack");

    const lead = text(
      "p",
      "baiter__note",
      "Send wild monsters at your own yard to see how it holds. It is only practice: nothing is saved.",
    );

    // Direction.
    const compass = document.createElement("div");
    compass.className = "baiter-compass";
    compass.setAttribute("role", "radiogroup");
    compass.setAttribute("aria-label", "Where the attack comes from");
    for (const id of COMPASS) {
      const direction = id ? this.directions.find((one) => one.id === id) : undefined;
      if (!direction) {
        const cell = document.createElement("span");
        cell.className = id ? "baiter-compass__cell baiter-compass__cell--off" : "baiter-compass__yard";
        if (id) cell.title = "From level 3 the Baiter can bring an attack in from the sides too.";
        compass.append(cell);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "baiter-compass__cell";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", direction.label);
      button.title = direction.label;
      button.textContent = ARROWS[direction.id] ?? "•";
      button.addEventListener("click", () => {
        this.direction = direction;
        this.render();
      });
      this.directionButtons.set(direction.id, button);
      compass.append(button);
    }
    const from = part("From", compass);

    // Levels (Q5).
    const levels = document.createElement("div");
    levels.className = "baiter-switch";
    levels.setAttribute("role", "radiogroup");
    levels.setAttribute("aria-label", "Attacker levels");
    for (const [choice, label, title] of [
      ["wild", "Level 1", "Level 1 monsters, as the original Baiter's wild attack"],
      ["academy", "My academy levels", "Each monster at the level your Monster Academy has trained it to"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "baiter-switch__option";
      button.setAttribute("role", "radio");
      button.textContent = label;
      button.title = title;
      button.addEventListener("click", () => {
        this.levelsChoice = choice;
        this.picks = clampPicks(this.picks, this.budget, this.levels());
        this.render();
      });
      this.levelButtons.set(choice, button);
      levels.append(button);
    }
    const strength = part("Attackers", levels);

    // Size.
    this.figures = text("p", "baiter__figures", "");
    this.bar = document.createElement("div");
    this.bar.className = "monsters-bar baiter__bar";
    this.bar.setAttribute("role", "meter");
    this.bar.setAttribute("aria-label", "Attack size");
    this.bar.setAttribute("aria-valuemin", "0");
    this.bar.setAttribute("aria-valuemax", String(this.budget));
    this.fill = document.createElement("span");
    this.fill.className = "monsters-bar__fill";
    this.bar.append(this.fill);

    // Rows.
    const list = document.createElement("ul");
    list.className = "baiter__list";
    list.setAttribute("aria-label", "Monsters in the attack");
    for (const id of BAITER_ROSTER) list.append(this.row(id));

    // Actions.
    this.clearButton = button("Clear", "btn btn--ghost");
    this.clearButton.addEventListener("click", () => {
      this.picks = {};
      this.render();
    });
    this.runButton = button("Run attack", "btn btn--primary baiter__run");
    tutTarget(this.runButton, TutTarget.BAITER_RUN);
    this.runButton.addEventListener("click", () => this.run());
    const actions = document.createElement("div");
    actions.className = "baiter__actions";
    actions.append(this.clearButton, this.runButton);

    this.element.append(lead, from, strength, this.figures, this.bar, list, actions);
    if (options.blocked) this.element.append(text("p", "baiter__gate", options.blocked));
    this.render();
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  destroy(): void {
    for (const stepper of this.steppers.values()) stepper.destroy();
    this.steppers.clear();
    this.element.remove();
  }

  /** The picks, for the tests. */
  get army(): Readonly<Record<string, number>> {
    return this.picks;
  }

  private levels(): Record<string, number> {
    return levelsFor(this.levelsChoice, this.options.save());
  }

  private row(id: string): HTMLElement {
    const item = document.createElement("li");
    item.className = "baiter__row";
    const name = monsterName(id);
    const label = document.createElement("span");
    label.className = "baiter__name";
    const entry = monsterEntry(id);
    if (entry) label.append(monsterPicture(entry, "small", "baiter__picture"));
    const each = text("span", "baiter__each", "");
    this.eachLabels.set(id, each);
    label.append(text("span", "baiter__monster", name), each);
    const stepper = new QuantityStepper({
      block: "baiter",
      inputLabel: `${name} in the attack`,
      fewerLabel: `Fewer ${name}`,
      moreLabel: `More ${name}`,
      fillTitle: "As many as still fit in the attack",
      value: () => this.picks[id] ?? 0,
      set: (value) => this.set(id, value),
      fill: () => this.set(id, Number.MAX_SAFE_INTEGER),
      commit: () => this.render(),
    });
    this.steppers.set(id, stepper);
    item.append(label, stepper.element);
    return item;
  }

  private set(id: string, value: number): void {
    const max = maxOf(id, this.picks, this.budget, this.levels());
    const next = Math.max(0, Math.min(Math.floor(value), max));
    if (next > 0) this.picks = { ...this.picks, [id]: next };
    else {
      const rest = { ...this.picks };
      delete rest[id];
      this.picks = rest;
    }
    this.render();
  }

  private render(): void {
    remembered = { picks: { ...this.picks }, direction: this.direction.id, levels: this.levelsChoice };

    for (const [id, button] of this.directionButtons) {
      const on = id === this.direction.id;
      button.setAttribute("aria-checked", String(on));
      button.classList.toggle("baiter-compass__cell--on", on);
      button.tabIndex = on ? 0 : -1;
    }
    for (const [choice, button] of this.levelButtons) {
      const on = choice === this.levelsChoice;
      button.setAttribute("aria-checked", String(on));
      button.classList.toggle("baiter-switch__option--on", on);
    }

    const levels = this.levels();
    const used = attackSize(this.picks, levels);
    this.figures.replaceChildren(
      "Attack size ",
      strong(formatAmount(used)),
      ` / ${formatAmount(this.budget)}`,
    );
    this.bar.setAttribute("aria-valuenow", String(Math.min(used, this.budget)));
    this.fill.style.width = `${+((Math.min(used, this.budget) / this.budget) * 100).toFixed(2)}%`;

    for (const id of BAITER_ROSTER) {
      const each = this.eachLabels.get(id);
      if (each) each.textContent = `${formatAmount(costOf(id, levels))} space each`;
      this.steppers.get(id)?.sync({
        value: this.picks[id] ?? 0,
        max: maxOf(id, this.picks, this.budget, levels),
        disabled: false,
        rewrite: document.activeElement !== this.steppers.get(id)?.input,
      });
    }

    this.clearButton.disabled = used === 0;
    this.runButton.disabled = used === 0 || this.options.blocked !== null;
    this.runButton.title = this.options.blocked ?? (used === 0 ? "Pick some monsters first" : "");
  }

  private run(): void {
    if (this.options.blocked) return;
    const picks = clampPicks(this.picks, this.budget, this.levels());
    if (attackSize(picks, this.levels()) === 0) return;
    this.options.onRun({
      save: this.options.save(),
      picks,
      direction: this.direction,
      levels: this.levelsChoice,
      baiterLevel: this.options.level,
    });
  }
}

const text = (tag: "p" | "span", className: string, content: string): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
};

const strong = (content: string): HTMLElement => {
  const element = document.createElement("strong");
  element.textContent = content;
  return element;
};

const button = (label: string, className: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
};

const part = (heading: string, body: HTMLElement): HTMLElement => {
  const element = document.createElement("div");
  element.className = "baiter__part";
  element.append(text("p", "baiter__heading", heading), body);
  return element;
};
