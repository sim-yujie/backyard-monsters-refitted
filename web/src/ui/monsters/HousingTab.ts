import type { YardRefusal } from "@/api/yard";
import type { JuiceActions } from "@/api/yardJuice";
import {
  expansionEndsAt,
  HOUSING_EXPANSION,
  HOUSING_TYPE,
  housedRows,
  housingBuildings,
  housingSummary,
  stalledHatcheries,
  type HousedRow,
  type HousingBuildingRow,
} from "@/game/monsters/housing";
import { nameOf } from "@/game/yard/buildingCosts";
import { actionKey, YardChangeReason, type YardChange } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/housing.css";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import { HousingJuice } from "./HousingJuice";
import { monsterPicture } from "./LockerTab";
import { MonstersTabId, type MonstersFocus, type MonstersTab, type MonstersTabContext } from "./monstersTab";

/**
 * The Housing tab (`docs/design/yard-buildings.md` §4.5): read-only.
 *
 * Top to bottom: how many hatcheries have a finished monster waiting for room,
 * if any; the army, one row per monster type with its count, the space one
 * takes and the space they all take, under the used/total bar; the Housing
 * buildings, one row each with its level and what it houses, saying why one
 * houses nothing; the Monster Juicer (`HousingJuice.ts`, §7.3): pick how many
 * of each to juice and juice them, confirmed first; and Housing Expansion
 * (`EXH`), a {@link ShinyButton} while none runs, its time left while one does.
 *
 * Every figure comes from `game/monsters/housing.ts`, the header's own
 * arithmetic, so the tab and the header always agree. The purchase goes
 * through the store's `buy("EXH")`. No Ascend (D19).
 */

/** The store's queue key for the expansion purchase. */
const BUY_KEY = actionKey("buy", HOUSING_EXPANSION.item);

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

export class HousingTab implements MonstersTab {
  readonly element: HTMLElement;

  private readonly context: MonstersTabContext;
  private readonly stalled: HTMLElement;
  private readonly status: HTMLElement;
  private readonly army: HTMLElement;
  private readonly buildings: HTMLElement;
  private readonly expansion: HTMLElement;
  private readonly juiceSection: HTMLElement;
  private readonly juice: HousingJuice;

  /** The building the tab was opened from, marked in the list. */
  private focusBuilding: number | null = null;
  /** The running expansion's end as last drawn, so its expiry redraws the tab. */
  private drawnExpansion: number | null = null;
  private expansionClock: HTMLElement | null = null;
  /** Long-lived, so an armed button survives the redraws. */
  private buyButton: ShinyButton | null = null;

  constructor(context: MonstersTabContext, juiceActions?: JuiceActions) {
    this.context = context;

    this.element = document.createElement("div");
    this.element.className = "housing";

    this.stalled = document.createElement("p");
    this.stalled.className = "housing__stalled";
    this.stalled.hidden = true;

    this.status = document.createElement("p");
    this.status.className = "monsters-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    const scroll = document.createElement("div");
    scroll.className = "housing__scroll";
    this.army = section("housing-army", "Army");
    this.juiceSection = section("housing-juicer", "Monster Juicer");
    this.juice = new HousingJuice({
      store: context.binding.store,
      onStatus: (status) => this.setStatus(status),
      ...(juiceActions ? { actions: juiceActions } : {}),
    });
    this.juiceSection.append(this.juice.element);
    this.buildings = section("housing-buildings", "Housing buildings");
    this.expansion = section("housing-expansion", "Housing Expansion");
    scroll.append(this.army, this.juiceSection, this.buildings, this.expansion);

    this.element.append(this.stalled, this.status, scroll);
  }

  private get store() {
    return this.context.binding.store;
  }

  show(focus: MonstersFocus): void {
    this.focusBuilding = focus.buildingId ?? null;
    this.render();
    if (this.focusBuilding !== null) {
      this.buildings
        .querySelector(`[data-building="${this.focusBuilding}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
    }
  }

  update(change: YardChange): void {
    if (change.reason === YardChangeReason.PENDING) {
      this.syncPending();
      return;
    }
    this.render();
  }

  tick(): void {
    const now = this.store.now();
    const ends = expansionEndsAt(this.store.save, now);
    if (ends !== this.drawnExpansion) {
      // Running out changes every building's figure.
      this.render();
      return;
    }
    if (ends !== null && this.expansionClock) this.expansionClock.textContent = formatCountdown(ends - now);
    this.syncPending();
  }

  destroy(): void {
    this.juice.destroy();
    this.buyButton?.destroy();
    this.buyButton = null;
    this.element.remove();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private render(): void {
    const save = this.store.save;
    const now = this.store.now();

    const stalled = stalledHatcheries(save);
    this.stalled.hidden = stalled === 0;
    this.stalled.textContent =
      stalled === 1
        ? "1 hatchery is waiting for space."
        : `${formatAmount(stalled)} hatcheries are waiting for space.`;

    this.renderArmy(housedRows(save), housingSummary(save, now));
    this.juice.render();
    this.renderBuildings(housingBuildings(save, now));
    this.renderExpansion(expansionEndsAt(save, now), now);
    this.syncPending();
  }

  private renderArmy(rows: readonly HousedRow[], { used, total }: { used: number; total: number }): void {
    const free = total - used;
    const figures = document.createElement("p");
    figures.className = "housing__figures";
    const value = document.createElement("strong");
    value.textContent = `${formatAmount(used)} / ${formatAmount(total)}`;
    figures.append(
      value,
      free >= 0 ? ` housed · ${formatAmount(free)} free` : ` housed · ${formatAmount(-free)} over`,
    );

    const bar = document.createElement("div");
    bar.className = "monsters-bar housing__bar";
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-label", "Housing used");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(Math.max(total, 1)));
    bar.setAttribute("aria-valuenow", String(Math.min(used, Math.max(total, 1))));
    bar.setAttribute("aria-valuetext", `${formatAmount(used)} of ${formatAmount(total)}`);
    bar.classList.toggle("monsters-bar--full", total > 0 && used >= total);
    const fill = document.createElement("div");
    fill.className = "monsters-bar__fill";
    const fraction = total > 0 ? Math.min(1, used / total) : used > 0 ? 1 : 0;
    fill.style.width = `${+(fraction * 100).toFixed(2)}%`;
    bar.append(fill);

    const body: HTMLElement[] = [figures, bar];
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "housing__empty";
      const note = document.createElement("p");
      note.textContent = "No monsters housed yet.";
      const hatch = plainButton("Hatch some", () => this.context.showTab(MonstersTabId.HATCH));
      empty.append(note, hatch);
      body.push(empty);
    } else {
      body.push(armyTable(rows, used));
    }
    fillSection(this.army, body);
  }

  private renderBuildings(rows: readonly HousingBuildingRow[]): void {
    const table = document.createElement("table");
    table.className = "housing-table housing-table--buildings";
    table.append(head(["Building", "Level", "Houses", ""]));
    const tbody = document.createElement("tbody");
    const name = nameOf(HOUSING_TYPE) || "Housing";
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.dataset["building"] = String(row.id);
      tr.classList.toggle("housing-table__row--zero", row.zero !== null);
      if (row.id === this.focusBuilding) {
        tr.classList.add("housing-table__row--focus");
        tr.setAttribute("aria-current", "true");
      }

      const label = document.createElement("th");
      label.scope = "row";
      label.className = "housing-table__name";
      label.append(name);
      const note = buildingNote(row);
      if (note) {
        const line = document.createElement("span");
        line.className = "housing-table__note";
        line.textContent = note;
        label.append(line);
      }

      const show = plainButton("Show", () => this.context.binding.scene.selectBuilding(row.id), "btn--ghost");
      show.classList.add("housing-table__show");
      show.setAttribute("aria-label", `Show this ${name} in the yard`);
      const showCell = cell("");
      showCell.append(show);

      tr.append(
        label,
        cell(String(row.level), "housing-table__num"),
        cell(formatAmount(row.capacity), "housing-table__num"),
        showCell,
      );
      tbody.append(tr);
    }
    table.append(tbody);
    fillSection(this.buildings, [scrollBox(table)]);
  }

  private renderExpansion(ends: number | null, now: number): void {
    this.drawnExpansion = ends;
    this.expansionClock = null;
    const text = document.createElement("p");
    text.className = "housing-expansion__text";

    if (ends !== null) {
      this.buyButton?.destroy();
      this.buyButton = null;
      const clock = document.createElement("strong");
      clock.className = "housing-expansion__clock";
      clock.textContent = formatCountdown(ends - now);
      this.expansionClock = clock;
      text.classList.add("housing-expansion__text--on");
      text.append("On: every building houses 25% more for ", clock, ".");
      fillSection(this.expansion, [text]);
      return;
    }

    text.textContent = "Every building houses 25% more for 24 hours.";
    if (!this.buyButton) {
      this.buyButton = new ShinyButton({
        label: "Expand housing",
        spell: formatAmount,
        onSpend: () => void this.runBuy(),
        className: "housing-expansion__buy",
      });
    }
    this.buyButton.setPrice(HOUSING_EXPANSION.price);
    this.buyButton.setBlocked(this.store.credits < HOUSING_EXPANSION.price ? "Not enough Shiny." : null);
    fillSection(this.expansion, [text, this.buyButton.element]);
  }

  private syncPending(): void {
    this.juice.syncPending();
    this.buyButton?.setBusy(this.store.isRunning(BUY_KEY));
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  private async runBuy(): Promise<void> {
    const result = await this.store.buy(HOUSING_EXPANSION.item);
    if (result.ok) {
      this.setStatus({
        tone: "good",
        content: [
          "Housing Expansion on for 24 hours: ",
          resourceAmount("shiny", result.report.credits),
          " spent.",
        ],
      });
    } else {
      this.setStatus({ tone: "bad", content: [refusalText(result.refusal)] });
    }
    this.render();
  }

  private setStatus(status: Status | null): void {
    this.status.hidden = status === null;
    this.status.className = status ? `monsters-status monsters-status--${status.tone}` : "monsters-status";
    this.status.replaceChildren(...(status?.content ?? []));
  }
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

/** Why a building houses nothing, or what it houses at mid-upgrade; null when there is nothing to say. */
const buildingNote = (row: HousingBuildingRow): string | null => {
  if (row.zero === "building") return "Still being built: houses nothing yet.";
  if (row.zero === "damaged") return "Too damaged to house monsters: repair it.";
  if (row.upgrading) return `Upgrading: houses at level ${row.level} until it finishes.`;
  return null;
};

const armyTable = (rows: readonly HousedRow[], used: number): HTMLElement => {
  const table = document.createElement("table");
  table.className = "housing-table housing-table--army";
  table.append(head(["Monster", "Count", "Space each", "Space"]));
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.dataset["monster"] = row.monster.id;
    const name = document.createElement("th");
    name.scope = "row";
    name.className = "housing-table__monster";
    name.append(monsterPicture(row.monster, "small", "housing-table__picture"), row.monster.name);
    tr.append(
      name,
      cell(formatAmount(row.count), "housing-table__num"),
      cell(formatAmount(row.each), "housing-table__num"),
      cell(formatAmount(row.total), "housing-table__num"),
    );
    tbody.append(tr);
  }
  const foot = document.createElement("tfoot");
  const total = document.createElement("tr");
  const label = document.createElement("th");
  label.scope = "row";
  label.textContent = "Total";
  total.append(
    label,
    cell(formatAmount(rows.reduce((sum, row) => sum + row.count, 0)), "housing-table__num"),
    cell(""),
    cell(formatAmount(used), "housing-table__num"),
  );
  foot.append(total);
  table.append(tbody, foot);
  return scrollBox(table);
};

const section = (className: string, title: string): HTMLElement => {
  const element = document.createElement("section");
  element.className = `housing-section ${className}`;
  const heading = document.createElement("h3");
  heading.className = "housing-section__title";
  heading.id = `${className}-title`;
  heading.textContent = title;
  element.setAttribute("aria-labelledby", heading.id);
  element.append(heading);
  return element;
};

/** Replaces everything in a section under its title. */
const fillSection = (element: HTMLElement, body: readonly HTMLElement[]): void => {
  const title = element.querySelector(".housing-section__title");
  element.replaceChildren(...(title ? [title] : []), ...body);
};

const head = (labels: readonly string[]): HTMLTableSectionElement => {
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  for (const text of labels) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    tr.append(th);
  }
  thead.append(tr);
  return thead;
};

const cell = (text: string, className?: string): HTMLTableCellElement => {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  return td;
};

/** A table never widens the sheet: it scrolls sideways inside its own box. */
const scrollBox = (table: HTMLTableElement): HTMLElement => {
  const box = document.createElement("div");
  box.className = "housing-table__box";
  box.append(table);
  return box;
};

const plainButton = (label: string, onClick: () => void, variant?: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = variant ? `btn ${variant}` : "btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
