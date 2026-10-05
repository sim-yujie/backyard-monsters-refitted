import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { BaseLoadResponse } from "@/api/types";
import { KRALLEN_TYPE } from "@/game/attack/AttackSession";
import {
  TEST_ROSTER,
  allLevel1,
  allMax,
  armySize,
  capOf,
  championLevels,
  championPowerLevels,
  clampArmy,
  clampLevel,
  emptyArmy,
  isUnlocked,
  maxOf,
  myArmy,
  myLevels,
  spaceOf,
  withChampion,
  withoutChampion,
  type BaiterRun,
  type TestArmy,
  type TestChampion,
} from "@/game/baiter/baiterSession";
import { CHAMPION_STANCES, isChampionStance } from "@/game/combat/rules";
import { maxTrainingLevel, monsterEntry } from "@/game/monsters/monsterCatalogue";
import { CHAMPION_CATALOGUE } from "@/game/yard/championCatalogue";
import { STANCE_TEXT, championName, monsterName } from "@/ui/attack/ArmyPanel";
import { formatAmount } from "@/ui/format";
import { monsterPicture } from "@/ui/monsters/LockerTab";
import { QuantityStepper } from "@/ui/QuantityStepper";
import "@/ui/styles/baiter.css";

/**
 * The Wild Monster Baiter's test setup, inside its building panel (issues
 * #126 and #22, `docs/design/baiter-simulator.md` §5.1 and §6 steps 1-5):
 * Flash's baiter popup (`client/scripts/MONSTERBAITERPOPUP.as`) as a defence
 * simulator.
 *
 * Top to bottom: the shortcuts (My army, My levels, All level 1, All max), the
 * army size against the Baiter level's cap, one row per test monster (the 18
 * surface monsters, unlocked ones first, locked ones tagged) with its own
 * level picker and a stepper whose Fill takes as many as still fit, the
 * champions (one ordinary champion plus Krallen, each at any level, power
 * level and Mode), then Clear and **Start test**. Start hands the test to the
 * Baiter scene; nothing here talks to the server, and a test is free.
 *
 * The army is kept for the session, as Flash kept its queue
 * (`MONSTERBAITER.Export`), so a second test starts from the first one's.
 */

export interface BaiterPanelOptions {
  /** The Baiter's level: the army's cap. */
  readonly level: number;
  /** The own yard as it stands now, read when Start test is pressed. */
  readonly save: () => BaseLoadResponse;
  /** Why no test can start now (the Baiter is damaged or busy), or null. */
  readonly blocked: string | null;
  readonly onRun: (run: BaiterRun) => void;
}

/** The last panel's army, for the next one this session. */
let remembered: TestArmy | null = null;

/** For tests: forget what earlier panels were set to. */
export const resetBaiterMemory = (): void => {
  remembered = null;
};

/** The ordinary champions, in the cage's order: every one but Krallen. */
const ORDINARY_CHAMPIONS: readonly number[] = CHAMPION_CATALOGUE.filter(
  (entry) => entry.t !== KRALLEN_TYPE,
).map((entry) => entry.t);

/** The Mode a champion fights in when none was picked. */
const DEFAULT_STANCE = "hybrid";

/** One champion slot's controls: the ordinary one or Krallen's. */
interface ChampionSlot {
  readonly krallen: boolean;
  /** The ordinary slot's type picker, or Krallen's on/off box. */
  readonly pick: HTMLSelectElement | HTMLInputElement;
  readonly details: HTMLElement;
  readonly level: HTMLSelectElement;
  readonly power: HTMLSelectElement;
  readonly mode: HTMLSelectElement;
}

export class BaiterPanel {
  readonly element: HTMLElement;

  private readonly options: BaiterPanelOptions;
  private readonly cap: number;
  private readonly figures: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly steppers = new Map<string, QuantityStepper>();
  private readonly levelPickers = new Map<string, HTMLSelectElement>();
  private readonly eachLabels = new Map<string, HTMLElement>();
  private readonly slots: ChampionSlot[] = [];
  private readonly clearButton: HTMLButtonElement;
  private readonly runButton: HTMLButtonElement;

  private testArmy: TestArmy;

  constructor(options: BaiterPanelOptions) {
    this.options = options;
    this.cap = capOf(options.level);
    const save = options.save();
    this.testArmy = clampArmy(remembered ?? emptyArmy(save), this.cap);

    this.element = document.createElement("section");
    this.element.className = "baiter";
    this.element.setAttribute("aria-label", "Defence test");

    const lead = text(
      "p",
      "baiter__note",
      "Make up any army and test it against your yard as it stands. Tests are free, and nothing is saved.",
    );

    // Shortcuts.
    const shortcuts = document.createElement("div");
    shortcuts.className = "baiter__shortcuts";
    const choices: ReadonlyArray<readonly [string, string, (army: TestArmy) => TestArmy]> = [
      ["My army", "The monsters housed in your yard now, at your levels", (army) => myArmy(army, this.options.save())],
      [
        "My levels",
        "Each monster at the level your Monster Academy has trained it to",
        (army) => myLevels(army, this.options.save()),
      ],
      ["All level 1", "Every monster at level 1", allLevel1],
      ["All max", "Every monster at its highest level", allMax],
    ];
    for (const [label, title, apply] of choices) {
      const shortcut = button(label, "btn btn--outline baiter__shortcut");
      shortcut.title = title;
      shortcut.addEventListener("click", () => {
        this.testArmy = clampArmy(apply(this.testArmy), this.cap);
        this.render();
      });
      shortcuts.append(shortcut);
    }

    // Size.
    this.figures = text("p", "baiter__figures", "");
    this.bar = document.createElement("div");
    this.bar.className = "monsters-bar baiter__bar";
    this.bar.setAttribute("role", "meter");
    this.bar.setAttribute("aria-label", "Army size");
    this.bar.setAttribute("aria-valuemin", "0");
    this.bar.setAttribute("aria-valuemax", String(this.cap));
    this.fill = document.createElement("span");
    this.fill.className = "monsters-bar__fill";
    this.bar.append(this.fill);

    // Rows: the monsters the player has unlocked first, each group in roster order.
    const list = document.createElement("ul");
    list.className = "baiter__list";
    list.setAttribute("aria-label", "Monsters in the test");
    const unlocked = TEST_ROSTER.filter((id) => isUnlocked(save, id));
    const locked = TEST_ROSTER.filter((id) => !isUnlocked(save, id));
    for (const id of unlocked) list.append(this.row(id, false));
    for (const id of locked) list.append(this.row(id, true));

    // Champions.
    const champions = document.createElement("div");
    champions.className = "baiter__champions";
    champions.append(this.slot(false), this.slot(true));

    // Actions.
    this.clearButton = button("Clear", "btn btn--ghost");
    this.clearButton.addEventListener("click", () => {
      this.testArmy = clampArmy({ monsters: this.withCounts(() => 0), champions: [] }, this.cap);
      this.render();
    });
    this.runButton = button("Start test", "btn btn--primary baiter__run");
    tutTarget(this.runButton, TutTarget.BAITER_RUN);
    this.runButton.addEventListener("click", () => this.run());
    const actions = document.createElement("div");
    actions.className = "baiter__actions";
    actions.append(this.clearButton, this.runButton);

    this.element.append(
      lead,
      part("Quick set", shortcuts),
      this.figures,
      this.bar,
      list,
      part("Champions", champions),
      actions,
    );
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

  private row(id: string, locked: boolean): HTMLElement {
    const item = document.createElement("li");
    item.className = locked ? "baiter__row baiter__row--locked" : "baiter__row";
    const name = monsterName(id);

    const head = document.createElement("span");
    head.className = "baiter__name";
    const entry = monsterEntry(id);
    if (entry) head.append(monsterPicture(entry, "small", "baiter__picture"));
    head.append(text("span", "baiter__monster", name));
    if (locked) {
      const tag = text("span", "baiter__tag", "Not unlocked");
      tag.title = "You have not unlocked this monster, but a test can still send it";
      head.append(tag);
    }
    const each = text("span", "baiter__each", "");
    this.eachLabels.set(id, each);
    head.append(each);

    const level = select("baiter__level", `${name}'s level`);
    for (let value = 1; value <= Math.max(1, maxTrainingLevel(id)); value += 1) {
      level.append(option(String(value), `Level ${value}`));
    }
    level.disabled = level.options.length < 2;
    level.addEventListener("change", () => this.setLevel(id, Number(level.value)));
    this.levelPickers.set(id, level);

    const stepper = new QuantityStepper({
      block: "baiter",
      inputLabel: `${name} in the test`,
      fewerLabel: `Fewer ${name}`,
      moreLabel: `More ${name}`,
      fillTitle: "As many as still fit in the army",
      value: () => this.testArmy.monsters[id]?.count ?? 0,
      set: (value) => this.set(id, value),
      fill: () => this.set(id, Number.MAX_SAFE_INTEGER),
      commit: () => this.render(),
    });
    this.steppers.set(id, stepper);

    const controls = document.createElement("div");
    controls.className = "baiter__row-controls";
    controls.append(level, stepper.element);
    item.append(head, controls);
    return item;
  }

  /** The ordinary champion's controls, or Krallen's. */
  private slot(krallen: boolean): HTMLElement {
    const element = document.createElement("div");
    element.className = "baiter-champion";

    let pick: HTMLSelectElement | HTMLInputElement;
    if (krallen) {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "baiter-champion__krallen";
      box.addEventListener("change", () => {
        this.testArmy = box.checked
          ? withChampion(this.testArmy, { t: KRALLEN_TYPE, l: 1, pl: 0 })
          : withoutChampion(this.testArmy, KRALLEN_TYPE);
        this.render();
      });
      const label = document.createElement("label");
      label.className = "baiter-champion__pick";
      label.append(box, ` ${championName(KRALLEN_TYPE)} as well`);
      element.append(label);
      pick = box;
    } else {
      const type = select("baiter-champion__type", "Champion");
      type.append(option("", "No champion"));
      for (const t of ORDINARY_CHAMPIONS) type.append(option(String(t), championName(t)));
      type.addEventListener("change", () => {
        const current = this.champion(false);
        this.testArmy = type.value
          ? withChampion(this.testArmy, {
              t: Number(type.value),
              l: current?.l ?? 1,
              pl: current?.pl ?? 0,
              ...(current?.s ? { s: current.s } : {}),
            })
          : current
            ? withoutChampion(this.testArmy, current.t)
            : this.testArmy;
        this.render();
      });
      const label = document.createElement("label");
      label.className = "baiter-champion__pick";
      label.append("Champion ", type);
      element.append(label);
      pick = type;
    }

    const who = krallen ? championName(KRALLEN_TYPE) : "Champion";
    const level = select("baiter-champion__level", `${who}'s level`);
    const power = select("baiter-champion__power", `${who}'s power level`);
    const mode = select("baiter-champion__mode", `${who}'s Mode`);
    for (const one of CHAMPION_STANCES) {
      const choice = option(one, STANCE_TEXT[one].label);
      choice.title = STANCE_TEXT[one].title;
      mode.append(choice);
    }
    const change = (patch: (champion: TestChampion) => TestChampion): void => {
      const current = this.champion(krallen);
      if (!current) return;
      this.testArmy = withChampion(this.testArmy, patch(current));
      this.render();
    };
    level.addEventListener("change", () => change((one) => ({ ...one, l: Number(level.value) })));
    power.addEventListener("change", () => change((one) => ({ ...one, pl: Number(power.value) })));
    mode.addEventListener("change", () => {
      const stance = mode.value;
      if (isChampionStance(stance)) change((one) => ({ ...one, s: stance }));
    });

    const details = document.createElement("div");
    details.className = "baiter-champion__details";
    details.append(field("Level", level), field("Power", power), field("Mode", mode));
    element.append(details);

    this.slots.push({ krallen, pick, details, level, power, mode });
    return element;
  }

  /** The army's ordinary champion, or its Krallen. */
  private champion(krallen: boolean): TestChampion | undefined {
    return this.testArmy.champions.find((one) => (one.t === KRALLEN_TYPE) === krallen);
  }

  private set(id: string, value: number): void {
    const count = Math.max(0, Math.min(Math.floor(value), maxOf(this.testArmy, id, this.cap)));
    const level = this.testArmy.monsters[id]?.level ?? 1;
    this.testArmy = { ...this.testArmy, monsters: { ...this.testArmy.monsters, [id]: { count, level } } };
    this.render();
  }

  /** A row at a new level: its count kept, or cut to what still fits at that level. */
  private setLevel(id: string, value: number): void {
    const level = clampLevel(id, value);
    const count = this.testArmy.monsters[id]?.count ?? 0;
    const relevelled = { ...this.testArmy, monsters: { ...this.testArmy.monsters, [id]: { count, level } } };
    const fits = Math.min(count, maxOf(relevelled, id, this.cap));
    this.testArmy = { ...relevelled, monsters: { ...relevelled.monsters, [id]: { count: fits, level } } };
    this.render();
  }

  private render(): void {
    remembered = this.testArmy;

    const used = armySize(this.testArmy);
    this.figures.replaceChildren("Army size ", strong(formatAmount(used)), ` / ${formatAmount(this.cap)}`);
    this.bar.setAttribute("aria-valuenow", String(Math.min(used, this.cap)));
    this.fill.style.width = `${+((Math.min(used, this.cap) / this.cap) * 100).toFixed(2)}%`;

    for (const id of TEST_ROSTER) {
      const row = this.testArmy.monsters[id];
      const level = row?.level ?? 1;
      const each = this.eachLabels.get(id);
      if (each) each.textContent = `${formatAmount(spaceOf(id, level))} space each`;
      const picker = this.levelPickers.get(id);
      if (picker) picker.value = String(level);
      this.steppers.get(id)?.sync({
        value: row?.count ?? 0,
        max: maxOf(this.testArmy, id, this.cap),
        disabled: false,
        rewrite: document.activeElement !== this.steppers.get(id)?.input,
      });
    }

    for (const slot of this.slots) this.renderSlot(slot);

    const empty = used === 0 && this.testArmy.champions.length === 0;
    this.clearButton.disabled = empty;
    this.runButton.disabled = empty || this.options.blocked !== null;
    this.runButton.title = this.options.blocked ?? (empty ? "Pick some monsters or a champion first" : "");
  }

  private renderSlot(slot: ChampionSlot): void {
    const champion = this.champion(slot.krallen);
    if (slot.pick instanceof HTMLInputElement) slot.pick.checked = champion !== undefined;
    else slot.pick.value = champion ? String(champion.t) : "";
    slot.details.hidden = !champion;
    if (!champion) return;
    fillNumbers(slot.level, 1, championLevels(champion.t), (value) => `Level ${value}`);
    fillNumbers(slot.power, 0, championPowerLevels(champion.t), (value) => `Power ${value}`);
    slot.level.value = String(champion.l);
    slot.power.value = String(champion.pl);
    slot.mode.value = champion.s ?? DEFAULT_STANCE;
  }

  private run(): void {
    if (this.options.blocked) return;
    const army = clampArmy(this.testArmy, this.cap);
    if (armySize(army) === 0 && army.champions.length === 0) return;
    this.options.onRun({ save: this.options.save(), army, baiterLevel: this.options.level });
  }
}

/** Gives `picker` the options `from`..`to`, unless it already has them. */
const fillNumbers = (
  picker: HTMLSelectElement,
  from: number,
  to: number,
  labelOf: (value: number) => string,
): void => {
  const first = picker.options[0]?.value;
  if (picker.options.length === to - from + 1 && first === String(from)) return;
  picker.replaceChildren();
  for (let value = from; value <= to; value += 1) picker.append(option(String(value), labelOf(value)));
};

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

const select = (className: string, label: string): HTMLSelectElement => {
  const element = document.createElement("select");
  element.className = `baiter__select ${className}`;
  element.setAttribute("aria-label", label);
  return element;
};

const option = (value: string, label: string): HTMLOptionElement => {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
};

/** A small caption over a picker. */
const field = (caption: string, control: HTMLElement): HTMLElement => {
  const element = document.createElement("span");
  element.className = "baiter-champion__field";
  element.append(text("span", "baiter-champion__caption", caption), control);
  return element;
};

const part = (heading: string, body: HTMLElement): HTMLElement => {
  const element = document.createElement("div");
  element.className = "baiter__part";
  element.append(text("p", "baiter__heading", heading), body);
  return element;
};
