import type { SpeedupItem } from "@/api/types";
import type { YardRefusal } from "@/api/yard";
import { buildActions } from "@/api/yardBuild";
import { artFolder, resolveArt } from "@/game/yard/buildingArt";
import { maxLevel, WALL_TYPES } from "@/game/yard/buildingCosts";
import { harvesterNow } from "@/game/yard/harvest";
import { NEED_MORE_SILOS } from "@/game/yard/storage";
import { progressFraction } from "@/game/yard/jobs";
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
import { costAmounts, resourceAmount, resourceIcon } from "@/ui/resourceIcon";
import {
  jobOffer,
  panelModel,
  type CancelOffer,
  type JobOffer,
  type PanelModel,
  type SpeedupOffer,
  type UpgradeGate,
  type UpgradeOffer,
} from "./buildingActions";
import { buildingInfo, type InfoValue } from "./buildingInfo";
import { ShinyButton } from "./ShinyButton";
import { describeSeconds } from "./upgradeText";

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
  private readonly status: HTMLElement;
  private readonly details: HTMLDetailsElement;
  private readonly facts: HTMLDListElement;
  private readonly planner: BuildingPanelOptions["planner"];
  private readonly openMap: (() => void) | undefined;
  private readonly unsubscribe: (() => void) | null;

  private building: YardBuilding | null = null;
  /** Countdown rows in Details, refreshed once a second. */
  private countdowns: { node: HTMLElement; endsAt: number }[] = [];
  private jobRefs: JobRefs | null = null;
  /**
   * One Shiny button per building and action, kept across redraws so an
   * armed button survives the store's answers and the second's tick.
   */
  private readonly shiny = new Map<string, ShinyButton>();
  /** Buttons whose request key disables them while it runs. */
  private pendingButtons: { key: string; button: HTMLButtonElement | ShinyButton }[] = [];
  /** The building whose Cancel confirmation is open. */
  private confirmingCancel: number | null = null;

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

    this.status = document.createElement("p");
    this.status.className = "building-panel__status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.details = document.createElement("details");
    this.details.className = "building-panel__details";
    const summary = document.createElement("summary");
    summary.className = "building-panel__summary";
    summary.textContent = "Details";
    this.facts = document.createElement("dl");
    this.facts.className = "cell-facts";
    this.details.append(summary, this.facts);

    this.panel.setContent(
      this.kind,
      this.info,
      this.unlocks,
      this.actions,
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
    if (this.building?.id !== building.id) {
      this.confirmingCancel = null;
      this.setStatus(null);
      // A different building's Shiny buttons are no use and may be armed.
      for (const button of this.shiny.values()) button.destroy();
      this.shiny.clear();
    }
    this.building = building;
    this.panel.setTitle(
      building.level > 0 ? `${building.name} · Level ${building.level}` : building.name,
    );
    this.render();
  }

  /** Advances the countdowns, the progress bar and the time-priced Shiny. Called once a second by the scene. */
  tick(nowSeconds: number): void {
    const now = this.yard ? this.yard.store.now() : nowSeconds;
    for (const entry of this.countdowns) {
      entry.node.textContent = formatCountdown(entry.endsAt - now);
    }
    const building = this.building;
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
    this.renderActions(building);
    this.renderDetails(building);
  }

  private renderInfo(building: YardBuilding): void {
    const { rows, list } = buildingInfo(building);
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
    this.pendingButtons = [];
    const used = new Set<string>();
    const blocks: HTMLElement[] = [];
    const yard = this.yard;

    if (yard) {
      const model = panelModel(building, yard.store);
      if (model.job) blocks.push(this.jobBlock(building, model.job, used));
      if (model.upgrade) blocks.push(this.upgradeBlock(building, model.upgrade, used));
      // A one-level building (Yard Planner, General Store) has no ladder to top out.
      if (model.maxed && maxLevel(building.type) > 1) {
        blocks.push(note(`Level ${building.level} is the highest level.`));
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
      const open = this.openButton(model);
      if (open) blocks.push(open);
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
    const scene = this.yard?.scene;
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

  private upgradeBlock(building: YardBuilding, offer: UpgradeOffer, used: Set<string>): HTMLElement {
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

    const cost = costAmounts(offer.cost);
    const costLine = document.createElement("p");
    costLine.className = "building-panel__cost";
    costLine.append(cost ?? "Free");
    block.append(costLine);

    if (offer.gate) {
      const line = gateLine(offer.gate);
      line.id = this.gateId(building);
      block.append(line);
    }

    const row = document.createElement("div");
    row.className = "map-row building-panel__buttons";
    const upgrade = actionButton("Upgrade", () => void this.runUpgrade(building.id), "btn--primary");
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
      instant.setPrice(offer.instantPrice);
      instant.setBlocked(offer.instantGate ? gateSentence(offer.instantGate) : null);
      row.append(instant.element);
      this.pendingButtons.push({ key: actionKey("instant", building.id), button: instant });
    }

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
    if (this.confirmingCancel !== building.id) {
      const button = actionButton(underConstruction ? "Cancel build" : "Cancel upgrade", () => {
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
      "Cancel and get back ",
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
    const confirm = actionButton("Yes, cancel", () => {
      this.confirmingCancel = null;
      void this.runCancel(building.id);
    });
    confirm.classList.add("btn--danger", "building-cancel__confirm");
    const keep = actionButton(underConstruction ? "Keep building" : "Keep upgrading", () => {
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

  private async runCancel(id: number): Promise<void> {
    const store = this.yard?.store;
    if (!store) return;
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

  private dispose(): void {
    this.unsubscribe?.();
    for (const button of this.shiny.values()) button.destroy();
    this.shiny.clear();
  }

  /* ── Details ────────────────────────────────────────────────────────── */

  private renderDetails(building: YardBuilding): void {
    this.facts.replaceChildren();
    this.countdowns = [];

    this.add("Type id", String(building.type));
    this.add(
      "Level",
      building.level === 0
        ? "0 — foundation, still building"
        : building.raw.l === undefined
          ? "1 (the save omits the level at 1)"
          : String(building.level),
    );

    const [width, height] = building.footprint;
    this.add("Footprint", `${width} x ${height} yard units`);
    this.add("Position", `${building.x}, ${building.y}`);
    this.add("Building id", String(building.id));

    this.add(
      "Fortification",
      building.fortification === 0 ? "None" : `Level ${building.fortification}`,
      building.fortification > 0 ? "is-info" : undefined,
    );

    this.addHealth(building);
    this.addCountdown(building);
    this.addProduction(building);
    this.addArt(building);
  }

  private addHealth(building: YardBuilding): void {
    if (building.hp === null) {
      this.add(
        "Health",
        building.maxHp === null
          ? "Full (the save omits health above full)"
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
   */
  private addProduction(building: YardBuilding): void {
    const store = this.yard?.store;
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

/** A refusal for the status line: the server's own sentence. */
const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
