import {
  SIEGE_WEAPONS,
  siegeRange,
  type SiegeStock,
  type SiegeWeaponId,
  type SiegeWeaponSpec,
} from "@/game/attack/AttackInput";
import { Panel } from "@/ui/Panel";

/**
 * Siege weapons: Decoy, Vacuum and Jars, the building-granted arsenal with
 * its own quantities and drop rules (`docs/design/attack-flow.md` §F4, §4.4;
 * `docs/specs/combat.md` §3 "Siege weapons").
 *
 * A separate docked panel from the Catapult, because they are separate
 * systems in the live game: bombs are bought from the attacker's pool, siege
 * weapons are built ahead of time and counted (`SiegeWeapons.as:52-68`
 * decrements `quantity` on use). Opening one never closes or clears the
 * other, nor the monster bucket.
 *
 * The engine accepts a `siege` event and ignores it today (`engine.ts:147-148`);
 * every tile says so with the same "no effect yet" badge the putty bombs
 * carry, and the drop is logged exactly as §3.10 wants so a later engine
 * replays it.
 */

/** What the panel needs to light or grey each weapon. */
export interface SiegeView {
  /** Uses so far this attack, by weapon. */
  readonly used: Readonly<Partial<Record<SiegeWeaponId, number>>>;
  readonly live: boolean;
  readonly armed: SiegeWeaponId | null;
}

export interface SiegePanelOptions {
  /** The attacker's stock, from the own save's `siege` blob. */
  readonly stock: readonly SiegeStock[];
  readonly onPick: (weapon: { spec: SiegeWeaponSpec; level: number } | null) => void;
  readonly onClose?: () => void;
}

interface Tile {
  readonly stock: SiegeStock;
  readonly spec: SiegeWeaponSpec;
  readonly button: HTMLButtonElement;
  readonly count: HTMLElement;
  readonly note: HTMLElement;
}

export class SiegePanel {
  readonly panel: Panel;
  private readonly tiles: Tile[] = [];
  private readonly note: HTMLElement;
  private readonly options: SiegePanelOptions;
  private view: SiegeView = { used: {}, live: true, armed: null };

  constructor(options: SiegePanelOptions) {
    this.options = options;
    this.panel = new Panel({
      title: "Siege weapons",
      className: "attack-siege attack-picker",
      ...(options.onClose ? { onClose: options.onClose } : {}),
    });
    this.panel.element.dataset["hotkey"] = "S";

    const body = this.panel.body;
    this.note = document.createElement("p");
    this.note.className = "attack-picker__note";

    const owned = options.stock.filter((entry) => entry.level > 0);
    if (owned.length === 0) {
      this.note.textContent = "You have no siege weapons. The Siege Factory builds them.";
      body.append(this.note);
      return;
    }

    const lead = document.createElement("p");
    lead.className = "attack-picker__lead";
    lead.textContent = "Pick a weapon, then tap the yard to place it.";
    body.append(lead);

    const list = document.createElement("div");
    list.className = "attack-picker__group";
    for (const spec of SIEGE_WEAPONS) {
      const stock = owned.find((entry) => entry.id === spec.id);
      if (!stock) continue;
      list.append(this.buildTile(spec, stock));
    }
    body.append(list, this.note);
  }

  get element(): HTMLElement {
    return this.panel.element;
  }

  mount(container: HTMLElement): this {
    this.panel.mount(container);
    this.refresh();
    return this;
  }

  update(view: SiegeView): void {
    this.view = view;
    this.refresh();
  }

  close(): void {
    this.panel.close();
  }

  destroy(): void {
    this.panel.close();
  }

  private buildTile(spec: SiegeWeaponSpec, stock: SiegeStock): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "attack-picker__tile";
    button.dataset["weapon"] = spec.id;
    button.setAttribute("aria-pressed", "false");

    const name = document.createElement("span");
    name.className = "attack-picker__name";
    name.textContent = `${spec.name} L${stock.level}`;

    const effect = document.createElement("span");
    effect.className = "attack-picker__effect";
    effect.textContent = `${spec.hint} Radius ${siegeRange(spec, stock.level)}.`;
    const badge = document.createElement("span");
    badge.className = "attack-picker__badge";
    badge.textContent = "no effect yet";
    badge.title = "The battle engine does not apply siege weapons yet; the drop is still logged.";
    effect.append(" ", badge);

    const count = document.createElement("span");
    count.className = "attack-picker__cost";

    const note = document.createElement("span");
    note.className = "attack-picker__tile-note";

    button.append(name, effect, count, note);
    button.addEventListener("click", () => {
      const armed = this.view.armed === spec.id;
      this.options.onPick(armed ? null : { spec, level: stock.level });
    });
    this.tiles.push({ stock, spec, button, count, note });
    return button;
  }

  private refresh(): void {
    const { used, live, armed } = this.view;
    for (const tile of this.tiles) {
      const left = Math.max(0, tile.stock.quantity - (used[tile.spec.id] ?? 0));
      tile.count.textContent = `${left} left`;
      let why = "";
      if (!live) why = "The attack is over.";
      else if (left <= 0) why = "None left.";
      tile.button.disabled = why !== "";
      tile.note.textContent = why;
      const isArmed = armed === tile.spec.id;
      tile.button.setAttribute("aria-pressed", String(isArmed));
      tile.button.classList.toggle("attack-picker__tile--armed", isArmed);
    }
    if (this.tiles.length === 0) return;
    const spec = armed ? SIEGE_WEAPONS.find((weapon) => weapon.id === armed) : undefined;
    this.note.textContent = spec ? `${spec.name} armed: tap the yard to place it. Esc cancels.` : "";
  }
}
