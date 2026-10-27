import { guideBus, GuideScreen } from "@/game/guide/guideBus";
import { tutTarget, TutTarget } from "@/game/guide/targets";
import { Container } from "pixi.js";
import { logout } from "@/api/auth";
import { loadAttackOn } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse, Resources } from "@/api/types";
import { clockReading, formatClock } from "@/game/attack/attackClock";
import { withLoot } from "@/game/attack/attackerPool";
import { boostSummary, loadBoosts } from "@/game/attack/boostSummary";
import { attackYardHandlers } from "@/game/attack/AttackInput";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import {
  AttackSession,
  combatKind,
  devDescentYard,
  LIVE_SPEEDS,
  PLAYBACK_SPEEDS,
  type AttackSessionState,
  type AttackSpeed,
} from "@/game/attack/AttackSession";
import { consumeAttackTarget, fromInfernoYard, type AttackTarget } from "@/game/attack/attackTarget";
import { targetLabel } from "@/game/attack/attackSave";
import { baiterTarget, consumeBaiterRun, setBaiterRun, type BaiterRun } from "@/game/baiter/baiterSession";
import {
  consumeWatchRun,
  isDefenceWatch,
  setWatchRun,
  watchRefusal,
  watchTarget,
  type WatchRun,
} from "@/game/autoAttack/watchRun";
import { DEFENCE_REFUSAL_TEXT, defenceReadout, type DefenceRefusal } from "@/game/defences/defenceWatch";
import { concealTraps, countedBuildings } from "@/game/attack/trapReveal";
import { consumeRaidRun, raidTarget, type RaidRun } from "@/game/raid/raidSession";
import { MOLOCH_RAID_TITLE, MOLOCH_RAIDERS } from "@/game/inferno/emergenceText";
import { isMolochRaid } from "@/game/inferno/molochRaid";
import { backToInferno } from "@/game/inferno/tribeReturn";
import { tribeTitle } from "@/game/raid/raidText";
import { Camera } from "@/game/Camera";
import { fixedWorkSource } from "@/game/yard/buildingWork";
import { setOwnYardTarget, type OwnYardTarget } from "@/game/yard/ownYards";
import { readYard, type Yard } from "@/game/yard/yardModel";
import { fellPens, yardLifeOf, type YardLife } from "@/game/yard/yardLifeModel";
import { setYardIntent } from "@/game/yard/yardIntent";
import { YardRenderer } from "@/game/yard/YardRenderer";
import { YardInput } from "@/game/yard/YardInput";
import { formatAmount } from "@/ui/format";
import { Hud } from "@/ui/Hud";
import { icon } from "@/ui/icons";
import { Notices } from "@/ui/maproom/Notices";
import type { Panel } from "@/ui/Panel";
import { RESOURCE_KEYS, resourceAmount, resourceName, setResourceRealm } from "@/ui/resourceIcon";
import { AttackMenu, sheetHandleLabel } from "@/ui/attack/AttackMenu";
import { ATTACK_CONFIRM_CLASS, retreatNote } from "@/ui/attack/attackDialogs";
import { confirmPanel } from "@/ui/yard/PlannerDialogs";
import { YardMinimap } from "@/ui/yard/YardMinimap";
import { ViewToolsFold } from "@/ui/attack/ViewToolsFold";
import { ZoomControl } from "@/ui/ZoomControl";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";
import { setScreenTune } from "@/game/sound/sound";

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
  /** Why the chosen replay cannot be played here (a defence fought under other rules, #362). */
  private watchRefused: DefenceRefusal | null = null;
  /**
   * A wild monster raid on the player's own yard (issue #226 WP4): the raid
   * scene is this scene with `RAID_PLUGINS` and this set. The server fought
   * it already; the screen plays it back with no HUD, no army and no way to
   * stop it but 1x and 2x, and the raid package lands it when it ends.
   */
  private readonly raiding: boolean;
  private raidRun: RaidRun | null = null;

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
  /** The shop boosts chip (beta.4), filled once the load has said what runs. */
  private boosts: HTMLElement | null = null;
  private boostsShown = false;
  private damage: HTMLElement | null = null;
  private loot: HTMLElement | null = null;
  /** The loot readout's four amounts, twigs to goo. */
  private lootValues: HTMLElement[] = [];
  private hudSlot: HTMLElement | null = null;
  private speedButtons = new Map<AttackSpeed, HTMLButtonElement>();
  private retreatButton: HTMLButtonElement | null = null;
  private menu: AttackMenu | null = null;
  private confirm: Panel | null = null;
  /** The open Retreat question's damage line and where it was going, told again as the fight goes on. */
  private retreatLine: { element: HTMLElement; goingTo?: string } | null = null;

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
    options: { practice?: boolean; watch?: boolean; raid?: boolean } = {},
  ) {
    this.plugins = plugins;
    this.practice = options.practice ?? false;
    this.watching = options.watch ?? false;
    this.raiding = options.raid ?? false;
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
      // A defence fought under other rules is refused before anything is built (#362).
      this.watchRefused = this.watchRun ? watchRefusal(this.watchRun) : null;
      this.target = this.watchRun && !this.watchRefused ? watchTarget(this.watchRun) : null;
      // A defence replay is the player's own yard under attack (`game/sound/tunes.ts`).
      if (isDefenceWatch(this.watchRun)) setScreenTune("underAttack");
    } else if (this.raiding) {
      this.raidRun = consumeRaidRun();
      this.target = this.raidRun ? raidTarget(this.raidRun) : null;
    } else {
      this.target = consumeAttackTarget();
    }

    context.stage.addChild(this.renderer.root);
    this.renderer.attach(context.renderer);
    this.renderer.root.addChild(this.battleLayer);

    // A Moloch tribe or another player's Inferno yard is fought from the
    // Inferno yard for its purse: Bone, Coal, Sulfur and Magma on the HUD and
    // every panel (Inferno WP 2.10, 3.5).
    setResourceRealm(fromInfernoYard(this.target) ? "inferno" : "surface");

    // A raid has no HUD: nothing on it may be left until it is over.
    if (!this.raiding) {
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
    }
    this.buildStrip(context);
    this.notices.mount(context.overlay.content);
    this.notices.setTopInset(this.inset.top);

    this.status = document.createElement("div");
    this.status.className = "cell-readout attack-status";
    context.overlay.content.append(this.status);

    this.buildDock(context);
    // No army to send: the raiders come in the server's waves.
    if (this.raiding && this.dock) this.dock.hidden = true;

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
    if (!target && this.raiding) {
      this.status.textContent = "No raid to play.";
      this.notices.show("attack-load", "The wild monsters are not here.", {
        level: "info",
        actionLabel: "Back to the yard",
        onAction: () => context.goTo(SceneName.YARD),
      });
      return;
    }
    if (!target && this.watching && this.watchRefused) {
      this.status.textContent = `${DEFENCE_REFUSAL_TEXT[this.watchRefused]}.`;
      this.notices.show("attack-load", `${DEFENCE_REFUSAL_TEXT[this.watchRefused]}.`, {
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
        : this.raiding
          ? "The wild monsters are coming…"
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
    setResourceRealm("surface");
    this.notices.destroy();
    this.battleLayer.removeChildren();
    this.renderer.destroy();
    this.session = null;
    this.presentation = new AttackPresentation();
    this.yard = null;
    this.life = null;
    this.lifeDestroyed = 0;
    this.raidRun = null;
    this.watchRefused = null;
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
    // the same way. A Moloch yard lies on the grown plot of a wild camp.
    const molochYard = this.target?.descentYard !== undefined || this.target?.infernoTribe === true;
    const yard = readYard(response, { foreign: true, wild: molochYard });
    this.yard = yard;
    // The defender's harvesters, hatcheries and the rest animate only while
    // working (#255).
    this.renderer.setWork(fixedWorkSource(response));
    this.renderer.show(yard);
    // An attacker never sees a trap until it fires (`BTRAP.as:33-43`, #66);
    // the battle layer reveals each one as the engine reports it going off.
    // The player's own traps are no secret to them, on a defence replay too.
    if (!this.practice && !this.raiding && !isDefenceWatch(this.watchRun)) concealTraps(this.renderer, yard);
    // The defender's pens, as Flash drew them on an attacked yard (#159):
    // scenery in the yard's own containers, never in the battle layer, so no
    // creep targets them and no count includes them. No caged champion: the
    // engine has no defending champion, and one that never fights would lie.
    this.life = yardLifeOf(response, yard, "attack");
    this.renderer.setLife(this.life);
    this.buildingCount = countedBuildings(yard.buildings.map((building) => building.type));
    this.startCamera(yard, context);

    // A replay fights with the server's own seed and Declare War (issue #221).
    // A raid fights with the server's own seed (issue #226).
    const replay = this.watchRun?.replay;
    // A Baiter test's clock waits for the first drop, as Flash's practice
    // did; its replay plays the recorded seed from the start (#22, WP5).
    const testReplay = this.run?.replay;
    const raid = this.raidRun?.fight;
    const session = new AttackSession({
      target: { ...target, load: response },
      ...(replay ? { seed: replay.seed, declareWar: replay.declareWar } : {}),
      ...(testReplay
        ? { seed: testReplay.seed }
        : raid
          ? { seed: raid.seed, raid: true }
          : this.practice
            ? { clockFromFirstDrop: true }
            : {}),
      // Dev only: `?descentYard=13` fights a practice under the Descent burn,
      // to see it before the Descent's own attacks exist (Inferno WP 1.21).
      ...(import.meta.env.DEV && this.practice ? devDescentYard(window.location.search) : {}),
    });
    this.session = session;
    this.unsubscribe = session.subscribe((state) => this.onSessionChange(state));
    this.refreshStrip(session.state());
    this.refreshStatus(session.state());

    // The attacker's own pool, not the defender's the load carries; the drop
    // package keeps it current as bombs go out (#92).
    const ownYard = this.practice || this.raiding;
    this.showResources(
      ownYard ? (response.resources ?? {}) : (target.roster.resources ?? {}),
      ownYard ? response.credits : target.roster.credits,
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
      goToMap: () => {
        // A Moloch tribe's or an Inferno player's map is the Inferno's, over the Inferno yard (WP 2.10, 3.5).
        if (fromInfernoYard(target)) {
          backToInferno(true);
          context.goTo(SceneName.YARD);
          return;
        }
        context.goTo(SceneName.MAP);
      },
      goToOutpost: (outpostTarget: OwnYardTarget) => {
        setOwnYardTarget(outpostTarget);
        context.goTo(SceneName.YARD);
      },
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
      // A defence replay goes back to the yard it was fought on, on the Defences screen (#362, #363).
      ...(isDefenceWatch(this.watchRun)
        ? {
            goToYard: () => {
              setYardIntent({ kind: "defences" });
              context.goTo(SceneName.YARD);
            },
          }
        : {}),
      ...(this.raidRun ? { raid: this.raidRun, goToYard: () => context.goTo(SceneName.YARD) } : {}),
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
    // No tips over a raid or a replay (an auto-attack's or a defence's): the
    // player has no army to pick or drop on it.
    if (this.raiding || this.watching) return;
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
    // On a phone both fold behind one map button (#381); it redraws on opening.
    new ViewToolsFold(tools, (open) => {
      if (open) this.minimap?.markDirty();
    });
    this.placeViewTools();
  }

  /* ── Chrome ─────────────────────────────────────────────────────────── */

  private buildStrip(context: SceneContext): void {
    const strip = document.createElement("div");
    strip.className = this.raiding ? "attack-strip attack-strip--raid" : "attack-strip";

    const title = document.createElement("span");
    title.className = "attack-strip__title";
    title.textContent = this.practice
      ? this.run?.replay
        ? "Test replay"
        : "Test attack"
      : this.raiding
        ? this.raidRun
          ? isMolochRaid(this.raidRun.raid)
            ? MOLOCH_RAID_TITLE
            : `${tribeTitle(this.raidRun.raid.tribe)} raid`
          : "Wild monster raid"
        : isDefenceWatch(this.watchRun)
          ? `Defence replay: ${this.watchRun.defence.attacker.name}`
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

    // The number alone on the narrowest phones (#381): the word gives way so
    // Retreat stays on the one row.
    const damage = document.createElement("span");
    damage.className = "attack-strip__readout";
    damage.title = "Damage";
    const damageValue = document.createElement("span");
    damageValue.textContent = "0%";
    const damageWord = document.createElement("span");
    damageWord.className = "attack-strip__word";
    damageWord.textContent = " damage";
    damage.append(damageValue, damageWord);

    // "Loot" and one icon-and-amount per resource (#93); an Inferno fight
    // takes Bone, Coal, Sulfur and Magma (Inferno WP 1.13).
    const loot = document.createElement("span");
    loot.className = "attack-strip__readout attack-strip__loot";
    const amounts = document.createElement("span");
    amounts.className = "res-list";
    const realm = this.target && combatKind(this.target) === "inferno" ? "inferno" : "surface";
    this.lootValues = RESOURCE_KEYS.map((key) => {
      const amount = resourceAmount(key, "0", { realm });
      amounts.append(amount);
      return amount.querySelector<HTMLElement>(".res-amount__value")!;
    });
    loot.append("Loot ", amounts);
    // Nothing is taken in practice; a raid's losses show when it has landed.
    loot.hidden = this.practice || this.raiding;
    // A raid has no countdown: it runs until the server's fight ended.
    clock.hidden = this.raiding;

    const spacer = document.createElement("span");
    spacer.className = "attack-strip__spacer";

    const hudSlot = document.createElement("span");
    hudSlot.className = "attack-strip__slot";

    const speed = document.createElement("span");
    speed.className = "attack-strip__speed";
    speed.setAttribute("role", "group");
    speed.setAttribute("aria-label", "Battle speed");
    tutTarget(speed, TutTarget.ATTACK_SPEED);
    // A replay also has 4x (#362); an attack the player fights keeps 1x and 2x.
    for (const value of this.watching ? PLAYBACK_SPEEDS : LIVE_SPEEDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost attack-strip__speed-button";
      button.textContent = `${value}x`;
      button.setAttribute("aria-pressed", String(value === 1));
      button.title =
        value === 1
          ? "Real speed"
          : value === 2
            ? "Twice real speed — the clock runs faster too"
            : "Four times real speed — the clock runs faster too";
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

    // A raid cannot be stopped or left (quitting the game cancels it). A
    // defence replay has no Retreat either (owner, #362): Skip to end, or leave.
    retreat.hidden = this.raiding || isDefenceWatch(this.watchRun);
    this.menu.element.hidden = this.raiding;

    // The shop boosts this battle is fought with (beta.4): hidden until the load says.
    const boosts = document.createElement("span");
    boosts.className = "attack-strip__boosts";
    boosts.hidden = true;
    const boostsWord = document.createElement("span");
    boostsWord.className = "attack-strip__word";
    boosts.append(icon("boost", 14), boostsWord);

    strip.append(title, boosts, clock, damage, loot, spacer, hudSlot, speed, retreat, this.menu.element);
    context.overlay.content.append(strip);

    this.strip = strip;
    this.boosts = boosts;
    this.clock = clock;
    this.damage = damageValue;
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
   * the stylesheet, and so is the dock when the tools are not under it (a
   * phone on its side keeps them in the other corner, attack.css).
   */
  private fitDock(): void {
    const dock = this.dock;
    const tools = this.viewTools;
    if (!dock || !tools) return;
    const toolsBox = tools.getBoundingClientRect();
    const dockBox = dock.getBoundingClientRect();
    if (
      dock.classList.contains("attack-dock--sheet") ||
      toolsBox.right <= dockBox.left ||
      toolsBox.left >= dockBox.right
    ) {
      dock.style.maxHeight = "";
      return;
    }
    const room = toolsBox.top - dockBox.top - DOCK_GAP;
    dock.style.maxHeight = room > 0 ? `${Math.max(MIN_DOCK_HEIGHT, Math.floor(room))}px` : "";
  }

  /* ── The session on screen ──────────────────────────────────────────── */

  private onSessionChange(state: AttackSessionState): void {
    this.showBoosts();
    this.refreshStrip(state);
    this.refreshStatus(state);
    this.fellPens(state);
    // The end plugin (WP6) takes over from here; a pending retreat question
    // is moot once the attack is over.
    if (state.phase === "ended") {
      this.confirm?.close();
      this.confirm = null;
      return;
    }
    // The fight goes on behind the Retreat question: its damage keeps up with the strip's.
    if (this.retreatLine) {
      const { element, goingTo } = this.retreatLine;
      element.textContent = retreatNote(this.presentation.damageShown(state), goingTo);
    }
  }

  /**
   * The boosts chip, once: what each side's shop boosts do, read off the load
   * the battle was built from. The player defends in a raid and a defence
   * replay, and attacks everywhere else.
   */
  private showBoosts(): void {
    const chip = this.boosts;
    const load = this.session?.attackLoad();
    if (this.boostsShown || !chip || !load) return;
    this.boostsShown = true;
    const side = this.raiding || isDefenceWatch(this.watchRun) ? "defender" : "attacker";
    const summary = boostSummary(loadBoosts(load), side);
    if (!summary) return;
    const word = chip.querySelector<HTMLElement>(".attack-strip__word");
    if (word) word.textContent = summary.label;
    chip.title = summary.lines.join("\n");
    chip.setAttribute("aria-label", `${summary.label}. ${summary.lines.join(". ")}`);
    chip.setAttribute("role", "note");
    chip.hidden = false;
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
    const damageShown = this.presentation.damageShown(state);
    // A defence replay reads the defender's side, and ends on the stored figures (#362).
    const readout = isDefenceWatch(this.watchRun)
      ? defenceReadout(
          this.watchRun.defence,
          damageShown,
          state.defenderLoss,
          state.phase === "ended" && this.session?.endedBy !== "left",
        )
      : { damage: Math.floor(damageShown), loot: state.loot };
    if (this.damage) {
      this.damage.textContent = `${readout.damage}%`;
    }
    if (this.loot) {
      RESOURCE_KEYS.forEach((key, index) => {
        const value = this.lootValues[index];
        if (value) value.textContent = formatAmount(readout.loot[key]);
      });
      // Bone, Coal, Sulfur and Magma in an Inferno fight, as the strip's icons.
      const realm = this.target && combatKind(this.target) === "inferno" ? "inferno" : "surface";
      this.loot.title = RESOURCE_KEYS.map((key) => `${resourceName(key, realm)} ${readout.loot[key]}`).join(", ");
    }
    const skipping = this.session?.skipping ?? false;
    for (const [value, button] of this.speedButtons) {
      button.setAttribute("aria-pressed", String(value === state.speed));
      button.disabled = state.phase === "ended" || skipping;
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
      // An ended test has put its battle to rest (#308): nobody is left attacking on screen.
      status.textContent =
        `Test on your yard · ${this.buildingCount} buildings · ${state.buildingsDestroyed} destroyed · ` +
        (state.phase === "ended" ? "over" : `${state.creepsAlive} attacking`);
      return;
    }
    if (isDefenceWatch(this.watchRun)) {
      status.textContent =
        `Your yard · ${this.buildingCount} buildings · ${state.buildingsDestroyed} destroyed · ` +
        (state.phase === "ended" ? "over" : `${state.creepsAlive} attacking`);
      return;
    }
    if (this.raiding) {
      const raiders = isMolochRaid(this.raidRun?.raid) ? MOLOCH_RAIDERS : "Wild monsters";
      status.textContent =
        state.phase === "ended"
          ? "The raid is over."
          : `${raiders} on your yard · ${this.buildingCount} buildings · ${state.buildingsDestroyed} destroyed · ` +
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
      note: retreatNote(this.presentation.damageShown(state), goingTo),
      confirmLabel: "Retreat",
      onConfirm: () => {
        this.confirm?.close();
        session.retreat();
        after?.();
      },
      onClose: () => {
        this.confirm = null;
        this.retreatLine = null;
      },
    });
    this.confirm.element.classList.add(ATTACK_CONFIRM_CLASS);
    // `confirmPanel` writes its note as its one muted line.
    const note = this.confirm.element.querySelector<HTMLElement>(".u-muted");
    this.retreatLine = note ? { element: note, ...(goingTo ? { goingTo } : {}) } : null;
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
    // A raid is not left from the screen: it lands, then opens the yard.
    if (!context || this.raiding) return;
    const session = this.session;
    const phase = session?.state().phase;
    // A practice attack or a replay is simply left: nothing was going to be
    // saved. A defence replay stops where it stands, with no result (#362).
    if (this.practice || this.watching) {
      if (isDefenceWatch(this.watchRun)) session?.leave();
      else session?.retreat();
      before?.();
      context.goTo(scene);
      return;
    }
    // An Inferno player attack counts once started (WP 3.5): it is retreated
    // too, so its save lands before the Inferno yard's load could close it.
    const counts = session?.hasActed() || this.target?.infernoPlayer === true;
    if (counts && (phase === "running" || phase === "loaded")) {
      this.askRetreat(undefined, scene === SceneName.MAP ? undefined : destinationName(scene));
      return;
    }
    before?.();
    // A Moloch tribe or an Inferno player is left for the Inferno: its yard, or its map over it (WP 2.10, 3.5).
    if (fromInfernoYard(this.target) && (scene === SceneName.MAP || scene === SceneName.YARD)) {
      backToInferno(scene === SceneName.MAP);
      context.goTo(SceneName.YARD);
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
}
