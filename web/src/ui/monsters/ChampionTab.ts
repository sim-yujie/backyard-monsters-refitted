import type { ChampionActions } from "@/api/yardChampion";
import { YardChangeReason, type YardChange } from "@/game/yard/YardStore";
import "@/ui/styles/housing.css";
import { ChamberPanel } from "@/ui/yard/ChamberPanel";
import { ChampionPanel } from "@/ui/yard/ChampionPanel";
import {
  MonsterBuilding,
  type MonstersFocus,
  type MonstersTab,
  type MonstersTabContext,
} from "./monstersTab";

/**
 * The Champion tab (owner, 12 Nov 2026: "can the champion panel be migrated
 * to be with monsters? I think it intuitively makes more sense").
 *
 * Top to bottom: the Champion Cage's controls (`ChampionPanel`: raise, the
 * champion's picture, Rename, health and Heal, evolution, hunger and
 * feeding, Evolve, how it fights, Freeze, and Korath when he is the
 * player's), then the Champion Chamber's frozen champions (`ChamberPanel`:
 * Freeze and Thaw) when the yard has a Chamber. Both used to open straight
 * from their buildings, the building's own card a tab away; now the building
 * panels keep their card and an Open button brings this tab forward, as the
 * Hatchery's does for Hatch. The Chamber's Open button lands on its section.
 *
 * A yard holds one cage and one chamber (`YARD_PROPS.as` quantities), so
 * there is one of each panel at most.
 */
export class ChampionTab implements MonstersTab {
  readonly element: HTMLElement;

  private readonly context: MonstersTabContext;
  private readonly actions: ChampionActions | undefined;
  private readonly scroll: HTMLElement;
  private readonly cageSection: HTMLElement;
  private readonly chamberSection: HTMLElement;
  private champion: ChampionPanel | null = null;
  private chamber: ChamberPanel | null = null;

  constructor(context: MonstersTabContext, actions?: ChampionActions) {
    this.context = context;
    this.actions = actions;

    this.element = document.createElement("div");
    this.element.className = "champion-tab";

    this.scroll = document.createElement("div");
    this.scroll.className = "champion-tab__scroll";
    this.cageSection = section("champion-tab__cage", "Champion Cage");
    this.chamberSection = section("champion-tab__chamber", "Champion Chamber");
    this.scroll.append(this.cageSection, this.chamberSection);
    this.element.append(this.scroll);
  }

  private get store() {
    return this.context.binding.store;
  }

  show(focus: MonstersFocus): void {
    this.render();
    const chamber = this.buildingOf(MonsterBuilding.CHAMPION_CHAMBER);
    if (chamber && focus.buildingId === chamber.id && !this.chamberSection.hidden) {
      this.chamberSection.scrollIntoView?.({ block: "start" });
    } else {
      this.scroll.scrollTop = 0;
    }
  }

  update(change: YardChange): void {
    if (change.reason === YardChangeReason.PENDING) {
      this.champion?.syncPending();
      this.chamber?.syncPending();
      return;
    }
    this.render();
  }

  tick(): void {
    this.champion?.tick();
    this.chamber?.tick();
  }

  destroy(): void {
    this.champion?.destroy();
    this.champion = null;
    this.chamber?.destroy();
    this.chamber = null;
    this.element.remove();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private buildingOf(type: number) {
    return this.store.yard.buildings.find((building) => building.type === type) ?? null;
  }

  /** Makes or drops each panel as its building comes and goes, then redraws them. */
  private render(): void {
    const store = this.store;
    const actions = this.actions ? { actions: this.actions } : {};

    const cage = this.buildingOf(MonsterBuilding.CHAMPION_CAGE);
    if (cage && !this.champion) {
      this.champion = new ChampionPanel({ store, ...actions });
      this.cageSection.append(this.champion.element);
    } else if (!cage && this.champion) {
      this.champion.destroy();
      this.champion = null;
    }
    this.cageSection.hidden = !cage;

    const chamber = this.buildingOf(MonsterBuilding.CHAMPION_CHAMBER);
    if (chamber && !this.chamber) {
      this.chamber = new ChamberPanel({ store, ...actions });
      this.chamberSection.append(this.chamber.element);
    } else if (!chamber && this.chamber) {
      this.chamber.destroy();
      this.chamber = null;
    }
    this.chamberSection.hidden = !chamber;

    this.champion?.show();
    this.chamber?.show();
  }
}

const section = (className: string, title: string): HTMLElement => {
  const element = document.createElement("section");
  element.className = `housing-section champion-tab__section ${className}`;
  const heading = document.createElement("h3");
  heading.className = "housing-section__title";
  heading.id = `${className.replace(/_/g, "-")}-title`;
  heading.textContent = title;
  element.setAttribute("aria-labelledby", heading.id);
  element.append(heading);
  return element;
};
