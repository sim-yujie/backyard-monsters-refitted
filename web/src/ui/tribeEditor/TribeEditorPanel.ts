import type { EditorTribe, TribeEditorStatus, TribeId } from "@/api/tribeEditor";
import { MONSTER_NAMES } from "@/game/combat/rules/report";
import { BUNKER_TYPE, BUNKERABLE_MONSTERS } from "@/game/monsters/bunker";
import type { TribeEdit } from "@/game/tribeEditor/tribeEditSession";
import { maxLevel, nameOf } from "@/game/yard/buildingCosts";
import { Panel } from "@/ui/Panel";
import "@/ui/styles/tribe-editor.css";

/**
 * The tribe yard editor's two pieces of screen (LOCAL game only; shown only
 * when the server says the editor is on, `api/tribeEditor.ts`):
 *
 * - {@link TribePicker}: pick a Map Room 2 tribe and a camp level and open
 *   that camp's yard on the yard screen.
 * - {@link TribeEditBar}: while one is open, "Save as <Tribe> level <N>", the
 *   selected building's level (1 to the type's top, whatever the Town Hall)
 *   and Delete, a bunker's defenders, the yard's housed monsters, and the
 *   ways out. Moving buildings is the Yard Planner's (Layout) job.
 */

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label: string, onClick: () => void, className = "btn"): HTMLButtonElement => {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

/** How a level reads in the picker: which have a yard of their own, and which the editor saved. */
export const levelLabel = (tribe: EditorTribe, level: number): string => {
  if (tribe.saved.includes(level)) return `Level ${level} (saved)`;
  if (tribe.originals.includes(level)) return `Level ${level} (original yard)`;
  const below = [...tribe.saved, ...tribe.originals].filter((one) => one < level).sort((a, b) => b - a)[0];
  if (below === undefined) return `Level ${level}`;
  // An original yard may stand at a level no camp has (Kozu 29), so name it, not its level.
  return tribe.saved.includes(below) ? `Level ${level} (uses ${below})` : `Level ${level} (original yard)`;
};

export interface TribePickerOptions {
  status: TribeEditorStatus;
  /** The tribe and level shown first. */
  initial?: { tribe: TribeId; level: number };
  /** Opens the yard; a rejection's message is shown in the picker. */
  onOpen: (tribe: TribeId, level: number) => Promise<void>;
  onClose?: () => void;
}

export class TribePicker {
  readonly panel: Panel;
  readonly tribeSelect: HTMLSelectElement;
  readonly levelSelect: HTMLSelectElement;
  readonly openButton: HTMLButtonElement;
  private readonly message: HTMLElement;
  private readonly status: TribeEditorStatus;

  constructor(private readonly options: TribePickerOptions) {
    this.status = options.status;
    this.panel = new Panel({
      title: "Tribe yard editor",
      className: "tribe-editor tribe-picker",
      closeOnEscape: true,
      ...(options.onClose && { onClose: options.onClose }),
    });

    const intro = el(
      "p",
      "tribe-editor__note",
      "Map Room 2 wild monster camps. Pick a tribe and a camp level; its yard opens here to edit. Local game only.",
    );

    this.tribeSelect = el("select", "tribe-editor__select");
    this.tribeSelect.setAttribute("aria-label", "Tribe");
    for (const tribe of this.status.tribes) {
      const option = el("option", undefined, tribe.name);
      option.value = tribe.id;
      this.tribeSelect.append(option);
    }
    this.levelSelect = el("select", "tribe-editor__select");
    this.levelSelect.setAttribute("aria-label", "Camp level");
    this.tribeSelect.addEventListener("change", () => this.fillLevels());

    if (options.initial) this.tribeSelect.value = options.initial.tribe;
    this.fillLevels();
    if (options.initial) this.levelSelect.value = String(options.initial.level);

    const tribeRow = el("label", "tribe-editor__row");
    tribeRow.append(el("span", undefined, "Tribe"), this.tribeSelect);
    const levelRow = el("label", "tribe-editor__row");
    levelRow.append(el("span", undefined, "Level"), this.levelSelect);

    this.message = el("p", "tribe-editor__message");
    this.message.setAttribute("role", "status");
    this.openButton = button("Open yard", () => void this.open(), "btn btn--primary");

    this.panel.setContent(intro, tribeRow, levelRow, this.openButton, this.message);
  }

  mount(container: HTMLElement): this {
    this.panel.mount(container);
    this.tribeSelect.focus();
    return this;
  }

  close(): void {
    this.panel.close();
  }

  private tribe(): EditorTribe | undefined {
    return this.status.tribes.find((one) => one.id === this.tribeSelect.value);
  }

  private fillLevels(): void {
    const tribe = this.tribe();
    this.levelSelect.replaceChildren();
    for (const level of tribe?.levels ?? []) {
      const option = el("option", undefined, tribe ? levelLabel(tribe, level) : String(level));
      option.value = String(level);
      this.levelSelect.append(option);
    }
  }

  private async open(): Promise<void> {
    const tribe = this.tribeSelect.value as TribeId;
    const level = Number(this.levelSelect.value);
    if (!tribe || !Number.isFinite(level)) return;
    this.openButton.disabled = true;
    this.message.textContent = "Opening…";
    try {
      await this.options.onOpen(tribe, level);
    } catch (caught) {
      this.message.textContent = caught instanceof Error ? caught.message : "Could not open that yard.";
      this.openButton.disabled = false;
    }
  }
}

export interface TribeEditBarOptions {
  edit: TribeEdit;
  /** The sim changed outside a yard route: the scene re-reads the yard. */
  onChanged: () => void;
  /** "Save as …"; resolves with the line to show. */
  onSave: () => Promise<string>;
  /** "Reset attacked camps" (local database); resolves with the line to show. */
  onReset: () => Promise<string>;
  /** Back to the picker. */
  onPick: () => void;
  /** Back to the player's own yard. */
  onExit: () => void;
}

export class TribeEditBar {
  readonly panel: Panel;
  readonly saveButton: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
  private resetArmed = false;
  private readonly message: HTMLElement;
  private readonly selection: HTMLElement;
  private readonly housing: HTMLDetailsElement;
  private selected: number | null = null;

  constructor(private readonly options: TribeEditBarOptions) {
    const { edit } = options;
    this.panel = new Panel({
      title: `${edit.name} level ${edit.level}`,
      className: "tribe-editor tribe-edit-bar",
      closable: false,
    });

    const source = el(
      "p",
      "tribe-editor__note",
      edit.from === edit.level
        ? `Editing the ${edit.saved ? "saved" : "original"} yard of this level.`
        : `This level has no yard of its own yet: starting from level ${edit.from}'s.`,
    );
    const hint = el(
      "p",
      "tribe-editor__note",
      "Build and upgrade free and instant, no limits. Move buildings with Layout, then Apply.",
    );

    this.saveButton = button(`Save as ${edit.name} level ${edit.level}`, () => void this.save(), "btn btn--primary");
    this.resetButton = button(TribeEditBar.RESET_LABEL, () => void this.reset());
    this.resetButton.title =
      "Camps of this level that were already opened or attacked keep their old yard. " +
      "This drops them from the local database so they use the saved yard.";
    this.message = el("p", "tribe-editor__message");
    this.message.setAttribute("role", "status");

    this.selection = el("div", "tribe-editor__selection");
    this.housing = el("details", "tribe-editor__housing");

    const ways = el("div", "tribe-editor__ways");
    ways.append(button("Other tribe/level", () => options.onPick()), button("Exit to my yard", () => options.onExit()));

    this.panel.setContent(source, hint, this.saveButton, this.resetButton, this.message, this.selection, this.housing, ways);
    this.renderSelection();
    this.renderHousing();
  }

  mount(container: HTMLElement): this {
    this.panel.mount(container);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /** The yard screen selected a building (or none). */
  select(id: number | null): void {
    this.selected = id;
    this.renderSelection();
  }

  /** Re-reads the selected building after the yard changed. */
  refresh(): void {
    if (this.selected !== null && !this.options.edit.sim.building(this.selected)) this.selected = null;
    this.renderSelection();
  }

  private async save(): Promise<void> {
    this.saveButton.disabled = true;
    this.message.textContent = "Saving…";
    try {
      this.message.textContent = await this.options.onSave();
    } catch (caught) {
      this.message.textContent = `Not saved: ${caught instanceof Error ? caught.message : "something went wrong."}`;
    } finally {
      this.saveButton.disabled = false;
    }
  }

  static readonly RESET_LABEL = "Reset attacked camps";

  /** The first click asks again; the second drops the stored camps. */
  private async reset(): Promise<void> {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.resetButton.textContent = "Click again to reset";
      this.message.textContent = `Drops already attacked ${this.options.edit.name} level ${this.options.edit.level} camps from the local database.`;
      return;
    }
    this.resetArmed = false;
    this.resetButton.disabled = true;
    this.resetButton.textContent = TribeEditBar.RESET_LABEL;
    this.message.textContent = "Resetting…";
    try {
      this.message.textContent = await this.options.onReset();
    } catch (caught) {
      this.message.textContent = `Not reset: ${caught instanceof Error ? caught.message : "something went wrong."}`;
    } finally {
      this.resetButton.disabled = false;
    }
  }

  private changed(): void {
    this.options.onChanged();
    this.renderSelection();
  }

  private renderSelection(): void {
    const { sim } = this.options.edit;
    const building = this.selected === null ? null : sim.building(this.selected);
    if (!building) {
      this.selection.replaceChildren(el("p", "tribe-editor__note", "Select a building to set its level."));
      return;
    }
    const id = building.id;
    const level = building.l === undefined ? 1 : Number(building.l);
    const top = Math.max(1, maxLevel(building.t));

    const heading = el("h3", "tribe-editor__heading", `${nameOf(building.t) || `Type ${building.t}`} (#${id})`);
    const levelInput = el("input", "tribe-editor__number");
    levelInput.type = "number";
    levelInput.min = "1";
    levelInput.max = String(top);
    levelInput.value = String(level);
    levelInput.setAttribute("aria-label", "Level");
    const setLevel = (next: number): void => {
      sim.setLevel(id, next);
      this.changed();
    };
    levelInput.addEventListener("change", () => setLevel(Number(levelInput.value)));

    const levelRow = el("div", "tribe-editor__row");
    const minus = button("−", () => setLevel(level - 1), "btn btn--icon");
    minus.setAttribute("aria-label", "Level down");
    minus.disabled = level <= 1;
    const plus = button("+", () => setLevel(level + 1), "btn btn--icon");
    plus.setAttribute("aria-label", "Level up");
    plus.disabled = level >= top;
    levelRow.append(el("span", undefined, `Level (1–${top})`), minus, levelInput, plus);

    const remove = button(
      "Delete",
      () => {
        sim.remove(id);
        this.selected = null;
        this.changed();
      },
      "btn btn--danger",
    );

    const nodes: Node[] = [heading, levelRow];
    if (building.t === BUNKER_TYPE) nodes.push(this.garrisonEditor(id));
    nodes.push(remove);
    this.selection.replaceChildren(...nodes);
  }

  private garrisonEditor(id: number): HTMLElement {
    const { sim } = this.options.edit;
    const garrison = sim.garrison(id);
    const box = el("div", "tribe-editor__monsters");
    box.append(el("h4", "tribe-editor__subheading", "Defenders in this bunker"));
    for (const monster of BUNKERABLE_MONSTERS) {
      box.append(
        this.countRow(monster, garrison[monster] ?? 0, (count) => {
          sim.setGarrison(id, monster, count);
          this.changed();
        }),
      );
    }
    return box;
  }

  private renderHousing(): void {
    const { sim } = this.options.edit;
    const housed = sim.housing();
    const summary = el("summary", undefined, "Housed monsters");
    const rows = BUNKERABLE_MONSTERS.map((monster) =>
      this.countRow(monster, housed[monster] ?? 0, (count) => {
        sim.setHousing(monster, count);
        this.options.onChanged();
      }),
    );
    this.housing.replaceChildren(summary, ...rows);
  }

  private countRow(monster: string, count: number, onSet: (count: number) => void): HTMLElement {
    const row = el("label", "tribe-editor__row tribe-editor__count");
    const input = el("input", "tribe-editor__number");
    input.type = "number";
    input.min = "0";
    input.value = String(count);
    input.addEventListener("change", () => onSet(Math.max(0, Number(input.value) || 0)));
    row.append(el("span", undefined, MONSTER_NAMES[monster] ?? monster), input);
    return row;
  }
}
