import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { BaseLoadResponse } from "@/api/types";
import {
  TEST_ROSTER,
  allLevel1,
  allMax,
  armySize,
  capOf,
  clampArmy,
  emptyArmy,
  maxOf,
  myLevels,
  spaceOf,
  type BaiterRun,
  type TestArmy,
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
 * (`client/scripts/MONSTERBAITERPOPUP.as`) as a defence test.
 *
 * Top to bottom: level shortcuts (My levels, All level 1, All max), the army
 * size against the level's cap, one row per test monster (issue #22: the 18
 * surface monsters) at its level, with a stepper whose Fill takes as many as
 * still fit, then Clear and **Run**. Run hands the test to the Baiter scene;
 * nothing here talks to the server. The full setup panel, with a level picker
 * per row and champions, is #22's WP2.
 *
 * The army is kept for the session, as Flash kept its queue
 * (`MONSTERBAITER.Export`), so a second run starts from the first one's.
 */

export interface BaiterPanelOptions {
  /** The Baiter's level: the army's cap. */
  readonly level: number;
  /** The own yard as it stands now, read when Run is pressed. */
  readonly save: () => BaseLoadResponse;
  /** Why no attack can start now (the Baiter is damaged or busy), or null. */
  readonly blocked: string | null;
  readonly onRun: (run: BaiterRun) => void;
}

/** The last panel's army, for the next one this session. */
let remembered: TestArmy | null = null;

/** For tests: forget what earlier panels were set to. */
export const resetBaiterMemory = (): void => {
  remembered = null;
};

export class BaiterPanel {
  readonly element: HTMLElement;

  private readonly options: BaiterPanelOptions;
  private readonly cap: number;
  private readonly figures: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly steppers = new Map<string, QuantityStepper>();
  private readonly eachLabels = new Map<string, HTMLElement>();
  private readonly clearButton: HTMLButtonElement;
  private readonly runButton: HTMLButtonElement;

  private testArmy: TestArmy;

  constructor(options: BaiterPanelOptions) {
    this.options = options;
    this.cap = capOf(options.level);
    this.testArmy = clampArmy(remembered ?? emptyArmy(options.save()), this.cap);

    this.element = document.createElement("section");
    this.element.className = "baiter";
    this.element.setAttribute("aria-label", "Practice attack");

    const lead = text(
      "p",
      "baiter__note",
      "Send wild monsters at your own yard to see how it holds. It is only practice: nothing is saved.",
    );

    // Level shortcuts.
    const levels = document.createElement("div");
    levels.className = "baiter-switch";
    levels.setAttribute("aria-label", "Attacker levels");
    const shortcuts: ReadonlyArray<readonly [string, string, (army: TestArmy) => TestArmy]> = [
      [
        "My levels",
        "Each monster at the level your Monster Academy has trained it to",
        (army) => myLevels(army, this.options.save()),
      ],
      ["All level 1", "Every monster at level 1", allLevel1],
      ["All max", "Every monster at its highest level", allMax],
    ];
    for (const [label, title, apply] of shortcuts) {
      const shortcut = button(label, "baiter-switch__option");
      shortcut.title = title;
      shortcut.addEventListener("click", () => {
        this.testArmy = clampArmy(apply(this.testArmy), this.cap);
        this.render();
      });
      levels.append(shortcut);
    }
    const strength = part("Levels", levels);

    // Size.
    this.figures = text("p", "baiter__figures", "");
    this.bar = document.createElement("div");
    this.bar.className = "monsters-bar baiter__bar";
    this.bar.setAttribute("role", "meter");
    this.bar.setAttribute("aria-label", "Attack size");
    this.bar.setAttribute("aria-valuemin", "0");
    this.bar.setAttribute("aria-valuemax", String(this.cap));
    this.fill = document.createElement("span");
    this.fill.className = "monsters-bar__fill";
    this.bar.append(this.fill);

    // Rows.
    const list = document.createElement("ul");
    list.className = "baiter__list";
    list.setAttribute("aria-label", "Monsters in the attack");
    for (const id of TEST_ROSTER) list.append(this.row(id));

    // Actions.
    this.clearButton = button("Clear", "btn btn--ghost");
    this.clearButton.addEventListener("click", () => {
      this.testArmy = clampArmy(
        { monsters: this.withCounts(() => 0), champions: [] },
        this.cap,
      );
      this.render();
    });
    this.runButton = button("Run attack", "btn btn--primary baiter__run");
    tutTarget(this.runButton, TutTarget.BAITER_RUN);
    this.runButton.addEventListener("click", () => this.run());
    const actions = document.createElement("div");
    actions.className = "baiter__actions";
    actions.append(this.clearButton, this.runButton);

    this.element.append(lead, strength, this.figures, this.bar, list, actions);
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

  /** The test army, for the tests. */
  get army(): TestArmy {
    return this.testArmy;
  }

  /** Every row with the count `countOf` gives it, at its level. */
  private withCounts(countOf: (id: string) => number): TestArmy["monsters"] {
    return Object.fromEntries(
      TEST_ROSTER.map((id) => [id, { count: countOf(id), level: this.testArmy.monsters[id]?.level ?? 1 }]),
    );
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
      value: () => this.testArmy.monsters[id]?.count ?? 0,
      set: (value) => this.set(id, value),
      fill: () => this.set(id, Number.MAX_SAFE_INTEGER),
      commit: () => this.render(),
    });
    this.steppers.set(id, stepper);
    item.append(label, stepper.element);
    return item;
  }

  private set(id: string, value: number): void {
    const count = Math.max(0, Math.min(Math.floor(value), maxOf(this.testArmy, id, this.cap)));
    const level = this.testArmy.monsters[id]?.level ?? 1;
    this.testArmy = { ...this.testArmy, monsters: { ...this.testArmy.monsters, [id]: { count, level } } };
    this.render();
  }

  private render(): void {
    remembered = this.testArmy;

    const used = armySize(this.testArmy);
    this.figures.replaceChildren(
      "Attack size ",
      strong(formatAmount(used)),
      ` / ${formatAmount(this.cap)}`,
    );
    this.bar.setAttribute("aria-valuenow", String(Math.min(used, this.cap)));
    this.fill.style.width = `${+((Math.min(used, this.cap) / this.cap) * 100).toFixed(2)}%`;

    for (const id of TEST_ROSTER) {
      const row = this.testArmy.monsters[id];
      const level = row?.level ?? 1;
      const each = this.eachLabels.get(id);
      if (each) each.textContent = `Level ${level} · ${formatAmount(spaceOf(id, level))} space each`;
      this.steppers.get(id)?.sync({
        value: row?.count ?? 0,
        max: maxOf(this.testArmy, id, this.cap),
        disabled: false,
        rewrite: document.activeElement !== this.steppers.get(id)?.input,
      });
    }

    const empty = used === 0 && this.testArmy.champions.length === 0;
    this.clearButton.disabled = empty;
    this.runButton.disabled = empty || this.options.blocked !== null;
    this.runButton.title = this.options.blocked ?? (empty ? "Pick some monsters first" : "");
  }

  private run(): void {
    if (this.options.blocked) return;
    const army = clampArmy(this.testArmy, this.cap);
    if (armySize(army) === 0 && army.champions.length === 0) return;
    this.options.onRun({ save: this.options.save(), army, baiterLevel: this.options.level });
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
