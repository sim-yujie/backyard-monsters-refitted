import { Container } from "pixi.js";
import { logout } from "@/api/auth";
import { loadAttack } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import { AttackSession, type AttackSessionState } from "@/game/attack/AttackSession";
import { consumeAttackTarget, type AttackTarget } from "@/game/attack/attackTarget";
import { Camera } from "@/game/Camera";
import { readYard, type Yard, type YardBuilding } from "@/game/yard/yardModel";
import { YardRenderer } from "@/game/yard/YardRenderer";
import { YardInput } from "@/game/yard/YardInput";
import { formatAmount } from "@/ui/format";
import { Hud } from "@/ui/Hud";
import { Notices } from "@/ui/maproom/Notices";
import type { Panel } from "@/ui/Panel";
import { BuildingPanel } from "@/ui/yard/BuildingPanel";
import { confirmPanel } from "@/ui/yard/PlannerDialogs";
import { YardMinimap } from "@/ui/yard/YardMinimap";
import { ZoomControl } from "@/ui/ZoomControl";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";

/**
 * The attack: an enemy yard, a clock, and the slots the rest of the flow
 * mounts into (`docs/design/attack-flow.md` §4.2, §4.3, §6 WP2).
 *
 * The yard is drawn by the same `YardRenderer` the yard scene uses, from the
 * same `readYard()` model, and the camera, zoom slider and minimap are wired
 * the same way — the enemy yard is a yard. What is new is the
 * {@link AttackSession} the scene drives once a frame, the strip under the
 * HUD that reads it (countdown, damage, loot, speed, Retreat), and the
 * {@link AttackMounts} handed to every plugin: the docked panel slot the army
 * panel and the pickers (WP3, WP4) mount into, the world-space container the
 * battle layer (WP5) draws into, and the modal layer the end panel (WP6) opens
 * on. No tower range is drawn over the enemy yard (§F1, decided).
 *
 * On a phone (§4.3) the HUD gives way to the strip alone and the dock becomes a
 * bottom sheet with a handle; the sheet reports its height so the fit-to-plot
 * zoom leaves room for it, the way the planner's bars report theirs.
 */

/** Everything a package mounted on the attack scene can reach. */
export interface AttackMounts {
  readonly session: AttackSession;
  readonly target: AttackTarget;
  readonly yard: Yard;
  readonly renderer: YardRenderer;
  readonly camera: Camera;
  readonly canvas: HTMLCanvasElement;
  /**
   * The docked panel slot: right column on desktop, bottom sheet on a phone.
   * The army panel, the catapult and siege pickers mount here (`Panel.mount`).
   */
  readonly dock: HTMLElement;
  /** A spare slot on the HUD strip, between the readouts and Retreat. */
  readonly hudSlot: HTMLElement;
  /** The overlay's modal layer, for the end-of-attack panel. */
  readonly modal: HTMLElement;
  /**
   * World-space container above the enemy yard's buildings, under the same
   * camera transform. Yard units go through `renderer.yardToWorld`.
   */
  readonly battleLayer: Container;
  readonly notices: Notices;
  /** Leaves for the map. */
  readonly goToMap: () => void;
  /**
   * How much of the canvas, in CSS px from the bottom edge, the dock covers.
   * The bottom sheet reports through this so the fit zoom stays honest.
   */
  readonly setBottomInset: (px: number) => void;
}

/** A package mounted on the scene; may return its teardown. */
export type AttackPlugin = (mounts: AttackMounts) => (() => void) | void;

/**
 * What mounts on every attack. Later packages add themselves here — the army
 * panel, the pickers, the battle layer, the end panel — in the order they
 * should mount.
 */
export const ATTACK_PLUGINS: AttackPlugin[] = [];

/** How often the strip is refreshed between session notifications. */
const UI_TICK_SECONDS = 0.25;

/** Zoom the attack opens at, over the town hall. 1 is art at native size. */
const OPENING_ZOOM = 0.9;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 1.5;

/** Below this many seconds the countdown reads as a warning (§F7). */
const WARNING_SECONDS = 60;

/** Viewport width at or below which the dock is a bottom sheet (§4.3). */
const PHONE_WIDTH = 620;

/** `m:ss`, the countdown's spelling. */
export const formatClock = (seconds: number): string => {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
};

/** One line for the interim end display; WP6's panel replaces it. */
export const describeEnd = (state: AttackSessionState): string => {
  switch (state.endReason) {
    case "destroyed":
      return "Attack over: the yard is destroyed.";
    case "exhausted":
      return "Attack over: nothing left to send.";
    case "expired":
      return "Attack over: time ran out.";
    case "retreat":
      return "Attack over: retreat.";
    default:
      return "";
  }
};

export class AttackScene implements Scene {
  private readonly renderer = new YardRenderer();
  private readonly notices = new Notices();
  private readonly battleLayer = new Container();
  private readonly plugins: readonly AttackPlugin[];

  private context: SceneContext | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private camera: Camera | null = null;
  private hud: Hud | null = null;
  private input: YardInput | null = null;
  private session: AttackSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private target: AttackTarget | null = null;
  private yard: Yard | null = null;

  private strip: HTMLElement | null = null;
  private clock: HTMLElement | null = null;
  private damage: HTMLElement | null = null;
  private loot: HTMLElement | null = null;
  private hudSlot: HTMLElement | null = null;
  private speedButtons = new Map<1 | 2, HTMLButtonElement>();
  private retreatButton: HTMLButtonElement | null = null;
  private confirm: Panel | null = null;

  private dock: HTMLElement | null = null;
  private dockBody: HTMLElement | null = null;
  private dockHandle: HTMLButtonElement | null = null;
  private dockOpen = false;
  private endNote: HTMLElement | null = null;
  private panel: BuildingPanel | null = null;
  private selected: YardBuilding | null = null;
  private status: HTMLElement | null = null;

  private viewTools: HTMLElement | null = null;
  private zoomControl: ZoomControl | null = null;
  private minimap: YardMinimap | null = null;
  private teardowns: Array<() => void> = [];

  private sinceUiTick = 0;
  private fitZoom = 0.05;
  private inset = { top: 0, bottom: 0 };

  constructor(plugins: readonly AttackPlugin[] = ATTACK_PLUGINS) {
    this.plugins = plugins;
    this.battleLayer.eventMode = "none";
  }

  async enter(context: SceneContext): Promise<void> {
    this.context = context;
    this.viewportWidth = context.width;
    this.viewportHeight = context.height;
    this.target = consumeAttackTarget();

    context.stage.addChild(this.renderer.root);
    this.renderer.attach(context.renderer);
    this.renderer.root.addChild(this.battleLayer);

    this.hud = new Hud({
      scenes: [
        { id: SceneName.MAP_ROOM_2, label: "Map" },
        { id: SceneName.YARD, label: "Yard" },
        { id: SceneName.LOGIN, label: "Account" },
      ],
      onSceneSelect: (id) => this.leaveFor(id),
      onSignOut: () => {
        logout();
        context.goTo(SceneName.LOGIN);
      },
    });
    this.hud.element.classList.add("hud--attack");
    this.hud.mount(context.overlay.content);
    this.buildStrip(context);
    this.notices.mount(context.overlay.content);
    this.notices.setTopInset(this.inset.top);

    this.status = document.createElement("div");
    this.status.className = "cell-readout attack-status";
    context.overlay.content.append(this.status);

    this.buildDock(context);

    const target = this.target;
    if (!target) {
      this.status.textContent = "No target was chosen.";
      this.notices.show("attack-load", "Pick a cell on the map and press Attack.", {
        level: "info",
        actionLabel: "Back to the map",
        onAction: () => context.goTo(SceneName.MAP_ROOM_2),
      });
      return;
    }

    this.status.textContent = `Loading ${target.name}'s yard…`;
    await this.load(target, context);
  }

  exit(): void {
    for (const teardown of this.teardowns.splice(0)) teardown();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.confirm?.close();
    this.confirm = null;
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
    this.dock?.remove();
    this.dock = null;
    this.dockBody = null;
    this.dockHandle = null;
    this.endNote = null;
    this.strip?.remove();
    this.strip = null;
    this.clock = null;
    this.damage = null;
    this.loot = null;
    this.hudSlot = null;
    this.speedButtons.clear();
    this.retreatButton = null;
    this.status?.remove();
    this.status = null;
    this.hud?.destroy();
    this.hud = null;
    this.notices.destroy();
    this.battleLayer.removeChildren();
    this.renderer.destroy();
    this.session = null;
    this.yard = null;
    this.target = null;
    this.context = null;
  }

  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.camera?.resize(width, height);
    if (this.yard) this.applyZoomLimits(width, height);
    this.measureDock();
    this.minimap?.markDirty();
  }

  update(deltaSeconds: number): void {
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
    this.minimap?.draw();

    // The clock runs in battle time; the session rate-limits what listeners hear.
    this.session?.advance(deltaSeconds);

    this.sinceUiTick += deltaSeconds;
    if (this.sinceUiTick >= UI_TICK_SECONDS) {
      this.sinceUiTick = 0;
      if (this.session) this.refreshStrip(this.session.state());
      this.panel?.tick(Date.now() / 1000);
    }
  }

  /* ── Loading ────────────────────────────────────────────────────────── */

  private async load(target: AttackTarget, context: SceneContext): Promise<void> {
    let response: BaseLoadResponse;
    try {
      response = target.load ?? (await loadAttack(target.baseid, target.kind, target.roster));
      if (this.context !== context) return;
    } catch (caught) {
      if (this.context !== context) return;
      if (caught instanceof ApiError && caught.isAuthFailure) {
        context.goTo(SceneName.LOGIN);
        return;
      }
      this.notices.show(
        "attack-load",
        caught instanceof NetworkError
          ? "Could not reach the server to start the attack."
          : caught instanceof Error
            ? `The attack could not start: ${caught.message}`
            : "The attack could not start.",
        { level: "error", actionLabel: "Back to the map", onAction: () => context.goTo(SceneName.MAP_ROOM_2) },
      );
      if (this.status) this.status.textContent = "The attack did not start.";
      return;
    }

    const yard = readYard(response);
    this.yard = yard;
    this.renderer.show(yard);
    this.startCamera(yard, context);

    const session = new AttackSession({ target: { ...target, load: response } });
    this.session = session;
    this.unsubscribe = session.subscribe((state) => this.onSessionChange(state));
    this.refreshStrip(session.state());
    this.refreshStatus(session.state());

    this.mountPlugins(session, target, yard, context);
    session.start();
  }

  private mountPlugins(
    session: AttackSession,
    target: AttackTarget,
    yard: Yard,
    context: SceneContext,
  ): void {
    const camera = this.camera;
    const dock = this.dockBody;
    const hudSlot = this.hudSlot;
    if (!camera || !dock || !hudSlot) return;
    const mounts: AttackMounts = {
      session,
      target,
      yard,
      renderer: this.renderer,
      camera,
      canvas: context.canvas,
      dock,
      hudSlot,
      modal: context.overlay.modal,
      battleLayer: this.battleLayer,
      notices: this.notices,
      goToMap: () => context.goTo(SceneName.MAP_ROOM_2),
      setBottomInset: (px) => this.setInset({ ...this.inset, bottom: px }),
    };
    for (const plugin of this.plugins) {
      const teardown = plugin(mounts);
      if (teardown) this.teardowns.push(teardown);
    }
    this.measureDock();
  }

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

    const tools = document.createElement("div");
    tools.className = "yard-viewtools attack-viewtools";
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

  /* ── Chrome ─────────────────────────────────────────────────────────── */

  private buildStrip(context: SceneContext): void {
    const strip = document.createElement("div");
    strip.className = "attack-strip";

    const title = document.createElement("span");
    title.className = "attack-strip__title";
    title.textContent = this.target ? `Attacking ${this.target.name}` : "Attack";

    const clock = document.createElement("span");
    clock.className = "attack-strip__clock";
    clock.setAttribute("role", "timer");
    clock.setAttribute("aria-live", "off");
    clock.textContent = "—:——";

    const damage = document.createElement("span");
    damage.className = "attack-strip__readout";
    damage.textContent = "0% damage";

    const loot = document.createElement("span");
    loot.className = "attack-strip__readout attack-strip__loot";
    loot.textContent = "Loot 0 · 0 · 0 · 0";

    const spacer = document.createElement("span");
    spacer.className = "attack-strip__spacer";

    const hudSlot = document.createElement("span");
    hudSlot.className = "attack-strip__slot";

    const speed = document.createElement("span");
    speed.className = "attack-strip__speed";
    speed.setAttribute("role", "group");
    speed.setAttribute("aria-label", "Battle speed");
    for (const value of [1, 2] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost attack-strip__speed-button";
      button.textContent = `${value}x`;
      button.setAttribute("aria-pressed", String(value === 1));
      button.title = value === 1 ? "Real speed" : "Twice real speed — the clock runs faster too";
      button.addEventListener("click", () => this.session?.setSpeed(value));
      speed.append(button);
      this.speedButtons.set(value, button);
    }

    const retreat = document.createElement("button");
    retreat.type = "button";
    retreat.className = "btn attack-strip__retreat";
    retreat.textContent = "Retreat";
    retreat.title = "End the attack now";
    retreat.disabled = true;
    retreat.addEventListener("click", () => this.askRetreat());

    strip.append(title, clock, damage, loot, spacer, hudSlot, speed, retreat);
    context.overlay.content.append(strip);

    this.strip = strip;
    this.clock = clock;
    this.damage = damage;
    this.loot = loot;
    this.hudSlot = hudSlot;
    this.retreatButton = retreat;
    this.inset = { top: strip.getBoundingClientRect().bottom, bottom: 0 };
  }

  private buildDock(context: SceneContext): void {
    const dock = document.createElement("div");
    dock.className = "attack-dock";

    // The sheet's handle: only shown at phone widths, by the stylesheet.
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "attack-dock__handle";
    handle.textContent = "Army";
    handle.setAttribute("aria-expanded", "false");
    handle.addEventListener("click", () => this.toggleDock());

    const body = document.createElement("div");
    body.className = "attack-dock__body";

    const endNote = document.createElement("p");
    endNote.className = "attack-dock__end";
    endNote.hidden = true;

    dock.append(handle, body, endNote);
    context.overlay.content.append(dock);
    this.dock = dock;
    this.dockHandle = handle;
    this.dockBody = body;
    this.endNote = endNote;
    this.measureDock();
  }

  private toggleDock(): void {
    this.dockOpen = !this.dockOpen;
    this.dock?.classList.toggle("attack-dock--open", this.dockOpen);
    this.dockHandle?.setAttribute("aria-expanded", String(this.dockOpen));
    this.measureDock();
  }

  /**
   * Re-reads how much chrome covers the canvas: the strip along the top (which
   * moves to the top edge once the HUD hides on a phone) and the dock along
   * the bottom, when it is a sheet.
   */
  private measureDock(): void {
    const dock = this.dock;
    if (!dock) return;
    const phone = this.viewportWidth > 0 && this.viewportWidth <= PHONE_WIDTH;
    dock.classList.toggle("attack-dock--sheet", phone);
    const bottom = phone ? dock.getBoundingClientRect().height : 0;
    const top = this.strip ? this.strip.getBoundingClientRect().bottom : this.inset.top;
    if (bottom !== this.inset.bottom || top !== this.inset.top) this.setInset({ top, bottom });
  }

  private setInset(inset: { top: number; bottom: number }): void {
    this.inset = inset;
    this.notices.setTopInset(inset.top);
    this.applyZoomLimits(this.viewportWidth, this.viewportHeight);
    this.placeViewTools();
  }

  private placeViewTools(): void {
    if (!this.viewTools) return;
    this.viewTools.style.bottom = `calc(${this.inset.bottom}px + var(--space-3))`;
  }

  /* ── The session on screen ──────────────────────────────────────────── */

  private onSessionChange(state: AttackSessionState): void {
    this.refreshStrip(state);
    this.refreshStatus(state);
    if (state.phase === "ended") this.showEnd(state);
  }

  private refreshStrip(state: AttackSessionState): void {
    if (this.clock) {
      const over = state.phase === "ended";
      this.clock.textContent = over ? "0:00" : formatClock(state.remainingSeconds);
      this.clock.classList.toggle(
        "attack-strip__clock--warning",
        !over && state.remainingSeconds <= WARNING_SECONDS,
      );
      this.clock.setAttribute("aria-live", state.remainingSeconds <= WARNING_SECONDS ? "polite" : "off");
    }
    if (this.damage) this.damage.textContent = `${Math.floor(state.damagePercent)}% damage`;
    if (this.loot) {
      const { r1, r2, r3, r4 } = state.loot;
      this.loot.textContent =
        `Loot ${formatAmount(r1)} · ${formatAmount(r2)} · ${formatAmount(r3)} · ${formatAmount(r4)}`;
      this.loot.title = `Twigs ${r1}, pebbles ${r2}, putty ${r3}, goo ${r4}`;
    }
    for (const [value, button] of this.speedButtons) {
      button.setAttribute("aria-pressed", String(value === state.speed));
      button.disabled = state.phase === "ended";
    }
    if (this.retreatButton) {
      this.retreatButton.disabled = state.phase !== "running" && state.phase !== "loaded";
    }
  }

  private refreshStatus(state: AttackSessionState): void {
    const status = this.status;
    const yard = this.yard;
    const target = this.target;
    if (!status || !yard || !target) return;
    const sent = Object.values(state.remaining).reduce((sum, count) => sum + count, 0);
    status.textContent =
      `${target.name}'s ${target.kind === "wild" ? "camp" : "yard"} · ` +
      `${yard.buildings.length} buildings · ${state.buildingsDestroyed} destroyed · ` +
      `${state.creepsAlive} on the field · ${sent} left to send` +
      (state.declareWar ? " · Declare War" : "") +
      (this.selected ? ` · selected #${this.selected.id}` : "");
  }

  private showEnd(state: AttackSessionState): void {
    this.confirm?.close();
    this.confirm = null;
    const note = this.endNote;
    if (!note) return;
    note.replaceChildren();
    const text = document.createElement("span");
    text.textContent = describeEnd(state);
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn--primary";
    back.textContent = "Back to the map";
    back.addEventListener("click", () => this.context?.goTo(SceneName.MAP_ROOM_2));
    note.append(text, back);
    note.hidden = false;
    if (!this.dockOpen) this.toggleDock();
    this.measureDock();
  }

  /* ── Retreat ────────────────────────────────────────────────────────── */

  /** One confirmation (§7, Q9), then the session's own retreat. */
  private askRetreat(after?: () => void): void {
    const context = this.context;
    const session = this.session;
    if (!context || !session || this.confirm) return;
    const state = session.state();
    if (state.phase === "ended") {
      after?.();
      return;
    }
    this.confirm = confirmPanel({
      title: "Retreat?",
      message: "Retreating ends the attack now and cannot be undone.",
      note: `${Math.floor(state.damagePercent)}% damage dealt so far will be kept.`,
      confirmLabel: "Retreat",
      onConfirm: () => {
        this.confirm?.close();
        session.retreat();
        after?.();
      },
      onClose: () => {
        this.confirm = null;
      },
    });
    this.confirm.element.classList.add("attack-confirm");
    this.confirm.mount(context.overlay.modal);
  }

  /** A HUD switch away from a running attack is a retreat, asked once. */
  private leaveFor(scene: string): void {
    const context = this.context;
    if (!context) return;
    const phase = this.session?.state().phase;
    if (phase === "running" || phase === "loaded") {
      this.askRetreat(() => context.goTo(scene));
      return;
    }
    context.goTo(scene);
  }

  /* ── Camera helpers ─────────────────────────────────────────────────── */

  private applyZoomLimits(width: number, height: number, target = this.camera): void {
    const yard = this.yard;
    if (!yard || !target) return;
    const frame = this.renderer.fitRect();
    const visibleHeight = Math.max(height - this.inset.top - this.inset.bottom, 1);
    const fit = Math.min(width / frame.width, visibleHeight / frame.height);
    this.fitZoom = Math.min(fit, MAX_ZOOM);
    target.setMinZoom(this.fitZoom);
    this.zoomControl?.setRange(this.fitZoom, MAX_ZOOM);
    this.zoomControl?.setZoom(target.zoom);
  }

  private fitYard(): void {
    const camera = this.camera;
    if (!camera || !this.yard) return;
    const frame = this.renderer.fitRect();
    camera.zoom = this.fitZoom;
    const centreX = this.viewportWidth / 2;
    const centreY = this.viewportHeight / 2 + (this.inset.top - this.inset.bottom) / 2;
    camera.setPosition(
      frame.x + frame.width / 2 - centreX / camera.zoom,
      frame.y + frame.height / 2 - centreY / camera.zoom,
    );
    camera.dirty = true;
  }

  private zoomBy(factor: number): void {
    this.camera?.zoomBy(factor, { x: this.viewportWidth / 2, y: this.viewportHeight / 2 });
  }

  /* ── Enemy building info ────────────────────────────────────────────── */

  /** Read-only facts on a tapped building (§4.4); no planner, no upgrades. */
  private select(building: YardBuilding | null): void {
    this.selected = building;
    this.renderer.setSelected(building);
    if (!building) {
      this.panel?.close();
      this.panel = null;
      return;
    }
    if (!this.panel) {
      const dock = this.dockBody;
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
    if (this.session) this.refreshStatus(this.session.state());
  }
}
