import type { YardRefusal } from "@/api/yard";
import {
  expansionEndsAt,
  HOUSING_EXPANSION,
  HOUSING_TYPE,
  housingBuildings,
  housingSummary,
  type HousedRow,
  type HousingBuildingRow,
} from "@/game/monsters/housing";
import {
  housingBlocks,
  livingHere,
  sharedRoom,
  waitingForRoom,
  waitingText,
  type WaitingMonster,
} from "@/game/monsters/housingPanel";
import { nameOf } from "@/game/yard/buildingCosts";
import { actionKey, type YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { icon } from "@/ui/icons";
import { resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/housing.css";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import { monsterPicture } from "./LockerTab";
import { MonstersTabId } from "./monstersTab";

/**
 * What lives in the yard's Housing, drawn as the approved Housing panel
 * (#170, mock-up R-Housing): the space as one big figure over a bar split
 * into one block per Housing, a card for the monsters waiting for room
 * (#169) that is gone when none wait, and the army as pictures with counts,
 * biggest space first, ending in a "Hatch more" tile.
 *
 * Shared by the Housing building's panel (`BuildingPanel`), where the clicked
 * Housing's block is ringed "This one" and the waiting card offers Housing
 * Expansion, and the Monsters screen's Housing tab (`HousingTab`), which has
 * the Juicer and the expansion in sections of their own below it.
 *
 * A block is the way to that Housing in the yard; a picture opens its
 * monster's card on the Unlock tab (the first tab on an outpost, which has
 * none).
 */

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

export interface HousingViewOptions {
  readonly binding: YardUiBinding;
  /** "Hatch more", and the empty army's way to hatch. */
  readonly onHatch: () => void;
  /** The waiting card's "Juice some". */
  readonly onJuice: () => void;
  /**
   * With it, the view has Housing Expansion: its time left under the bar
   * while one runs, and its buy in the waiting card, reported here. The
   * Housing tab leaves it out: it has an expansion section of its own.
   */
  readonly onStatus?: (status: Status) => void;
}

/** The store's queue key for the expansion purchase. */
const BUY_KEY = actionKey("buy", HOUSING_EXPANSION.item);

/** How many of the waiting monsters' pictures the card stacks. */
const WAITING_PICTURES = 2;

/** "10 free", "1,950 over". */
export const freeText = (used: number, total: number): string =>
  used <= total ? `${formatAmount(total - used)} free` : `${formatAmount(used - total)} over`;

/** "51 monsters · 7 kinds". */
export const armyCount = (rows: readonly HousedRow[]): string => {
  const monsters = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    `${formatAmount(monsters)} ${monsters === 1 ? "monster" : "monsters"} · ` +
    `${rows.length} ${rows.length === 1 ? "kind" : "kinds"}`
  );
};

/** Why a Housing houses nothing, or what it houses at mid-upgrade; null when there is nothing to say. */
export const housingNote = (row: HousingBuildingRow): string | null => {
  if (row.zero === "building") return "Still being built: houses nothing yet.";
  if (row.zero === "damaged") return "Too damaged to house monsters: repair it.";
  if (row.upgrading) return `Upgrading: houses at level ${row.level} until it finishes.`;
  return null;
};

export class HousingView {
  readonly element: HTMLElement;

  private readonly options: HousingViewOptions;
  private readonly space: HTMLElement;
  private readonly waiting: HTMLElement;
  private readonly living: HTMLElement;
  /** The Housing the panel is for, ringed "This one"; null in the Monsters screen. */
  private focus: number | null = null;
  /** The running expansion's end as last drawn, so its expiry redraws. */
  private drawnExpansion: number | null = null;
  private expansionClock: HTMLElement | null = null;
  /** Long-lived, so an armed button survives the redraws. */
  private buyButton: ShinyButton | null = null;

  constructor(options: HousingViewOptions) {
    this.options = options;
    this.element = document.createElement("div");
    this.element.className = "housing-view";
    this.space = document.createElement("div");
    this.space.className = "housing-space";
    this.waiting = document.createElement("div");
    this.waiting.className = "housing-waiting";
    this.waiting.setAttribute("role", "status");
    this.living = document.createElement("section");
    this.living.className = "housing-living";
    this.living.setAttribute("aria-label", "Living here");
    this.element.append(this.space, this.waiting, this.living);
  }

  private get store() {
    return this.options.binding.store;
  }

  /** The Housing to ring as "This one", or null for none. */
  setFocus(id: number | null): void {
    this.focus = id;
  }

  render(): void {
    const save = this.store.save;
    const now = this.store.now();
    const summary = housingSummary(save, now);
    const waiting = waitingForRoom(save);
    this.drawnExpansion = expansionEndsAt(save, now);
    this.renderSpace(housingBuildings(save, now), summary.used, summary.total, waiting.length > 0, now);
    this.renderWaiting(waiting);
    this.renderLiving(livingHere(save));
    this.syncPending();
  }

  /** Once a second: the expansion's clock, and a redraw when it runs out. */
  tick(): void {
    const now = this.store.now();
    const ends = expansionEndsAt(this.store.save, now);
    if (ends !== this.drawnExpansion) {
      this.render();
      return;
    }
    if (ends !== null && this.expansionClock) this.expansionClock.textContent = formatCountdown(ends - now);
  }

  syncPending(): void {
    this.buyButton?.setBusy(this.store.isRunning(BUY_KEY));
  }

  destroy(): void {
    this.buyButton?.destroy();
    this.buyButton = null;
    this.element.remove();
  }

  /* ── The space ──────────────────────────────────────────────────────── */

  private renderSpace(
    buildings: readonly HousingBuildingRow[],
    used: number,
    total: number,
    waiting: boolean,
    now: number,
  ): void {
    const tight = waiting || used >= total;
    this.space.classList.toggle("housing-space--tight", tight);

    const head = document.createElement("div");
    head.className = "housing-space__head";
    const figures = document.createElement("span");
    figures.className = "housing-space__figures";
    const value = document.createElement("span");
    value.className = "housing-space__used";
    value.textContent = formatAmount(used);
    const of = document.createElement("span");
    of.className = "housing-space__total";
    of.textContent = `/ ${formatAmount(total)} spaces`;
    figures.append(value, of);
    const free = document.createElement("span");
    free.className = "housing-space__free";
    free.classList.toggle("housing-space__free--tight", tight);
    free.textContent = freeText(used, total);
    head.append(figures, free);

    const name = nameOf(HOUSING_TYPE) || "Housing";
    const bar = document.createElement("div");
    bar.className = "housing-space__bar";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", `Housing space: ${formatAmount(used)} of ${formatAmount(total)} used`);
    const blocks = housingBlocks(buildings, used);
    blocks.forEach((block, index) => {
      const row = buildings[index]!;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "housing-space__block";
      button.dataset["building"] = String(block.id);
      button.style.flexGrow = String(Math.max(block.capacity, 1));
      const note = housingNote(row);
      button.classList.toggle("housing-space__block--zero", row.zero !== null);
      const mine = block.id === this.focus;
      if (mine) {
        button.classList.add("housing-space__block--this");
        button.setAttribute("aria-current", "true");
      }
      button.setAttribute(
        "aria-label",
        `${name} ${index + 1} of ${blocks.length}${mine ? ", this one" : ""}: ` +
          `${formatAmount(block.used)} of ${formatAmount(block.capacity)} spaces used` +
          (note ? `. ${note}` : ""),
      );
      button.title = note ? `${note} Show it in the yard.` : `Show this ${name} in the yard`;
      const fill = document.createElement("span");
      fill.className = "housing-space__fill";
      fill.style.width = `${+(block.fraction * 100).toFixed(1)}%`;
      button.append(fill);
      button.addEventListener("click", () => this.options.binding.scene.selectBuilding(block.id));
      bar.append(button);
    });

    const legend = document.createElement("div");
    legend.className = "housing-space__legend";
    const room = sharedRoom(buildings);
    const left = document.createElement("span");
    left.textContent =
      buildings.length === 0
        ? `No ${name} yet: build one to house monsters.`
        : room === null
          ? `Each block is one ${name}`
          : `Each block is one ${name}, ${formatAmount(room)} spaces`;
    legend.append(left);
    if (this.focus !== null && blocks.some((block) => block.id === this.focus)) {
      const key = document.createElement("span");
      key.className = "housing-space__key";
      const swatch = document.createElement("span");
      swatch.className = "housing-space__swatch";
      swatch.setAttribute("aria-hidden", "true");
      key.append(swatch, "This one");
      legend.append(key);
    }

    const parts: HTMLElement[] = [head, bar, legend];
    this.expansionClock = null;
    const ends = this.drawnExpansion;
    if (ends !== null && this.options.onStatus) {
      const on = document.createElement("p");
      on.className = "housing-space__expansion";
      const clock = document.createElement("strong");
      clock.textContent = formatCountdown(ends - now);
      this.expansionClock = clock;
      on.append("Housing Expansion on: every Housing houses 25% more for ", clock, ".");
      parts.push(on);
    }
    this.space.replaceChildren(...parts);
  }

  /* ── Waiting for room ───────────────────────────────────────────────── */

  private renderWaiting(waiting: readonly WaitingMonster[]): void {
    const words = waitingText(waiting);
    this.waiting.hidden = words === null;
    if (!words) {
      this.buyButton?.destroy();
      this.buyButton = null;
      this.waiting.replaceChildren();
      return;
    }

    const top = document.createElement("div");
    top.className = "housing-waiting__top";
    const faces = document.createElement("div");
    faces.className = "housing-waiting__faces";
    faces.setAttribute("aria-hidden", "true");
    for (const entry of waiting.slice(0, WAITING_PICTURES)) {
      const face = document.createElement("span");
      face.className = "housing-waiting__face";
      face.append(monsterPicture(entry.monster, "small", "housing-waiting__picture"));
      faces.append(face);
    }
    const text = document.createElement("div");
    text.className = "housing-waiting__text";
    const title = document.createElement("span");
    title.className = "housing-waiting__title";
    title.append(icon("warning", 16, "housing-waiting__icon"), words.title);
    const line = document.createElement("span");
    line.className = "housing-waiting__line";
    line.textContent = words.text;
    text.append(title, line);
    top.append(faces, text);

    const buttons = document.createElement("div");
    buttons.className = "housing-waiting__buttons";
    const juice = document.createElement("button");
    juice.type = "button";
    juice.className = "btn housing-waiting__juice";
    juice.append(icon("drop", 16), "Juice some");
    juice.title = "Turn some of your monsters into goo to make room";
    juice.addEventListener("click", () => this.options.onJuice());
    buttons.append(juice);

    if (this.options.onStatus && this.drawnExpansion === null) {
      if (!this.buyButton) {
        this.buyButton = new ShinyButton({
          label: "+25% · 24 h",
          spell: formatAmount,
          onSpend: () => void this.runBuy(),
          className: "housing-waiting__expand",
        });
        this.buyButton.element.title = "Housing Expansion: every Housing houses 25% more for 24 hours";
      }
      this.buyButton.setPrice(HOUSING_EXPANSION.price);
      this.buyButton.setBlocked(this.store.credits < HOUSING_EXPANSION.price ? "Not enough Shiny." : null);
      buttons.append(this.buyButton.element);
    } else {
      this.buyButton?.destroy();
      this.buyButton = null;
    }
    buttons.classList.toggle("housing-waiting__buttons--one", buttons.childElementCount === 1);
    this.waiting.replaceChildren(top, buttons);
  }

  private async runBuy(): Promise<void> {
    const onStatus = this.options.onStatus;
    const result = await this.store.buy(HOUSING_EXPANSION.item);
    if (result.ok) {
      onStatus?.({
        tone: "good",
        content: [
          "Housing Expansion on for 24 hours: ",
          resourceAmount("shiny", result.report.credits),
          " spent.",
        ],
      });
    } else {
      onStatus?.({ tone: "bad", content: [refusalText(result.refusal)] });
    }
    this.render();
  }

  /* ── Living here ────────────────────────────────────────────────────── */

  private renderLiving(rows: readonly HousedRow[]): void {
    const head = document.createElement("div");
    head.className = "housing-living__head";
    const title = document.createElement("h3");
    title.className = "housing-living__title";
    title.textContent = "Living here";
    const count = document.createElement("span");
    count.className = "housing-living__count";
    count.textContent = rows.length > 0 ? armyCount(rows) : "No monsters yet";
    head.append(title, count);

    const grid = document.createElement("div");
    grid.className = "housing-living__grid";
    for (const row of rows) grid.append(this.tile(row));

    const hatch = document.createElement("button");
    hatch.type = "button";
    hatch.className = "housing-living__hatch";
    hatch.setAttribute("aria-label", "Hatch more monsters");
    hatch.title = "Hatch more monsters";
    hatch.append(icon("plus", 22), "Hatch more");
    hatch.addEventListener("click", () => this.options.onHatch());
    grid.append(hatch);

    this.living.replaceChildren(head, grid);
  }

  private tile(row: HousedRow): HTMLButtonElement {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "housing-living__tile";
    tile.dataset["monster"] = row.monster.id;
    const label =
      `${row.monster.name}: ${formatAmount(row.count)} housed, ` +
      `${formatAmount(row.each)} ${row.each === 1 ? "space" : "spaces"} each, ${formatAmount(row.total)} in total`;
    tile.setAttribute("aria-label", label);
    tile.title = `${label}. Open its card.`;
    const count = document.createElement("span");
    count.className = "housing-living__badge";
    count.textContent = `×${formatAmount(row.count)}`;
    const name = document.createElement("span");
    name.className = "housing-living__name";
    name.textContent = row.monster.name;
    const space = document.createElement("span");
    space.className = "housing-living__space";
    space.textContent = `${formatAmount(row.total)} space`;
    tile.append(monsterPicture(row.monster, "small", "housing-living__picture"), count, name, space);
    tile.addEventListener("click", () =>
      this.options.binding.scene.openMonsters?.(MonstersTabId.UNLOCK, { monster: row.monster.id }),
    );
    return tile;
  }
}

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
