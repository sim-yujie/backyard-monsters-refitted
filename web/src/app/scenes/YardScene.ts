import { logout } from "@/api/auth";
import { loadOwnYard } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import {
  BaseMode,
  type BaseLoadResponse,
  type BuildingDataMap,
  type Resources,
  type UpgradeReport,
} from "@/api/types";
import { Camera } from "@/game/Camera";
import {
  PlannerAccess,
  plannerAccess,
  plannerEntryTooltip,
} from "@/game/yard/planner/access";
import { readYard, type Yard, type YardBuilding } from "@/game/yard/yardModel";
import { YardRenderer, YardView } from "@/game/yard/YardRenderer";
import { YardInput } from "@/game/yard/YardInput";
import { Hud } from "@/ui/Hud";
import { Notices } from "@/ui/maproom/Notices";
import { BuildingPanel } from "@/ui/yard/BuildingPanel";
import { describeUpgradeReport } from "@/ui/yard/upgradeText";
import { YardMinimap } from "@/ui/yard/YardMinimap";
import { ZoomControl } from "@/ui/yard/ZoomControl";
import { YardPlanner } from "./YardPlanner";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";

/**
 * The player's own yard, read-only.
 *
 * Wiring only, the same division as Map Room 2: the camera owns the view, the
 * renderer owns the scene graph and the panel owns the DOM. What lives here is
 * the load, the failure paths and the once-a-second tick that keeps the
 * countdowns honest.
 *
 * The yard is one request and then static, so there is no refresh clock and no
 * request budget — the two things that make the map scene complicated are both
 * absent.
 */

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

  private yard: Yard | null = null;
  /** The save the yard was built from, so an apply can rebuild it in place. */
  private save: BaseLoadResponse | null = null;
  private planner: YardPlanner | null = null;
  private plannerButton: HTMLButtonElement | null = null;
  /**
   * What the player may do with the planner in the yard now open (§8, Q5).
   *
   * Locked until the yard has loaded, because the rule is read off the
   * buildings and there are none to read before then.
   */
  private access: PlannerAccess = PlannerAccess.LOCKED;
  private toolbar: HTMLElement | null = null;
  private selected: YardBuilding | null = null;
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

    this.status = document.createElement("div");
    this.status.className = "cell-readout";
    this.status.textContent = "Loading your yard…";

    // Entry is a toolbar button, not the Yard Planner building's popup
    // (design §8, Q5).
    this.plannerButton = document.createElement("button");
    this.plannerButton.type = "button";
    this.plannerButton.className = "btn btn--ghost yard-toolbar__plan";
    this.plannerButton.textContent = "Plan";
    this.plannerButton.title = "Loading your yard…";
    this.plannerButton.disabled = true;
    this.plannerButton.addEventListener("click", () => this.togglePlanner());

    this.toolbar = document.createElement("div");
    this.toolbar.className = "yard-toolbar";
    this.toolbar.append(this.plannerButton, this.status);
    context.overlay.content.append(this.toolbar);
    this.inset = { top: this.toolbar.getBoundingClientRect().bottom, bottom: 0 };

    window.addEventListener("keydown", this.onKeyDown);

    this.panelDock = document.createElement("div");
    this.panelDock.className = "map-dock map-dock--right";
    context.overlay.content.append(this.panelDock);

    await this.load();
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.planner?.destroy();
    this.planner = null;
    this.plannerButton = null;
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
      this.panel?.tick(Date.now() / 1000);
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

    try {
      const response = await loadOwnYard();
      // The scene may have been swapped out while the request was in flight.
      if (this.context !== context) return;

      const yard = readYard(response);
      this.yard = yard;
      this.save = response;
      this.notices.clear("yard-load");

      // Q5's entry rule. This scene always asks for the player's own main yard
      // in build mode (`loadOwnYard`), so today the only answer that varies is
      // whether the yard holds a Yard Planner at all; the other two arguments
      // are here so a visit flow only has to change what it passes.
      this.access = plannerAccess(yard, BaseMode.BUILD, true);
      if (this.plannerButton) {
        this.plannerButton.disabled = this.access === PlannerAccess.LOCKED;
        this.plannerButton.title = plannerEntryTooltip(this.access);
      }

      this.renderer.show(yard);
      this.startCamera(yard, context);

      this.hud?.setResources(yard.resources, yard.credits);
    } catch (caught) {
      if (caught instanceof ApiError && caught.isAuthFailure) {
        context.goTo(SceneName.LOGIN);
        return;
      }
      this.notices.show(
        "yard-load",
        caught instanceof NetworkError
          ? "Could not reach the server to load your yard."
          : "Could not load your yard.",
        { level: "error", actionLabel: "Retry", onAction: () => void this.load() },
      );
      if (this.status) this.status.textContent = "Your yard did not load.";
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
      onHover: (building) => this.renderer.setHovered(building),
      onSelect: (building) => this.select(building),
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

  private select(building: YardBuilding | null): void {
    // In planner mode the selection belongs to the planner, which draws its own
    // chrome and has its own multi-selection; the read-only panel stays shut.
    if (this.planner) return;
    this.selected = building;
    this.renderer.setSelected(building);

    if (!building) {
      this.panel?.close();
      this.panel = null;
      return;
    }

    if (!this.panel) {
      const dock = this.panelDock;
      if (!dock) return;
      this.panel = new BuildingPanel({
        onClose: () => {
          this.panel = null;
          this.selected = null;
          this.renderer.setSelected(null);
        },
      }).mount(dock);
    }
    this.panel.show(building);
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
      onExit: () => this.closePlanner(),
    });
    if (this.plannerButton) {
      this.plannerButton.setAttribute("aria-pressed", "true");
      this.plannerButton.textContent = "Close plan";
    }
  }

  private closePlanner(): void {
    this.planner?.destroy();
    this.planner = null;
    // Leaving puts every sprite back where the save had it, which the minimap
    // has to be told about even when the view does not change.
    this.minimap?.markDirty();
    // The blueprint is a planner view; the yard itself is always isometric.
    this.setView(YardView.ISO);
    this.plannerButton?.setAttribute("aria-pressed", "false");
    if (this.plannerButton) this.plannerButton.textContent = "Plan";
  }

  /**
   * Rebuilds the yard from the `buildingdata` the apply wrote.
   *
   * The response is authoritative — it is the save as the server now holds it —
   * so the honest thing is to re-read it rather than to assume the client's own
   * plan and the server's answer agree.
   */
  private onApplied(
    buildingdata: BuildingDataMap,
    moved: number,
    resources: Resources | undefined,
    upgrades: UpgradeReport | null,
  ): void {
    const save = this.save;
    const context = this.context;
    if (!save || !context) return;

    this.closePlanner();

    // The pool comes back charged whenever Apply started anything, so it is
    // taken from the response rather than subtracted here: the server owns
    // what an upgrade cost, and the walk it ran is partial by design
    // (`docs/design/planner-upgrades.md` §5.5).
    const merged: BaseLoadResponse = {
      ...save,
      buildingdata,
      ...(resources ? { resources } : {}),
    };
    this.save = merged;
    const yard = readYard(merged);
    this.yard = yard;
    this.renderer.show(yard);
    this.minimap?.refreshBuildings();
    if (resources) this.hud?.setResources(yard.resources, yard.credits);

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
    const save = this.save;
    if (!save) return;

    const merged: BaseLoadResponse = { ...save, buildingdata, resources };
    this.save = merged;
    const yard = readYard(merged);
    this.yard = yard;
    this.renderer.show(yard);
    this.minimap?.refreshBuildings();
    this.hud?.setResources(yard.resources, yard.credits);
    this.planner?.rebase(yard);
  }

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
    status.textContent =
      `${yard.buildings.length} buildings · ${yard.mushrooms.length} mushrooms · ` +
      `plot ${yard.bounds.yardWidth} x ${yard.bounds.yardHeight} (expansion ${yard.expansionLevel}) · ` +
      `${this.frameCostMs.toFixed(1)} ms/frame` +
      (waiting > 0 ? ` · ${waiting} awaiting art` : "") +
      (this.selected ? ` · selected #${this.selected.id}` : "");
  }
}
