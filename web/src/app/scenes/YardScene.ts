import { logout } from "@/api/auth";
import { loadAttack, loadOwnYard, takeAwayJobs, viewBase } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import {
  BaseMode,
  type BaseLoadResponse,
  type BuildingDataMap,
  type Resources,
  type UpgradeReport,
} from "@/api/types";
import { bankActions } from "@/api/yardBank";
import { buildActions } from "@/api/yardBuild";
import { consumeViewTarget, setAttackTarget, type ViewTarget } from "@/game/attack/attackTarget";
import { concealTraps, countedBuildings } from "@/game/attack/trapReveal";
import { Camera } from "@/game/Camera";
import {
  PlannerAccess,
  plannerAccess,
  plannerEntryTooltip,
} from "@/game/yard/planner/access";
import { buildOffer, buildsAtOnce } from "@/game/yard/buildCatalogue";
import { BuildPlacement } from "@/game/yard/BuildPlacement";
import { harvesterNow, type HarvestKey } from "@/game/yard/harvest";
import { MushroomPicker, type MushroomPickView } from "@/game/yard/mushroomPick";
import { readYard, type Yard, type YardBuilding } from "@/game/yard/yardModel";
import {
  YardChangeReason,
  YardStore,
  type YardChange,
  type YardUiBinding,
} from "@/game/yard/YardStore";
import { YardRenderer, YardView } from "@/game/yard/YardRenderer";
import { YardInput } from "@/game/yard/YardInput";
import { formatAmount } from "@/ui/format";
import { Hud } from "@/ui/Hud";
import { Notices } from "@/ui/maproom/Notices";
import { MonstersScreen } from "@/ui/monsters/MonstersScreen";
import { monstersTabFor, type MonstersFocus, type MonstersTabId } from "@/ui/monsters/monstersTab";
import { resourceAmount } from "@/ui/resourceIcon";
import { BuildingPanel } from "@/ui/yard/BuildingPanel";
import { BuildMenu, PlacementBar, spotSentence } from "@/ui/yard/BuildMenu";
import { showBankResult } from "@/ui/yard/CollectAll";
import { showGoldenMushroom } from "@/ui/yard/MushroomReward";
import { describeUpgradeReport } from "@/ui/yard/upgradeText";
import { YardMinimap } from "@/ui/yard/YardMinimap";
import { ZoomControl } from "@/ui/ZoomControl";
import { YardPlanner } from "./YardPlanner";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";

/**
 * A yard: the player's own, or — handed a {@link ViewTarget} by the map —
 * anyone else's, read-only.
 *
 * Wiring only, the same division as Map Room 2: the camera owns the view, the
 * renderer owns the scene graph and the panel owns the DOM. What lives here is
 * the load, the failure paths and the once-a-second tick that keeps the
 * countdowns honest.
 *
 * The player's own yard is held by a {@link YardStore}
 * (`docs/design/yard-buildings.md` §2.1, §2.4): the store owns the save, this
 * scene redraws from it on every change, ticks it once a second so a finished
 * job flips at once and is confirmed by one `state` call, asks it for a
 * `state` call when the tab becomes visible again, and hands it to the
 * building panel and the HUD through one {@link YardUiBinding}. A foreign yard
 * is one request and then static, with no store.
 *
 * A foreign yard is the same screen with the own-yard doors shut
 * (`docs/design/attack-flow.md` §F1, §4.1): the load is a `view`/`wmview`
 * rather than a `build`, the planner opens to look and not to change
 * (`plannerAccess` with `ownYard` false, the visit flow its comment names),
 * and the HUD shows no resources because the response's pool is the
 * defender's. The one thing it gains is an Attack button, offered only when
 * the map's gate passed, which issues the attack load while this yard stays
 * on screen and hands the response straight to the attack scene.
 */

/** The two calls a yard can be loaded with, so the choice can be tested. */
export interface YardLoaders {
  loadOwnYard: typeof loadOwnYard;
  viewBase: typeof viewBase;
}

/**
 * Loads the yard a target names: the player's own in build mode when there
 * is no target, otherwise the foreign yard read-only. Pure in the sense that
 * matters — which call is made is decided by the target and nothing else.
 */
export const loadYardFor = (
  target: ViewTarget | null,
  api: YardLoaders = { loadOwnYard, viewBase },
): Promise<BaseLoadResponse> =>
  target ? api.viewBase(target.baseid, target.kind) : api.loadOwnYard();

/**
 * The pool the HUD shows over a yard: the yard's own when it is the player's,
 * and the visitor's own, as the map read it, on a visit (#60). A visit's load
 * carries the defender's resources, which are never shown as the player's.
 * Null leaves the HUD at its placeholders.
 */
export const hudPoolFor = (
  target: ViewTarget | null,
  yard: { readonly resources: Resources; readonly credits?: number | undefined },
): { resources: Resources; credits?: number | undefined } | null => {
  if (!target) return { resources: yard.resources, credits: yard.credits };
  const own = target.own;
  return own?.resources ? { resources: own.resources, credits: own.credits } : null;
};

/**
 * The floor-plan glyph on the Layout control.
 *
 * Four rectangles rather than an icon font or a file: it is four elements, it
 * takes its colour from the button it sits in, and it cannot arrive late.
 */
const layoutIcon = (): SVGSVGElement => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "yard-toolbar__icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [x, y, width, height] of [
    [1, 1, 6, 6],
    [9, 1, 6, 4],
    [1, 9, 6, 6],
    [9, 7, 6, 8],
  ]) {
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(width));
    rect.setAttribute("height", String(height));
    rect.setAttribute("rx", "1.5");
    svg.append(rect);
  }
  return svg;
};

/** How often the open panel's countdowns are refreshed. */
const UI_TICK_SECONDS = 1;

/** Zoom the yard opens at, over the town hall. 1 is art at native size. */
const OPENING_ZOOM = 0.9;

/**
 * Closest zoom. The art is 1:1 at zoom 1, so past about 2 it is visibly soft;
 * 2.5 matches the map's ceiling and is a deliberate "look closely" step rather
 * than a useful working zoom.
 */
const MAX_ZOOM = 2.5;

/**
 * What one press of a zoom key, or of the slider's minus and plus, multiplies
 * the zoom by. One constant so the keyboard and the buttons cannot drift.
 */
const ZOOM_STEP = 1.5;

export class YardScene implements Scene {
  private readonly renderer = new YardRenderer();
  private readonly notices = new Notices();

  private camera: Camera | null = null;
  private context: SceneContext | null = null;
  /**
   * The current viewport size in CSS px. `SceneContext.width`/`height` are a
   * one-time snapshot taken at `enter`, never updated after — `resize` is the
   * only place the manager hands us a live size, so it is mirrored here for
   * every other method that needs "the viewport right now" (fitYard, setView,
   * zoomBy, the inset recompute). Reading `this.context.width` instead is the
   * bug that leaves the zoom floor pinned to the size the scene opened at.
   */
  private viewportWidth = 0;
  private viewportHeight = 0;
  private hud: Hud | null = null;
  private input: YardInput | null = null;
  private panel: BuildingPanel | null = null;
  private panelDock: HTMLElement | null = null;
  /** The own yard's Monsters screen (§4.1), built the first time it opens. */
  private monsters: MonstersScreen | null = null;
  /** Picks a tapped mushroom on the own yard (§5.6); null on a foreign one. */
  private mushroomPicker: MushroomPicker | null = null;

  private yard: Yard | null = null;
  /** The save the yard was built from; on the own yard, always the store's. */
  private save: BaseLoadResponse | null = null;
  /** The own yard's store; null on a visit and before the load answers. */
  private store: YardStore | null = null;
  private unsubscribeStore: (() => void) | null = null;
  /** What the panel and the HUD are handed on the own yard. */
  private binding: YardUiBinding | null = null;
  /** The tab came back while the planner was open; refresh once it closes. */
  private refreshAfterPlanner = false;
  private planner: YardPlanner | null = null;
  private plannerButton: HTMLButtonElement | null = null;
  /** The word inside the Layout control, beside its glyph. */
  private plannerLabel: HTMLElement | null = null;
  /**
   * What the player may do with the planner in the yard now open (§8, Q5).
   *
   * Locked until the yard has loaded, because the rule is read off the
   * buildings and there are none to read before then.
   */
  private access: PlannerAccess = PlannerAccess.LOCKED;
  private toolbar: HTMLElement | null = null;
  /** The own yard's Build control (§5.3); null on a visit. */
  private buildButton: HTMLButtonElement | null = null;
  /** The build menu, made the first time it opens. */
  private buildMenu: BuildMenu | null = null;
  /** A new building in hand, and the bar that says what it is; null otherwise. */
  private placement: BuildPlacement | null = null;
  private placementBar: PlacementBar | null = null;
  /**
   * The foreign cell this visit is looking at, or null for the player's own
   * yard. Taken from the map's handoff once, in `enter`, and never changed.
   */
  private target: ViewTarget | null = null;
  /** The visit's Attack button; only built when the target can be attacked. */
  private attackButton: HTMLButtonElement | null = null;
  /** True while the attack load is in flight, so a second click does nothing. */
  private attacking = false;
  private selected: YardBuilding | null = null;
  /**
   * One word the planner adds to the status line: what the pointer is over.
   *
   * Null whenever it is over nothing worth naming, and always null once the
   * planner has gone, because the planner clears it on its way out.
   */
  private hint: string | null = null;
  private sinceUiTick = 0;
  /** The zoom at which the whole plot fits the viewport; also the floor. */
  private fitZoom = 0.05;
  /**
   * How much of the canvas, in CSS px from the top and bottom edges, is
   * covered by HTML chrome (the HUD and toolbar, or the planner's bars) and so
   * should not count toward the fit-to-plot floor. Kept current by `enter`
   * and by the planner's `onInset` reports.
   */
  private inset = { top: 0, bottom: 0 };
  /** Rolling average of the scene's own per-frame cost, in milliseconds. */
  private frameCostMs = 0;
  private status: HTMLElement | null = null;

  /**
   * The canvas's bottom-right corner furniture (design §4.1): the zoom slider
   * and the minimap. Both belong to the yard rather than to the planner — the
   * design puts them on the canvas, and a player reading a yard wants to zoom
   * and to know where they are just as much as one editing it.
   */
  private viewTools: HTMLElement | null = null;
  private zoomControl: ZoomControl | null = null;
  private minimap: YardMinimap | null = null;

  async enter(context: SceneContext): Promise<void> {
    this.context = context;
    this.viewportWidth = context.width;
    this.viewportHeight = context.height;
    // Consumed, not read: a target left behind would turn the next plain
    // "Yard" click into a visit to somebody else's base.
    this.target = consumeViewTarget();
    const whose = this.target ? `${this.target.name}'s yard` : "your yard";
    context.stage.addChild(this.renderer.root);
    this.renderer.attach(context.renderer);

    this.hud = new Hud({
      scenes: [
        { id: SceneName.MAP_ROOM_2, label: "Map" },
        { id: SceneName.YARD, label: "Yard" },
        { id: SceneName.LOGIN, label: "Account" },
      ],
      onSceneSelect: (id) => context.goTo(id),
      onSignOut: () => {
        logout();
        context.goTo(SceneName.LOGIN);
      },
    });
    this.hud.setActiveScene(SceneName.YARD);
    this.hud.mount(context.overlay.content);

    this.notices.mount(context.overlay.content);
    // On a phone they dock under the toolbar row instead of over it (maproom.css).
    this.notices.element.classList.add("yard-notices");

    this.status = document.createElement("div");
    this.status.className = "cell-readout";
    this.status.textContent = `Loading ${whose}…`;

    /*
     * The way into the planner, and the first thing on this screen anyone has
     * to find.
     *
     * It used to be a ghost button labelled "Plan", which is to say grey text
     * on a dark background beside a wall of grey text, and the owner's verdict
     * on it was "I really don't see the Plan button". So: the accent fill the
     * rest of the client keeps for its primary action, a floor-plan glyph
     * beside the word, and "Layout" rather than "Plan" because a plan is a
     * thing and a layout is what the player is trying to do. The P shortcut and
     * the Q5 access rule are unchanged — only how loudly it asks to be clicked.
     */
    this.plannerButton = document.createElement("button");
    this.plannerButton.type = "button";
    this.plannerButton.className = "btn btn--primary yard-toolbar__layout";
    this.plannerLabel = document.createElement("span");
    this.plannerLabel.className = "yard-toolbar__layout-label";
    this.plannerLabel.textContent = "Layout";
    this.plannerButton.append(layoutIcon(), this.plannerLabel);
    this.plannerButton.title = `Loading ${whose}…`;
    this.plannerButton.setAttribute("aria-label", `Layout. Loading ${whose}…`);
    this.plannerButton.setAttribute("aria-pressed", "false");
    this.plannerButton.disabled = true;
    this.plannerButton.addEventListener("click", () => this.togglePlanner());

    this.toolbar = document.createElement("div");
    this.toolbar.className = "yard-toolbar";
    this.toolbar.append(this.plannerButton);

    /*
     * The way into the build menu (§5.3), on the player's own yard only.
     * Disabled until the yard's store is up, because every tile reads it.
     */
    if (!this.target) {
      this.buildButton = document.createElement("button");
      this.buildButton.type = "button";
      this.buildButton.className = "btn btn--primary yard-toolbar__layout yard-toolbar__build";
      this.buildButton.textContent = "Build";
      this.buildButton.title = "Build something new";
      this.buildButton.setAttribute("aria-expanded", "false");
      this.buildButton.disabled = true;
      this.buildButton.addEventListener("click", () => this.toggleBuildMenu());
      this.toolbar.append(this.buildButton);
    }

    /*
     * A visit's way into the attack (§4.1). Omitted entirely, not disabled,
     * when the map's gate refused — the cell panel already said why, and a
     * greyed-out control with no reason attached is the worse version.
     * Disabled until the yard has loaded, so an attack cannot start against
     * a yard that failed to open.
     */
    if (this.target?.attack) {
      this.attackButton = document.createElement("button");
      this.attackButton.type = "button";
      this.attackButton.className = "btn btn--primary yard-toolbar__layout";
      this.attackButton.textContent = "Attack";
      this.attackButton.title = `Attack ${this.target.name}'s yard`;
      this.attackButton.disabled = true;
      this.attackButton.addEventListener("click", () => void this.startAttack());
      this.toolbar.append(this.attackButton);
    }
    /*
     * The readout is docked to the overlay and not to the toolbar.
     *
     * `.cell-readout` pins itself to the bottom-left *of its positioned
     * ancestor*, and the toolbar is one, so as a child of the toolbar it
     * became a 102 x 213 box sitting squarely on top of the very control
     * this task is about making visible. Out here it lands where the class
     * always meant it to: the bottom-left of the screen.
     */
    context.overlay.content.append(this.toolbar, this.status);
    this.inset = { top: this.toolbar.getBoundingClientRect().bottom, bottom: 0 };

    window.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    this.panelDock = document.createElement("div");
    this.panelDock.className = "map-dock map-dock--right";
    context.overlay.content.append(this.panelDock);

    await this.load();
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.dropStore();
    this.buildButton = null;
    this.planner?.destroy();
    this.planner = null;
    this.plannerButton = null;
    this.plannerLabel = null;
    this.attackButton = null;
    this.toolbar = null;
    this.input?.detach();
    this.input = null;
    this.camera?.detach();
    this.camera = null;

    this.minimap?.destroy();
    this.minimap = null;
    this.zoomControl?.destroy();
    this.zoomControl = null;
    this.viewTools?.remove();
    this.viewTools = null;

    this.panel?.close();
    this.panel = null;
    this.panelDock?.remove();
    this.panelDock = null;
    this.status?.remove();
    this.status = null;

    this.hud?.destroy();
    this.hud = null;
    this.notices.destroy();
    this.renderer.destroy();
    this.yard = null;
    this.context = null;
  }

  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.camera?.resize(width, height);
    if (this.yard) this.applyZoomLimits(width, height);
    // A different viewport is a different visible rectangle even when the
    // camera did not move.
    this.minimap?.markDirty();
  }

  update(deltaSeconds: number): void {
    const started = performance.now();
    const camera = this.camera;

    if (camera) {
      if (camera.dirty) {
        camera.dirty = false;
        this.renderer.root.scale.set(camera.zoom);
        this.renderer.root.position.set(
          -camera.position.x * camera.zoom,
          -camera.position.y * camera.zoom,
        );
        this.renderer.setZoom(camera.zoom);
        // The camera is the only thing that knows a wheel or a pinch happened;
        // it goes straight through `Camera`'s own listeners without passing
        // through this scene, so this is where the slider and the minimap find
        // out about it.
        this.zoomControl?.setZoom(camera.zoom);
        this.minimap?.markDirty();
      }

      const view = camera.visibleWorldRect();
      this.renderer.draw(
        {
          x: view.left,
          y: view.top,
          width: view.right - view.left,
          height: view.bottom - view.top,
        },
        deltaSeconds,
      );
    }

    // A no-op on every frame nothing moved; see YardMinimap's dirty flag.
    this.minimap?.draw();

    this.sinceUiTick += deltaSeconds;
    if (this.sinceUiTick >= UI_TICK_SECONDS) {
      this.sinceUiTick = 0;
      // Not while the planner is open: a flip rebuilds the sprites, which a
      // drag in progress holds. The jobs stay due and flip on the first tick
      // after it closes.
      if (!this.planner) this.store?.tick();
      this.panel?.tick(Date.now() / 1000);
      this.monsters?.tick();
      this.refreshStatus();
    }

    // Exponential moving average: one slow frame should show, not dominate.
    this.frameCostMs += (performance.now() - started - this.frameCostMs) * 0.1;
  }

  /* ── Loading ────────────────────────────────────────────────────────────── */

  /**
   * Switches between the isometric yard and the planner's blueprint.
   *
   * The two views are different worlds under one camera, so the camera is
   * re-bounded and its zoom floor recomputed, and the point that was in the
   * middle of the screen is carried across in yard units so the player is
   * looking at the same part of the yard afterwards.
   */
  private setView(view: YardView): void {
    const camera = this.camera;
    if (!camera) return;
    if (this.renderer.view === view) return;

    const middle = camera.screenToWorld({
      x: this.viewportWidth / 2,
      y: this.viewportHeight / 2,
    });
    const focus = this.renderer.worldToYard(middle.x, middle.y);

    this.renderer.setView(view);
    camera.setBounds(this.renderer.worldSize());
    this.applyZoomLimits(this.viewportWidth, this.viewportHeight);
    camera.centreOn(this.renderer.yardToWorld(focus.x, focus.y));
    camera.dirty = true;
    // A different world size and a different projection: everything the
    // minimap draws is in the other view's coordinates now.
    this.minimap?.markDirty();
  }

  private async load(): Promise<void> {
    const context = this.context;
    if (!context) return;

    const target = this.target;
    const whose = target ? `${target.name}'s yard` : "your yard";

    try {
      const response = await loadYardFor(target);
      // The scene may have been swapped out while the request was in flight.
      if (this.context !== context) return;

      // A visit is somebody else's yard: open grass and no plot edge, as the
      // Flash client drew it outside BUILD mode. The own yard keeps its edge,
      // and is held by a store from here on.
      const store = target ? null : this.startStore(response, context);
      const yard = store ? store.yard : readYard(response, { foreign: true });
      this.yard = yard;
      this.save = response;
      this.notices.clear("yard-load");

      // Q5's entry rule. The player's own main yard arrives in build mode and
      // is editable; a visit arrives in view mode and opens the planner, if
      // the yard holds one, to look at and never to change.
      this.access = plannerAccess(
        yard,
        target ? (target.kind === "wild" ? BaseMode.WORLD_MAP_VIEW : BaseMode.VIEW) : BaseMode.BUILD,
        target === null,
      );
      this.refreshPlannerButton();

      // Bars over running jobs are the own yard's alone (#139), on the
      // store's server-corrected clock.
      this.renderer.setJobClock(store ? () => store.now() : null);
      this.renderer.show(yard);
      // A visitor never sees another yard's traps (`BTRAP.as:33-43`, #66);
      // the player's own yard shows them, as build mode always did.
      if (target) concealTraps(this.renderer, yard);
      this.startCamera(yard, context);

      // A visit's response carries the defender's pool, not the player's, so
      // the HUD shows the visitor's own, as the map read it (#60), and never
      // somebody else's twigs as if they were the player's own.
      const pool = hudPoolFor(target, yard);
      if (pool) this.hud?.setResources(pool.resources, pool.credits);
      if (this.attackButton) this.attackButton.disabled = false;
      this.refreshBuildButton();
      // Once the yard is drawn, because the first answer may redraw it.
      store?.start();
    } catch (caught) {
      if (caught instanceof ApiError && caught.isAuthFailure) {
        context.goTo(SceneName.LOGIN);
        return;
      }
      this.notices.show(
        "yard-load",
        caught instanceof NetworkError
          ? `Could not reach the server to load ${whose}.`
          : caught instanceof ApiError && target
            ? `Could not load ${whose}: ${caught.message}`
            : `Could not load ${whose}.`,
        { level: "error", actionLabel: "Retry", onAction: () => void this.load() },
      );
      if (this.status) this.status.textContent = `${target ? "This" : "Your"} yard did not load.`;
    }
  }

  /**
   * Starts the attack from inside a visit (§F1 "Attacking from inside View
   * yard needs a second load").
   *
   * A view load minted no `attackid` and no session, so this is a genuine
   * second `/base/load`, now in attack mode. The yard already on screen stays
   * there while it resolves — there is no map screen in between — and the
   * response goes to the attack scene inside the target so it need not fetch
   * again. A refusal (protection, a truce, the defender online, range) comes
   * back as the server's own message and is shown here, with the yard intact.
   */
  private async startAttack(): Promise<void> {
    const attack = this.target?.attack;
    const context = this.context;
    const button = this.attackButton;
    if (!attack || !context || this.attacking) return;

    this.attacking = true;
    if (button) button.disabled = true;
    this.notices.show("attack", `Starting the attack on ${attack.name}…`, { level: "info" });

    try {
      const load = await loadAttack(attack.baseid, attack.kind, attack.roster);
      if (this.context !== context) return;
      setAttackTarget({ ...attack, load });
      context.goTo(SceneName.ATTACK);
    } catch (caught) {
      if (this.context !== context) return;
      if (caught instanceof ApiError && caught.isAuthFailure) {
        context.goTo(SceneName.LOGIN);
        return;
      }
      this.notices.show(
        "attack",
        caught instanceof NetworkError
          ? "Could not reach the server to start the attack."
          : caught instanceof Error
            ? `The attack could not start: ${caught.message}`
            : "The attack could not start.",
        { level: "error", timeoutMs: 8_000 },
      );
      this.attacking = false;
      if (button) button.disabled = false;
    }
  }

  /**
   * Puts the camera on the town hall, or on the middle of the plot when the
   * yard has none.
   *
   * The town hall is where a player's eye goes first and it is the one building
   * every yard is laid out around, so it is a better opening frame than the
   * geometric centre — which in a wide yard can be empty grass.
   */
  private startCamera(yard: Yard, context: SceneContext): void {
    const camera = new Camera({
      bounds: { width: yard.bounds.width, height: yard.bounds.height },
      maxZoom: MAX_ZOOM,
      minZoom: 0.05,
      zoom: OPENING_ZOOM,
    });
    camera.resize(this.viewportWidth, this.viewportHeight);
    this.applyZoomLimits(this.viewportWidth, this.viewportHeight, camera);
    this.renderer.setZoom(camera.zoom);

    const focus = yard.townHall
      ? { x: yard.townHall.centreX, y: yard.townHall.centreY }
      : { x: yard.bounds.width / 2, y: yard.bounds.height / 2 };
    camera.centreOn(focus);
    camera.dirty = true;

    camera.attach(context.canvas);
    this.camera = camera;

    this.input = new YardInput({
      camera,
      canvas: context.canvas,
      pick: (x, y) => this.renderer.pick(x, y),
      // Carrying a new building, the ghost is what the pointer is over.
      onHover: (building) => this.renderer.setHovered(this.placement ? null : building),
      onSelect: (building) => this.tap(building),
      // Not while carrying a new building: that click is a drop.
      pickMushroom: (x, y) =>
        this.mushroomPicker && !this.planner && !this.placement
          ? this.renderer.pickMushroom(x, y)
          : null,
      onMushroom: (mushroom) => {
        this.select(null);
        void this.mushroomPicker?.pick(mushroom);
      },
      onZoomStep: (direction) => this.zoomBy(Math.pow(ZOOM_STEP, direction)),
      onZoomReset: () => this.fitYard(),
      onCancel: () => this.select(null),
    });
    this.input.attach();

    this.startViewTools(camera, context);
  }

  /**
   * Builds the zoom slider and the minimap and docks them bottom-right.
   *
   * Both are created once the camera exists and destroyed with the scene; the
   * planner never owns them, it only marks the minimap dirty when it moves
   * something. That keeps the plan and the session free of any knowledge of
   * the DOM, which is the reason the planner reports through a callback rather
   * than being handed the canvas.
   */
  private startViewTools(camera: Camera, context: SceneContext): void {
    const tools = document.createElement("div");
    tools.className = "yard-viewtools";
    context.overlay.content.append(tools);
    this.viewTools = tools;

    this.zoomControl = new ZoomControl({
      onZoom: (zoom) =>
        camera.zoomAt(zoom, { x: this.viewportWidth / 2, y: this.viewportHeight / 2 }),
      onStep: (direction) => this.zoomBy(Math.pow(ZOOM_STEP, direction)),
      onFit: () => this.fitYard(),
    }).mount(tools);
    this.zoomControl.setRange(this.fitZoom, MAX_ZOOM);
    this.zoomControl.setZoom(camera.zoom);

    this.minimap = new YardMinimap({
      renderer: this.renderer,
      camera,
      onJump: (world) => {
        camera.centreOn(world);
        camera.dirty = true;
      },
    }).mount(tools);
    this.minimap.refreshBuildings();

    this.placeViewTools();
  }

  /**
   * Keeps the bottom-right furniture clear of whatever is along the bottom
   * edge: nothing in read-only mode, the planner's action bar when it is open.
   *
   * The same number `applyZoomLimits` keeps the fit floor out from under, so
   * the two cannot disagree about where the bottom of the canvas is.
   */
  private placeViewTools(): void {
    if (!this.viewTools) return;
    this.viewTools.style.bottom = `calc(${this.inset.bottom}px + var(--space-3))`;
  }

  /**
   * Sets the floor on zoom so the whole plot fits, and no further.
   *
   * Pulling back past the point where the yard fits shows nothing but the
   * surround, so the floor is the fit and `fitYard` is exactly `minZoom`.
   * Recomputed on resize because the fit depends on the viewport.
   */
  private applyZoomLimits(width: number, height: number, target = this.camera): void {
    const yard = this.yard;
    if (!yard || !target) return;

    const frame = this.renderer.fitRect();
    // The HUD, toolbar and (in planner mode) the two planner bars overlay the
    // canvas top and bottom, so the fit is against the band still visible
    // between them, not the whole canvas.
    const visibleHeight = Math.max(height - this.inset.top - this.inset.bottom, 1);
    const fit = Math.min(width / frame.width, visibleHeight / frame.height);
    this.fitZoom = Math.min(fit, MAX_ZOOM);
    // The camera enforces this floor itself, so wheel and pinch zoom (which go
    // straight through Camera's own listeners, not through this scene) respect
    // it too, not just the keyboard and toolbar paths that call back in here.
    target.setMinZoom(this.fitZoom);

    // The slider's left end *is* the fit floor, so it moves with it.
    this.zoomControl?.setRange(this.fitZoom, MAX_ZOOM);
    this.zoomControl?.setZoom(target.zoom);
  }

  private fitYard(): void {
    const camera = this.camera;
    const yard = this.yard;
    if (!camera || !yard) return;
    const frame = this.renderer.fitRect();
    camera.zoom = this.fitZoom;
    // Centre on the visible band, not the whole canvas: the same top/bottom
    // offset applied in applyZoomLimits, translated to a screen-space shift.
    const centreX = this.viewportWidth / 2;
    const centreY = this.viewportHeight / 2 + (this.inset.top - this.inset.bottom) / 2;
    camera.setPosition(
      frame.x + frame.width / 2 - centreX / camera.zoom,
      frame.y + frame.height / 2 - centreY / camera.zoom,
    );
    camera.dirty = true;
  }

  /**
   * Called by the planner (and, back to the default, when it closes) with how
   * much of the canvas its bars cover. Recomputes the fit against the new
   * band immediately, matching a viewport resize.
   */
  private setInset(inset: { top: number; bottom: number }): void {
    this.inset = inset;
    this.applyZoomLimits(this.viewportWidth, this.viewportHeight);
    this.placeViewTools();
  }

  private zoomBy(factor: number): void {
    const camera = this.camera;
    if (!camera) return;
    // The floor lives on the camera now (see applyZoomLimits), so this needs
    // no clamp of its own.
    camera.zoomBy(factor, { x: this.viewportWidth / 2, y: this.viewportHeight / 2 });
  }

  /* ── Selection ──────────────────────────────────────────────────────────── */

  /**
   * A tap on the yard. On the player's own yard a harvester with something
   * to bank banks it — one request, through the store's queue — as its panel
   * opens (design §5.1, decision D12), and the amount rises off the building
   * when the answer comes. Anything else is a plain selection.
   */
  private tap(building: YardBuilding | null): void {
    // Carrying a new building, a click is a drop, which the placement takes.
    if (this.placement) return;
    this.select(building);
    const store = this.store;
    const binding = this.binding;
    if (!building || !store || !binding || this.planner) return;
    const waiting = harvesterNow(building.raw, store.save, store.now());
    if (!waiting?.bankable || waiting.offer <= 0) return;

    void bankActions(store)
      .one(building.id)
      .then((result) => {
        if (this.binding !== binding) return;
        showBankResult(binding.notices, result);
        const amount = result.ok ? (result.report.byBuilding[String(building.id)]?.amount ?? 0) : 0;
        if (amount > 0) this.floatBanked(building.id, waiting.resource, amount);
      });
  }

  /** "+720" with the resource's icon, rising off a building and fading (`harvest.css`). */
  private floatBanked(id: number, resource: HarvestKey, amount: number): void {
    const camera = this.camera;
    const context = this.context;
    const building = this.yard?.buildings.find((one) => one.id === id);
    if (!camera || !context || !building) return;

    const screen = camera.worldToScreen({ x: building.centreX, y: building.centreY });
    const canvas = context.canvas.getBoundingClientRect();
    const float = resourceAmount(resource, `+${formatAmount(amount)}`, {
      className: "yard-bank-float",
      decorative: true,
    });
    float.setAttribute("aria-hidden", "true");
    float.style.left = `${Math.round(canvas.left + screen.x)}px`;
    float.style.top = `${Math.round(canvas.top + screen.y)}px`;
    document.body.append(float);
    const remove = (): void => float.remove();
    float.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, 2_000);
  }

  private select(building: YardBuilding | null): void {
    // In planner mode the selection belongs to the planner, which draws its own
    // chrome and has its own multi-selection; the read-only panel stays shut.
    if (this.planner) return;
    this.selected = building;
    this.renderer.setSelected(building);

    if (!building) {
      this.panel?.close();
      this.panel = null;
      this.monsters?.besidePanel(false);
      return;
    }

    // The panel docks where the build menu does.
    this.buildMenu?.close();

    if (!this.panel) {
      const dock = this.panelDock;
      if (!dock) return;
      this.panel = new BuildingPanel({
        ...(this.binding ? { yard: this.binding } : {}),
        // The Map Room's door: on the own yard only, where the map is the player's.
        ...(this.binding ? { openMap: () => this.context?.goTo(SceneName.MAP_ROOM_2) } : {}),
        onClose: () => {
          this.panel = null;
          this.selected = null;
          this.renderer.setSelected(null);
          this.monsters?.besidePanel(false);
        },
        // Clicking the Yard Planner should open the yard planner. The offer is
        // left out entirely when there is none to open, which is also the only
        // state in which that building cannot be on screen.
        ...(this.access === PlannerAccess.LOCKED
          ? {}
          : {
              planner: {
                label:
                  this.access === PlannerAccess.READ_ONLY
                    ? "View layout planner"
                    : "Open layout planner",
                title: plannerEntryTooltip(this.access),
                open: () => this.togglePlanner(),
              },
            }),
      }).mount(dock);
    }
    this.panel.show(building);
    this.monsters?.besidePanel(true);

    // A monster building opens its tab of the Monsters screen (D4), beside
    // the panel, which keeps the building's own upgrade.
    const tab = monstersTabFor(building.type);
    if (tab && this.binding) this.openMonsters(tab, { buildingId: building.id });
  }

  /**
   * Opens the Monsters screen on a tab (§4.1): the HUD's Monsters button, a
   * monster building's click and its panel's Open button come here. Own yard
   * only, and not over the planner.
   */
  private openMonsters(tab: MonstersTabId, focus: MonstersFocus = {}): void {
    const binding = this.binding;
    const context = this.context;
    if (!binding || !context || this.planner) return;
    this.buildMenu?.close();
    this.monsters ??= new MonstersScreen({ binding }).mount(context.overlay.content);
    this.monsters.besidePanel(this.panel !== null);
    this.monsters.open(tab, focus);
  }

  /* ── Build ──────────────────────────────────────────────────────────── */

  /**
   * The Build control: opens the menu, closes it, or puts down a building in
   * hand (§5.3). Own yard only, and not over the planner.
   */
  private toggleBuildMenu(): void {
    if (this.placement) {
      this.endPlacement();
      return;
    }
    if (this.buildMenu?.isOpen) {
      this.buildMenu.close();
      return;
    }
    const binding = this.binding;
    const context = this.context;
    if (!binding || !context || this.planner) return;

    // The menu docks where the building panel and the Monsters screen do.
    this.select(null);
    this.monsters?.close();
    this.buildMenu ??= new BuildMenu({
      binding,
      onPick: (type, instant) => this.startPlacement(type, instant),
      onClose: () => this.refreshBuildButton(),
    }).mount(context.overlay.content);
    this.buildMenu.open();
    this.refreshBuildButton();
  }

  /** Enabled on the own yard once it has loaded, and not over the planner. */
  private refreshBuildButton(): void {
    const button = this.buildButton;
    if (!button) return;
    const carrying = this.placement !== null;
    const open = carrying || this.buildMenu?.isOpen === true;
    button.disabled = !this.store || this.planner !== null;
    button.textContent = carrying ? "Stop building" : "Build";
    button.title = carrying ? "Put the building down without building it (Esc)" : "Build something new";
    button.setAttribute("aria-expanded", String(open));
  }

  /**
   * Starts carrying a new building of `type`, from a tile of the menu: the
   * menu closes, the building appears in the middle of the screen and follows
   * the pointer, and a click builds it (`BuildPlacement.ts`). A wall or trap
   * stays in hand after each block; anything else is done after one, and its
   * panel opens on the new building.
   */
  private startPlacement(type: number, instant: boolean): void {
    const store = this.store;
    const camera = this.camera;
    const context = this.context;
    if (!store || !camera || !context || this.planner) return;
    const offer = buildOffer(type, store);
    if (!offer) return;

    this.endPlacement();
    this.buildMenu?.close();
    this.select(null);

    const actions = buildActions(store);
    const repeat = buildsAtOnce(type) && !instant;
    let placed: number | null = null;

    const bar = new PlacementBar({
      type,
      instant,
      instantPrice: offer.instantPrice,
      cost: offer.cost,
      onCancel: () => this.endPlacement(),
    }).mount(context.overlay.content);
    this.placementBar = bar;

    const placement = new BuildPlacement({
      type,
      yard: store.yard,
      camera,
      canvas: context.canvas,
      layer: this.renderer.root,
      worldToYard: (x, y) => this.renderer.worldToYard(x, y),
      repeat,
      onSpot: (check) =>
        bar.setSpot(
          check?.problem ? spotSentence(check, (id) => placement.grid.nameOf(id)) : null,
        ),
      onDrop: async (x, y) => {
        const result = instant
          ? await actions.instant(type, x, y)
          : await actions.build(type, x, y);
        if (this.placement !== placement) return result.ok ? "placed" : "refused";
        if (!result.ok) {
          bar.setMessage(result.refusal.message, "bad");
          return "refused";
        }
        placed = result.report.id;
        bar.setMessage(repeat ? "Built. Click again for another." : null);
        return "placed";
      },
      onCancel: () => this.endPlacement(),
      onDone: () => {
        this.endPlacement();
        // The new building's panel: its countdown, Finish now and Cancel build.
        if (placed !== null) this.focusBuilding(placed);
      },
    });
    this.placement = placement;

    // In the middle of the view, so a touch screen has something to tap.
    const middle = camera.screenToWorld({
      x: this.viewportWidth / 2,
      y: this.viewportHeight / 2 + (this.inset.top - this.inset.bottom) / 2,
    });
    const point = this.renderer.worldToYard(middle.x, middle.y);
    const spot = placement.grid.spotAt(type, point.x, point.y);
    placement.moveTo(spot.x, spot.y);
    this.renderer.setHovered(null);
    this.refreshBuildButton();
  }

  /** Puts down whatever is in hand, without building it. */
  private endPlacement(): void {
    this.placement?.destroy();
    this.placement = null;
    this.placementBar?.destroy();
    this.placementBar = null;
    this.refreshBuildButton();
  }

  /* ── Planner ────────────────────────────────────────────────────────── */

  /**
   * Enters or leaves planner mode.
   *
   * The planner is a mode over the same scene, not a second screen: the yard
   * keeps its camera, its sprites and its art, and the planner moves them. That
   * is why entering is instant on a 575-building yard and why leaving cannot
   * leave anything half-drawn — the sprites go back to the save's positions.
   */
  private togglePlanner(): void {
    if (this.planner) {
      this.planner.requestExit();
      return;
    }

    // No Yard Planner in this yard, so there is no planner to open. Checked
    // here as well as on the button because the P key does not go through it.
    if (this.access === PlannerAccess.LOCKED) return;

    const yard = this.yard;
    const camera = this.camera;
    const context = this.context;
    const toolbar = this.toolbar;
    if (!yard || !camera || !context || !toolbar) return;

    this.select(null);
    this.monsters?.close();
    this.endPlacement();
    this.buildMenu?.close();
    this.planner = new YardPlanner({
      yard,
      renderer: this.renderer,
      camera,
      canvas: context.canvas,
      overlay: context.overlay.content,
      notices: this.notices,
      readOnlyToolbar: toolbar,
      readOnly: this.access === PlannerAccess.READ_ONLY,
      ...(this.save?.firedtraps ? { firedtraps: this.save.firedtraps } : {}),
      onApplied: (buildingdata, moved, resources, upgrades) =>
        this.onApplied(buildingdata, moved, resources, upgrades),
      onYardChanged: (buildingdata, resources) => this.onYardChanged(buildingdata, resources),
      onView: (view) => this.setView(view),
      onInset: (inset) => this.setInset(inset),
      // The plan moved something. The session stays ignorant of the DOM and
      // the minimap reads the positions back off the renderer itself; all this
      // carries is "look again".
      onPlanChanged: () => this.minimap?.markDirty(),
      // One word from the planner about what the pointer is over. The line it
      // lands on is this scene's, so this scene is what rewrites it.
      onHint: (note) => {
        this.hint = note;
        this.refreshStatus();
      },
      onExit: () => this.closePlanner(),
    });
    // The planner's constructor reports its own inset synchronously (via
    // `onInset` above), so `this.inset.top` is already the top bar's real
    // measured height here — that is what the notice dock tucks under
    // instead of the HUD, so it stops sitting partly behind the bar (#44).
    this.notices.setTopInset(this.inset.top);
    this.refreshPlannerButton();
  }

  /**
   * Rewrites the Layout control for the access rule and for whether the
   * planner is open.
   *
   * One place, because the label, the tooltip, the pressed state and the
   * disabled state all answer the same two questions, and they drifted apart
   * while they were being set from three.
   */
  private refreshPlannerButton(): void {
    const control = this.plannerButton;
    const label = this.plannerLabel;
    if (!control || !label) return;

    const open = this.planner !== null;
    const text = open
      ? "Close layout"
      : this.access === PlannerAccess.READ_ONLY
        ? "View layout"
        : "Layout";
    const title = open ? "Leave the layout planner (P)" : plannerEntryTooltip(this.access);

    label.textContent = text;
    control.disabled = this.access === PlannerAccess.LOCKED;
    control.title = title;
    // A disabled control's `title` is not announced by every screen reader, and
    // the whole point of the locked state is that it says what would unlock it.
    control.setAttribute("aria-label", text + ". " + title);
    control.setAttribute("aria-pressed", String(open));
    this.refreshBuildButton();
  }

  private closePlanner(): void {
    this.planner?.destroy();
    this.planner = null;
    if (this.refreshAfterPlanner) {
      this.refreshAfterPlanner = false;
      void this.store?.refresh();
    }
    // Back to the HUD's own band now the planner's bar is gone.
    this.notices.setTopInset(null);
    // Leaving puts every sprite back where the save had it, which the minimap
    // has to be told about even when the view does not change.
    this.minimap?.markDirty();
    // The blueprint is a planner view; the yard itself is always isometric.
    this.setView(YardView.ISO);
    this.refreshPlannerButton();
  }

  /**
   * Rebuilds the yard from the `buildingdata` the apply wrote.
   *
   * The response is authoritative — it is the save as the server now holds it —
   * so the honest thing is to re-read it rather than to assume the client's own
   * plan and the server's answer agree. It goes through the store, whose
   * change redraws the yard and which fetches the full state after it.
   */
  private onApplied(
    buildingdata: BuildingDataMap,
    moved: number,
    resources: Resources | undefined,
    upgrades: UpgradeReport | null,
  ): void {
    const store = this.store;
    if (!store || !this.context) return;

    this.closePlanner();

    // The pool comes back charged whenever Apply started anything, so it is
    // taken from the response rather than subtracted here: the server owns
    // what an upgrade cost, and the walk it ran is partial by design
    // (`docs/design/planner-upgrades.md` §5.5).
    store.mergeWrite({ buildingdata, ...(resources ? { resources } : {}) });

    // Raised here rather than by the planner because the planner has just been
    // closed and clears its own notices on the way out (§8, Q4).
    const moveText = `Moved ${moved} building${moved === 1 ? "" : "s"}.`;
    this.notices.show(
      "yard-applied",
      upgrades ? `${moveText} ${describeUpgradeReport(upgrades)}` : moveText,
      { level: "info", timeoutMs: upgrades ? 12_000 : 5_000 },
    );
  }

  /**
   * Rebuilds the yard after a batch action, with the planner left open.
   *
   * This is the other half of `onApplied` and it differs in exactly one way
   * that matters: the planner stays up. A wall upgrade or a trap re-arm is
   * something a player does *during* a layout, so closing the planner would
   * throw away the arrangement in progress and the undo stack with it. The
   * plan is brought up to date instead, through `rebase`.
   *
   * `renderer.show` rebuilds the blueprint layer as well as the isometric one
   * and re-activates whichever view is current (`YardRenderer.show`), so the
   * flat view survives the rebuild; `rebase` then puts every sprite back where
   * the plan has it rather than where the save does.
   */
  private onYardChanged(buildingdata: BuildingDataMap, resources: Resources): void {
    // The store's change does the rebuild and the `rebase` (`onStoreChange`).
    this.store?.mergeWrite({ buildingdata, resources });
  }

  /* ── The store ──────────────────────────────────────────────────────── */

  /**
   * Creates the own yard's store over the load response, and the binding the
   * panel and the HUD are handed. Not started here: `load` starts it once the
   * yard is on screen.
   */
  private startStore(response: BaseLoadResponse, context: SceneContext): YardStore {
    this.dropStore();
    const store = new YardStore({
      save: response,
      // What this load, or the map's load before it, finished while the
      // player was away (#135); the store announces it once it starts.
      away: takeAwayJobs(),
      onAuthFailure: () => {
        if (this.context === context) context.goTo(SceneName.LOGIN);
      },
    });
    this.store = store;
    this.unsubscribeStore = store.subscribe((change) => this.onStoreChange(change));
    this.binding = {
      store,
      scene: {
        selectBuilding: (id) => this.focusBuilding(id),
        openMonsters: (tab, focus) => this.openMonsters(tab, focus),
      },
      notices: this.notices,
    };
    this.hud?.bindYard(this.binding);
    this.mushroomPicker = new MushroomPicker(store, this.mushroomView(context));
    return store;
  }

  /** What a mushroom pick draws through: the renderer's shake, the notices, the popup. */
  private mushroomView(context: SceneContext): MushroomPickView {
    return {
      shake: (spot) => this.renderer.shakeMushroom(spot, true),
      stop: (spot) => this.renderer.shakeMushroom(spot, false),
      golden: (shiny) => void showGoldenMushroom(context.overlay.modal, shiny),
      ordinary: (quip) => this.notices.show("mushroom", quip, { level: "info", timeoutMs: 4000 }),
      refused: (message) =>
        this.notices.show("mushroom", message, { level: "error", timeoutMs: 5000 }),
    };
  }

  private dropStore(): void {
    this.mushroomPicker = null;
    // The menu and the placement read the store they were made with.
    this.endPlacement();
    this.buildMenu?.destroy();
    this.buildMenu = null;
    this.monsters?.destroy();
    this.monsters = null;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.store?.destroy();
    this.store = null;
    this.binding = null;
    this.hud?.bindYard(null);
  }

  /**
   * Redraws the yard from the store: the sprites, the minimap, the HUD's pool,
   * the planner's base when it is open, and the open panel, re-pointed at the
   * same building in the new yard.
   *
   * `pending` only says which requests are running, which is the panel's and
   * the HUD's business through their own subscriptions, and `away` is the
   * HUD's notice about a yard already drawn; nothing here changes.
   */
  private onStoreChange(change: YardChange): void {
    const store = this.store;
    if (!store || !this.camera) return;
    if (change.reason === YardChangeReason.PENDING || change.reason === YardChangeReason.AWAY) return;

    const yard = store.yard;
    this.yard = yard;
    this.save = store.save;
    this.renderer.show(yard);
    this.minimap?.refreshBuildings();
    this.hud?.setResources(store.resources, store.credits);
    this.planner?.rebase(yard);
    this.placement?.rebase(yard);

    // `show` drops the selection with the old sprites; put it back.
    const selected = this.selected;
    if (selected && !this.planner) {
      const same = yard.buildings.find((one) => one.id === selected.id) ?? null;
      if (same) {
        this.selected = same;
        this.renderer.setSelected(same);
        this.panel?.show(same);
      } else {
        this.select(null);
      }
    }
  }

  /** Pans the camera to a building and opens its panel (the binding's `selectBuilding`). */
  private focusBuilding(id: number): void {
    const camera = this.camera;
    const building = this.yard?.buildings.find((one) => one.id === id) ?? null;
    if (!camera || !building || this.planner) return;
    camera.centreOn({ x: building.centreX, y: building.centreY });
    camera.dirty = true;
    this.select(building);
  }

  /**
   * The tab is visible again: ask the server what happened while it was not
   * (§2.4). Held while the planner is open, whose sprites a redraw would pull
   * out from under a drag, and sent when it closes.
   */
  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible" || !this.store) return;
    if (this.planner) {
      this.refreshAfterPlanner = true;
      return;
    }
    void this.store.refresh();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== "p" && event.key !== "P") return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    this.togglePlanner();
  };

  private refreshStatus(): void {
    const status = this.status;
    const yard = this.yard;
    if (!status || !yard) return;

    const waiting = this.renderer.placeholderCount;
    // A visitor is not told how many traps the yard hides (#66), so a visit
    // counts as the attack does, traps left out (#72).
    const buildings = this.target
      ? countedBuildings(yard.buildings.map((building) => building.type))
      : yard.buildings.length;
    status.textContent =
      (this.target ? `${this.target.name}'s yard, read-only · ` : "") +
      `${buildings} buildings · ${yard.mushrooms.length} mushrooms · ` +
      `plot ${yard.bounds.yardWidth} x ${yard.bounds.yardHeight} (expansion ${yard.expansionLevel}) · ` +
      `${this.frameCostMs.toFixed(1)} ms/frame` +
      (waiting > 0 ? ` · ${waiting} awaiting art` : "") +
      (this.selected ? ` · selected #${this.selected.id}` : "") +
      (this.hint ? ` · ${this.hint}` : "");
  }
}
