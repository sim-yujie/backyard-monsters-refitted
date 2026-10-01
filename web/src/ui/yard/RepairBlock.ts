import { tutTarget, TutTarget } from "@/game/guide/targets";
import { RepairKey } from "@/api/yardRepair";
import type { RepairOffer } from "@/game/yard/repair";
import { formatAmount, formatCountdown } from "@/ui/format";
import type { ShinyButton } from "./ShinyButton";
import { describeSeconds } from "./upgradeText";

/**
 * The building panel's repair block (`docs/design/yard-buildings.md` §5.5): a
 * damaged building's health, its **Repair** button, and **Repair all now**
 * for Shiny.
 *
 * Repair is free and holds no worker, so it is a plain button; the original
 * put it where Upgrade would be (`client/scripts/BUILDINGINFO.as:98-107`), and
 * the upgrade block below says "Repair first." while the building is damaged.
 * While the repair runs the block shows its countdown and the health filling.
 * Repair all now (`FIX`) heals every damaged building in the yard at once, so
 * its label says how many; with every repair at five minutes or less it costs
 * nothing and becomes a plain button, as Finish free does.
 *
 * The panel owns the block's life: it builds one per redraw and calls
 * {@link RepairBlock.update} once a second.
 */

export interface RepairBlockHooks {
  /** The panel's long-lived Shiny button for this key, so an armed one survives redraws. */
  shinyButton(key: string, label: string, onSpend: () => void): ShinyButton;
  /** Registers a button to disable while its request key runs. */
  pending(key: string, button: HTMLButtonElement | ShinyButton): void;
  repair(): void;
  repairNow(): void;
}

/** "Repair all now" names how many it heals when that is more than this building. */
export const repairNowLabel = (count: number): string =>
  count > 1 ? `Repair all ${count} now` : "Repair now";

export class RepairBlock {
  readonly element: HTMLElement;

  private readonly time: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly health: HTMLElement;
  private readonly now: ShinyButton | null;
  private readonly free: boolean;
  private readonly repairing: boolean;

  /**
   * @param id - The building.
   * @param offer - Its repair offer at the moment of drawing.
   * @param used - The panel's set of Shiny keys still in use, which this adds to.
   */
  constructor(id: number, offer: RepairOffer, hooks: RepairBlockHooks, used: Set<string>) {
    const { damage } = offer;
    this.repairing = damage.repairing;
    this.free = offer.nowPrice === 0;

    const block = document.createElement("section");
    block.className = "building-panel__block building-repair";
    block.setAttribute("aria-label", damage.repairing ? "Repairing" : "Damaged");
    this.element = block;

    const head = document.createElement("div");
    head.className = "building-panel__head";
    const title = document.createElement("h3");
    title.className = "building-panel__heading";
    title.textContent = damage.repairing ? "Repairing" : "Damaged";
    this.time = document.createElement("span");
    this.time.className = "building-panel__time building-repair__time";
    head.append(title, this.time);

    this.bar = document.createElement("div");
    this.bar.className = "building-job__bar building-repair__bar";
    this.bar.setAttribute("role", "progressbar");
    this.bar.setAttribute("aria-label", "Health");
    this.bar.setAttribute("aria-valuemin", "0");
    this.bar.setAttribute("aria-valuemax", "100");
    this.fill = document.createElement("div");
    this.fill.className = "building-job__fill building-repair__fill";
    this.bar.append(this.fill);

    this.health = document.createElement("p");
    this.health.className = "building-panel__note building-repair__health";
    // The info rows above already give the saved health; only a running
    // repair has a live figure worth its own line.
    this.health.hidden = !damage.repairing;
    block.append(head, this.bar, this.health);

    const row = document.createElement("div");
    row.className = "map-row map-row--wrap building-panel__buttons";
    if (!damage.repairing) {
      const repair = button("Repair", hooks.repair, "btn--primary");
      tutTarget(repair, TutTarget.REPAIR);
      repair.title = "Free, and needs no worker. The building heals over time.";
      hooks.pending(RepairKey.one(id), repair);
      row.append(repair);
    }
    const label = repairNowLabel(offer.nowCount);
    if (this.free) {
      this.now = null;
      const finish = button(label, hooks.repairNow);
      finish.title = "Every repair has five minutes or less left: finishing costs nothing.";
      hooks.pending(RepairKey.NOW, finish);
      row.append(finish);
    } else {
      const key = `${id}:repairNow`;
      used.add(key);
      this.now = hooks.shinyButton(key, label, hooks.repairNow);
      hooks.pending(RepairKey.NOW, this.now);
      row.append(this.now.element);
    }
    block.append(row);

    this.update(offer);
  }

  /**
   * Redraws the clock, the bar and the price from an offer read at the
   * current moment. Returns false when the block must be rebuilt instead: the
   * repair started or ended, or Repair now crossed between free and paid.
   */
  update(offer: RepairOffer): boolean {
    const { damage } = offer;
    if (damage.repairing !== this.repairing || (offer.nowPrice === 0) !== this.free) return false;

    if (damage.repairing) {
      this.time.textContent = formatCountdown(damage.secondsLeft);
      this.time.title = "Until this building is back to full health.";
    } else {
      this.time.textContent = describeSeconds(damage.secondsLeft);
      this.time.title = "How long a repair takes. It is free and needs no worker.";
    }

    const fraction = damage.max > 0 ? damage.now / damage.max : 1;
    const percent = Math.round(fraction * 100);
    this.fill.style.width = `${fraction * 100}%`;
    this.bar.setAttribute("aria-valuenow", String(percent));
    this.bar.setAttribute(
      "aria-valuetext",
      `${formatAmount(damage.now)} of ${formatAmount(damage.max)} health`,
    );
    this.health.textContent = `Healed to ${formatAmount(damage.now)} / ${formatAmount(damage.max)}`;

    if (this.now) {
      this.now.setPrice(offer.nowPrice);
      this.now.setBlocked(offer.nowBlocked === "credits" ? "Not enough Shiny." : null);
    }
    return true;
  }
}

const button = (label: string, onClick: () => void, variant?: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = variant ? `btn ${variant}` : "btn";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
};
