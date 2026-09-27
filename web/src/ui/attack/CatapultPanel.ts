import { BOMBS, type BombStats } from "@/game/combat/rules";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { resourceIcon, resourceKeyOf } from "@/ui/resourceIcon";

/**
 * The Catapult: resource bombs (`docs/design/attack-flow.md` §F4, §4.4;
 * `docs/specs/combat.md` §3 "Catapult (resource bombs)").
 *
 * A docked panel in the same family as the army panel, not a hover bubble:
 * picking a bomb is the primary action, so it opens on a tap and works the
 * same under a finger (§F4). Opening it changes nothing else — the monster
 * bucket, the champion pick and a pending siege weapon all survive, which is
 * the point of the redesign (`combat.md:412-414` is the Flash behaviour it
 * replaces).
 *
 * ## One row per resource (issue #76)
 *
 * The first cut listed every tier as a tall tile, eleven of them at catapult
 * level 3, and the panel scrolled on an ordinary desktop. A bomb is really two
 * choices, which resource and how big, and only one bomb per resource can go
 * out (`ResourceBombs.as:301-315`), so the panel is three compact rows —
 * twigs, pebbles, putty — each with its tiers as a pill switch, in the idiom
 * of the attack screen's 1x/2x speed switch (#89), and one Arm button. The row says what the attacker has; each tier shows its
 * cost; a tier the pool cannot pay for is greyed; a row the catapult has not
 * unlocked yet stays visible, locked, with the level it needs. A blocked row
 * says why in place of the bomb's effect, so every row is the same height.
 *
 * A row opens on the largest tier the attacker can afford that costs at most
 * 2,000,000, which is how the Flash client picked its default bomb
 * (`ResourceBombs.Setup`, `:237-245`): the two 5,000,000-plus tiers are never
 * the default, so an Arm tap cannot spend ten million by accident. Choosing a
 * tier while that row's bomb is armed re-arms the new size.
 *
 * Arming raises the bomb's ring; the next tap on the yard fires it. A bomb
 * costs its `cost` out of the attacker's own pool and marks every bomb of that
 * resource used for the rest of the attack. Putty bombs buff the attacker's
 * own monsters, so they are only offered while something is on the field
 * (`ATTACK.as:254-265`), and the engine applies no effect for them yet
 * (`engine.ts` fidelity note 8), which the row says.
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

/** The size word each tier's segment shows, in tier order. */
const TIER_LABELS = ["Small", "Big", "Huge", "Massive"] as const;

/** The most a pre-selected bomb may cost (`ResourceBombs.Setup`, `cost <= 2000000`). */
export const DEFAULT_BOMB_COST_CAP = 2_000_000;

export const bombName = (id: string): string => BOMB_NAMES[id] ?? id;

/** A cost as the segment shows it: `10K`, `100K`, `2M`. */
const shortCost = (value: number): string => {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}K`;
  return String(value);
};

/** What the panel needs to know to light or grey each row. */
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
  /** A bomb was armed, or un-armed with null. */
  readonly onPick: (bomb: BombStats | null) => void;
  readonly onClose?: () => void;
}

/**
 * The tier a row opens on: the largest affordable one within the Flash
 * default's cost cap, else the largest affordable one, else the smallest.
 */
export const defaultTier = (tiers: readonly BombStats[], have: number | null): BombStats => {
  const affordable = tiers.filter((bomb) => have !== null && have >= bomb.cost);
  const capped = affordable.filter((bomb) => bomb.cost <= DEFAULT_BOMB_COST_CAP);
  return capped.at(-1) ?? affordable.at(-1) ?? tiers[0]!;
};

interface Segment {
  readonly bomb: BombStats;
  readonly button: HTMLButtonElement;
}

interface Row {
  readonly resource: number;
  readonly tiers: readonly BombStats[];
  readonly element: HTMLElement;
  readonly have: HTMLElement;
  readonly segments: readonly Segment[];
  readonly arm: HTMLButtonElement;
  readonly detail: HTMLElement;
  /** The tier the player chose, or null for the default. */
  chosen: string | null;
}

const poolOf = (view: CatapultView, resource: number): number | null => {
  const pool = view.pool;
  if (!pool) return null;
  return resource === 1 ? pool.r1 : resource === 2 ? pool.r2 : pool.r3;
};

export class CatapultPanel {
  readonly panel: Panel;
  private readonly rows: Row[] = [];
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

    if (options.catapultLevel <= 0) {
      this.note.textContent = "You have no Catapult, so there are no bombs to fire.";
      body.append(this.note);
      return;
    }

    const lead = document.createElement("p");
    lead.className = "attack-picker__lead";
    lead.textContent = "Pick a size, arm it, then tap the yard.";
    body.append(lead);

    for (const resource of [1, 2, 3]) {
      const tiers = BOMBS.filter((bomb) => bomb.resource === resource);
      if (tiers.length > 0) body.append(this.buildRow(resource, tiers));
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

  /** Re-reads what each row may do. */
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

  private buildRow(resource: number, tiers: readonly BombStats[]): HTMLElement {
    const name = RESOURCE_NAMES[resource] ?? `Resource ${resource}`;
    const element = document.createElement("section");
    element.className = "attack-catapult__row";
    element.dataset["resource"] = String(resource);
    element.setAttribute("aria-label", `${name} bombs`);

    const head = document.createElement("div");
    head.className = "attack-catapult__head";
    // The row is headed by what it spends: the resource's icon and how much
    // of it the attacker holds (#93), where it used to be the word and the
    // amount at opposite ends.
    const title = document.createElement("h3");
    title.className = "attack-catapult__resource";
    const have = document.createElement("span");
    have.className = "attack-catapult__have";
    title.append(resourceIcon(resourceKeyOf(resource)), have);
    head.append(title);
    if (resource === 3) {
      const badge = document.createElement("span");
      badge.className = "attack-picker__badge";
      badge.textContent = "no effect yet";
      badge.title = "The battle engine does not apply putty bombs yet; the drop is still logged.";
      head.append(badge);
    }

    const group = document.createElement("div");
    group.className = "attack-catapult__tiers";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `${name} bomb size`);
    const segments: Segment[] = tiers.map((bomb, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost attack-catapult__tier";
      button.dataset["bomb"] = bomb.id;
      button.setAttribute("aria-pressed", "false");
      const label = document.createElement("span");
      label.className = "attack-catapult__tier-name";
      label.textContent = TIER_LABELS[index] ?? bombName(bomb.id);
      const cost = document.createElement("span");
      cost.className = "attack-catapult__tier-cost";
      cost.textContent = shortCost(bomb.cost);
      button.append(label, cost);
      button.addEventListener("click", () => this.choose(row, bomb));
      group.append(button);
      return { bomb, button };
    });

    const foot = document.createElement("div");
    foot.className = "attack-catapult__foot";
    const detail = document.createElement("span");
    detail.className = "attack-catapult__detail";
    const arm = document.createElement("button");
    arm.type = "button";
    arm.className = "btn btn--primary attack-catapult__arm";
    arm.dataset["arm"] = String(resource);
    arm.setAttribute("aria-pressed", "false");
    arm.addEventListener("click", () => this.toggleArm(row));
    foot.append(detail, arm);

    element.append(head, group, foot);
    const row: Row = { resource, tiers, element, have, segments, arm, detail, chosen: null };
    this.rows.push(row);
    return element;
  }

  /** The tier a row is showing: the armed one, the player's pick, or the default. */
  private selected(row: Row): BombStats {
    const armed = row.tiers.find((bomb) => bomb.id === this.view.armed);
    if (armed) return armed;
    const chosen = row.tiers.find((bomb) => bomb.id === row.chosen);
    return chosen ?? defaultTier(row.tiers, poolOf(this.view, row.resource));
  }

  /** Why nothing in the row can be armed right now, or "". */
  private blocked(row: Row): string {
    const need = row.tiers[0]!.catapultLevel;
    if (!this.view.live) return "The attack is over.";
    if (this.options.catapultLevel < need) return `Needs a level ${need} Catapult.`;
    if (this.view.used.has(row.resource)) return "Already fired this attack.";
    if (poolOf(this.view, row.resource) === null) return "Your resources could not be read.";
    if (row.resource === 3 && this.view.creepsAlive <= 0) {
      return "Ready once your monsters are on the field.";
    }
    return "";
  }

  private choose(row: Row, bomb: BombStats): void {
    row.chosen = bomb.id;
    const armedHere = row.tiers.some((tier) => tier.id === this.view.armed);
    if (armedHere && this.view.armed !== bomb.id) {
      this.options.onPick(bomb);
      return;
    }
    this.refresh();
  }

  private toggleArm(row: Row): void {
    const bomb = this.selected(row);
    this.options.onPick(this.view.armed === bomb.id ? null : bomb);
  }

  private refresh(): void {
    const { armed } = this.view;
    for (const row of this.rows) {
      const have = poolOf(this.view, row.resource);
      const why = this.blocked(row);
      const unlocked = this.options.catapultLevel >= row.tiers[0]!.catapultLevel;
      const bomb = this.selected(row);
      const payable = have !== null && have >= bomb.cost;

      row.element.classList.toggle("attack-catapult__row--locked", !unlocked);
      row.have.textContent = !unlocked ? "Locked" : have === null ? "" : formatAmount(have);
      row.have.title =
        unlocked && have !== null
          ? `You have ${Math.floor(have).toLocaleString("en-US")} ${
              RESOURCE_NAMES[row.resource]?.toLowerCase() ?? ""
            }`
          : "";

      for (const segment of row.segments) {
        const affordable = have !== null && have >= segment.bomb.cost;
        segment.button.disabled = why !== "" || !affordable;
        segment.button.title =
          why !== ""
            ? why
            : affordable
              ? bombName(segment.bomb.id)
              : `${bombName(segment.bomb.id)}: costs ${formatAmount(segment.bomb.cost)}`;
        const on = segment.bomb.id === bomb.id;
        segment.button.setAttribute("aria-pressed", String(on));
      }

      // Why the row cannot fire takes the effect's place, so a blocked row is
      // no taller than an open one.
      const block =
        why !== "" ? why : payable ? "" : `Not enough: you have ${formatAmount(have ?? 0)}.`;
      row.detail.textContent =
        block !== ""
          ? block
          : bomb.damage > 0
            ? `${shortCost(bomb.damage)} damage per building`
            : "Speeds up your monsters";
      row.detail.classList.toggle("attack-catapult__detail--blocked", block !== "");

      const isArmed = armed === bomb.id;
      const usable = why === "" && payable;
      row.arm.disabled = !usable && !isArmed;
      row.arm.textContent = isArmed ? "Armed" : "Arm";
      row.arm.title = isArmed
        ? `${bombName(bomb.id)} armed: tap the yard to fire it. Esc cancels.`
        : `${bombName(bomb.id)}, ${formatAmount(bomb.cost)} ${
            RESOURCE_NAMES[row.resource]?.toLowerCase() ?? ""
          }`;
      row.arm.setAttribute("aria-pressed", String(isArmed));
      row.arm.classList.toggle("attack-catapult__arm--armed", isArmed);
      row.element.classList.toggle("attack-catapult__row--armed", isArmed);
    }
    // Each row says why it cannot fire and the Arm button says "Armed", so the
    // panel adds no line of its own: a line here would push the last row under
    // the yard's minimap at 1366 x 768.
  }
}
