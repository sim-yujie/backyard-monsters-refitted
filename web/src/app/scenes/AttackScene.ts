import { guideBus, GuideScreen } from "@/game/guide/guideBus";
import { tutTarget, TutTarget } from "@/game/guide/targets";
import { Container } from "pixi.js";
import { logout } from "@/api/auth";
import { loadAttackOn } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse, Resources } from "@/api/types";
import { clockReading, formatClock } from "@/game/attack/attackClock";
import { withLoot } from "@/game/attack/attackerPool";
import { attackYardHandlers } from "@/game/attack/AttackInput";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import { AttackSession, type AttackSessionState } from "@/game/attack/AttackSession";
import { consumeAttackTarget, type AttackTarget } from "@/game/attack/attackTarget";
import { targetLabel } from "@/game/attack/attackSave";
import { baiterTarget, consumeBaiterRun, setBaiterRun, type BaiterRun } from "@/game/baiter/baiterSession";
import { consumeWatchRun, setWatchRun, watchTarget, type WatchRun } from "@/game/autoAttack/watchRun";
import { concealTraps, countedBuildings } from "@/game/attack/trapReveal";
import { Camera } from "@/game/Camera";
import { fixedWorkSource } from "@/game/yard/buildingWork";
import { readYard, type Yard } from "@/game/yard/yardModel";
import { fellPens, yardLifeOf, type YardLife } from "@/game/yard/yardLifeModel";
import { setYardIntent } from "@/game/yard/yardIntent";
import { YardRenderer } from "@/game/yard/YardRenderer";
import { YardInput } from "@/game/yard/YardInput";
import { formatAmount } from "@/ui/format";
import { Hud } from "@/ui/Hud";
import { Notices } from "@/ui/maproom/Notices";
import type { Panel } from "@/ui/Panel";
import { RESOURCE_KEYS, resourceAmount } from "@/ui/resourceIcon";
import { AttackMenu, sheetHandleLabel } from "@/ui/attack/AttackMenu";
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
 * On a phone (§4.3) the HUD gives way to the strip and its overflow menu, and
 * the dock becomes a bottom sheet with a handle; the sheet reports its height
 * so the fit-to-plot zoom leaves room for it, the way the planner's bars
 * report theirs, and the camera keeps what was in view in view as it opens.
 */

// The registry is a leaf module and the stubs run here, after it, so a stub's
// push never lands in a module still being evaluated.
import { ATTACK_PLUGINS, type AttackMounts, type AttackPlugin } from "@/game/attack/attackPlugins";
import "@/game/attack/plugins";

export { ATTACK_PLUGINS, type AttackMounts, type AttackPlugin };

/** How often the strip is refreshed between session notifications. */
const UI_TICK_SECONDS = 0.25;

/** Zoom the attack opens at, over the town hall. 1 is art at native size. */
const OPENING_ZOOM = 0.9;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 1.5;

/** Viewport width at or below which the dock is a bottom sheet (§4.3). */
const PHONE_WIDTH = 620;

/** Space kept between the wide-screen dock and the minimap under it, and the least the dock shrinks to. */
const DOCK_GAP = 12;
const MIN_DOCK_HEIGHT = 160;

export { formatClock };

/** A HUD destination as the retreat question names it (#152). */
const destinationName = (scene: string): string =>
  scene === SceneName.YARD ? "your yard" : scene === SceneName.LOGIN ? "the sign-in screen" : "there";

export class AttackScene implements Scene {
  private readonly renderer = new YardRenderer();
  private readonly notices = new Notices();
  private readonly battleLayer = new Container();
  private presentation = new AttackPresentation();
  private readonly plugins: readonly AttackPlugin[];
  /**
   * A Wild Monster Baiter practice attack on the player's own yard (#126):
   * the Baiter scene is this scene with {@link BAITER_PLUGINS} and this set.
   * The yard comes from the run, already loaded; Stop needs no confirmation
   * and leaving needs none either, because nothing is saved.
   */
  private readonly practice: boolean;
  private run: BaiterRun | null = null;
  /**
   * An auto-attack's battle played back (issue #221): the watch scene is this
   * scene with `WATCH_PLUGINS` and this set. Like practice, nothing is saved,
   * so stopping or leaving asks nothing.
   */
  private readonly watching: boolean;
  private watchRun: WatchRun | null = null;

  private context: SceneContext | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private camera: Camera | null = null;
  private hud: Hud | null = null;
  /** The attacker's pool as the HUD last showed it, for the banked loot to add to (#168). */
  private shownResources: Resources = {};
  private input: YardInput | null = null;
  private session: AttackSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private target: AttackTarget | null = null;
  private yard: Yard | null = null;
  /** The defender's housed monsters and workers, drawn as scenery (#159). */
  private life: YardLife | null = null;
  /** Buildings destroyed when `life` was last checked for fallen pens. */
  private lifeDestroyed = 0;

  private strip: HTMLElement | null = null;
  private clock: HTMLElement | null = null;
  private damage: HTMLElement | null = null;
  private loot: HTMLElement | null = null;
  /** The loot readout's four amounts, twigs to goo. */
  private lootValues: HTMLElement[] = [];
  private hudSlot: HTMLElement | null = null;
  private speedButtons = new Map<1 | 2, HTMLButtonElement>();
  private retreatButton: HTMLButtonElement | null = null;
  private menu: AttackMenu | null = null;
  private confirm: Panel | null = null;

  private dock: HTMLElement | null = null;
  private dockBody: HTMLElement | null = null;
  private dockHandle: HTMLButtonElement | null = null;
  private dockOpen = false;
  private dockWatch: MutationObserver | null = null;
  private status: HTMLElement | null = null;

  private viewTools: HTMLElement | null = null;
  private zoomControl: ZoomControl | null = null;
  private minimap: YardMinimap | null = null;
  private teardowns: Array<() => void> = [];

  private sinceUiTick = 0;
  /** The buildings the counts cover, traps left out (#72). */
  private buildingCount = 0;
  private fitZoom = 0.05;
  private inset = { top: 0, bottom: 0 };

  constructor(
    plugins: readonly AttackPlugin[] = ATTACK_PLUGINS,
    options: { practice?: boolean; watch?: boolean } = {},
  ) {
    this.plugins = plugins;
    this.practice = options.practice ?? false;
    this.watching = options.watch ?? false;
    this.battleLayer.eventMode = "none";
  }

  async enter(context: SceneContext): Promise<void> {
    this.context = context;
    this.viewportWidth = context.width;
    this.viewportHeight = context.height;
    if (this.practice) {
      this.run = consumeBaiterRun();
      this.target = this.run ? baiterTarget(this.run) : null;
    } else if (this.watching) {
      this.watchRun = consumeWatchRun();
      this.target = this.watchRun ? watchTarget(this.watchRun) : null;
    } else {
      this.target = consumeAttackTarget();
    }

    context.stage.addChild(this.renderer.root);
    this.renderer.attach(context.renderer);
    this.renderer.root.addChild(this.battleLayer);

    this.hud = new Hud({
      scenes: [
        { id: SceneName.MAP, label: "Map" },
        { id: SceneName.YARD, label: "Yard" },
      ],
      onSceneSelect: (id) => this.leaveFor(id),
      onSignOut: () => this.leaveFor(SceneName.LOGIN, logout),
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
    if (!target && this.practice) {
      this.status.textContent = "No practice attack was set up.";
      this.notices.show("attack-load", "Open the Wild Monster Baiter in your yard to bring a practice attack.", {
        level: "info",
        actionLabel: "Back to the yard",
        onAction: () => context.goTo(SceneName.YARD),
      });
      return;
    }
    if (!target && this.watching) {
      this.status.textContent = "No replay was chosen.";
      this.notices.show("attack-load", "Run an auto-attack from the map, then press Watch.", {
        level: "info",
        actionLabel: "Back to the map",
        onAction: () => context.goTo(SceneName.MAP),
      });
      return;
    }
    if (!target) {
      this.status.textContent = "No target was chosen.";
      this.notices.show("attack-load", "Pick a target on the map and press Attack.", {
        level: "info",
        actionLabel: "Back to the map",
        onAction: () => context.goTo(SceneName.MAP),
      });
      return;
    }

    this.status.textContent = this.practice
      ? "Setting up the practice attack…"
      : this.watching
        ? "Setting up the replay…"
        : `Loading ${targetLabel(target, false)}…`;
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
    this.dockWatch?.disconnect();
    this.dockWatch = null;
    this.dock?.remove();
    this.dock = null;
    this.dockBody = null;
    this.dockHandle = null;
    this.strip?.remove();
    this.strip = null;
    this.clock = null;
    this.damage = null;
    this.loot = null;
    this.lootValues = [];
    this.hudSlot = null;
    this.speedButtons.clear();
    this.retreatButton = null;
    this.menu?.destroy();
    this.menu = null;
    this.status?.remove();
    this.status = null;
    this.hud?.destroy();
    this.hud = null;
    this.notices.destroy();
    this.battleLayer.removeChildren();
    this.renderer.destroy();
    this.session = null;
    this.presentation = new AttackPresentation();
    this.yard = null;
    this.life = null;
    this.lifeDestroyed = 0;
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
    }
  }

  /* ── Loading ────────────────────────────────────────────────────────── */

  private async load(target: AttackTarget, context: SceneContext): Promise<void> {
    let response: BaseLoadResponse;
    try {
      response = target.load ?? (await loadAttackOn(target));
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
        { level: "error", actionLabel: "Back to the map", onAction: () => context.goTo(SceneName.MAP) },
      );
      if (this.status) this.status.textContent = "The attack did not start.";
      return;
    }

    // An attack target is always somebody else's yard: open grass, no plot
    // edge, and room around the camp to drop on (issue #62). A practice
    // attack's wild monsters come from far outside the plot, so it is drawn
    // the same way.
    const yard = readYard(response, { foreign: true });
    this.yard = yard;
    // The defender's harvesters, hatcheries and the rest animate only while
    // working (#255).
    this.renderer.setWork(fixedWorkSource(response));
    this.renderer.show(yard);
    // An attacker never sees a trap until it fires (`BTRAP.as:33-43`, #66);
    // the battle layer reveals each one as the engine reports it going off.
    // The player's own traps are no secret to them.
    if (!this.practice) concealTraps(this.renderer, yard);
    // The defender's pens, as Flash drew them on an attacked yard (#159):
    // scenery in the yard's own containers, never in the battle layer, so no
    // creep targets them and no count includes them. No caged champion: the
    // engine has no defending champion, and one that never fights would lie.
    this.life = yardLifeOf(response, yard, "attack");
    this.renderer.setLife(this.life);
    this.buildingCount = countedBuildings(yard.buildings.map((building) => building.type));
    this.startCamera(yard, context);

    // A replay fights with the server's own seed and Declare War (issue #221).
    const replay = this.watchRun?.replay;
    // A Baiter test's clock waits for the first drop, as Flash's practice
    // did; its replay plays the recorded seed from the start (#22, WP5).
    const testReplay = this.run?.replay;
    const session = new AttackSession({
      target: { ...target, load: response },
      ...(replay ? { seed: replay.seed, declareWar: replay.declareWar } : {}),
      ...(testReplay ? { seed: testReplay.seed } : this.practice ? { clockFromFirstDrop: true } : {}),
    });
    this.session = session;
    this.unsubscribe = session.subscribe((state) => this.onSessionChange(state));
    this.refreshStrip(session.state());
    this.refreshStatus(session.state());

    // The attacker's own pool, not the defender's the load carries; the drop
    // package keeps it current as bombs go out (#92).
    this.showResources(
      this.practice ? (response.resources ?? {}) : (target.roster.resources ?? {}),
      this.practice ? response.credits : target.roster.credits,
    );
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
      guide: context.overlay.guide,
      battleLayer: this.battleLayer,
      notices: this.notices,
      goToMap: () => context.goTo(SceneName.MAP),
      ...(this.run
        ? {
            practice: this.run,
            runAgain: (run: BaiterRun) => {
              setBaiterRun(run);
              context.goTo(SceneName.BAITER);
            },
            goToYard: () => context.goTo(SceneName.YARD),
            changeArmy: () => {
              setYardIntent({ kind: "baiter" });
              context.goTo(SceneName.YARD);
            },
            watchTest: (run: BaiterRun) => {
              setBaiterRun(run);
              context.goTo(SceneName.BAITER_REPLAY);
            },
          }
        : {}),
      ...(this.watchRun ? { watch: this.watchRun } : {}),
      openWatch: (run: WatchRun) => {
        setWatchRun(run);
        context.goTo(SceneName.WATCH);
      },
      setBottomInset: (px) => this.setInset({ ...this.inset, bottom: px }),
      showResources: (resources) => this.showResources(resources),
      creditLoot: (credited) => this.showResources(withLoot(this.shownResources, credited)),
      presentation: this.presentation,
    };
    for (const plugin of this.plugins) {
      const teardown = plugin(mounts);
      if (teardown) this.teardowns.push(teardown);
    }
    this.measureDock();
    // The tutorial's tips (issue #227); the attack strip is the screen's header.
    guideBus.emit("screen", {
      id: GuideScreen.ATTACK,
      root: context.overlay.content,
      header: context.overlay.content.querySelector<HTMLElement>(".attack-strip"),
    });
  }

  /** Shows the attacker's own pool on the HUD, and keeps it for {@link withLoot}. */
  private showResources(resources: Resources, credits?: number): void {
    this.shownResources = resources;
    this.hud?.setResources(resources, credits);
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
      // Only the drop input answers a tap; the enemy's buildings answer nothing (#258).
      ...attackYardHandlers(),
      onZoomStep: (direction) => this.zoomBy(Math.pow(ZOOM_STEP, direction)),
      onZoomReset: () => this.fitYard(),
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
    title.textContent = this.practice
      ? this.run?.replay
        ? "Test replay"
        : "Test attack"
      : this.watching && this.target
        ? `Replay: ${this.target.name} camp`
        : this.target
        ? `Attacking ${this.target.name}`
        : "Attack";

    const clock = document.createElement("span");
    clock.className = "attack-strip__clock";
    clock.setAttribute("role", "timer");
    clock.setAttribute("aria-live", "off");
    clock.textContent = "—:——";

    const damage = document.createElement("span");
    damage.className = "attack-strip__readout";
    damage.textContent = "0% damage";

    // "Loot" and one icon-and-amount per resource (#93).
    const loot = document.createElement("span");
    loot.className = "attack-strip__readout attack-strip__loot";
    const amounts = document.createElement("span");
    amounts.className = "res-list";
    this.lootValues = RESOURCE_KEYS.map((key) => {
      const amount = resourceAmount(key, "0");
      amounts.append(amount);
      return amount.querySelector<HTMLElement>(".res-amount__value")!;
    });
    loot.append("Loot ", amounts);
    // Nothing is taken in practice.
    loot.hidden = this.practice;

    const spacer = document.createElement("span");
    spacer.className = "attack-strip__spacer";

    const hudSlot = document.createElement("span");
    hudSlot.className = "attack-strip__slot";

    const speed = document.createElement("span");
    speed.className = "attack-strip__speed";
    speed.setAttribute("role", "group");
    speed.setAttribute("aria-label", "Battle speed");
    tutTarget(speed, TutTarget.ATTACK_SPEED);
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
    tutTarget(retreat, TutTarget.ATTACK_RETREAT);
    const replaying = this.watching || Boolean(this.run?.replay);
    retreat.textContent = replaying ? "End replay" : this.practice ? "Stop" : "Retreat";
    retreat.title = replaying ? "Stop watching" : this.practice ? "End the test now" : "End the attack now";
    retreat.disabled = true;
    retreat.addEventListener("click", () => this.askRetreat());

    // The HUD's way out, for a phone, where the HUD is hidden (§4.3, #151).
    this.menu = new AttackMenu([
      { label: "Map", run: () => this.leaveFor(SceneName.MAP) },
      { label: "Yard", run: () => this.leaveFor(SceneName.YARD) },
      { label: "Log out", run: () => this.leaveFor(SceneName.LOGIN, logout) },
    ]);

    strip.append(title, clock, damage, loot, spacer, hudSlot, speed, retreat, this.menu.element);
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

    dock.append(handle, body);
    context.overlay.content.append(dock);
    this.dock = dock;
    this.dockHandle = handle;
    this.dockBody = body;
    // The handle names what the sheet holds (#151): the dock's mode classes
    // and the panels mounted into it are what change that.
    this.dockWatch = new MutationObserver(() => this.labelHandle());
    this.dockWatch.observe(dock, { attributes: true, attributeFilter: ["class"] });
    this.dockWatch.observe(body, { childList: true });
    this.measureDock();
  }

  private labelHandle(): void {
    const dock = this.dock;
    const handle = this.dockHandle;
    if (!dock || !handle) return;
    const label = sheetHandleLabel(dock);
    if (handle.textContent !== label) handle.textContent = label;
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
    else this.fitDock();
  }

  private setInset(inset: { top: number; bottom: number }): void {
    const before = this.inset;
    this.inset = inset;
    this.notices.setTopInset(inset.top);
    this.applyZoomLimits(this.viewportWidth, this.viewportHeight);
    this.placeViewTools();
    this.keepCentre(before, inset);
  }

  /**
   * Pans so the point at the middle of the visible band stays there when the
   * chrome around it changes size: opening the phone sheet over two thirds of
   * the screen used to leave the view's centre under it (#151).
   */
  private keepCentre(before: { top: number; bottom: number }, after: { top: number; bottom: number }): void {
    const camera = this.camera;
    if (!camera) return;
    const shift = (before.top - before.bottom - (after.top - after.bottom)) / 2;
    if (shift === 0) return;
    camera.setPosition(camera.position.x, camera.position.y + shift / camera.zoom);
    camera.dirty = true;
  }

  private placeViewTools(): void {
    if (!this.viewTools) return;
    this.viewTools.style.bottom = `calc(${this.inset.bottom}px + var(--space-3))`;
    this.fitDock();
  }

  /**
   * On a wide screen the dock stands at the right and the minimap sits in the
   * corner below it; a tall army panel (the Baiter's whole test roster, with
   * its champion row last) ran on under the minimap, which took its taps. The
   * dock stops above the view tools and scrolls. A phone's sheet is sized by
   * the stylesheet.
   */
  private fitDock(): void {
    const dock = this.dock;
    const tools = this.viewTools;
    if (!dock || !tools) return;
    if (dock.classList.contains("attack-dock--sheet")) {
      dock.style.maxHeight = "";
      return;
    }
    const room = tools.getBoundingClientRect().top - dock.getBoundingClientRect().top - DOCK_GAP;
    dock.style.maxHeight = room > 0 ? `${Math.max(MIN_DOCK_HEIGHT, Math.floor(room))}px` : "";
  }

  /* ── The session on screen ──────────────────────────────────────────── */

  private onSessionChange(state: AttackSessionState): void {
    this.refreshStrip(state);
    this.refreshStatus(state);
    this.fellPens(state);
    // The end plugin (WP6) takes over from here; a pending retreat question
    // is moot once the attack is over.
    if (state.phase === "ended") {
      this.confirm?.close();
      this.confirm = null;
    }
  }

  /** A Housing destroyed in the battle takes its monsters with it (`BUILDING15.as:93-104`). */
  private fellPens(state: AttackSessionState): void {
    const life = this.life;
    if (!life || state.buildingsDestroyed === this.lifeDestroyed) return;
    this.lifeDestroyed = state.buildingsDestroyed;
    const destroyed = this.session?.battle()?.state().destroyedIds ?? [];
    const next = fellPens(life, destroyed);
    if (next === life) return;
    this.life = next;
    this.renderer.setLife(next);
  }

  private refreshStrip(state: AttackSessionState): void {
    if (this.clock) {
      // The countdown, then the retreat grace, labelled and counted down (#149).
      const reading = clockReading(state);
      this.clock.textContent = reading.text;
      this.clock.title = reading.title;
      this.clock.classList.toggle("attack-strip__clock--warning", reading.warning);
      this.clock.classList.toggle("attack-strip__clock--grace", reading.grace);
      this.clock.setAttribute("aria-live", reading.warning ? "polite" : "off");
    }
    // What the screen has dealt, not what the engine has booked (#148).
    if (this.damage) {
      this.damage.textContent = `${Math.floor(this.presentation.damageShown(state))}% damage`;
    }
    if (this.loot) {
      const { r1, r2, r3, r4 } = state.loot;
      RESOURCE_KEYS.forEach((key, index) => {
        const value = this.lootValues[index];
        if (value) value.textContent = formatAmount(state.loot[key]);
      });
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
    if (this.practice) {
      status.textContent =
        `Test on your yard · ${this.buildingCount} buildings · ${state.buildingsDestroyed} destroyed · ` +
        `${state.creepsAlive} attacking`;
      return;
    }
    status.textContent =
      `${targetLabel(target)} · ` +
      `${this.buildingCount} buildings · ${state.buildingsDestroyed} destroyed · ` +
      `${state.creepsAlive} on the field · ${sent} left to send` +
      (state.declareWar ? " · Declare War" : "");
  }

  /* ── Retreat ────────────────────────────────────────────────────────── */

  /**
   * One confirmation (§7, Q9), then the session's own retreat. `goingTo`
   * names where a HUD switch asked to go, when that is not the map (#152).
   */
  private askRetreat(after?: () => void, goingTo?: string): void {
    const context = this.context;
    const session = this.session;
    if (!context || !session || this.confirm) return;
    const state = session.state();
    if (state.phase === "ended") {
      after?.();
      return;
    }
    // A practice attack or a replay keeps nothing, so stopping it asks nothing.
    if (this.practice || this.watching) {
      session.retreat();
      after?.();
      return;
    }
    this.confirm = confirmPanel({
      title: "Retreat?",
      message: "Retreating ends the attack now and cannot be undone.",
      note:
        `${Math.floor(state.damagePercent)}% damage dealt so far will be kept.` +
        (goingTo
          ? ` The result is saved on the end screen first, which leads back to the map, not straight to ${goingTo}.`
          : ""),
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

  /**
   * A HUD switch away from the attack.
   *
   * With nothing dropped, bombed or sieged yet it leaves at once: such an
   * attack saves nothing (#79), so there is nothing to confirm (#152). After
   * the first action it is a retreat, asked once, because leaving ends and
   * saves the attack (#138). Once confirmed, the end-of-attack panel (WP6)
   * saves the result and offers the map, its one way out (§F6); the scene
   * does not leave on its own, or the save would go unseen, so the question
   * says so when the player asked for somewhere else.
   */
  private leaveFor(scene: string, before?: () => void): void {
    const context = this.context;
    if (!context) return;
    const session = this.session;
    const phase = session?.state().phase;
    // A practice attack or a replay is simply left: nothing was going to be saved.
    if (this.practice || this.watching) {
      session?.retreat();
      before?.();
      context.goTo(scene);
      return;
    }
    if (session?.hasActed() && (phase === "running" || phase === "loaded")) {
      this.askRetreat(undefined, scene === SceneName.MAP ? undefined : destinationName(scene));
      return;
    }
    before?.();
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
}
