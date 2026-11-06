import type { SiegeStock } from "@/game/attack/AttackInput";
import type { SiegeSnapshot } from "@/game/combat/rules/engine";
import { siegeData, siegeValue, type SiegeId, type SiegeStat } from "@/game/combat/rules/siege";
import { TICKS_PER_SECOND } from "@/game/combat/rules/stats";
import { Panel } from "@/ui/Panel";

/**
 * The siege weapon in an attack: Flash's `SIEGEWEAPONPOPUP`, one weapon and
 * its Fire button (`docs/design/attack-flow.md` §F4; Inferno WP 6.8).
 *
 * Flash offers one weapon per attack, `SiegeWeapons.availableWeapon`: the
 * first of Decoy, Vacuum and Jars the attacker holds one of (the Factory
 * holds at most one at a time). The popup has three states, kept here:
 *
 * - ready (Flash's state 0): "Fire". A weapon with a drop range (the Decoy,
 *   the Jars) arms a drop zone; the Vacuum has none and fires at once
 *   (`SIEGEWEAPONPOPUP.Target`, `:341-363`).
 * - armed (1): "Cancel" and where to tap (`siege_target_*`), until the tap
 *   or the cancel.
 * - fired (2): for the rest of the attack, with the seconds left for a
 *   weapon with a duration (red under 10 s, `updateTimeRemaining`) and a
 *   health bar for a durable one (`updateHealth`).
 *
 * The weapon's tooltip (its name, level, `w_<id>_tooltip` and the stat lines
 * at its level, `ToolTipShow`) is the panel's body, since a phone has no
 * hover. The words are Flash's `english.json`, under the keys beside them.
 */

/** `english.json`: the popup's words. */
const TEXT = {
  fire: "Fire", // siege_firebtn
  cancel: "Cancel", // siege_cancelbtn
  level: (level: number) => `Level ${level}`, // siege_tooltip_level
  target: {
    decoy: "Select Target Ground", // siege_target_ground
    jars: "Select Target Towers", // siege_target_towers
    vacuum: "Select Targets", // siege_target_targets
  } satisfies Record<SiegeId, string>,
  tooltip: {
    decoy: "Drop Marilyn Monstroe near enemy bunkers to lure out defending monsters.", // w_decoy_tooltip
    vacuum: "Click to activate the Loot-O-Tron 5000.", // w_vacuum_tooltip
    jars: "Select an area with multiple towers to disable as many as possible.", // w_jars_tooltip
  } satisfies Record<SiegeId, string>,
} as const;

/** `label_<id>_stat<n>` and `<id>_stat<n>`, by the figure each line reads. */
const STAT_TEXT: Record<SiegeId, Partial<Record<SiegeStat, { label: string; text: (value: number) => string }>>> = {
  decoy: {
    damage: { label: "Damage:", text: (v) => `Does up to ${v} damage when she explodes` },
    range: { label: "Attraction Range:", text: (v) => `Attracts all defending monsters within a range of ${v}` },
    duration: { label: "Countdown:", text: (v) => `Marilyn Monstroe blows up after ${v} seconds` },
  },
  vacuum: {
    lootBonus: { label: "Loot Rate:", text: (v) => `Steals resources at the rate of ${v} per second` },
    durability: { label: "Durability:", text: (v) => `Can withstand ${v} damage` },
    duration: { label: "Duration:", text: (v) => `Will operate for ${v} seconds` },
  },
  jars: {
    range: { label: "Range:", text: (v) => `Jars drop on all defensive towers within a range of ${v}` },
    durability: { label: "Durability:", text: (v) => `Can withstand ${v} damage` },
  },
};

/** Where the popup is: Flash's `_state` 0, 1 and 2. */
export type SiegeState = "ready" | "armed" | "fired";

/** What the panel shows each refresh. */
export interface SiegeView {
  readonly state: SiegeState;
  readonly live: boolean;
  /**
   * `canFire`: for the Vacuum, a Town Hall (or the Resource Outpost) still
   * stands to latch onto (`Vacuum.canFire`, `SIEGEWEAPONPOPUP.validate`).
   */
  readonly canFire: boolean;
  /**
   * Once fired and while still on the field: whole seconds left (null with
   * no duration) and health 0 to 1 (null when it cannot be hurt).
   */
  readonly onField: { readonly secondsLeft: number | null; readonly health: number | null } | null;
}

export interface SiegePanelOptions {
  /** `SiegeWeapons.availableWeapon`, the one weapon this attack offers. */
  readonly weapon: SiegeStock;
  /** The Fire button: fire, arm, or (armed) cancel; the plugin decides which. */
  readonly onFire: () => void;
  readonly onClose?: () => void;
}

/** Seconds left under which Flash's timer glows red (`updateTimeRemaining`). */
export const SIEGE_TIME_LOW = 10;

/** Whole seconds to a tick, as Flash's one-second `activeWeaponTimer` counts them down. */
const secondsUntil = (end: number, tick: number): number =>
  Math.max(0, Math.ceil((end - tick) / TICKS_PER_SECOND));

/**
 * What the fired popup shows from the battle's {@link SiegeSnapshot}: the
 * Decoy's countdown; the Vacuum's time and hose health; the Jars' health,
 * Flash's `Jars.activeDurability` (the jars' health over all their
 * durability). Null once the weapon has left the field.
 */
export const siegeOnField = (snapshot: SiegeSnapshot, tick: number): SiegeView["onField"] => {
  const { decoy, vacuum, jars } = snapshot;
  if (decoy) return { secondsLeft: secondsUntil(decoy.explodesAt, tick), health: null };
  if (vacuum) {
    return {
      secondsLeft: secondsUntil(vacuum.endsAt, tick),
      health: vacuum.durability > 0 ? vacuum.health / vacuum.durability : 0,
    };
  }
  if (snapshot.active !== "jars") return null;
  const whole = jars.reduce((sum, jar) => sum + jar.durability, 0);
  // A jar still falling is whole; a broken one is spent.
  const left = jars.reduce(
    (sum, jar) => sum + (jar.health ?? (jar.breaking ? 0 : jar.durability)),
    0,
  );
  return { secondsLeft: null, health: whole > 0 ? left / whole : 0 };
};

export class SiegePanel {
  readonly panel: Panel;
  private readonly options: SiegePanelOptions;
  private readonly fire: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly status: HTMLElement;
  private readonly time: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly note: HTMLElement;
  private view: SiegeView = { state: "ready", live: true, canFire: true, onField: null };

  constructor(options: SiegePanelOptions) {
    this.options = options;
    const { weapon } = options;
    const data = siegeData(weapon.id);
    this.panel = new Panel({
      title: data?.name ?? weapon.id,
      className: "attack-siege attack-picker",
      ...(options.onClose ? { onClose: options.onClose } : {}),
    });
    this.panel.element.dataset["hotkey"] = "S";
    this.panel.element.dataset["weapon"] = weapon.id;

    const head = document.createElement("div");
    head.className = "attack-siege__head";
    const image = document.createElement("img");
    image.className = "attack-siege__image";
    image.src = `/assets/siegebuttons/${weapon.id}.png`;
    image.alt = "";
    const level = document.createElement("p");
    level.className = "attack-siege__level";
    level.textContent = TEXT.level(weapon.level);
    this.fire = document.createElement("button");
    this.fire.type = "button";
    this.fire.className = "btn btn--primary attack-siege__fire";
    this.fire.dataset["fire"] = weapon.id;
    this.fire.addEventListener("click", () => this.options.onFire());
    head.append(image, level, this.fire);

    this.hint = document.createElement("p");
    this.hint.className = "attack-siege__hint";
    this.hint.setAttribute("role", "status");

    this.status = document.createElement("div");
    this.status.className = "attack-siege__status";
    this.time = document.createElement("span");
    this.time.className = "attack-siege__time";
    this.bar = document.createElement("span");
    this.bar.className = "attack-siege__bar";
    this.bar.setAttribute("role", "meter");
    this.bar.setAttribute("aria-label", "Health");
    this.bar.setAttribute("aria-valuemin", "0");
    this.bar.setAttribute("aria-valuemax", "100");
    this.barFill = document.createElement("span");
    this.barFill.className = "attack-siege__bar-fill";
    this.bar.append(this.barFill);
    this.status.append(this.time, this.bar);

    const tooltip = document.createElement("p");
    tooltip.className = "attack-picker__lead";
    tooltip.textContent = TEXT.tooltip[weapon.id];
    const stats = document.createElement("ul");
    stats.className = "attack-siege__stats";
    for (const stat of data?.stats ?? []) {
      const words = STAT_TEXT[weapon.id][stat];
      const value = data ? siegeValue(data[stat], weapon.level) : null;
      if (!words || value === null) continue;
      const item = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent = `${words.label} `;
      item.append(label, words.text(value));
      stats.append(item);
    }

    this.note = document.createElement("p");
    this.note.className = "attack-picker__note";

    this.panel.body.append(head, this.hint, this.status, tooltip, stats, this.note);
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

  private refresh(): void {
    const { state, live, canFire, onField } = this.view;
    const id = this.options.weapon.id;
    const armed = state === "armed";
    this.fire.textContent = armed ? TEXT.cancel : TEXT.fire;
    this.fire.hidden = state === "fired";
    this.fire.disabled = !armed && (!live || !canFire);
    this.fire.setAttribute("aria-pressed", String(armed));
    this.fire.classList.toggle("attack-siege__fire--armed", armed);
    this.hint.textContent = armed ? TEXT.target[id] : "";

    const seconds = onField?.secondsLeft ?? null;
    const health = onField?.health ?? null;
    this.status.hidden = onField === null;
    this.time.hidden = seconds === null;
    this.time.textContent = seconds === null ? "" : `${seconds}s`;
    this.time.classList.toggle("attack-siege__time--low", seconds !== null && seconds < SIEGE_TIME_LOW);
    this.bar.hidden = health === null;
    const percent = Math.round(Math.max(0, Math.min(1, health ?? 0)) * 100);
    this.barFill.style.width = `${percent}%`;
    this.bar.setAttribute("aria-valuenow", String(percent));

    let why = "";
    if (state === "fired" && onField === null) why = "Used this attack.";
    else if (!live) why = "The attack is over.";
    else if (state === "ready" && !canFire) why = "No Town Hall left to latch onto.";
    this.note.textContent = why;
  }
}
