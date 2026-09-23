import { logout } from "@/api/auth";
import { loadOwnYard } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse, BuildingDataMap } from "@/api/types";
import { Camera } from "@/game/Camera";
import { readYard, type Yard, type YardBuilding } from "@/game/yard/yardModel";
import { YardRenderer, YardView } from "@/game/yard/YardRenderer";
import { YardInput } from "@/game/yard/YardInput";
import { Hud } from "@/ui/Hud";
import { Notices } from "@/ui/maproom/Notices";
import { BuildingPanel } from "@/ui/yard/BuildingPanel";
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

export class YardScene implements Scene {
  private readonly renderer = new YardRenderer();
  private readonly notices = new Notices();

  private camera: Camera | null = null;
  private context: SceneContext | null = null;
  private hud: Hud | null = null;
  private input: YardInput | null = null;
  private panel: BuildingPanel | null = null;
  private panelDock: HTMLElement | null = null;

  private yard: Yard | null = null;
  /** The save the yard was built from, so an apply can rebuild it in place. */
  private save: BaseLoadResponse | null = null;
  private planner: YardPlanner | null = null;
  private plannerButton: HTMLButtonElement | null = null;
  private selected: YardBuilding | null = null;
  private sinceUiTick = 0;
  /** The zoom at which the whole plot fits the viewport; also the floor. */
  private fitZoom = 0.05;
  /** Rolling average of the scene's own per-frame cost, in milliseconds. */
  private frameCostMs = 0;
  private status: HTMLElement | null = null;

  async enter(context: SceneContext): Promise<void> {
    this.context = context;
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
    this.plannerButton.title = "Open the Yard Planner (P)";
    this.plannerButton.disabled = true;
    this.plannerButton.addEventListener("click", () => this.togglePlanner());

    const toolbar = document.createElement("div");
    toolbar.className = "yard-toolbar";
    toolbar.append(this.plannerButton, this.status);
    context.overlay.content.append(toolbar);

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
    this.input?.detach();
    this.input = null;
    this.camera?.detach();
    this.camera = null;

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
    this.camera?.resize(width, height);
    if (this.yard) this.applyZoomLimits(width, height);
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
    const context = this.context;
    if (!camera || !context) return;
    if (this.renderer.view === view) return;

    const middle = camera.screenToWorld({ x: context.width / 2, y: context.height / 2 });
    const focus = this.renderer.worldToYard(middle.x, middle.y);

    this.renderer.setView(view);
    camera.setBounds(this.renderer.worldSize());
    this.applyZoomLimits(context.width, context.height);
    camera.centreOn(this.renderer.yardToWorld(focus.x, focus.y));
    camera.dirty = true;
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
      if (this.plannerButton) this.plannerButton.disabled = false;

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
    camera.resize(context.width, context.height);
    this.applyZoomLimits(context.width, context.height, camera);
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
      onZoomStep: (direction) => this.zoomBy(Math.pow(1.5, direction)),
      onZoomReset: () => this.fitYard(),
      onCancel: () => this.select(null),
    });
    this.input.attach();
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
    const fit = Math.min(width / frame.width, height / frame.height);
    this.fitZoom = Math.min(fit, MAX_ZOOM);
    // The camera enforces this floor itself, so wheel and pinch zoom (which go
    // straight through Camera's own listeners, not through this scene) respect
    // it too, not just the keyboard and toolbar paths that call back in here.
    target.setMinZoom(this.fitZoom);
  }

  private fitYard(): void {
    const camera = this.camera;
    const yard = this.yard;
    const context = this.context;
    if (!camera || !yard || !context) return;
    const frame = this.renderer.fitRect();
    camera.zoom = this.fitZoom;
    camera.centreOn({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });
    camera.dirty = true;
  }

  private zoomBy(factor: number): void {
    const camera = this.camera;
    const context = this.context;
    if (!camera || !context) return;
    // The floor lives on the camera now (see applyZoomLimits), so this needs
    // no clamp of its own.
    camera.zoomBy(factor, { x: context.width / 2, y: context.height / 2 });
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

    const yard = this.yard;
    const camera = this.camera;
    const context = this.context;
    if (!yard || !camera || !context) return;

    this.select(null);
    this.planner = new YardPlanner({
      yard,
      renderer: this.renderer,
      camera,
      canvas: context.canvas,
      overlay: context.overlay.content,
      notices: this.notices,
      onApplied: (buildingdata, moved) => this.onApplied(buildingdata, moved),
      onView: (view) => this.setView(view),
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
  private onApplied(buildingdata: BuildingDataMap, moved: number): void {
    const save = this.save;
    const context = this.context;
    if (!save || !context) return;

    this.closePlanner();

    const merged: BaseLoadResponse = { ...save, buildingdata };
    this.save = merged;
    const yard = readYard(merged);
    this.yard = yard;
    this.renderer.show(yard);
    this.notices.show("yard-applied", `Moved ${moved} building${moved === 1 ? "" : "s"}.`, {
      level: "info",
      timeoutMs: 5000,
    });
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
