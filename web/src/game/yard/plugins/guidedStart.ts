import { guideActions, type GuideActions } from "@/api/guide";
import type { Onboarding } from "@/api/types";
import { guideBus } from "@/game/guide/guideBus";
import { MonsterWalkIn } from "@/game/guide/MonsterWalkIn";
import { StagedRaidLayer } from "@/game/guide/StagedRaidLayer";
import { SPAWN_DISTANCE } from "@/game/guide/stagedRaid";
import {
  buildMicroStep,
  dotsFor,
  FREE_POKEYS,
  guideBuildOf,
  GUIDE_BUILDS,
  isGuideStep,
  LINES,
  TOUR,
  type GuideStepName,
} from "@/game/guide/steps";
import { findTarget, registerCanvasTarget, tutTarget, TutTarget, type TargetRect } from "@/game/guide/targets";
import { offerGuideTour } from "@/game/guide/tour";
import type { YardBuilding } from "@/game/yard/yardModel";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "@/game/yard/yardPlugins";
import { GuideOverlay, type GuideStep } from "@/ui/guide/GuideOverlay";
import type { BobAction } from "@/ui/guide/BobBubble";
import "@/ui/styles/guide-start.css";

/**
 * Own-yard plugin for the new-player tutorial's guided start package (b): Bob's steps on the
 * own yard and the staged raid (`docs/design/tutorial.md` §2, §4).
 * Issue #227.
 *
 * The server holds the macro step (`onboarding.guide.step`, on every yard
 * answer) and makes every grant; this runner only shows Bob for that step,
 * works out the micro step from what is on screen, and calls the guide's
 * routes when the player has done what he asked. A reload resumes at the
 * server's step. A refusal means the screen fell behind the server: the yard
 * is re-read and Bob carries on from the step it says.
 *
 * The yard part is steps 1 to 13 and 17 to 19; Map Room 1 runs 13 to 16
 * (`game/guide/mr1Guide.ts`) and the attack scene the practice attack
 * (`game/attack/plugins/practice.ts`). Main yard only. While the guided start
 * is not running, the plugin offers Help's tour instead (Q5).
 */

/** The place line where the building follows the pointer and a click builds it. */
const PLACE_BY_CLICK = "Move it onto open grass, then click to build it there. You can drag the yard to find space.";

/** How often the screen is looked at again for the micro step, ms. */
const POLL_MS = 250;
/** A collect step whose button never shows (nothing to bank) offers Next after this, ms. */
const COLLECT_FALLBACK_MS = 3000;
/** Skip appears in the raid after this, ms (§4). */
const RAID_SKIP_MS = 3000;

/** The Town Hall and the guide's buildings, by type. */
const TOWN_HALL = 14;
const SNIPER = GUIDE_BUILDS["build-sniper"]!.type;
const HOUSING = GUIDE_BUILDS["build-housing"]!.type;

const centreOf = (building: YardBuilding): { x: number; y: number } => ({
  x: building.x + building.footprint[0] / 2,
  y: building.y + building.footprint[1] / 2,
});

/** What Bob shows, with the key that says whether it changed. */
interface View {
  key: string;
  step: GuideStep | null;
  /** Called after the step is on screen (to tag a bubble button as the target). */
  after?: () => void;
}

/** The target name the bubble's own Finish now button is tagged with. */
const GUIDE_FINISH = "guide-finish";

/**
 * The ground the raid or the Pokeys' walk-in plays on, as a canvas target:
 * Bob's spotlight leaves it undimmed so the player can watch them.
 */
const GUIDE_SCENE = "guide-scene";

export class GuidedStartRunner {
  private readonly overlay: GuideOverlay;
  private readonly actions: GuideActions;
  private readonly unsubscribe: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private shownKey: string | null = null;
  private busy = false;
  private asking = false;

  // What the screen is doing, from the guide bus.
  private menuOpen = false;
  private carrying: number | null = null;

  // Local sub-states the server does not need.
  private collected = false;
  private collectSince: number | null = null;
  private raid: StagedRaidLayer | null = null;
  private raidOver = false;
  private raidSkippable = false;
  private raidTimer: ReturnType<typeof setTimeout> | null = null;
  private walkIn: MonsterWalkIn | null = null;
  /** The army answer came back: Bob says his Pokeys line until Next. */
  private pokeysLine = false;
  /** The gift was asked for at this step already (a refusal is not asked again). */
  private armyTried = false;
  private goalsRoot: HTMLElement | null = null;
  private goalsSeen = false;
  private tour: number | null = null;
  private tourRaid: StagedRaidLayer | null = null;
  private withdrawTour: (() => void) | null = null;

  constructor(private readonly mounts: YardMounts) {
    this.overlay = new GuideOverlay(mounts.overlay.guide);
    this.actions = guideActions(mounts.store);
  }

  start(): void {
    const { store } = this.mounts;
    this.unsubscribe.push(
      registerCanvasTarget(GUIDE_SCENE, () => this.sceneRect()),
      store.subscribe(() => this.render()),
      guideBus.on("buildMenu", ({ open }) => {
        this.menuOpen = open;
        this.render();
      }),
      guideBus.on("carry", ({ type }) => {
        this.carrying = type;
        this.render();
      }),
      guideBus.on("panel", () => this.render()),
      guideBus.on("banked", () => {
        if (this.step() === "collect") this.collected = true;
        this.render();
      }),
      guideBus.on("screen", ({ id, root }) => {
        if ((id as string) === "goals") {
          this.goalsRoot = root;
          void this.goalsOpened();
        } else if (this.goalsRoot) {
          this.goalsRoot = null;
        }
        this.render();
      }),
    );
    this.timer = setInterval(() => this.render(), POLL_MS);
    this.render();
  }

  destroy(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.raidTimer !== null) clearTimeout(this.raidTimer);
    this.raid?.destroy();
    this.raid = null;
    this.tourRaid?.destroy();
    this.tourRaid = null;
    this.walkIn?.destroy();
    this.walkIn = null;
    this.withdrawTour?.();
    this.withdrawTour = null;
    this.overlay.destroy();
  }

  /** Where the raid or the walk-in plays, on screen; null while neither does. */
  private sceneRect(): TargetRect | null {
    const box = this.raid?.worldBox() ?? this.tourRaid?.worldBox() ?? this.walkIn?.worldBox() ?? null;
    if (!box) return null;
    const { camera, canvas } = this.mounts;
    const bounds = canvas.getBoundingClientRect();
    const topLeft = camera.worldToScreen({ x: box.x, y: box.y });
    const bottomRight = camera.worldToScreen({ x: box.x + box.width, y: box.y + box.height });
    return {
      left: bounds.left + topLeft.x,
      top: bounds.top + topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  /* ── Reading the server's step ───────────────────────────────────────── */

  private onboarding(): Onboarding | undefined {
    return this.mounts.store.save.onboarding;
  }

  /** The step while the guide runs; null when it is over or never ran. */
  private step(): GuideStepName | null {
    const guide = this.onboarding()?.guide;
    if (!guide) return null;
    if (guide.state === "pending") return "welcome";
    if (guide.state !== "active") return null;
    return isGuideStep(guide.step) ? guide.step : null;
  }

  private building(id: number | undefined): YardBuilding | null {
    return id === undefined ? null : this.mounts.store.building(id);
  }

  private firstOfType(type: number): YardBuilding | null {
    return this.mounts.store.yard.buildings.find((one) => one.type === type) ?? null;
  }

  /* ── Drawing ─────────────────────────────────────────────────────────── */

  private render(): void {
    if (this.tour !== null) return;
    const step = this.step();
    this.offerTour(step === null);
    if (step === null || this.mounts.scene.plannerOpen()) {
      this.show({ key: "none", step: null });
      return;
    }
    if (this.asking) return;
    // A screen Bob does not run (the Goals panel) is open: he waits out of its way.
    if (this.goalsRoot?.isConnected) {
      this.show({ key: "aside", step: null });
      return;
    }
    if (step !== "pokeys") this.armyTried = false;
    this.show(this.viewFor(step));
  }

  private show(view: View): void {
    if (view.key === this.shownKey) return;
    this.shownKey = view.key;
    if (!view.step) {
      this.overlay.hide();
      return;
    }
    this.overlay.show(view.step);
    view.after?.();
  }

  /** Bob's line with the step's dots and Skip. */
  private line(step: GuideStepName, line: Omit<GuideStep, "dots" | "skip">): GuideStep {
    return { ...line, dots: dotsFor(step), skip: { label: "Skip", onClick: () => this.askSkip() } };
  }

  private next(label: string, run: () => void): BobAction[] {
    return [{ label, primary: true, onClick: run }];
  }

  private viewFor(step: GuideStepName): View {
    switch (step) {
      case "welcome":
        return {
          key: "welcome",
          step: this.line(step, {
            text: LINES.welcome(this.mounts.store.save.name ?? ""),
            actions: this.next("Next", () => this.advance("welcome")),
          }),
        };
      case "collect":
        return this.collectView();
      case "build-sniper":
      case "build-housing":
      case "build-maproom":
      case "build-flinger":
        return this.buildView(step);
      case "finish-sniper":
      case "finish-housing":
      case "finish-maproom":
      case "finish-flinger":
        return this.finishView(step);
      case "raid":
        return this.raidView();
      case "pokeys":
        return this.pokeysView();
      case "open-map":
      case "pick-camp":
      case "attack":
      case "attack-result":
        return {
          key: `map:${step}`,
          step: this.line(step, {
            text: step === "open-map" ? LINES.openMap : "Back to the map: tap Map.",
            target: TutTarget.DOCK_MAP,
          }),
        };
      case "home-goals":
        return this.goalsView();
      case "finish-now":
        return {
          key: "finish-now",
          step: this.line(step, {
            text: LINES.finishNow,
            target: TutTarget.HUD_SHINY,
            actions: this.next("Next", () => this.advance("finish-now")),
          }),
        };
      case "protection":
        return {
          key: "protection",
          step: this.line(step, {
            text: LINES.protection,
            actions: this.next("Finish", () => this.advance("protection")),
          }),
        };
    }
  }

  private collectView(): View {
    if (this.collected) {
      return {
        key: "collect:done",
        step: this.line("collect", {
          text: LINES.collected,
          actions: this.next("Next", () => this.advance("collect")),
        }),
      };
    }
    const shown = findTarget(TutTarget.COLLECT_ALL) !== null;
    if (shown) this.collectSince = null;
    else this.collectSince ??= Date.now();
    // Nothing to collect (the Snapper is empty): Bob does not wait on a button that is not there.
    const stuck = !shown && this.collectSince !== null && Date.now() - this.collectSince > COLLECT_FALLBACK_MS;
    return {
      key: `collect:${stuck ? "stuck" : "wait"}`,
      step: this.line("collect", {
        text: LINES.collect,
        target: TutTarget.COLLECT_ALL,
        ...(stuck && { actions: this.next("Next", () => this.advance("collect")) }),
      }),
    };
  }

  private buildView(step: GuideStepName): View {
    if (this.pokeysLine) return this.pokeysView();
    const build = guideBuildOf(step)!;
    const picked =
      document.querySelector(`.build-tile[data-type="${build.type}"][aria-pressed="true"]`) !== null &&
      findTarget(TutTarget.BUILD_GO) !== null;
    const micro = buildMicroStep(build, {
      carrying: this.mounts.scene.carrying() ? this.carrying : null,
      menuOpen: this.menuOpen,
      picked,
      cardShown: findTarget(`${TutTarget.BUILD_CARD}${build.type}`) !== null,
    });
    // A desktop places with a click and shows no Build here: point at the building in hand.
    const here = micro.key !== "place" || findTarget(TutTarget.BUILD_HERE) !== null;
    return {
      key: `${step}:${micro.key}:${here}`,
      step: this.line(step, {
        text: here ? micro.text : PLACE_BY_CLICK,
        target: here ? micro.target : TutTarget.CARRY_GHOST,
        block: micro.block,
      }),
    };
  }

  private finishView(step: GuideStepName): View {
    const build = guideBuildOf(step)!;
    const id =
      this.onboarding()?.guide.building ??
      this.mounts.store.yard.buildings.find((one) => one.type === build.type && one.countdown?.kind === "build")?.id;
    const building = this.building(id);
    if (!building || id === undefined) {
      // The answer is on its way, or the yard is behind: read it again.
      return { key: `${step}:wait`, step: this.line(step, { text: build.lines.finishTap }) };
    }
    if (this.mounts.scene.selectedBuilding() !== id) {
      return {
        key: `${step}:tap:${id}`,
        step: this.line(step, {
          text: build.lines.finishTap,
          target: `${TutTarget.BUILDING}${id}`,
        }),
        after: () => {
          const centre = centreOf(building);
          this.mounts.scene.centreOn(centre.x, centre.y);
        },
      };
    }
    return {
      key: `${step}:finish:${id}`,
      step: this.line(step, {
        text: build.lines.finishNow,
        target: GUIDE_FINISH,
        // From the right, so the hand does not cover Bob's own words.
        side: "right",
        actions: this.next("Finish now (free)", () => void this.finish(id)),
      }),
      after: () => this.tagFinishButton(),
    };
  }

  /** The bubble's Finish now is what the hand points at. */
  private tagFinishButton(): void {
    const button = this.mounts.overlay.guide.querySelector<HTMLElement>(".guide-bob__action.btn--primary");
    if (button) tutTarget(button, GUIDE_FINISH);
  }

  private raidView(): View {
    if (this.raidOver) {
      return {
        key: "raid:end",
        step: this.line("raid", {
          text: LINES.raidEnd,
          actions: this.next("Next", () => this.advance("raid")),
        }),
      };
    }
    const tower = this.firstOfType(SNIPER);
    if (!tower) return { key: "raid:wait", step: this.line("raid", { text: LINES.raidStart }) };
    if (!this.raid) this.startRaid(tower);
    const text = document.createDocumentFragment();
    const banner = document.createElement("strong");
    banner.className = "guide-raid__banner";
    banner.textContent = LINES.raidBanner;
    text.append(banner, document.createElement("br"), LINES.raidStart);
    return {
      key: `raid:play:${this.raidSkippable}`,
      step: this.line("raid", {
        text,
        target: GUIDE_SCENE,
        ...(this.raidSkippable && {
          actions: [{ label: "Skip the raid", onClick: () => this.raid?.skip() }],
        }),
      }),
    };
  }

  private startRaid(tower: YardBuilding): void {
    const hall = this.firstOfType(TOWN_HALL);
    const centre = centreOf(tower);
    this.centreOnRaid(centre, hall);
    this.raid = new StagedRaidLayer(this.mounts.renderer, centre, hall ? centreOf(hall) : null, () => {
      this.raidOver = true;
      this.shownKey = null;
      this.render();
    });
    this.raid.start();
    this.raidTimer = setTimeout(() => {
      this.raidSkippable = true;
      this.render();
    }, RAID_SKIP_MS);
  }

  /** The camera between the tower and where the oozes come from, so the whole walk is in view. */
  private centreOnRaid(tower: { x: number; y: number }, hall: YardBuilding | null): void {
    const from = hall ? centreOf(hall) : { x: tower.x - 1, y: tower.y };
    const dx = tower.x - from.x;
    const dy = tower.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const ahead = SPAWN_DISTANCE / 2;
    this.mounts.scene.centreOn(tower.x + (dx / length) * ahead, tower.y + (dy / length) * ahead);
  }

  private pokeysView(): View {
    if (this.pokeysLine) {
      return {
        key: "pokeys:line",
        step: this.line("pokeys", {
          text: LINES.pokeys,
          target: this.walkIn?.worldBox() ? GUIDE_SCENE : this.walkInTarget(),
          actions: this.next("Next", () => {
            this.pokeysLine = false;
            this.shownKey = null;
            this.render();
          }),
        }),
      };
    }
    if (!this.busy && !this.armyTried) void this.army();
    return { key: "pokeys:wait", step: this.line("pokeys", { text: LINES.pokeys }) };
  }

  private walkInTarget(): string | null {
    const housing = this.firstOfType(HOUSING);
    return housing ? `${TutTarget.BUILDING}${housing.id}` : null;
  }

  private goalsView(): View {
    // Opened once already: the advance is on its way.
    if (this.goalsSeen) return { key: "goals:seen", step: null };
    if (!findTarget(TutTarget.DOCK_GOALS)) {
      return {
        key: "goals:nobutton",
        step: this.line("home-goals", {
          text: LINES.homeGoalsNoButton,
          actions: this.next("Next", () => this.advance("home-goals")),
        }),
      };
    }
    return {
      key: "goals:point",
      step: this.line("home-goals", { text: LINES.homeGoals, target: TutTarget.DOCK_GOALS }),
    };
  }

  /* ── Skip ────────────────────────────────────────────────────────────── */

  private askSkip(): void {
    this.asking = true;
    this.shownKey = "skip-ask";
    this.overlay.show({
      text: LINES.skipAsk,
      mood: "worried",
      actions: [
        {
          label: "Keep going",
          onClick: () => {
            this.asking = false;
            this.shownKey = null;
            this.render();
          },
        },
        {
          label: "Skip",
          primary: true,
          onClick: () => {
            this.asking = false;
            void this.call(() => this.actions.skip());
          },
        },
      ],
    });
  }

  /* ── Routes ──────────────────────────────────────────────────────────── */

  /** Runs one guide route; a refusal re-reads the yard so Bob follows the server. */
  private async call(run: () => Promise<{ ok: boolean }>): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const result = await run();
      if (!result.ok) await this.mounts.store.refresh();
      return result.ok;
    } finally {
      this.busy = false;
      this.shownKey = null;
      this.render();
    }
  }

  private advance(from: GuideStepName): void {
    if (from === "collect") this.collected = false;
    if (from === "raid") {
      this.raid?.destroy();
      this.raid = null;
    }
    void this.call(() => this.actions.advance(from));
  }

  private async finish(id: number): Promise<void> {
    const ok = await this.call(() => this.actions.finish(id));
    if (ok) this.mounts.scene.closePanel();
  }

  private async army(): Promise<void> {
    this.armyTried = true;
    this.busy = true;
    try {
      const result = await this.actions.army();
      if (!result.ok) {
        await this.mounts.store.refresh();
        return;
      }
      this.pokeysLine = true;
      this.playWalkIn(Math.max(result.report.added, 1));
    } finally {
      this.busy = false;
      this.shownKey = null;
      this.render();
    }
  }

  /** Bob's Pokeys walk in from the yard's edge to the Housing. */
  private playWalkIn(count: number): void {
    const housing = this.firstOfType(HOUSING);
    if (!housing) return;
    const to = centreOf(housing);
    const bounds = this.mounts.store.yard.bounds;
    const from = { x: bounds.yardWidth / 2, y: to.y };
    this.walkIn?.destroy();
    this.walkIn = new MonsterWalkIn(this.mounts.renderer, {
      monster: "C1",
      count: Math.min(count, FREE_POKEYS),
      from,
      to,
    });
    this.walkIn.start();
    this.mounts.scene.centreOn(to.x, to.y);
  }

  private async goalsOpened(): Promise<void> {
    if (this.step() !== "home-goals" || this.goalsSeen) return;
    this.goalsSeen = true;
    await this.call(() => this.actions.advance("home-goals"));
  }

  /* ── The Help tour (Q5) ──────────────────────────────────────────────── */

  private offerTour(on: boolean): void {
    if (on && !this.withdrawTour) this.withdrawTour = offerGuideTour(() => this.startTour());
    else if (!on && this.withdrawTour) {
      this.withdrawTour();
      this.withdrawTour = null;
    }
  }

  private startTour(): void {
    this.tour = 0;
    this.showTour();
  }

  private showTour(): void {
    const index = this.tour;
    if (index === null) return;
    const stop = TOUR[index];
    if (!stop) {
      this.endTour();
      return;
    }
    if (stop.raid) {
      const tower = this.firstOfType(SNIPER);
      if (tower && !this.tourRaid) {
        const hall = this.firstOfType(TOWN_HALL);
        const centre = centreOf(tower);
        this.centreOnRaid(centre, hall);
        this.tourRaid = new StagedRaidLayer(this.mounts.renderer, centre, hall ? centreOf(hall) : null, () => {
          this.tourRaid?.destroy();
          this.tourRaid = null;
        });
        this.tourRaid.start();
      }
    }
    const last = index === TOUR.length - 1;
    this.shownKey = `tour:${index}`;
    this.overlay.show({
      text: stop.text,
      target: stop.target && findTarget(stop.target) ? stop.target : null,
      block: false,
      dots: { index, count: TOUR.length },
      skip: { label: "End tour", onClick: () => this.endTour() },
      actions: this.next(last ? "Done" : "Next", () => {
        this.tour = last ? null : index + 1;
        if (last) this.endTour();
        else this.showTour();
      }),
    });
  }

  private endTour(): void {
    this.tour = null;
    this.tourRaid?.destroy();
    this.tourRaid = null;
    this.shownKey = null;
    this.overlay.hide();
    this.render();
  }
}

const plugin: YardPlugin = (mounts) => {
  // The guide is the main yard's: an outpost has none.
  if (mounts.store.kind !== "main") return;
  const runner = new GuidedStartRunner(mounts);
  runner.start();
  return () => runner.destroy();
};

YARD_PLUGINS.push(plugin);

/** The plugin itself, for the tests. */
export { plugin as guidedStartPlugin };
