import { housingSummary } from "@/game/monsters/housingSummary";
import { nameOf, quantityOf, townHallLevel } from "@/game/yard/buildingCosts";
import { YardChangeReason, type YardChange, type YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { RESOURCE_NAMES, resourceAmount } from "@/ui/resourceIcon";
import {
  MONSTERS_TAB_ORDER,
  MonstersTabId,
  type MonstersFocus,
  type MonstersTab,
  type MonstersTabDefinition,
} from "./monstersTab";
import { MONSTERS_TABS } from "./tabs";

/**
 * The Monsters screen (`docs/design/yard-buildings.md` §4.1, decision D4).
 *
 * One screen with five tabs — Unlock (Monster Locker), Hatch (Hatchery and
 * Hatchery Control Centre), Housing, Train (Academy), Lab — opened by the HUD's
 * Monsters button or by the Open button on one of those buildings. Docked to
 * the right under the HUD at full height on a wide screen, a bottom sheet on a
 * phone; the yard stays visible and clickable beside it. It is not a modal and
 * stays open after every action: the original closed its popups on success,
 * which meant reopening them for the next monster (MH §12.2 item 5).
 *
 * The header always shows housing used/total and the two monster resources,
 * goo and putty, as exact amounts with their caps, so "will this fit?" and "can
 * I afford it?" never need another screen. A tab whose building the yard does
 * not have yet shows what to build and the Town Hall it needs instead of an
 * empty list.
 *
 * The frame is this file; each tab's body is its own (`monstersTab.ts` has the
 * contract, `tabs.ts` the list).
 */

export interface MonstersScreenOptions {
  /** The own yard. The screen exists only there. */
  readonly binding: YardUiBinding;
  /** After the player closes it. */
  readonly onClose?: () => void;
  /** The tabs; `MONSTERS_TABS` unless a test swaps them. */
  readonly tabs?: readonly MonstersTabDefinition[];
}

/** What each tab's building is for, in the "build one first" sentence. */
const PURPOSE: Readonly<Record<MonstersTabId, string>> = {
  unlock: "unlock new monsters",
  hatch: "hatch monsters",
  housing: "house your monsters",
  train: "train your monsters",
  lab: "research monster abilities",
};

/** The first Town Hall level that allows one of `type` (the build menu's rule). */
export const townHallFor = (type: number): number => {
  for (let hall = 1; hall <= 10; hall++) if (quantityOf(type, hall) > 0) return hall;
  return 0;
};

export class MonstersScreen {
  readonly element: HTMLElement;

  private readonly binding: YardUiBinding;
  private readonly onClose: (() => void) | undefined;
  private readonly panel: Panel;
  private readonly definitions: ReadonlyMap<MonstersTabId, MonstersTabDefinition>;
  private readonly tabButtons = new Map<MonstersTabId, HTMLButtonElement>();
  private readonly created = new Map<MonstersTabId, MonstersTab>();
  private readonly header: HTMLElement;
  private readonly housingValue: HTMLElement;
  private readonly housingMeter: HTMLElement;
  private readonly housingFill: HTMLElement;
  private readonly goo: HTMLElement;
  private readonly putty: HTMLElement;
  private readonly body: HTMLElement;
  private readonly unsubscribe: () => void;

  private active: MonstersTabId = MonstersTabId.UNLOCK;
  /** What the body shows now: the tab, or the "build one first" note. */
  private showing: "tab" | "empty" | null = null;
  private opened = false;
  private destroyed = false;

  constructor(options: MonstersScreenOptions) {
    this.binding = options.binding;
    this.onClose = options.onClose;
    const tabs = options.tabs ?? MONSTERS_TABS;
    this.definitions = new Map(tabs.map((tab) => [tab.id, tab]));

    // Not Panel's own close: that removes the element for good, and this
    // screen is opened and closed many times over one yard.
    this.panel = new Panel({ title: "Monsters", className: "monsters-screen", closable: false });
    this.element = this.panel.element;
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        this.close();
      }
    });

    const strip = document.createElement("div");
    strip.className = "tabs monsters-tabs";
    strip.setAttribute("role", "tablist");
    strip.setAttribute("aria-label", "Monster buildings");
    for (const id of MONSTERS_TAB_ORDER) {
      const definition = this.definitions.get(id);
      if (!definition) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tabs__tab monsters-tabs__tab";
      button.id = `monsters-tab-${id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "monsters-body");
      button.textContent = definition.label;
      button.addEventListener("click", () => this.open(id));
      strip.append(button);
      this.tabButtons.set(id, button);
    }
    strip.addEventListener("keydown", (event) => this.onStripKey(event));

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost btn--icon monsters-screen__close";
    close.setAttribute("aria-label", "Close Monsters");
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    this.panel.titlebar.append(strip, close);

    this.header = document.createElement("div");
    this.header.className = "monsters-header";
    const housing = document.createElement("div");
    housing.className = "monsters-header__housing";
    const housingLabel = document.createElement("span");
    housingLabel.className = "monsters-header__label";
    housingLabel.textContent = "Housing";
    this.housingValue = document.createElement("span");
    this.housingValue.className = "monsters-header__value";
    this.housingMeter = document.createElement("span");
    this.housingMeter.className = "monsters-bar monsters-header__meter";
    this.housingMeter.setAttribute("role", "meter");
    this.housingMeter.setAttribute("aria-label", "Housing used");
    this.housingMeter.setAttribute("aria-valuemin", "0");
    this.housingFill = document.createElement("span");
    this.housingFill.className = "monsters-bar__fill";
    this.housingMeter.append(this.housingFill);
    housing.append(housingLabel, this.housingValue, this.housingMeter);
    this.goo = document.createElement("span");
    this.goo.className = "monsters-header__resource";
    this.putty = document.createElement("span");
    this.putty.className = "monsters-header__resource";
    this.header.append(housing, this.goo, this.putty);

    this.body = document.createElement("div");
    this.body.className = "monsters-body";
    this.body.id = "monsters-body";
    this.body.setAttribute("role", "tabpanel");

    this.panel.setContent(this.header, this.body);
    this.unsubscribe = this.binding.store.subscribe((change) => this.onChange(change));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get activeTab(): MonstersTabId {
    return this.active;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** Opens the screen on `tab` (or brings that tab forward when already open). */
  open(tab: MonstersTabId = this.active, focus: MonstersFocus = {}): void {
    if (this.destroyed || !this.definitions.has(tab)) return;
    const wasOpen = this.opened;
    this.opened = true;
    this.element.hidden = false;
    this.active = tab;
    // The Hatch tab is the original's wide hatchery popup (#156): hatch.css widens the frame for it.
    this.element.dataset["tab"] = tab;
    for (const [id, button] of this.tabButtons) {
      const current = id === tab;
      button.setAttribute("aria-selected", String(current));
      button.tabIndex = current ? 0 : -1;
    }
    this.body.setAttribute("aria-labelledby", `monsters-tab-${tab}`);
    this.renderHeader();
    this.renderBody(focus, true);
    if (!wasOpen) this.tabButtons.get(tab)?.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.element.hidden = true;
    this.onClose?.();
  }

  /**
   * Whether the building panel is open in the right dock: on a wide screen the
   * screen then stands to its left, so a Monster Locker's panel (its upgrade)
   * and its Unlock tab are both in view.
   */
  besidePanel(beside: boolean): void {
    this.element.classList.toggle("monsters-screen--beside-panel", beside);
  }

  /** Once a second, from the scene. */
  tick(): void {
    if (!this.opened || this.showing !== "tab") return;
    this.created.get(this.active)?.tick();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    for (const tab of this.created.values()) tab.destroy();
    this.created.clear();
    this.element.remove();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private onChange(change: YardChange): void {
    if (!this.opened) return;
    if (change.reason !== YardChangeReason.PENDING) {
      this.renderHeader();
      // A locker finishing its build turns the note into the tab, and back.
      if (this.renderBody({}, false)) return;
    }
    if (this.showing === "tab") this.created.get(this.active)?.update(change);
  }

  private renderHeader(): void {
    const store = this.binding.store;
    const { used, total } = housingSummary(store.save, store.now());
    this.housingValue.textContent = `${formatAmount(used)} / ${formatAmount(total)}`;
    this.housingMeter.setAttribute("aria-valuemax", String(Math.max(total, 1)));
    this.housingMeter.setAttribute("aria-valuenow", String(Math.min(used, Math.max(total, 1))));
    this.housingMeter.setAttribute(
      "aria-valuetext",
      `${formatAmount(used)} of ${formatAmount(total)}`,
    );
    const fraction = total > 0 ? Math.min(1, used / total) : used > 0 ? 1 : 0;
    this.housingFill.style.width = `${+(fraction * 100).toFixed(2)}%`;
    this.housingMeter.classList.toggle("monsters-bar--full", total > 0 && used >= total);

    for (const [node, key] of [
      [this.goo, "r4"],
      [this.putty, "r3"],
    ] as const) {
      const amount = Number(store.resources[key]);
      const cap = store.caps?.[key];
      const text = Number.isFinite(amount)
        ? cap === undefined
          ? formatAmount(amount)
          : `${formatAmount(amount)} / ${formatAmount(cap)}`
        : "—";
      node.replaceChildren(resourceAmount(key, text));
      node.title =
        cap === undefined
          ? `${RESOURCE_NAMES[key]}: ${text}`
          : `${RESOURCE_NAMES[key]}: ${formatAmount(amount)} of ${formatAmount(cap)}`;
    }
  }

  /**
   * Puts the active tab, or the note saying what to build, in the body.
   * Returns true when it (re)showed the tab, which then has already redrawn.
   */
  private renderBody(focus: MonstersFocus, switching: boolean): boolean {
    const definition = this.definitions.get(this.active);
    if (!definition) return false;
    const yard = this.binding.store.yard;
    const has = yard.buildings.some((building) => definition.buildings.includes(building.type));

    if (!has) {
      this.showing = "empty";
      this.body.replaceChildren(this.emptyNote(definition));
      return false;
    }
    if (this.showing === "tab" && !switching) return false;
    let tab = this.created.get(definition.id);
    if (!tab) {
      tab = definition.create({ binding: this.binding, showTab: (id, next) => this.open(id, next) });
      this.created.set(definition.id, tab);
    }
    this.showing = "tab";
    this.body.replaceChildren(tab.element);
    tab.show(focus);
    return true;
  }

  private emptyNote(definition: MonstersTabDefinition): HTMLElement {
    const type = definition.buildings[0] ?? 0;
    const name = nameOf(type) || definition.label;
    const need = townHallFor(type);
    const hall = townHallLevel(this.binding.store.yard);

    const note = document.createElement("div");
    note.className = "monsters-empty";
    const title = document.createElement("h3");
    title.className = "monsters-empty__title";
    title.textContent = `No ${name} yet`;
    const text = document.createElement("p");
    text.className = "monsters-empty__text";
    text.textContent = `Build a ${name} to ${PURPOSE[definition.id]}.`;
    const gate = document.createElement("p");
    gate.className = "monsters-empty__gate";
    gate.textContent =
      need <= 0
        ? ""
        : hall >= need
          ? `Needs Town Hall ${need}: yours is level ${hall}, so you can build one now.`
          : `Needs Town Hall ${need}: yours is level ${hall}.`;
    gate.classList.toggle("monsters-empty__gate--short", hall < need);
    note.append(title, text);
    if (need > 0) note.append(gate);
    return note;
  }

  /** Left and right move along the strip, Home and End jump to its ends. */
  private onStripKey(event: KeyboardEvent): void {
    const ids = [...this.tabButtons.keys()];
    const at = ids.indexOf(this.active);
    const next =
      event.key === "ArrowRight"
        ? ids[(at + 1) % ids.length]
        : event.key === "ArrowLeft"
          ? ids[(at - 1 + ids.length) % ids.length]
          : event.key === "Home"
            ? ids[0]
            : event.key === "End"
              ? ids[ids.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    this.open(next);
    this.tabButtons.get(next)?.focus();
  }
}
