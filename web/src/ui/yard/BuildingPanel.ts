import { tutTarget, TutTarget } from "@/game/guide/targets";
import { guideBus, GuideScreen } from "@/game/guide/guideBus";
import type { Resources, SpeedupItem } from "@/api/types";
import { devDetails } from "@/app/devDetails";
import type { YardRefusal } from "@/api/yard";
import { buildActions } from "@/api/yardBuild";
import { fortifyActions, FortifyKey } from "@/api/yardFortify";
import { recycleAction, recycleKey, type RecycleReport } from "@/api/yardRecycle";
import { repairActions } from "@/api/yardRepair";
import type { BaiterRun } from "@/game/baiter/baiterSession";
import type { RecordedTest } from "@/game/baiter/testHistory";
import { artFolder, resolveArt } from "@/game/yard/buildingArt";
import { maxLevel, OUTPOST_CORE_TYPE, WALL_TYPES } from "@/game/yard/buildingCosts";
import { HOUSING_TYPE, housingBuildings } from "@/game/monsters/housing";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { harvesterNow, isHarvester } from "@/game/yard/harvest";
import type { RecycleOffer } from "@/game/yard/recycle";
import { NEED_MORE_SILOS } from "@/game/yard/storage";
import { progressFraction } from "@/game/yard/jobs";
import { repairOffer, type RepairOffer } from "@/game/yard/repair";
import { YARD_PLANNER_TYPE } from "@/game/yard/planner/access";
import { typeName } from "@/game/yard/planner/summary";
import {
  actionKey,
  YardChangeReason,
  type YardActionResult,
  type YardUiBinding,
} from "@/game/yard/YardStore";
import { artStateFor, BuildingCondition, type YardBuilding } from "@/game/yard/yardModel";
import { Panel } from "@/ui/Panel";
import { formatAmount, formatCountdown } from "@/ui/format";
import { icon } from "@/ui/icons";
import { HousingJuice } from "@/ui/monsters/HousingJuice";
import { HousingView } from "@/ui/monsters/HousingView";
import { MonstersTabId } from "@/ui/monsters/monstersTab";
import { costAmounts, resourceAmount, resourceIcon } from "@/ui/resourceIcon";
import { costFactChips } from "./costFactChips";
import {
  jobOffer,
  panelModel,
  type CancelOffer,
  type FortifyOffer,
  type JobOffer,
  type PanelModel,
  type SpeedupOffer,
  type UpgradeGate,
  type UpgradeOffer,
} from "./buildingActions";
import { buildingInfo, type InfoValue } from "./buildingInfo";
import { BaiterPanel } from "./BaiterPanel";
import { BunkerPanel } from "./BunkerPanel";
import { ChamberPanel } from "./ChamberPanel";
import { ChampionPanel } from "./ChampionPanel";
import { RepairBlock } from "./RepairBlock";
import { ShinyButton } from "./ShinyButton";
import { describeSeconds } from "./upgradeText";

/** What an outpost harvester's panel says in place of its stored amount. */
export const AUTO_BANKING = "Auto-banking: what it makes goes straight to your main yard's storage";

/**
 * One building, and what can be done with it
 * (`docs/design/yard-buildings.md` §3.1 "Building panel").
 *
 * Top to bottom: the building's state, the numbers that matter for its type
 * now and after the next level (`buildingInfo.ts`), then one action block —
 * the running job with its countdown, speed-ups and Cancel, or the next
 * upgrade with its cost, time and the one reason it cannot start — then an
 * Open button for the buildings that are doors (Map Room, Yard Planner, the
 * monster buildings' tabs of the Monsters screen), and
 * finally Details: every field the save sends, collapsed.
 *
 * What is offered and what it costs is decided in `buildingActions.ts`; this
 * file draws it and runs the store's actions (`YardStore.ts`, "Hooks for the
 * UI work packages"). On a foreign yard there is no store: the panel shows
 * the numbers and the details and offers nothing.
 *
 * ## Shiny and Cancel
 *
 * Shiny spends are irreversible, so each is a {@link ShinyButton}: tap, then
 * tap again within three seconds. Cancel loses the progress, so it opens one
 * inline confirmation that states the refund, capped by storage as the server
 * caps it. Neither is a modal: the yard stays visible and clickable behind.
 *
 * ## Details
 *
 * The exhaustive field list is kept — the yard is also how the client is
 * checked against the server — but closed by default. Where the wire is
 * silent by convention (an absent `l` means level 1, an absent `hp` full
 * health) it says what the absence means.
 *
 * ## Housing
 *
 * A Housing on the player's own yard is the Housing panel (#170, mock-up
 * R-Housing): one panel in place of the small card and the Monsters screen's
 * tables. Under "Housing" and its level, what lives there (`HousingView`):
 * the space over one block per Housing, this one ringed; the monsters waiting
 * for room, with "Juice some" (the Juicer as a sheet of this panel) and
 * Housing Expansion; the army as pictures. Then the building's own job,
 * upgrade or repair when it has one, and at the foot "Open Monsters" and a
 * "···" menu with Recycle and the Details.
 *
 * ## The Yard Planner's own door
 *
 * Clicking the Yard Planner offers to open the planner. Design §8, Q5 had
 * entry as a toolbar button only, and that was the wrong call: players click
 * the building expecting it to do something. The toolbar stays the main door;
 * this is the door people actually try.
 */

export interface BuildingPanelOptions {
  onClose: () => void;
  /**
   * The offer to open the layout planner, shown on the Yard Planner building
   * and on nothing else. Left out when the yard has no planner to open.
   */
  planner?: {
    readonly label: string;
    readonly title: string;
    readonly open: () => void;
  };
  /** Opens the world map, offered on the Map Room. Left out where there is no map to go to. */
  openMap?: () => void;
  /**
   * The player's own yard: its `YardStore`, the scene's hooks and its notice
   * dock. Absent on a foreign yard, which is read-only.
   */
  yard?: YardUiBinding;
}

/** Words for each job kind, as the heading of the job block. */
const JOB_HEADING: Readonly<Record<JobOffer["kind"], string>> = {
  build: "Building",
  upgrade: "Upgrading to",
  fortify: "Fortifying",
  rebuild: "Rebuilding",
};

const SPEEDUP_LABEL: Readonly<Record<SpeedupItem, string>> = {
  SP1: "Finish now",
  SP2: "−1 h",
  SP3: "−2 h",
  SP4: "Finish now",
};

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

/** The live parts of the job block, refreshed every second without a redraw. */
interface JobRefs {
  readonly countdown: HTMLElement;
  readonly bar: HTMLElement;
  readonly fill: HTMLElement;
}

export class BuildingPanel {
  readonly element: HTMLElement;
  /** See {@link BuildingPanelOptions.yard}. */
  readonly yard: YardUiBinding | undefined;

  private readonly panel: Panel;
  private readonly kind: HTMLElement;
  private readonly kindLabel: HTMLElement;
  private readonly swatch: HTMLElement;
  private readonly info: HTMLDListElement;
  private readonly unlocks: HTMLElement;
  private readonly actions: HTMLElement;
  /** Holds a Monster Bunker's controls while they are open (`BunkerPanel.ts`). */
  private readonly bunkerSlot: HTMLElement;
  private bunker: BunkerPanel | null = null;
  /** The Baiter's practice-attack window while it is open (#126, #308). */
  private baiter: BaiterPanel | null = null;
  /** Holds the Champion Cage's or Chamber's controls while they are open (`ChampionPanel.ts`, `ChamberPanel.ts`). */
  private readonly championSlot: HTMLElement;
  private champion: ChampionPanel | ChamberPanel | null = null;
  private readonly status: HTMLElement;
  /** A Housing's level chip beside the title ("Level 6 · max"). */
  private readonly chip: HTMLElement;
  /** A Housing's one-line purpose under the title. */
  private readonly blurb: HTMLElement;
  /** A Housing's space, waiting monsters and army (`HousingView`). */
  private readonly housingSlot: HTMLElement;
  private housing: HousingView | null = null;
  /** The Juicer, while "Juice some" has it open as this panel's sheet. */
  private readonly juiceSheet: HTMLElement;
  private juice: HousingJuice | null = null;
  /** A Housing's foot: Open Monsters and the "···" menu. */
  private readonly footer: HTMLElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly moreMenu: HTMLElement;
  /** A Housing keeps its Details behind the "···" menu. */
  private detailsShown = false;
  private readonly details: HTMLDetailsElement;
  private readonly facts: HTMLDListElement;
  private readonly planner: BuildingPanelOptions["planner"];
  private readonly openMap: (() => void) | undefined;
  private readonly unsubscribe: (() => void) | null;

  private building: YardBuilding | null = null;
  /** Countdown rows in Details, refreshed once a second. */
  private countdowns: { node: HTMLElement; endsAt: number }[] = [];
  private jobRefs: JobRefs | null = null;
  /** The repair block on show, updated once a second. */
  private repairView: RepairBlock | null = null;
  /**
   * One Shiny button per building and action, kept across redraws so an
   * armed button survives the store's answers and the second's tick.
   */
  private readonly shiny = new Map<string, ShinyButton>();
  /** Buttons whose request key disables them while it runs. */
  private pendingButtons: { key: string; button: HTMLButtonElement | ShinyButton }[] = [];
  /** The building whose Cancel confirmation is open. */
  private confirmingCancel: number | null = null;
  /** The building whose Recycle confirmation is open. */
  private confirmingRecycle: number | null = null;

  constructor(options: BuildingPanelOptions) {
    this.planner = options.planner;
    this.openMap = options.openMap;
    this.yard = options.yard;
    this.panel = new Panel({
      title: "Building",
      className: "map-panel building-panel",
      onClose: () => {
        this.dispose();
        options.onClose();
      },
    });
    this.element = this.panel.element;

    this.kind = document.createElement("span");
    this.kind.className = "cell-kind";
    this.swatch = document.createElement("span");
    this.swatch.className = "cell-swatch";
    this.kindLabel = document.createElement("span");
    this.kind.append(this.swatch, this.kindLabel);

    this.info = document.createElement("dl");
    this.info.className = "cell-facts building-panel__info";

    this.unlocks = document.createElement("div");
    this.unlocks.className = "building-panel__unlocks";

    this.actions = document.createElement("div");
    this.actions.className = "building-panel__actions";

    this.bunkerSlot = document.createElement("div");
    this.bunkerSlot.className = "building-panel__bunker";
    this.bunkerSlot.hidden = true;

    this.championSlot = document.createElement("div");
    this.championSlot.className = "building-panel__champion";
    this.championSlot.hidden = true;

    this.status = document.createElement("p");
    this.status.className = "building-panel__status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.chip = document.createElement("span");
    this.chip.className = "building-panel__chip";
    this.chip.hidden = true;
    this.panel.titlebar.querySelector(".panel__title")?.after(this.chip);

    this.blurb = document.createElement("p");
    this.blurb.className = "building-panel__blurb";
    this.blurb.hidden = true;

    this.housingSlot = document.createElement("div");
    this.housingSlot.className = "building-panel__housing";
    this.housingSlot.hidden = true;

    this.juiceSheet = document.createElement("div");
    this.juiceSheet.className = "building-panel__sheet";
    this.juiceSheet.hidden = true;

    this.footer = document.createElement("div");
    this.footer.className = "building-panel__foot";
    this.footer.hidden = true;
    const openMonsters = document.createElement("button");
    openMonsters.type = "button";
    openMonsters.className = "btn building-panel__open-monsters";
    openMonsters.append(icon("paw", 18), "Open Monsters");
    openMonsters.title = "The Monsters screen: hatch, juice and house your monsters";
    openMonsters.addEventListener("click", () => {
      const building = this.building;
      if (building) this.yard?.scene.openMonsters?.(MonstersTabId.HOUSING, { buildingId: building.id });
    });
    const more = document.createElement("div");
    more.className = "building-panel__more";
    this.moreButton = document.createElement("button");
    this.moreButton.type = "button";
    this.moreButton.className = "btn building-panel__more-button";
    this.moreButton.setAttribute("aria-haspopup", "true");
    this.moreButton.setAttribute("aria-expanded", "false");
    this.moreButton.append(icon("more", 20));
    this.moreButton.addEventListener("click", () => this.toggleMore(this.moreMenu.hidden));
    this.moreMenu = document.createElement("div");
    this.moreMenu.className = "building-panel__more-menu";
    this.moreMenu.setAttribute("role", "menu");
    this.moreMenu.hidden = true;
    more.append(this.moreButton, this.moreMenu);
    this.footer.append(openMonsters, more);

    this.details = document.createElement("details");
    this.details.className = "building-panel__details";
    const summary = document.createElement("summary");
    summary.className = "building-panel__summary";
    summary.textContent = "Details";
    this.facts = document.createElement("dl");
    this.facts.className = "cell-facts";
    this.details.append(summary, this.facts);

    this.panel.setContent(
      this.blurb,
      this.kind,
      this.info,
      this.unlocks,
      this.housingSlot,
      this.juiceSheet,
      this.actions,
      this.bunkerSlot,
      this.championSlot,
      this.footer,
      this.status,
      this.details,
    );

    // The scene redraws the panel on every change to the yard; only the set
    // of running requests is this panel's own business.
    this.unsubscribe =
      this.yard?.store.subscribe((change) => {
        if (change.reason === YardChangeReason.PENDING) this.syncPending();
      }) ?? null;
  }

  get shownBuilding(): YardBuilding | null {
    return this.building;
  }

  show(building: YardBuilding): void {
    const opened = this.building?.id !== building.id;
    if (this.building?.id !== building.id) {
      this.confirmingCancel = null;
      this.confirmingRecycle = null;
      this.setStatus(null);
      // A different building's Shiny buttons are no use and may be armed.
      for (const button of this.shiny.values()) button.destroy();
      this.shiny.clear();
      this.closeBunker();
      this.closeBaiter();
      this.closeChampion();
      this.closeJuice();
      this.toggleMore(false);
      this.detailsShown = false;
    }
    this.building = building;
    if (this.isHousing(building)) {
      this.panel.setTitle(building.name);
    } else {
      this.housing?.destroy();
      this.housing = null;
      this.panel.setTitle(
        building.level > 0 ? `${building.name} · Level ${building.level}` : building.name,
      );
    }
    this.render();
    // A new building's panel is a screen for the tutorial (issue #227); a damaged one is its repair screen too.
    if (opened) {
      guideBus.emit("screen", { id: GuideScreen.BUILDING, root: this.element, header: this.panel.titlebar });
      if (this.repairView) {
        guideBus.emit("screen", { id: GuideScreen.REPAIR, root: this.element, header: this.panel.titlebar });
      }
    }
  }

  /** Advances the countdowns, the progress bar and the time-priced Shiny. Called once a second by the scene. */
  tick(nowSeconds: number): void {
    const now = this.yard ? this.yard.store.now() : nowSeconds;
    for (const entry of this.countdowns) {
      entry.node.textContent = formatCountdown(entry.endsAt - now);
    }
    this.champion?.tick();
    this.housing?.tick();
    const building = this.building;
    if (building && this.yard && this.repairView) {
      const store = this.yard.store;
      const offer = repairOffer(building.id, store.save, store.credits, store.now());
      if (!offer || !this.repairView.update(offer)) {
        this.render();
        return;
      }
    }
    const refs = this.jobRefs;
    if (!building || !refs || !this.yard) return;
    const job = jobOffer(building, this.yard.store);
    if (!job) return;
    this.drawJobClock(job, refs);
    this.updateSpeedups(building, job);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private render(): void {
    const building = this.building;
    if (!building) return;

    this.setKind(building);
    this.renderInfo(building);
    this.renderHousing(building);
    this.renderActions(building);
    this.bunker?.show();
    this.champion?.show();
    this.renderDetails(building);
  }

  /**
   * A Housing on the own yard: the Housing panel (#170), not the plain card.
   * Still on its first build, it has no working window yet (#281): the plain
   * card's construction info shows instead, as for any other building.
   */
  private isHousing(building: YardBuilding): boolean {
    return building.type === HOUSING_TYPE && this.yard !== undefined && building.level > 0;
  }

  /**
   * The Housing panel's own parts, shown or hidden: the chip, the blurb, what
   * lives there, the Juicer sheet and the foot. The plain card's kind line,
   * numbers and Details step aside for it.
   */
  private renderHousing(building: YardBuilding): void {
    const yard = this.yard;
    const on = yard !== undefined && this.isHousing(building);
    const juicing = on && this.juice !== null;
    this.element.classList.toggle("building-panel--housing", on);
    this.chip.hidden = !on;
    this.blurb.hidden = !on || juicing;
    this.housingSlot.hidden = !on || juicing;
    this.juiceSheet.hidden = !juicing;
    this.footer.hidden = !on || juicing;
    this.details.hidden = on && (juicing || !this.detailsShown);
    if (on) {
      this.kind.hidden = true;
      this.info.hidden = true;
      this.unlocks.hidden = true;
    } else {
      this.kind.hidden = false;
      return;
    }

    const store = yard.store;
    const max = maxLevel(building.type, store.kind);
    // `isHousing` only turns this branch on past the first build, so `level`
    // is always at least 1 here.
    this.chip.textContent =
      building.level >= max ? `Level ${building.level} · max` : `Level ${building.level}`;
    const count = housingBuildings(store.save, store.now()).length;
    this.blurb.textContent =
      count > 1
        ? `Where your monsters live. Your ${count} Housings share one space: bigger space, bigger army.`
        : "Where your monsters live. Its space is your army's: bigger space, bigger army.";

    if (!this.housing) {
      this.housing = new HousingView({
        binding: yard,
        onHatch: () => yard.scene.openMonsters?.(MonstersTabId.HATCH),
        onJuice: () => this.openJuice(),
        onStatus: (status) => this.setStatus(status),
      });
      this.housingSlot.replaceChildren(this.housing.element);
    }
    this.housing.setFocus(building.id);
    this.housing.render();
    this.juice?.render();
    this.renderMore(building);
  }

  /** "Juice some": the Juicer as a sheet of this panel, with a way back. */
  private openJuice(): void {
    const yard = this.yard;
    if (!yard || this.juice) return;
    this.juice = new HousingJuice({ store: yard.store, onStatus: (status) => this.setStatus(status) });
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn--ghost building-panel__back";
    back.append(icon("back", 18), "Back to Housing");
    back.addEventListener("click", () => {
      this.closeJuice();
      this.render();
      this.housingSlot.querySelector<HTMLElement>(".housing-waiting__juice")?.focus();
    });
    const title = document.createElement("h3");
    title.className = "building-panel__sheet-title";
    title.textContent = "Juice monsters";
    this.juiceSheet.replaceChildren(back, title, this.juice.element);
    this.render();
    back.focus();
  }

  private closeJuice(): void {
    this.juice?.destroy();
    this.juice = null;
    this.juiceSheet.replaceChildren();
    this.juiceSheet.hidden = true;
  }

  /** The "···" menu: Recycle (or why not) and the Details. */
  private renderMore(building: YardBuilding): void {
    const yard = this.yard;
    if (!yard) return;
    const model = panelModel(building, yard.store);
    const items: HTMLButtonElement[] = [];
    const recycle = model.recycle;
    if (recycle) {
      const label = recycle.toStorage ? "Put this Housing in storage" : "Recycle this Housing";
      const item = menuItem(label, () => {
        this.toggleMore(false);
        this.confirmingRecycle = building.id;
        this.render();
        this.actions.querySelector<HTMLButtonElement>(".building-recycle__confirm")?.focus();
      });
      if (recycle.blocked) {
        item.disabled = true;
        item.title = recycle.blocked.message;
      }
      items.push(item);
    }
    items.push(
      menuItem(this.detailsShown ? "Hide details" : "Show details", () => {
        this.toggleMore(false);
        this.detailsShown = !this.detailsShown;
        this.details.open = this.detailsShown;
        this.render();
      }),
    );
    this.moreMenu.replaceChildren(...items);
    const first = recycle ? (recycle.toStorage ? "Put in storage" : "Recycle this Housing") : "Details";
    this.moreButton.setAttribute("aria-label", `More: ${first}`);
    this.moreButton.title = recycle ? `More: ${first}, details` : "More: details";
  }

  private toggleMore(open: boolean): void {
    this.moreMenu.hidden = !open;
    this.moreButton.setAttribute("aria-expanded", String(open));
    if (open) {
      document.addEventListener("pointerdown", this.dismissMore, true);
      document.addEventListener("keydown", this.dismissMore, true);
      this.moreMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    } else {
      document.removeEventListener("pointerdown", this.dismissMore, true);
      document.removeEventListener("keydown", this.dismissMore, true);
    }
  }

  /** A press outside the "···" menu, or Escape, closes it. */
  private readonly dismissMore = (event: Event): void => {
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.toggleMore(false);
      this.moreButton.focus();
      return;
    }
    if (event.target instanceof Node && this.moreMenu.parentElement?.contains(event.target)) return;
    this.toggleMore(false);
  };

  private renderInfo(building: YardBuilding): void {
    const { rows, list } = buildingInfo(
      building,
      this.yard?.store.kind ?? "main",
      this.yard?.store.yard.cellHeight ?? 0,
    );
    this.info.replaceChildren();
    for (const row of rows) {
      const term = document.createElement("dt");
      term.textContent = row.label;
      const definition = document.createElement("dd");
      definition.append(infoValue(row.now));
      if (row.next) {
        const arrow = document.createElement("span");
        arrow.className = "building-panel__arrow";
        arrow.textContent = " → ";
        const next = document.createElement("span");
        next.className = row.down
          ? "building-panel__next building-panel__next--down"
          : "building-panel__next";
        next.append(infoValue(row.next));
        definition.append(arrow, next);
      }
      this.info.append(term, definition);
    }
    this.info.hidden = rows.length === 0;

    this.unlocks.replaceChildren();
    this.unlocks.hidden = list === null;
    if (list) {
      const heading = document.createElement("p");
      heading.className = "building-panel__label";
      heading.textContent = list.label;
      const items = document.createElement("ul");
      items.className = "building-panel__list";
      for (const text of list.items) {
        const item = document.createElement("li");
        item.textContent = text;
        items.append(item);
      }
      this.unlocks.append(heading, items);
    }
  }

  private renderActions(building: YardBuilding): void {
    this.jobRefs = null;
    this.repairView = null;
    this.pendingButtons = [];
    const used = new Set<string>();
    const blocks: HTMLElement[] = [];
    const yard = this.yard;

    if (yard) {
      const model = panelModel(building, yard.store);
      const repair = repairOffer(building.id, yard.store.save, yard.store.credits, yard.store.now());
      if (repair) blocks.push(this.repairBlock(building, repair, used));
      if (model.job) blocks.push(this.jobBlock(building, model.job, used));
      if (model.upgrade) blocks.push(this.upgradeBlock(building, model.upgrade, used, yard.store.resources));
      if (model.fortify) blocks.push(this.fortifyBlock(building, model.fortify, yard.store.resources));
      const housing = this.isHousing(building);
      // A one-level building (Yard Planner, General Store) has no ladder to
      // top out; a Housing says "max" in its chip.
      if (model.maxed && !housing && maxLevel(building.type, yard.store.kind) > 1) {
        blocks.push(note(`Level ${building.level} is the highest level.`));
      }
      // An outpost's harvesters bank by themselves: Flash's disabled
      // "Auto-Banking" (`BUILDINGINFO.as:130-131`), said here in words.
      if (yard.store.kind === "outpost" && isHarvester(building.type)) {
        blocks.push(note(`${AUTO_BANKING}.`));
      }
      if (model.batch) {
        blocks.push(
          note(
            WALL_TYPES.includes(building.type)
              ? "Walls are upgraded in the layout planner."
              : "Traps are re-armed in the layout planner.",
          ),
        );
      }
      const open = housing ? null : this.openButton(model);
      if (open) blocks.push(open);
      if (model.recycle && (!housing || this.confirmingRecycle === building.id)) {
        blocks.push(this.recycleControl(building, model.recycle));
      }
    } else {
      const open = this.openButton(null);
      if (open) blocks.push(open);
    }

    // Shiny buttons for actions this building no longer offers.
    for (const [key, button] of this.shiny) {
      if (!used.has(key)) {
        button.destroy();
        this.shiny.delete(key);
      }
    }

    this.actions.replaceChildren(...blocks);
    this.actions.hidden = blocks.length === 0;
    this.syncPending();
  }

  /** The door a building is: the Map Room's map, the Yard Planner's planner. */
  private openButton(model: PanelModel | null): HTMLElement | null {
    const building = this.building;
    if (!building) return null;
    if (model?.open === "map" && this.openMap) {
      const run = this.openMap;
      const button = actionButton("Open map", () => run(), "btn--primary");
      if (model.openBlocked) {
        button.disabled = true;
        button.title = model.openBlocked;
        const wrap = document.createElement("div");
        wrap.className = "building-panel__block";
        wrap.append(button, gateText(model.openBlocked));
        return wrap;
      }
      return button;
    }
    if (model?.open === "baiter" && this.yard) {
      const button = actionButton("Test attack", () => this.openBaiterWindow(model.openBlocked), "btn--primary");
      button.classList.add("building-panel__planner");
      button.setAttribute("aria-haspopup", "dialog");
      button.title = "A practice attack on your own yard. Nothing is saved.";
      if (model.openBlocked) {
        button.disabled = true;
        const wrap = document.createElement("div");
        wrap.className = "building-panel__block";
        wrap.append(button, gateText(model.openBlocked));
        return wrap;
      }
      return button;
    }
    if (model?.open === "bunker" && this.yard) {
      const open = this.bunker !== null;
      const button = actionButton(open ? "Close bunker" : "Open bunker", () => this.toggleBunker(), "btn--primary");
      button.classList.add("building-panel__planner");
      button.setAttribute("aria-expanded", String(open));
      return button;
    }
    if ((model?.open === "cage" || model?.open === "chamber") && this.yard) {
      const target = model.open;
      const open = this.champion !== null;
      const word = target === "cage" ? "cage" : "chamber";
      const button = actionButton(open ? `Close ${word}` : `Open ${word}`, () => this.toggleChampion(target), "btn--primary");
      button.classList.add("building-panel__planner");
      button.setAttribute("aria-expanded", String(open));
      return button;
    }
    const scene = this.yard?.scene;
    if (model?.open === "shop" && scene?.openShop) {
      const openShop = scene.openShop.bind(scene);
      const button = actionButton("Open Shop", () => openShop(), "btn--primary");
      button.classList.add("building-panel__planner");
      button.title = "Spend Shiny on workers, boosts and more";
      return button;
    }
    if (model?.open === "monsters" && model.monstersTab && scene?.openMonsters) {
      const tab = model.monstersTab;
      const button = actionButton(
        "Open",
        () => scene.openMonsters?.(tab, { buildingId: building.id }),
        "btn--primary",
      );
      button.classList.add("building-panel__planner");
      button.title = "Open the Monsters screen";
      return button;
    }
    if (this.planner && (model ? model.open === "planner" : isPlanner(building))) {
      const run = this.planner.open;
      const button = actionButton(this.planner.label, () => run(), "btn--primary");
      button.classList.add("building-panel__planner");
      button.title = this.planner.title;
      return button;
    }
    return null;
  }

  private repairBlock(building: YardBuilding, offer: RepairOffer, used: Set<string>): HTMLElement {
    const view = new RepairBlock(
      building.id,
      offer,
      {
        shinyButton: (key, label, onSpend) => this.shinyButton(key, label, onSpend),
        pending: (key, button) => this.pendingButtons.push({ key, button }),
        repair: () => void this.runRepair(building.id),
        repairNow: () => void this.runRepairNow(building.id),
        finish: () => void this.runRepairFinish(building.id),
      },
      used,
    );
    this.repairView = view;
    return view.element;
  }

  /**
   * An upgrade or fortify step's cost: the build tab's own chips, green when
   * held and red when short (#278), so the colour means the same thing here
   * as it does picking a new building. `Free` in words when there is nothing
   * to pay, as the Map Room's single-currency steps sometimes have.
   */
  private costFactsLine(cost: UpgradeOffer["cost"], resources: Resources): HTMLElement {
    const chips = costFactChips(cost, resources);
    if (chips.length === 0) {
      const line = document.createElement("p");
      line.className = "building-panel__cost";
      line.append("Free");
      return line;
    }
    const line = document.createElement("ul");
    line.className = "building-panel__cost build-info__facts";
    line.setAttribute("aria-label", "Cost");
    line.append(...chips);
    return line;
  }

  private upgradeBlock(
    building: YardBuilding,
    offer: UpgradeOffer,
    used: Set<string>,
    resources: Resources,
  ): HTMLElement {
    const block = document.createElement("section");
    block.className = "building-panel__block building-upgrade";
    block.setAttribute("aria-label", `Upgrade to level ${offer.to}`);

    const head = document.createElement("div");
    head.className = "building-panel__head";
    const title = document.createElement("h3");
    title.className = "building-panel__heading";
    title.textContent = `Upgrade to ${offer.to}`;
    const time = document.createElement("span");
    time.className = "building-panel__time";
    time.textContent = describeSeconds(offer.seconds);
    time.title = "How long the upgrade takes. It holds one worker until it finishes.";
    head.append(title, time);
    block.append(head);

    block.append(this.costFactsLine(offer.cost, resources));

    if (offer.gate) {
      const line = gateLine(offer.gate);
      line.id = this.gateId(building);
      block.append(line);
    }

    const row = document.createElement("div");
    row.className = "map-row building-panel__buttons";
    const upgrade = actionButton("Upgrade", () => void this.runUpgrade(building.id), "btn--primary");
    tutTarget(upgrade, TutTarget.UPGRADE);
    upgrade.disabled = offer.gate !== null;
    if (offer.gate) upgrade.setAttribute("aria-describedby", this.gateId(building));
    row.append(upgrade);
    this.pendingButtons.push({ key: actionKey("upgrade", building.id), button: upgrade });

    // The Map Room is never bought with Shiny (D16): Upgrade alone.
    if (offer.instant) {
      const instantKey = `${building.id}:instant`;
      used.add(instantKey);
      const instant = this.shinyButton(instantKey, "Instant", () =>
        void this.runInstant(building.id),
      );
      tutTarget(instant.element, TutTarget.INSTANT);
      instant.setPrice(offer.instantPrice);
      instant.setBlocked(offer.instantGate ? gateSentence(offer.instantGate) : null);
      row.append(instant.element);
      this.pendingButtons.push({ key: actionKey("instant", building.id), button: instant });
    }

    block.append(row);
    return block;
  }

  /**
   * Fortify, on a home yard's silo, Town Hall and towers or an outpost's core and towers (#191): Flash's `btn_fortify`
   * and its options popup (`client/scripts/BUILDINGINFO.as:263-265`,
   * `:571-572`), with the step's price and time, the one reason it cannot
   * start, and Flash's warning that a tower does not fire while it fortifies
   * (`msg_inactivefortify`, `BFOUNDATION.as:2207-2210`). Fully fortified
   * says so (`bdg_fullyfortified`).
   */
  private fortifyBlock(building: YardBuilding, offer: FortifyOffer, resources: Resources): HTMLElement {
    if (offer.maxed) return note(`Fully fortified: F${offer.max} of ${offer.max}.`);

    const block = document.createElement("section");
    block.className = "building-panel__block building-fortify";
    block.setAttribute("aria-label", `Fortify to F${offer.to}`);

    const head = document.createElement("div");
    head.className = "building-panel__head";
    const title = document.createElement("h3");
    title.className = "building-panel__heading";
    title.textContent = `Fortify to F${offer.to}`;
    title.title = `Fortified F${offer.from} of ${offer.max}.`;
    const time = document.createElement("span");
    time.className = "building-panel__time";
    time.textContent = describeSeconds(offer.seconds);
    time.title = "How long the fortification takes. It holds a worker until it finishes.";
    head.append(title, time);
    block.append(head);

    block.append(this.costFactsLine(offer.cost, resources));

    const gateId = `${this.gateId(building)}-fortify`;
    if (offer.gate) {
      const line = gateLine(offer.gate);
      line.id = gateId;
      block.append(line);
    } else if (building.type !== OUTPOST_CORE_TYPE) {
      block.append(gateText("A tower does not fire while it fortifies."));
    }

    const row = document.createElement("div");
    row.className = "map-row building-panel__buttons";
    const fortify = actionButton("Fortify", () => void this.runFortify(building.id), "btn--primary");
    fortify.disabled = offer.gate !== null;
    if (offer.gate) fortify.setAttribute("aria-describedby", gateId);
    row.append(fortify);
    this.pendingButtons.push({ key: FortifyKey.start(building.id), button: fortify });
    block.append(row);
    return block;
  }

  private jobBlock(building: YardBuilding, job: JobOffer, used: Set<string>): HTMLElement {
    const block = document.createElement("section");
    block.className = "building-panel__block building-job";
    block.setAttribute("aria-label", "Current job");

    const head = document.createElement("div");
    head.className = "building-panel__head";
    const title = document.createElement("h3");
    title.className = "building-panel__heading";
    title.textContent =
      job.kind === "upgrade" ? `${JOB_HEADING.upgrade} ${job.to}` : JOB_HEADING[job.kind];
    const countdown = document.createElement("span");
    countdown.className = "building-panel__time building-job__countdown";
    head.append(title, countdown);

    const bar = document.createElement("div");
    bar.className = "building-job__bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Progress");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("div");
    fill.className = "building-job__fill";
    bar.append(fill);
    block.append(head, bar);

    const refs: JobRefs = { countdown, bar, fill };
    this.jobRefs = refs;
    this.drawJobClock(job, refs);

    if (job.paused) block.append(gateText("Paused until the building is repaired."));

    const speedups = [job.finish, job.minusOne, job.minusTwo].filter(
      (offer): offer is SpeedupOffer => offer !== null,
    );
    if (speedups.length > 0) {
      const row = document.createElement("div");
      row.className = "map-row map-row--wrap building-panel__buttons";
      for (const offer of speedups) row.append(this.speedupControl(building, offer, used));
      block.append(row);
    }

    if (job.cancel) block.append(this.cancelControl(building, job.cancel));
    return block;
  }

  /** Finish now, −1 h or −2 h. A free finish (SP1) is a plain button; the rest spend Shiny. */
  private speedupControl(
    building: YardBuilding,
    offer: SpeedupOffer,
    used: Set<string>,
  ): HTMLElement {
    const key = actionKey("speedup", building.id);
    if (offer.item === "SP1") {
      const button = actionButton("Finish free", () => void this.runSpeedup(building.id, "SP1"));
      tutTarget(button, TutTarget.FINISH);
      button.title = "Five minutes or less left: finishing costs nothing.";
      button.disabled = offer.blocked !== null;
      this.pendingButtons.push({ key, button });
      return button;
    }
    const slot = speedupSlot(offer.item);
    const shinyKey = `${building.id}:${slot}`;
    used.add(shinyKey);
    const button = this.shinyButton(shinyKey, SPEEDUP_LABEL[offer.item], () => {
      const item = this.currentSpeedupItem(slot);
      if (item) void this.runSpeedup(building.id, item);
    });
    applySpeedup(button, offer);
    if (slot === "finish") tutTarget(button.element, TutTarget.FINISH);
    this.pendingButtons.push({ key, button });
    return button.element;
  }

  /** The item the finish slot sells right now: SP4 turns into SP1 in the last five minutes. */
  private currentSpeedupItem(slot: "finish" | "minusOne" | "minusTwo"): SpeedupItem | null {
    const building = this.building;
    if (!building || !this.yard) return null;
    const job = jobOffer(building, this.yard.store);
    return job?.[slot]?.item ?? null;
  }

  /** Keeps the Shiny buttons' prices and states in step with the clock. */
  private updateSpeedups(building: YardBuilding, job: JobOffer): void {
    for (const slot of ["finish", "minusOne", "minusTwo"] as const) {
      const offer = job[slot];
      const button = this.shiny.get(`${building.id}:${slot}`);
      if (!offer) continue;
      // The finish slot crossing five minutes changes from Shiny to free: redraw.
      if ((offer.item === "SP1") !== !button) {
        this.render();
        return;
      }
      if (button) applySpeedup(button, offer);
    }
    this.syncPending();
  }

  private cancelControl(building: YardBuilding, offer: CancelOffer): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "building-cancel";
    const key = actionKey("cancel", building.id);

    const underConstruction = building.countdown?.kind === "build";
    // Stopping a fortification (#191): `btn_stopfortify` and its confirmation
    // (`BUILDINGINFO.as:512-513`, `BFOUNDATION.FortifyCancel`, `:2218-2220`).
    const fortifying = building.countdown?.kind === "fortify";
    if (this.confirmingCancel !== building.id) {
      const openLabel = fortifying ? "Stop fortifying" : underConstruction ? "Cancel build" : "Cancel upgrade";
      const button = actionButton(openLabel, () => {
        this.confirmingCancel = building.id;
        this.render();
        this.actions.querySelector<HTMLButtonElement>(".building-cancel__confirm")?.focus();
      });
      button.classList.add("btn--ghost", "building-cancel__open");
      this.pendingButtons.push({ key, button });
      wrap.append(button);
      return wrap;
    }

    wrap.classList.add("building-cancel--confirming");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Confirm cancel");
    const question = document.createElement("p");
    question.className = "building-cancel__question";
    const refund = costAmounts(offer.refund);
    question.append(
      fortifying ? "Stop fortifying and get back " : "Cancel and get back ",
      refund ?? "nothing",
      "? Progress is lost.",
    );
    wrap.append(question);
    const lost = costAmounts(offer.lost);
    if (lost) {
      const warning = document.createElement("p");
      warning.className = "building-cancel__lost";
      warning.append("Your storage is full: ", lost, " will not fit and is lost.");
      wrap.append(warning);
    }

    const row = document.createElement("div");
    row.className = "map-row";
    const confirm = actionButton(fortifying ? "Yes, stop" : "Yes, cancel", () => {
      this.confirmingCancel = null;
      void this.runCancel(building.id);
    });
    confirm.classList.add("btn--danger", "building-cancel__confirm");
    const keepLabel = fortifying ? "Keep fortifying" : underConstruction ? "Keep building" : "Keep upgrading";
    const keep = actionButton(keepLabel, () => {
      this.confirmingCancel = null;
      this.render();
    });
    keep.classList.add("building-cancel__keep");
    row.append(confirm, keep);
    wrap.append(row);
    wrap.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.confirmingCancel = null;
      this.render();
    });
    this.pendingButtons.push({ key, button: confirm });
    return wrap;
  }

  /**
   * Recycle, at the foot of the actions: one inline confirmation that says
   * what comes back, what the storage cap turns away and, for Housing, which
   * monsters the cull would remove (§5.4). Recycling cannot be undone.
   */
  private recycleControl(building: YardBuilding, offer: RecycleOffer): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "building-recycle";
    const key = recycleKey(building.id);
    const label = offer.toStorage ? "Put in storage" : "Recycle";

    if (this.confirmingRecycle !== building.id) {
      const button = actionButton(label, () => {
        this.confirmingRecycle = building.id;
        this.render();
        this.actions.querySelector<HTMLButtonElement>(".building-recycle__confirm")?.focus();
      });
      button.classList.add("btn--ghost", "building-recycle__open");
      wrap.append(button);
      if (offer.blocked) {
        button.disabled = true;
        button.title = offer.blocked.message;
        // A running job already says so in its own block.
        if (offer.blocked.reason !== "busy") wrap.append(gateText(offer.blocked.message));
        return wrap;
      }
      this.pendingButtons.push({ key, button });
      return wrap;
    }

    wrap.classList.add("building-recycle--confirming");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", offer.toStorage ? "Confirm put in storage" : "Confirm recycle");
    const question = document.createElement("p");
    question.className = "building-recycle__question";
    if (offer.toStorage) {
      question.append(`Put this ${building.name} in storage? You can place it again later.`);
    } else {
      const refund = costAmounts(offer.refund);
      question.append(
        `Recycle this ${building.name} and get back `,
        refund ?? "nothing",
        "? This cannot be undone.",
      );
    }
    wrap.append(question);
    const lost = costAmounts(offer.lost);
    if (lost) {
      const warning = document.createElement("p");
      warning.className = "building-recycle__warning";
      warning.append("Your storage is full: ", lost, " will not fit and is lost.");
      wrap.append(warning);
    }
    const culled = cullText(offer.culled);
    if (culled) {
      const warning = document.createElement("p");
      warning.className = "building-recycle__warning building-recycle__cull";
      warning.textContent = `Your monsters will no longer fit. These are lost: ${culled}.`;
      wrap.append(warning);
    }
    const bunkered = cullText(offer.bunkered);
    if (bunkered) {
      const warning = document.createElement("p");
      warning.className = "building-recycle__warning building-recycle__cull";
      warning.textContent = `The monsters in this bunker go with it. These are lost: ${bunkered}.`;
      wrap.append(warning);
    }

    const row = document.createElement("div");
    row.className = "map-row";
    const confirm = actionButton(offer.toStorage ? "Yes, store it" : "Yes, recycle", () => {
      this.confirmingRecycle = null;
      void this.runRecycle(building.id, offer.bunkered);
    });
    confirm.classList.add("btn--danger", "building-recycle__confirm");
    const keep = actionButton("Keep it", () => {
      this.confirmingRecycle = null;
      this.render();
    });
    keep.classList.add("building-recycle__keep");
    row.append(confirm, keep);
    wrap.append(row);
    wrap.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.confirmingRecycle = null;
      this.render();
    });
    this.pendingButtons.push({ key, button: confirm });
    return wrap;
  }

  private drawJobClock(job: JobOffer, refs: JobRefs): void {
    refs.countdown.textContent = job.paused ? "Paused" : formatCountdown(job.remaining);
    const done = progressFraction(job.remaining, job.total);
    const percent = Math.round(done * 100);
    refs.fill.style.width = `${done * 100}%`;
    refs.bar.setAttribute("aria-valuenow", String(percent));
    refs.bar.setAttribute("aria-valuetext", `${percent}%, ${formatCountdown(job.remaining)} left`);
    refs.bar.classList.toggle("building-job__bar--paused", job.paused);
  }

  private shinyButton(key: string, label: string, onSpend: () => void): ShinyButton {
    let button = this.shiny.get(key);
    if (!button) {
      button = new ShinyButton({ label, spell: formatAmount, onSpend });
      this.shiny.set(key, button);
    }
    return button;
  }

  private gateId(building: YardBuilding): string {
    return `building-gate-${building.id}`;
  }

  /** Disables every button whose request is in flight or queued. */
  private syncPending(): void {
    const store = this.yard?.store;
    if (!store) return;
    this.bunker?.syncPending();
    this.champion?.syncPending();
    this.housing?.syncPending();
    this.juice?.syncPending();
    for (const { key, button } of this.pendingButtons) {
      const running = store.isRunning(key);
      if (button instanceof ShinyButton) {
        button.setBusy(running);
      } else if (running) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      } else if (button.getAttribute("aria-busy") === "true") {
        // Only undo what this set; a gate's own disable stays until the redraw.
        button.removeAttribute("aria-busy");
        button.disabled = false;
      }
    }
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  private async runUpgrade(id: number): Promise<void> {
    const store = this.yard?.store;
    if (!store) return;
    const result = await store.upgrade(id);
    this.report(id, result, (report) => [`Upgrade to ${report.to} started.`]);
  }

  private async runInstant(id: number): Promise<void> {
    const store = this.yard?.store;
    if (!store) return;
    const result = await store.instantUpgrade(id);
    this.report(id, result, (report) => [
      `Reached level ${report.to} for `,
      resourceAmount("shiny", formatAmount(report.credits)),
      ".",
    ]);
  }

  private async runSpeedup(id: number, item: SpeedupItem): Promise<void> {
    const store = this.yard?.store;
    if (!store) return;
    const result = await store.speedUp(id, item);
    this.report(id, result, (report) =>
      report.remaining <= 0
        ? ["Finished."]
        : [`${item === "SP3" ? "Two hours" : "An hour"} taken off.`],
    );
  }

  private async runFortify(id: number): Promise<void> {
    const store = this.yard?.store;
    if (!store) return;
    const result = await fortifyActions(store).start(id);
    this.report(id, result, (report) => [`Fortifying to F${report.to}.`]);
  }

  private async runCancel(id: number): Promise<void> {
    const store = this.yard?.store;
    if (!store) return;
    if (store.building(id)?.countdown?.kind === "fortify") {
      const result = await fortifyActions(store).cancel(id);
      this.report(id, result, (report) => {
        const refund = costAmounts(report.refund);
        return refund ? ["Fortifying stopped. Got back ", refund, "."] : ["Fortifying stopped."];
      });
      return;
    }
    // A building still under construction goes altogether (`build/cancel`, §5.3).
    if (store.building(id)?.countdown?.kind === "build") {
      const result = await buildActions(store).cancel(id);
      if (!result.ok) {
        this.report(id, result, () => []);
        return;
      }
      // The building is gone, and this panel with it: the refund goes to the notices.
      const refund = costAmounts(result.report.refund);
      const text = document.createElement("span");
      text.append(...(refund ? ["Build cancelled. Got back ", refund, "."] : ["Build cancelled."]));
      this.yard?.notices.show("build-cancel", text, { level: "info", timeoutMs: 6_000 });
      return;
    }
    const result = await store.cancelUpgrade(id);
    this.report(id, result, (report) => {
      const refund = costAmounts(report.refund);
      return refund ? ["Upgrade cancelled. Got back ", refund, "."] : ["Upgrade cancelled."];
    });
  }

  private async runRepair(id: number): Promise<void> {
    const store = this.yard?.store;
    if (!store) return;
    const result = await repairActions(store).one(id);
    this.report(id, result, () => {
      const left = repairOffer(id, store.save, store.credits, store.now())?.damage.secondsLeft;
      return [left ? `Repairing: back to full health in ${describeSeconds(left)}.` : "Repaired."];
    });
  }

  private async runRepairFinish(id: number): Promise<void> {
    const store = this.yard?.store;
    if (!store) return;
    const result = await repairActions(store).finish(id);
    this.report(id, result, () => ["Repaired."]);
  }

  private async runRepairNow(id: number): Promise<void> {
    const store = this.yard?.store;
    if (!store) return;
    const result = await repairActions(store).now();
    this.report(id, result, (report) => {
      const count = report.repaired.length;
      const what = count === 1 ? "Repaired" : `Repaired ${count} buildings`;
      return report.credits > 0
        ? [`${what} for `, resourceAmount("shiny", formatAmount(report.credits)), "."]
        : [`${what}.`];
    });
  }

  /**
   * Recycles, then says so in the notice dock: the building is gone, so the
   * scene closes this panel as the answer lands. A refusal stays on the
   * status line.
   */
  private async runRecycle(id: number, bunkered: Readonly<Record<string, number>>): Promise<void> {
    const yard = this.yard;
    if (!yard) return;
    const name = this.building?.name ?? "Building";
    const result = await recycleAction(yard.store, id);
    if (result.ok) {
      yard.notices.show("yard-recycle", recycledMessage(name, result.report, bunkered), {
        level: "info",
        timeoutMs: 6_000,
      });
      return;
    }
    this.report(id, result, () => []);
  }

  /** Puts an action's outcome on the status line, if its building is still shown. */
  private report<Report>(
    id: number,
    result: YardActionResult<Report>,
    success: (report: Report) => (Node | string)[],
  ): void {
    if (this.building?.id !== id) return;
    if (result.ok) {
      this.setStatus({ tone: "good", content: success(result.report) });
    } else {
      this.setStatus({ tone: "bad", content: [refusalText(result.refusal)] });
      // A 409 leaves the panel showing a yard the server disagrees with until
      // the store's refresh lands; the redraw then re-derives every gate.
      if (this.building) this.render();
    }
  }

  private setStatus(status: Status | null): void {
    if (!status) {
      this.status.hidden = true;
      this.status.replaceChildren();
      return;
    }
    this.status.hidden = false;
    this.status.className = `building-panel__status building-panel__status--${status.tone}`;
    this.status.replaceChildren(...status.content);
  }

  /** Opens or closes the bunker's controls under the actions. */
  private toggleBunker(): void {
    const building = this.building;
    const store = this.yard?.store;
    if (this.bunker || !building || !store) {
      this.closeBunker();
    } else {
      this.bunker = new BunkerPanel({ store, bunkerId: building.id });
      this.bunkerSlot.append(this.bunker.element);
      this.bunkerSlot.hidden = false;
    }
    this.render();
    if (this.bunker) this.bunker.element.querySelector<HTMLElement>("[role=radio][aria-checked=true]")?.focus();
  }

  /**
   * Opens the Baiter's practice-attack window over the yard (#126, #308): a
   * large window on the overlay's modal layer, the yard dimmed behind it.
   */
  private openBaiterWindow(blocked: string | null): void {
    const building = this.building;
    const yard = this.yard;
    if (this.baiter || !building || !yard) return;
    const store = yard.store;
    const opened: BaiterPanel = new BaiterPanel({
      level: building.level,
      save: () => store.save,
      blocked,
      onRun: (run) => yard.scene.runBaiter?.(run),
      ...(yard.scene.watchBaiter ? { onWatch: (run: BaiterRun) => yard.scene.watchBaiter?.(run) } : {}),
      ...(yard.scene.showBaiterReport
        ? { onReport: (test: RecordedTest) => yard.scene.showBaiterReport?.(test) }
        : {}),
      onClose: () => {
        if (this.baiter === opened) this.baiter = null;
      },
    });
    this.baiter = opened;
    opened.mount(yard.modal ?? this.element.ownerDocument.body);
    guideBus.emit("screen", { id: GuideScreen.BAITER, root: opened.element, header: null });
  }

  /** Opens the Baiter's test window when this Baiter may open it (a test's "Change army", #22 WP4). */
  openBaiter(): void {
    const building = this.building;
    const yard = this.yard;
    if (this.baiter || !building || !yard) return;
    const model = panelModel(building, yard.store);
    if (model.open !== "baiter" || model.openBlocked) return;
    this.openBaiterWindow(null);
  }

  private closeBaiter(): void {
    this.baiter?.destroy();
    this.baiter = null;
  }

  private closeBunker(): void {
    this.bunker?.destroy();
    this.bunker = null;
    this.bunkerSlot.hidden = true;
  }

  /** Opens or closes the Champion Cage's or Chamber's controls under the actions. */
  private toggleChampion(target: "cage" | "chamber"): void {
    const store = this.yard?.store;
    if (this.champion || !this.building || !store) {
      this.closeChampion();
    } else {
      this.champion = target === "cage" ? new ChampionPanel({ store }) : new ChamberPanel({ store });
      this.championSlot.append(this.champion.element);
      this.championSlot.hidden = false;
      if (target === "cage") {
        guideBus.emit("screen", { id: GuideScreen.CHAMPION, root: this.champion.element, header: null });
      }
    }
    this.render();
    this.champion?.element.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }

  private closeChampion(): void {
    this.champion?.destroy();
    this.champion = null;
    this.championSlot.hidden = true;
  }

  private dispose(): void {
    this.closeBunker();
    this.closeBaiter();
    this.closeChampion();
    this.closeJuice();
    this.toggleMore(false);
    this.housing?.destroy();
    this.housing = null;
    this.unsubscribe?.();
    for (const button of this.shiny.values()) button.destroy();
    this.shiny.clear();
  }

  /* ── Details ────────────────────────────────────────────────────────── */

  private renderDetails(building: YardBuilding): void {
    this.facts.replaceChildren();
    this.countdowns = [];

    // The type id, the save's encoding, the footprint, position, id and art
    // file are a developer's; a player's Details are level, fortification,
    // health, the job and what it holds (#150).
    const dev = devDetails();
    if (dev) this.add("Type id", String(building.type));
    this.add(
      "Level",
      building.level === 0
        ? dev
          ? "0 — foundation, still building"
          : "Still being built"
        : dev && building.raw.l === undefined
          ? "1 (the save omits the level at 1)"
          : String(building.level),
    );

    if (dev) {
      const [width, height] = building.footprint;
      this.add("Footprint", `${width} x ${height} yard units`);
      this.add("Position", `${building.x}, ${building.y}`);
      this.add("Building id", String(building.id));
    }

    this.add(
      "Fortification",
      building.fortification === 0 ? "None" : `Level ${building.fortification}`,
      building.fortification > 0 ? "is-info" : undefined,
    );

    this.addHealth(building);
    this.addCountdown(building);
    this.addProduction(building);
    if (dev) this.addArt(building);
  }

  private addHealth(building: YardBuilding): void {
    if (building.hp === null) {
      this.add(
        "Health",
        building.maxHp === null
          ? devDetails()
            ? "Full (the save omits health above full)"
            : "Full"
          : `${building.maxHp.toLocaleString()} / ${building.maxHp.toLocaleString()}`,
      );
      return;
    }

    this.add(
      "Health",
      building.maxHp === null
        ? building.hp.toLocaleString()
        : `${building.hp.toLocaleString()} / ${building.maxHp.toLocaleString()}`,
      "is-danger",
    );
  }

  private addCountdown(building: YardBuilding): void {
    const countdown = building.countdown;
    if (!countdown) return;

    const label =
      countdown.kind === "build"
        ? "Building"
        : countdown.kind === "upgrade"
          ? "Upgrading"
          : countdown.kind === "fortify"
            ? "Fortifying"
            : "Rebuilding";

    const now = this.yard ? this.yard.store.now() : Date.now() / 1000;
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.className = "is-info";
    definition.textContent = formatCountdown(countdown.endsAt - now);
    this.facts.append(term, definition);
    this.countdowns.push({ node: definition, endsAt: countdown.endsAt });
  }

  /**
   * Harvester fields: what its buffer holds, predicted to now on the own yard
   * (`harvest.ts`) and as saved elsewhere, and whether it is being repaired.
   * An own outpost's harvesters are never banked by hand: Flash showed a
   * disabled "Auto-Banking" there (`client/scripts/BUILDINGINFO.as:130-131`,
   * `:384-385`), and the server pays them into the main pool as they produce.
   */
  private addProduction(building: YardBuilding): void {
    const store = this.yard?.store;
    if (store?.kind === "outpost") {
      this.add("Banking", AUTO_BANKING, "is-info");
      if (building.raw.rE === 1) this.add("Repairing", "Yes", "is-info");
      return;
    }
    const now = store ? harvesterNow(building.raw, store.save, store.now()) : null;
    if (now) {
      this.add("Stored", `${formatAmount(now.stored)} / ${formatAmount(now.capacity)}`);
    } else if (typeof building.raw.st === "number") {
      this.add("Stored", formatAmount(building.raw.st));
    }
    if (building.raw.rE === 1) this.add("Repairing", "Yes", "is-info");
  }

  /** Which picture this building is showing, which is the first thing to check
   * when one looks wrong. */
  private addArt(building: YardBuilding): void {
    const art = resolveArt(building.type, building.level, artStateFor(building.condition));
    if (!art) {
      this.add("Art", `No art for type ${building.type}`, "is-danger");
      return;
    }
    const folder = artFolder(building.type) ?? "";
    this.add("Art", `${folder}${art.top.url.slice(art.top.url.lastIndexOf("/") + 1)}`);
    if (art.level !== building.level && building.level > 0) {
      this.add("Art level", `${art.level} (this building's art changes at ${art.level})`);
    }
  }

  private setKind(building: YardBuilding): void {
    const [label, colour] =
      building.condition === BuildingCondition.DESTROYED
        ? ["Destroyed", "var(--colour-danger, #d46a6a)"]
        : building.condition === BuildingCondition.DAMAGED
          ? ["Damaged", "var(--colour-warning, #d4a76a)"]
          : building.level === 0
            ? ["Under construction", "var(--colour-accent)"]
            : ["Intact", "var(--colour-text)"];
    this.kindLabel.textContent = label;
    this.swatch.style.background = colour;
  }

  private add(label: string, value: string, className?: string): void {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;
    if (className) definition.className = className;
    this.facts.append(term, definition);
  }
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

const isPlanner = (building: YardBuilding): boolean => building.type === YARD_PLANNER_TYPE;

const speedupSlot = (item: SpeedupItem): "finish" | "minusOne" | "minusTwo" =>
  item === "SP2" ? "minusOne" : item === "SP3" ? "minusTwo" : "finish";

const applySpeedup = (button: ShinyButton, offer: SpeedupOffer): void => {
  button.setPrice(offer.price);
  button.setBlocked(
    offer.blocked === "paused"
      ? "Repair the building first: its countdown is paused."
      : offer.blocked === "tooShort"
        ? offer.item === "SP4"
          ? "Five minutes or less left: finish it free."
          : `Less than ${offer.item === "SP3" ? "two hours" : "an hour"} left.`
        : offer.blocked === "credits"
          ? "Not enough Shiny."
          : null,
  );
};

const actionButton = (label: string, onClick: () => void, variant?: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = variant ? `btn ${variant}` : "btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};

const menuItem = (label: string, onClick: () => void): HTMLButtonElement => {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "btn btn--ghost building-panel__menu-item";
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  item.addEventListener("click", onClick);
  return item;
};

const note = (text: string): HTMLElement => {
  const paragraph = document.createElement("p");
  paragraph.className = "building-panel__note";
  paragraph.textContent = text;
  return paragraph;
};

const gateText = (text: string): HTMLElement => {
  const paragraph = document.createElement("p");
  paragraph.className = "building-panel__gate";
  paragraph.textContent = text;
  return paragraph;
};

/** "2 × Monster Locker at level 3", or "a Monster Locker at level 3" for one. */
const requirementText = ([type, count, level]: readonly [number, number, number]): string =>
  `${count === 1 ? "a" : `${count} ×`} ${typeName(type)} at level ${level}`;

/**
 * Why a gate stops the upgrade, as plain words: what a disabled button's
 * tooltip and accessible name carry, where no icon can go.
 */
export const gateSentence = (gate: UpgradeGate): string => {
  switch (gate.reason) {
    case "busy":
      return "Busy with another job.";
    case "training":
      return "Training a monster. Open it and cancel the training first.";
    case "damaged":
      return "Repair first.";
    case "townHall":
      return gate.have <= 0 ? "Build a Town Hall first." : `Needs Town Hall ${gate.need}.`;
    case "maxLevel":
      return "Max level.";
    case "requirements":
      return `Needs ${gate.requirements.map(requirementText).join(", ")}.`;
    case "shortfall":
      return gate.overCap ? NEED_MORE_SILOS : "Not enough resources.";
    case "workers":
      return gate.total === 1 ? "Your worker is busy." : `All ${gate.total} workers are busy.`;
    case "credits":
      return "Not enough Shiny.";
  }
};

/** The one line under the cost that says why Upgrade is disabled, amounts drawn with their icons. */
export const gateLine = (gate: UpgradeGate): HTMLElement => {
  const line = gateText("");
  if (gate.reason === "shortfall" && !gate.overCap) {
    line.append("Need ", costAmounts(gate.shortfall) ?? "", " more.");
  } else if (gate.reason === "credits") {
    line.append("Need ", resourceAmount("shiny", formatAmount(gate.need)), " more.");
  } else {
    line.textContent = gateSentence(gate);
  }
  return line;
};

/** An info value: text, an amount with its icon, or a row of icons. */
const infoValue = (value: InfoValue): Node => {
  if ("text" in value) return document.createTextNode(value.text);
  if ("resources" in value) {
    const icons = document.createElement("span");
    icons.className = "building-panel__icons";
    if (value.resources.length === 0) icons.textContent = "None";
    for (const key of value.resources) icons.append(resourceIcon(key));
    return icons;
  }
  const text = `${formatAmount(value.amount)}${value.suffix ?? ""}`;
  return value.resource
    ? resourceAmount(value.resource, text)
    : document.createTextNode(text);
};

/** "3 × Pokey, 1 × Octo-ooze", or null for none. */
const cullText = (culled: Readonly<Record<string, number>>): string | null => {
  const entries = Object.entries(culled);
  if (entries.length === 0) return null;
  return entries.map(([id, count]) => `${count} × ${monsterEntry(id)?.name ?? id}`).join(", ");
};

/**
 * What a recycle came to, for the notice: what came back, what was lost, what
 * went to storage. `bunkered` is what a Monster Bunker held when the player
 * confirmed: the server deletes it with the bunker and does not report it.
 */
export const recycledMessage = (
  name: string,
  report: RecycleReport,
  bunkered: Readonly<Record<string, number>> = {},
): HTMLElement => {
  const line = document.createElement("span");
  if (report.stored) {
    // Where to find it again (#128): the Build menu's Decorations tab.
    line.append(`${name} put in storage. Place it again from Build, Decorations.`);
    return line;
  }
  const refund = costAmounts(report.refund);
  line.append(`${name} recycled`);
  if (refund) line.append(" for ", refund);
  line.append(".");
  const lost = costAmounts(report.lost);
  if (lost) line.append(" ", lost, " did not fit in storage.");
  const culled = cullText(report.culled);
  if (culled) line.append(` Housing shrank: ${culled} lost.`);
  const emptied = cullText(bunkered);
  if (emptied) line.append(` ${emptied} lost with it.`);
  return line;
};

/** A refusal for the status line: the server's own sentence. */
const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
