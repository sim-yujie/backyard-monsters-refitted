import { bombsFor, type BombStats } from "@/game/combat/rules";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";

/**
 * The Catapult: resource bombs, one tile per tier the attacker's catapult
 * unlocks (`docs/design/attack-flow.md` §F4, §4.4; `docs/specs/combat.md` §3
 * "Catapult (resource bombs)").
 *
 * A docked panel in the same family as the army panel, not a hover bubble:
 * picking a bomb is the primary action, so it opens on a tap and works the
 * same under a finger (§F4). Opening it changes nothing else — the monster
 * bucket, the champion pick and a pending siege weapon all survive, which is
 * the point of the redesign (`combat.md:412-414` is the Flash behaviour it
 * replaces).
 *
 * Picking a tile arms it; the drop input raises the bomb's ring and the next
 * tap on the yard fires it. A bomb costs its `cost` out of the attacker's own
 * pool and marks every bomb of that resource used for the rest of the attack
 * (`ResourceBombs.as:301-315`), so at most one twig, one pebble and one putty
 * bomb go out. Putty bombs buff the attacker's own monsters, so they are only
 * offered while something is on the field (`ATTACK.as:254-265`), and the
 * engine applies no effect for them yet (`engine.ts` fidelity note 8), which
 * the tile says.
 */

/** Twigs, pebbles, putty: the resources bombs are made of, in tier order. */
const RESOURCE_NAMES: Readonly<Record<number, string>> = { 1: "Twigs", 2: "Pebbles", 3: "Putty" };

/** Tier names by id, from the tooltips' own wording. */
const BOMB_NAMES: Readonly<Record<string, string>> = {
  tw0: "Twig bomb",
  tw1: "Big twig bomb",
  tw2: "Huge twig bomb",
  pb0: "Pebble bomb",
  pb1: "Big pebble bomb",
  pb2: "Huge pebble bomb",
  pb3: "Massive pebble bomb",
  pu0: "Putty bomb",
  pu1: "Big putty bomb",
  pu2: "Huge putty bomb",
  pu3: "Massive putty bomb",
};

export const bombName = (id: string): string => BOMB_NAMES[id] ?? id;

/** What the panel needs to know to light or grey each tile. */
export interface CatapultView {
  /** The attacker's pool by resource, or null while unknown. */
  readonly pool: { readonly r1: number; readonly r2: number; readonly r3: number } | null;
  /** Resources whose bomb already went out this attack. */
  readonly used: ReadonlySet<number>;
  readonly creepsAlive: number;
  /** Whether the attack still takes drops. */
  readonly live: boolean;
  /** The armed bomb's id, or null. */
  readonly armed: string | null;
}

export interface CatapultPanelOptions {
  readonly catapultLevel: number;
  /** A tile was pressed: arm this bomb, or un-arm with null. */
  readonly onPick: (bomb: BombStats | null) => void;
  readonly onClose?: () => void;
}

interface Tile {
  readonly bomb: BombStats;
  readonly button: HTMLButtonElement;
  readonly note: HTMLElement;
}

export class CatapultPanel {
  readonly panel: Panel;
  private readonly tiles: Tile[] = [];
  private readonly groups = new Map<number, HTMLElement>();
  private readonly note: HTMLElement;
  private readonly options: CatapultPanelOptions;
  private view: CatapultView = { pool: null, used: new Set(), creepsAlive: 0, live: true, armed: null };

  constructor(options: CatapultPanelOptions) {
    this.options = options;
    this.panel = new Panel({
      title: "Catapult",
      className: "attack-catapult attack-picker",
      ...(options.onClose ? { onClose: options.onClose } : {}),
    });
    this.panel.element.dataset["hotkey"] = "B";

    const body = this.panel.body;
    this.note = document.createElement("p");
    this.note.className = "attack-picker__note";

    const bombs = bombsFor(options.catapultLevel);
    if (options.catapultLevel <= 0 || bombs.length === 0) {
      this.note.textContent = "You have no Catapult, so there are no bombs to fire.";
      body.append(this.note);
      return;
    }

    const lead = document.createElement("p");
    lead.className = "attack-picker__lead";
    lead.textContent = "Pick a bomb, then tap the yard to fire it. One of each kind per attack.";
    body.append(lead);

    for (const bomb of bombs) {
      let group = this.groups.get(bomb.resource);
      if (!group) {
        group = document.createElement("div");
        group.className = "attack-picker__group";
        group.dataset["resource"] = String(bomb.resource);
        const legend = document.createElement("h3");
        legend.className = "attack-picker__legend";
        legend.textContent = RESOURCE_NAMES[bomb.resource] ?? `Resource ${bomb.resource}`;
        group.append(legend);
        body.append(group);
        this.groups.set(bomb.resource, group);
      }
      group.append(this.buildTile(bomb));
    }
    body.append(this.note);
  }

  get element(): HTMLElement {
    return this.panel.element;
  }

  mount(container: HTMLElement): this {
    this.panel.mount(container);
    this.refresh();
    return this;
  }

  /** Re-reads what each tile may do. */
  update(view: CatapultView): void {
    this.view = view;
    this.refresh();
  }

  close(): void {
    this.panel.close();
  }

  destroy(): void {
    this.panel.close();
  }

  private buildTile(bomb: BombStats): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "attack-picker__tile";
    button.dataset["bomb"] = bomb.id;
    button.setAttribute("aria-pressed", "false");

    const name = document.createElement("span");
    name.className = "attack-picker__name";
    name.textContent = bombName(bomb.id);

    const effect = document.createElement("span");
    effect.className = "attack-picker__effect";
    if (bomb.damage > 0) {
      effect.textContent = `${formatAmount(bomb.damage)} damage, radius ${bomb.radius}`;
    } else {
      effect.textContent = `Speeds your monsters up, radius ${bomb.radius}`;
      const badge = document.createElement("span");
      badge.className = "attack-picker__badge";
      badge.textContent = "no effect yet";
      badge.title = "The battle engine does not apply putty bombs yet; the drop is still logged.";
      effect.append(" ", badge);
    }

    const cost = document.createElement("span");
    cost.className = "attack-picker__cost";
    cost.textContent = `${formatAmount(bomb.cost)} ${RESOURCE_NAMES[bomb.resource]?.toLowerCase() ?? ""}`;

    const note = document.createElement("span");
    note.className = "attack-picker__tile-note";

    button.append(name, effect, cost, note);
    button.addEventListener("click", () => {
      const armed = this.view.armed === bomb.id;
      this.options.onPick(armed ? null : bomb);
    });
    this.tiles.push({ bomb, button, note });
    return button;
  }

  private refresh(): void {
    const { pool, used, creepsAlive, live, armed } = this.view;
    let offered = 0;
    for (const tile of this.tiles) {
      const { bomb, button, note } = tile;
      const putty = bomb.resource === 3;
      const hidden = putty && creepsAlive <= 0;
      button.hidden = hidden;
      if (hidden) continue;
      offered += 1;

      const have = pool ? (bomb.resource === 1 ? pool.r1 : bomb.resource === 2 ? pool.r2 : pool.r3) : null;
      let why = "";
      if (!live) why = "The attack is over.";
      else if (used.has(bomb.resource)) why = `${RESOURCE_NAMES[bomb.resource]} bomb already fired.`;
      else if (have === null) why = "Your resources could not be read.";
      else if (have < bomb.cost) why = `Not enough: you have ${formatAmount(have)}.`;

      button.disabled = why !== "";
      note.textContent = why;
      const isArmed = armed === bomb.id;
      button.setAttribute("aria-pressed", String(isArmed));
      button.classList.toggle("attack-picker__tile--armed", isArmed);
    }
    for (const [resource, group] of this.groups) {
      group.hidden = resource === 3 && creepsAlive <= 0;
    }
    if (this.tiles.length === 0) return;
    this.note.textContent =
      offered === 0
        ? "Nothing to fire right now."
        : armed
          ? `${bombName(armed)} armed: tap the yard to fire it. Esc cancels.`
          : creepsAlive <= 0 && this.groups.has(3)
            ? "Putty bombs appear once your monsters are on the field."
            : "";
  }
}
