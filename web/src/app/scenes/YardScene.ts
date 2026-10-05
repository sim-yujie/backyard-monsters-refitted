import { getSession, logout } from "@/api/auth";
import { chatApi, chatConfigFrom } from "@/api/chat";
import { loadAttackOn, loadOwnBase, loadOwnYard, takeAwayJobs, viewBase } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import { ELSEWHERE } from "@/api/presence";
import {
  BaseMode,
  type BaseLoadResponse,
  type BuildingDataMap,
  type MushroomSave,
  type Resources,
  type UpgradeReport,
} from "@/api/types";
import { bankActions } from "@/api/yardBank";
import { buildActions } from "@/api/yardBuild";
import { decorActions } from "@/api/yardDecor";
import { consumeViewTarget, setAttackTarget, setViewTarget, type ViewTarget } from "@/game/attack/attackTarget";
import { worldChat } from "@/game/chat/chatSession";
import { concealTraps, countedBuildings } from "@/game/attack/trapReveal";
import { prefersReducedMotion } from "@/game/attack/AttackBattleLayer";
import { Camera } from "@/game/Camera";
import { setMapFocus } from "@/game/maproom/mapFocus";
import { MapRoomChoice, mapRoomOf, takePrimedOwnYard } from "@/game/maproom/mapRoute";
import { finishedMonstersJobs } from "@/game/monsters/finishedJobs";
import {
  blueprintBlock,
  PlannerAccess,
  plannerAccess,
  plannerEntryTooltip,
} from "@/game/yard/planner/access";
import { buildOffer, buildsAtOnce, categoryOf } from "@/game/yard/buildCatalogue";
import { BuildPlacement } from "@/game/yard/BuildPlacement";
import { fixedWorkSource } from "@/game/yard/buildingWork";
import { startBank, type AnswerBank } from "@/game/yard/bankShow";
import { harvesterNow, predictBank, type BankedByBuilding, type HarvestKey } from "@/game/yard/harvest";
import { MushroomPicker, type MushroomPickView } from "@/game/yard/mushroomPick";
import {
  consumeOwnYardTarget,
  isEmptyOutpost,
  MAIN_YARD,
  outpostBaseid,
  sameYard,
  setOwnYardTarget,
  withCell,
  yardTitle,
  type OwnYardTarget,
} from "@/game/yard/ownYards";
import { readYard, type Yard, type YardBuilding } from "@/game/yard/yardModel";
import { isUnderAttackRefusal, YardAttackGuard } from "@/game/yard/yardAttackGuard";
import { presence } from "@/game/presence/presencePing";
import { yardAttack } from "@/game/presence/yardAttack";
import { UnderAttackLock } from "@/ui/yard/UnderAttackLock";
import { withStoredDecorations } from "@/game/yard/decorStorage";
import { consumeYardIntent, type YardIntent } from "@/game/yard/yardIntent";
import { yardLifeOf } from "@/game/yard/yardLifeModel";
import {
  YardChangeReason,
  YardStore,
  type YardChange,
  type YardUiBinding,
} from "@/game/yard/YardStore";
import type { HatcheryMarks } from "@/game/yard/YardHatchMarks";
import { YardRenderer, YardView } from "@/game/yard/YardRenderer";
import { CompareView, pointerInPlanPane } from "@/game/yard/CompareView";
import { YardInput } from "@/game/yard/YardInput";
import { formatAmount, formatCountdown } from "@/ui/format";
import { Hud } from "@/ui/Hud";
import { Notices } from "@/ui/maproom/Notices";
import { showTakenOver } from "@/ui/maproom/TakeoverDialog";
import { showBuildMapRoom } from "@/ui/maproom1/MapRoomPrompt";
import { MonstersScreen } from "@/ui/monsters/MonstersScreen";
import { ShopScreen } from "@/ui/yard/ShopScreen";
import { MailDoor } from "@/ui/mail/MailDoor";
import { NotificationDoor } from "@/ui/notifications/NotificationDoor";
import { ChatBox } from "@/ui/chat/ChatBox";
import {
  MONSTERS_TAB_ORDER,
  MonsterBuilding,
  MonstersTabId,
  monstersTabFor,
  type MonstersFocus,
} from "@/ui/monsters/monstersTab";
import { monstersTabsFor } from "@/ui/monsters/tabs";
import { resourceAmount } from "@/ui/resourceIcon";
import { TestReportPanel } from "@/ui/attack/TestReport";
import { BuildingPanel } from "@/ui/yard/BuildingPanel";
import { MAP_ROOM_TYPE } from "@/ui/yard/buildingActions";
import { BuildMenu, PlacementBar, spotSentence } from "@/ui/yard/BuildMenu";
import { showBankResult } from "@/ui/yard/CollectAll";
import { showGoldenMushroom } from "@/ui/yard/MushroomReward";
import { describeUpgradeReport } from "@/ui/yard/upgradeText";
import { YardDock } from "@/ui/yard/YardDock";
import { StarterKitPicker } from "@/ui/yard/StarterKitPicker";
import { YardMinimap } from "@/ui/yard/YardMinimap";
import { icon } from "@/ui/icons";
import { ZoomControl } from "@/ui/ZoomControl";
import { YardPlanner, type AppliedStorage, type CompareVisuals } from "./YardPlanner";
import { sceneForMap } from "./MapGateScene";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";
import { BAITER_TYPE, setBaiterRun } from "@/game/baiter/baiterSession";
import { replayOf } from "@/game/baiter/testHistory";
import { guideBus, GuideScreen } from "@/game/guide/guideBus";
import { registerCanvasTarget, tutTarget, TutTarget, type TargetRect } from "@/game/guide/targets";
import { footprintBox } from "@/game/yard/YardGrid";
import { mountYardPlugins, type YardSceneControls } from "@/game/yard/yardPlugins";
import "@/game/yard/plugins";
import { devDetails } from "../devDetails";

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
 *
 * The player's own yard is the main yard or one of their outposts (outposts
 * WP5, #146), named by an {@link OwnYardTarget} the map, the HUD's yard
 * switcher or a takeover hands over (`ownYards.ts`). An outpost opens by its
 * `baseid`, its store sends that `baseid` on every request, and the doors an
 * outpost does not have are left shut: Collect and banking (it banks by
 * itself), Recycle, Cancel on a construction, mushrooms, and the Unlock, Train
 * and Lab tabs of the Monsters screen.
 */

/** The calls a yard can be loaded with, so the choice can be tested. */
export interface YardLoaders {
  loadOwnYard: typeof loadOwnYard;
  loadOwnBase: typeof loadOwnBase;
  viewBase: typeof viewBase;
}

/**
 * Loads the yard a target names: the player's own in build mode when there
 * is no target (the main yard, or the outpost `own` names), otherwise the
 * foreign yard read-only. Pure in the sense that matters — which call is made
 * is decided by the targets and nothing else.
 */
export const loadYardFor = (
  target: ViewTarget | null,
  api: YardLoaders = { loadOwnYard, loadOwnBase, viewBase },
  own: OwnYardTarget = MAIN_YARD,
): Promise<BaseLoadResponse> =>
  !target
    ? own.kind === "outpost"
      ? api.loadOwnBase(own.baseid)
      : api.loadOwnYard()
    : target.mapversion === undefined
      ? api.viewBase(target.baseid, target.kind)
      : api.viewBase(target.baseid, target.kind, { mapversion: target.mapversion });

/**
 * What an outpost holding nothing but its core says, with a way to the
 * Starter Kits, as Flash's help popup offered them there
 * (`client/scripts/BASE.as:2321-2324`, `newmap_sk_hlp`; outposts WP9).
 */
export const EMPTY_OUTPOST_HINT =
  "This outpost has only its core. Open Kits for a ready-made layout, or Build to add buildings one at a time; both are paid from your main yard's storage.";

/**
 * Why a visit has no Attack button, said as text when the yard opens (#153):
 * the map's refusal was only its cell panel's tooltip, which a touch screen
 * never shows, and the visit left the button out without a word. Null for the
 * own yard and for a visit that can attack.
 */
export const refusalNotice = (target: ViewTarget | null): string | null =>
  target && !target.attack && target.refusal ? `No attack from here: ${target.refusal}` : null;

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

/** How often the open panel's countdowns are refreshed. */
const UI_TICK_SECONDS = 1;

/** The notice key of the empty-outpost hint. */
const OUTPOST_HINT_NOTICE = "outpost-empty";

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
  /** The Shop (§8.2), made on first open; own yard only. */
  private shop: ShopScreen | null = null;
  /** The Mail button and the mailbox behind it (#193): the player's own yards only. */
  private mail: MailDoor | null = null;
  /** The bell and its notification list (#257): the own yard only, as Mail is. */
  private bell: NotificationDoor | null = null;
  /** World chat's box (#282), on every yard; the connection is `worldChat`'s and outlives it. */
  private chat: ChatBox | null = null;
  /** The Starter Kit picker, while open (outposts WP9). */
  private kitPicker: StarterKitPicker | null = null;
  /** Picks a tapped mushroom on the own yard (§5.6); null on a foreign one. */
  private mushroomPicker: MushroomPicker | null = null;
  /**
   * Locks the own yard while someone attacks it, and reloads it after
   * (#275, `yardAttackGuard.ts`); null on a visit.
   */
  private attackGuard: YardAttackGuard | null = null;

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
  /**
   * The round buttons (#171): Build, Collect all, Monsters, Layout, Map and
   * the yard switcher on the own yard; Layout, Map, Home and Attack on a visit.
   */
  private dock: YardDock | null = null;
  /**
   * What the player may do with the planner in the yard now open (§8, Q5).
   *
   * Locked until the yard has loaded, because the rule is read off the
   * buildings and there are none to read before then.
   */
  private access: PlannerAccess = PlannerAccess.LOCKED;
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
  /**
   * Which own yard this is when there is no visit target: the main yard, or
   * the outpost the map, the switcher or a takeover asked for. Taken once,
   * in `enter`.
   */
  private own: OwnYardTarget = MAIN_YARD;
  /** An outpost just taken over: "Veni, Vidi, Vici!" once it has loaded. */
  private takenOver: OwnYardTarget["takenOver"] | null = null;
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

  /**
   * The planner's compare (#9): a saved layout beside the plan, sharing the
   * canvas and the camera (`CompareView`). While it lives, the camera's
   * viewport — `viewportWidth` and `viewportHeight` — is the plan's pane, and
   * these are the whole canvas.
   */
  private compare: CompareView | null = null;
  private compareLabels: HTMLElement[] = [];
  /**
   * The new-player tutorial's packages on the own yard (`yardPlugins.ts`,
   * issue #227): their teardown while mounted, and the canvas targets this
   * scene registers for Bob to point at.
   */
  private unmountPlugins: (() => void) | null = null;
  private readonly unregisterTargets: (() => void)[] = [];
  private canvasWidth = 0;
  private canvasHeight = 0;

  async enter(context: SceneContext): Promise<void> {
    this.context = context;
    this.viewportWidth = context.width;
    this.viewportHeight = context.height;
    this.canvasWidth = context.width;
    this.canvasHeight = context.height;
    // Consumed, not read: a target left behind would turn the next plain
    // "Yard" click into a visit to somebody else's base.
    this.target = consumeViewTarget();
    // Taken whatever happens, so it cannot open an outpost on a later visit.
    const own = consumeOwnYardTarget();
    this.own = this.target ? MAIN_YARD : (own ?? MAIN_YARD);
    this.takenOver = this.target ? null : (own?.takenOver ?? null);
    const whose = this.whose();
    context.stage.addChild(this.renderer.root);
    this.renderer.attach(context.renderer);

    /*
     * The HUD redesign (#171, option B, "a game, not a dashboard"): the
     * amounts and the account along the top (`Hud`'s corner), and the yard's
     * doors as round buttons along the bottom (`YardDock`). Map is the way to
     * the world; on a visit, Home is the way back.
     */
    this.hud = new Hud({
      scenes: [],
      layout: "corner",
      onSceneSelect: (id) => context.goTo(id),
      // The achievements screen docks where the mailbox does.
      onAchievementsOpen: () => {
        this.mail?.close();
        this.makeRoomForMail();
      },
      onSignOut: () => {
        logout();
        context.goTo(SceneName.LOGIN);
      },
    });
    this.hud.setActiveScene(SceneName.YARD);
    this.hud.mount(context.overlay.content);

    this.chat = new ChatBox({
      session: worldChat,
      api: chatApi,
      container: context.overlay.content,
      onViewYard: (userId) => this.viewChatPlayer(userId),
    });

    this.notices.mount(context.overlay.content);
    this.notices.element.classList.add("yard-notices");

    this.status = document.createElement("div");
    this.status.className = "cell-readout";
    this.status.textContent = `Loading ${whose}…`;

    /*
     * Layout is the way into the planner (P does the same, and the Q5 access
     * rule is unchanged); Build (§5.3) is the own yard's only and is disabled
     * until the yard's store is up, because every tile reads it. A visit's way
     * into the attack (§4.1) is left out entirely, not disabled, when the
     * map's gate refused — the yard says why once it opens (#153) — and is disabled
     * until the yard has loaded, so an attack cannot start against a yard that
     * failed to open.
     */
    const target = this.target;
    this.dock = new YardDock({
      onMap: () => this.openMap(),
      onLayout: () => this.togglePlanner(),
      ...(target
        ? { onHome: () => context.goTo(SceneName.YARD) }
        : {
            onBuild: () => this.toggleBuildMenu(),
            onYardSelect: (next: OwnYardTarget) => this.openOwnYard(next),
            onKits: () => this.openKits(),
          }),
      ...(target?.attack ? { onAttack: () => void this.startAttack() } : {}),
    }).mount(context.overlay.content);
    this.dock.setLayout({
      disabled: true,
      open: false,
      label: "Layout",
      title: `Loading ${whose}…`,
    });
    if (target?.attack) {
      this.dock.setAttack({ disabled: true, title: `Attack ${target.name}'s yard` });
    }
    if (!target) {
      this.mail = new MailDoor({
        style: "dock",
        container: context.overlay.content,
        onOpen: () => this.makeRoomForMail(),
        onShowOnMap: (cell) => {
          setMapFocus({ cell });
          context.goTo(sceneForMap(MapRoomChoice.MAP_ROOM_2));
        },
        // An invitation to move accepted here (#205): its price left the pool, which the server now holds.
        onInviteAccepted: () => void this.store?.refresh(),
      });
      this.dock.placeBesideMonsters(tutTarget(this.mail.button.element, TutTarget.DOCK_MAIL));
      this.bell = new NotificationDoor({
        container: context.overlay.content,
        onOpen: () => {
          this.mail?.close();
          this.makeRoomForMail();
        },
        currentYard: () => outpostBaseid(this.own) ?? null,
        selectBuilding: (id) => this.focusBuilding(id),
      });
      this.mail.button.element.after(this.bell.bell.element);
    }
    context.overlay.content.append(this.status);
    this.inset = { top: this.hud.element.getBoundingClientRect().bottom, bottom: 0 };

    window.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    this.panelDock = document.createElement("div");
    this.panelDock.className = "map-dock map-dock--right";
    context.overlay.content.append(this.panelDock);

    if (!target) this.startAttackGuard(context);

    await this.load();
  }

  exit(): void {
    presence.setScreen(ELSEWHERE);
    for (const unregister of this.unregisterTargets.splice(0)) unregister();
    this.attackGuard?.destroy();
    this.attackGuard = null;
    window.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.dropStore();
    this.endCompare();
    this.planner?.destroy();
    this.planner = null;
    this.mail?.destroy();
    this.mail = null;
    this.bell?.destroy();
    this.bell = null;
    this.chat?.destroy();
    this.chat = null;
    this.dock?.destroy();
    this.dock = null;
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
    this.canvasWidth = width;
    this.canvasHeight = height;
    // In compare the camera sees the plan's pane, not the whole canvas.
    const pane = this.compare ? this.compare.resize(width, height)[0] : { width, height };
    this.viewportWidth = pane.width;
    this.viewportHeight = pane.height;
    this.camera?.resize(pane.width, pane.height);
    if (this.yard) this.applyZoomLimits(pane.width, pane.height);
    this.placeCompareLabels();
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
        this.compare?.place(camera);
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

    if (camera && this.compare) {
      const view = camera.visibleWorldRect();
      this.compare.draw(
        { x: view.left, y: view.top, width: view.right - view.left, height: view.bottom - view.top },
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
      this.shop?.tick();
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
    this.compare?.setView(view);
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
    const own = this.own;
    const whose = this.whose();

    try {
      // The own-yard load that sent a player with no Map Room here from the
      // map door (issue #162), when there was one: always the main yard's.
      const primed = !target && own.kind === "main" ? takePrimedOwnYard() : null;
      const response = primed ?? (await loadYardFor(target, undefined, own));
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
      // The owner's load carries world chat's token and room (#282).
      const chat = target ? null : chatConfigFrom(response, getSession()?.userId ?? 0, location.protocol === "https:");
      if (chat) worldChat.configure(chat);

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
      // Harvesters, hatcheries and the rest animate only while working
      // (#255): read off the store's save on its clock, or the visit's load.
      this.renderer.setWork(
        store ? { save: () => store.save, now: () => store.now() } : fixedWorkSource(response),
      );
      this.renderer.show(yard);
      // What lives on the yard (#158). A visit's load carries the defender's
      // monsters, champion and workers, which Flash drew there too (#159).
      this.renderer.setLife(yardLifeOf(response, yard, store ? "own" : "visit"));
      // A visitor never sees another yard's traps (`BTRAP.as:33-43`, #66);
      // the player's own yard shows them, as build mode always did.
      if (target) concealTraps(this.renderer, yard);
      this.startCamera(yard, context);

      // A visit's response carries the defender's pool, not the player's, so
      // the HUD shows the visitor's own, as the map read it (#60), and never
      // somebody else's twigs as if they were the player's own.
      const pool = hudPoolFor(target, yard);
      if (pool) this.hud?.setResources(pool.resources, pool.credits);
      if (this.target?.attack) {
        this.dock?.setAttack({ disabled: false, title: `Attack ${this.target.name}'s yard` });
      } else {
        const refused = refusalNotice(this.target);
        if (refused) this.notices.show("attack-refused", refused, { level: "info" });
      }
      this.refreshBuildButton();
      // Once the yard is drawn, because the first answer may redraw it.
      store?.start();
      // The tutorial's packages (issue #227), then the screen event they listen for.
      if (store) this.mountPlugins(store, context);
      // The presence ping says the player is here (#226): a raid may be due.
      this.tellPresence();
      // What the screen the player came from asked for, on the own yard only.
      if (store) this.applyIntent(consumeYardIntent());
      if (store?.kind === "outpost") this.arriveAtOutpost(store, context);
    } catch (caught) {
      if (caught instanceof ApiError && caught.isAuthFailure) {
        context.goTo(SceneName.LOGIN);
        return;
      }
      // Someone is attacking it: the lock says so, and loads it once they are done.
      if (!target && this.attackGuard && isUnderAttackRefusal(caught)) {
        this.attackGuard.refused();
        if (this.status) {
          this.status.hidden = false;
          this.status.textContent = "Your yard opens when the attack is over.";
        }
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
      if (this.status) {
        this.status.hidden = false;
        this.status.textContent = target
          ? "This yard did not load."
          : own.kind === "outpost"
            ? "Your outpost did not load."
            : "Your yard did not load.";
      }
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
    if (!attack || !context || this.attacking) return;
    const title = `Attack ${attack.name}'s yard`;

    this.attacking = true;
    this.dock?.setAttack({ disabled: true, title });
    this.notices.show("attack", `Starting the attack on ${attack.name}…`, { level: "info" });

    try {
      const load = await loadAttackOn(attack);
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
      this.dock?.setAttack({ disabled: false, title });
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
    this.registerTargets(camera, context);

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
   * Builds the zoom control and the minimap: a rail on the right edge with a
   * button for the minimap (#171), or, while the planner is open, the slider,
   * Fit and the minimap in the bottom-right corner.
   *
   * Both are created once the camera exists and destroyed with the scene; the
   * planner never owns them, it only marks the minimap dirty when it moves
   * something. That keeps the plan and the session free of any knowledge of
   * the DOM, which is the reason the planner reports through a callback rather
   * than being handed the canvas.
   */
  private startViewTools(camera: Camera, context: SceneContext): void {
    const tools = document.createElement("div");
    tools.className = this.planner ? "yard-viewtools" : "yard-viewtools yard-viewtools--rail";
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

    // On the rail the minimap waits behind a button of its own (#171).
    const overview = document.createElement("button");
    overview.type = "button";
    overview.className = "yard-viewtools__overview";
    overview.title = "Yard overview: click on it to move the view";
    overview.setAttribute("aria-label", "Yard overview");
    overview.setAttribute("aria-pressed", "false");
    overview.append(icon("overview", 20));
    overview.addEventListener("click", () => {
      const on = tools.classList.toggle("yard-viewtools--overview");
      overview.setAttribute("aria-pressed", String(on));
      if (on) this.minimap?.markDirty();
    });
    tools.append(overview);

    this.placeViewTools();
  }

  /**
   * Keeps the planner's bottom-right furniture clear of its action bar, and
   * the status line above it on the left, where "Yard centre" is read (#56:
   * it sat behind the bar). Out of the planner the tools are the zoom rail on
   * the right edge and the line is back beside Map.
   *
   * The same number `applyZoomLimits` keeps the fit floor out from under, so
   * the two cannot disagree about where the bottom of the canvas is.
   */
  private placeViewTools(): void {
    const above = this.planner ? `calc(${this.inset.bottom}px + var(--space-3))` : "";
    if (this.status) this.status.style.bottom = above;
    if (!this.viewTools) return;
    // The rail is centred on the right edge by its stylesheet.
    this.viewTools.style.bottom = above;
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
    // An outpost banks by itself (`BUILDINGINFO.as:130-131`): a tap only selects.
    if (!building || !store || !binding || this.planner || store.kind === "outpost") return;
    const waiting = harvesterNow(building.raw, store.save, store.now());
    if (!waiting?.bankable || waiting.offer <= 0) return;

    // The balls leave on the tap; the answer only corrects the totals (#208).
    const answer = this.startBank(
      predictBank(store.save, store.now(), [building.id], store.resources, store.caps),
    );
    void bankActions(store)
      .one(building.id)
      .then((result) => {
        answer?.(result.ok ? { banked: result.report.banked } : null);
        if (this.binding !== binding) return;
        showBankResult(binding.notices, result);
        const amount = result.ok ? (result.report.byBuilding[String(building.id)]?.amount ?? 0) : 0;
        if (amount > 0) this.floatBanked(building.id, waiting.resource, amount);
      });
  }

  /**
   * A bank's resource balls fly from each harvester in `predicted` to the
   * Town Hall as it is pressed, and the HUD counts up across their flight; the
   * returned function takes the server's answer (#208, `bankShow.ts`). Under
   * `prefers-reduced-motion` nothing flies and the HUD shows the new amounts
   * at once, as the answer leaves them.
   */
  private startBank(predicted: BankedByBuilding): AnswerBank | null {
    const hud = this.hud;
    if (!hud || prefersReducedMotion()) return null;
    return startBank(predicted, this.renderer, hud);
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
      const open = this.panel !== null;
      this.panel?.close();
      this.panel = null;
      this.monsters?.besidePanel(false);
      this.shop?.besidePanel(false);
      if (open) guideBus.emit("panel", { building: null });
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
        ...(this.binding ? { openMap: () => this.openMap() } : {}),
        onClose: () => {
          this.panel = null;
          this.selected = null;
          this.renderer.setSelected(null);
          this.monsters?.besidePanel(false);
          this.shop?.besidePanel(false);
          guideBus.emit("panel", { building: null });
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
    this.shop?.besidePanel(true);
    guideBus.emit("panel", { building: { id: building.id, type: building.type } });

    // A monster building opens its tab of the Monsters screen (D4), beside
    // the panel, which keeps the building's own upgrade. A Housing's panel is
    // the Housing panel itself (#170), which has the tab's army in it, so the
    // screen steps aside for it. Still on its first build (level 0), the
    // building has no working window yet: the panel's construction info is
    // all a click should open (#281).
    const tab = monstersTabFor(building.type);
    if (tab === MonstersTabId.HOUSING) this.monsters?.close();
    else if (tab && this.binding && building.level > 0) {
      this.openMonsters(tab, { buildingId: building.id });
    }
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
    // An outpost's screen has Hatch and Housing only; the HUD's Monsters
    // button, which asks for Unlock, opens its first tab there.
    const tabs = monstersTabsFor(binding.store.kind);
    const shown = tabs.some((one) => one.id === tab) ? tab : tabs[0]?.id;
    if (!shown) return;
    this.buildMenu?.close();
    this.shop?.close();
    this.mail?.close();
    this.bell?.close();
    this.hud?.achievements?.close();
    this.monsters ??= new MonstersScreen({ binding, tabs }).mount(context.overlay.content);
    this.monsters.besidePanel(this.panel !== null);
    this.monsters.open(shown, focus);
    // The player is looking: the Monsters button's cyan count starts again (#192).
    finishedMonstersJobs.clear();
  }

  /**
   * The Hatch tab's hatchery numbers and its chosen hatchery (#268), drawn
   * over the yard. An open hatchery panel follows the window's choice, so the
   * panel, the outline and the window all name the same building.
   */
  private markHatcheries(marks: HatcheryMarks | null): void {
    this.renderer.setHatcheryMarks(marks);
    const chosen = marks?.chosen ?? null;
    const selected = this.selected;
    if (chosen === null || !this.panel || !selected || selected.id === chosen) return;
    if (selected.type !== MonsterBuilding.HATCHERY) return;
    const building = this.yard?.buildings.find((one) => one.id === chosen);
    if (!building) return;
    this.selected = building;
    this.renderer.setSelected(building);
    this.panel.show(building);
    guideBus.emit("panel", { building: { id: building.id, type: building.type } });
  }

  /**
   * The mailbox docks where the Monsters screen, the Shop and the building
   * panel do (#193), so they make way as it opens, as they do for each other.
   * The planner hides the dock, and with it the Mail button. The bell's list
   * (#257) docks there too, and makes way for the mailbox the same way.
   */
  private makeRoomForMail(): void {
    this.bell?.close();
    this.hud?.achievements?.close();
    this.endPlacement();
    this.select(null);
    this.buildMenu?.close();
    this.monsters?.close();
    this.shop?.close();
  }

  /**
   * Opens the Shop (§8.2): the HUD's Shiny counter and the General Store's
   * Open Shop button come here. It docks where the Monsters screen does, so
   * that one closes. Own yard only, and not over the planner.
   */
  private openShop(): void {
    const binding = this.binding;
    const context = this.context;
    if (!binding || !context || this.planner) return;
    this.endPlacement();
    this.buildMenu?.close();
    this.monsters?.close();
    this.mail?.close();
    this.bell?.close();
    this.hud?.achievements?.close();
    this.shop ??= new ShopScreen({ binding }).mount(context.overlay.content);
    this.shop.besidePanel(this.panel !== null);
    this.shop.open();
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
    this.openBuildMenu();
  }

  /**
   * Opens the Build window, on one building's tile when `type` is given
   * (the Map link's "Build Map Room", a Map Room 1 card's "Build Flinger").
   */
  private openBuildMenu(type?: number): void {
    const binding = this.binding;
    const context = this.context;
    if (!binding || !context || this.planner) return;
    this.endPlacement();

    // The menu docks where the building panel and the Monsters screen do.
    this.select(null);
    this.monsters?.close();
    this.shop?.close();
    this.mail?.close();
    this.bell?.close();
    this.hud?.achievements?.close();
    this.buildMenu ??= new BuildMenu({
      binding,
      onPick: (picked, instant) => this.startPlacement(picked, instant),
      onTownHall: () => this.showTownHall(),
      onClose: () => {
        this.refreshBuildButton();
        guideBus.emit("buildMenu", { open: false });
      },
    }).mount(context.overlay.content);
    const category = type === undefined ? null : categoryOf(type);
    if (category) {
      this.buildMenu.open(category);
      this.buildMenu.pick(type!);
    } else {
      this.buildMenu.open();
    }
    this.refreshBuildButton();
    guideBus.emit("buildMenu", { open: true, ...(category ? { tab: category } : {}) });
  }

  /**
   * World chat's "View yard" (#282): the player's main yard, read-only, by
   * the map rooms' way in (`setViewTarget`). Chat does not know where they
   * are on the map, so the visit has no cell and no Attack button. Throws
   * when the yard cannot be found, for the box to say so.
   */
  private async viewChatPlayer(userId: number): Promise<void> {
    const context = this.context;
    const yard = await chatApi.yardOf(userId);
    if (!yard) throw new Error("No yard");
    if (this.context !== context || !context) return;
    const store = this.store;
    const own = store
      ? { resources: store.resources, credits: store.credits }
      : this.target?.own;
    setViewTarget({
      baseid: yard.baseid,
      kind: "main",
      name: yard.name,
      attack: null,
      refusal: null,
      own,
    });
    context.goTo(SceneName.YARD);
  }

  /**
   * The HUD's Map and the Map Room's Open map (issue #162): Map Room 2 for a
   * player who has moved, Map Room 1 for a built Map Room, and with none,
   * the way to build one — never the Map Room 2 world, which is a dead end
   * without a home cell in it. A visit (or a yard not loaded yet) asks the
   * map door, which loads the own yard to decide.
   */
  private openMap(): void {
    const context = this.context;
    if (!context) return;
    const store = this.store;
    if (this.target || !store) {
      context.goTo(SceneName.MAP);
      return;
    }
    // An outpost is a Map Room 2 cell: its map is that world, opened on it.
    if (store.kind === "outpost") {
      if (store.target.cell) setMapFocus({ cell: store.target.cell });
      context.goTo(sceneForMap(MapRoomChoice.MAP_ROOM_2));
      return;
    }
    const choice = mapRoomOf(store.save);
    if (choice !== MapRoomChoice.NONE) {
      context.goTo(sceneForMap(choice));
      return;
    }
    showBuildMapRoom(context.overlay.modal, () => this.openBuildMenu(MAP_ROOM_TYPE));
  }

  /** Carries out what another screen asked the own yard to open (`yardIntent.ts`). */
  private applyIntent(intent: YardIntent | null): void {
    if (!intent) return;
    if (intent.kind === "build") this.openBuildMenu(intent.type);
    else if (intent.kind === "baiter") {
      const baiter = this.yard?.buildings.find((one) => one.type === BAITER_TYPE);
      if (!baiter) return;
      this.focusBuilding(baiter.id);
      this.panel?.openBaiter();
    } else {
      const tab = MONSTERS_TAB_ORDER.find((one) => one === intent.tab);
      if (tab) this.openMonsters(tab);
    }
  }

  /** The Build window's "Upgrade Town Hall": close it and open the hall's panel. */
  private showTownHall(): void {
    const hall = this.yard?.townHall;
    if (!hall) return;
    this.buildMenu?.close();
    this.focusBuilding(hall.id);
  }

  /** Enabled on the own yard once it has loaded, and not over the planner. */
  private refreshBuildButton(): void {
    const carrying = this.placement !== null;
    this.dock?.setBuild({
      disabled: !this.store || this.planner !== null,
      carrying,
      open: carrying || this.buildMenu?.isOpen === true,
    });
  }

  /**
   * Starts carrying a new building of `type`, from a tile of the menu: the
   * menu closes, the building appears in the middle of the screen and follows
   * the pointer, and a click builds it (`BuildPlacement.ts`). A wall or trap
   * stays in hand after each block; anything else is done after one, and its
   * panel opens on the new building. A decoration from the Decorations tab
   * comes out of storage (`decor/place`, §8.3): free and finished.
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
    const storage = offer.stored !== null ? decorActions(store) : null;
    const repeat = buildsAtOnce(type) && !instant && !storage;
    let placed: number | null = null;

    const bar = new PlacementBar({
      type,
      instant,
      instantPrice: offer.instantPrice,
      cost: offer.cost,
      time: offer.atOnce ? "At once" : formatCountdown(offer.seconds),
      onCancel: () => this.endPlacement(),
      onBuildHere: () => placement.dropHere(),
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
        // A one-off building is down; the bar says so until the answer (#277).
        if (!repeat) bar.setBuilding(true);
        const result = storage
          ? await storage.place(type, x, y)
          : instant
            ? await actions.instant(type, x, y)
            : await actions.build(type, x, y);
        if (this.placement !== placement) return result.ok ? "placed" : "refused";
        if (!result.ok) {
          bar.setBuilding(false);
          bar.setMessage(result.refusal.message, "bad");
          return "refused";
        }
        placed = result.report.id;
        guideBus.emit("placed", { type, id: result.report.id });
        if (repeat) bar.setBuiltAgain();
        else bar.setMessage(null);
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
    guideBus.emit("carry", { type });
  }

  /** Puts down whatever is in hand, without building it. */
  private endPlacement(): void {
    if (this.placement) guideBus.emit("carry", { type: null });
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

    const yard = this.plannerYard();
    const camera = this.camera;
    const context = this.context;
    const hud = this.hud;
    if (!yard || !camera || !context || !hud) return;

    this.select(null);
    this.monsters?.close();
    this.shop?.close();
    this.mail?.close();
    this.bell?.close();
    this.hud?.achievements?.close();
    this.endPlacement();
    this.buildMenu?.close();
    // Stored decorations need sprites to be carried out of the drawer.
    if (yard !== this.renderer.shown) {
      this.renderer.show(yard);
      this.minimap?.refreshBuildings();
    }
    // The planner takes the whole screen; chat steps aside until it closes.
    this.chat?.setOpen(false);
    this.chat?.setHidden(true);
    this.planner = new YardPlanner({
      yard,
      renderer: this.renderer,
      camera,
      canvas: context.canvas,
      overlay: context.overlay.content,
      notices: this.notices,
      readOnlyToolbar: hud.element,
      readOnly: this.access === PlannerAccess.READ_ONLY,
      // Blueprint needs a Yard Planner in this yard, and never in an outpost.
      blueprintBlocked: blueprintBlock(yard),
      ...(this.save?.firedtraps ? { firedtraps: this.save.firedtraps } : {}),
      // An outpost's Apply and batch actions act on it (outposts WP3).
      ...(this.store?.baseid !== undefined ? { baseid: this.store.baseid } : {}),
      onApplied: (buildingdata, moved, resources, upgrades, storage) =>
        this.onApplied(buildingdata, moved, resources, upgrades, storage),
      onYardChanged: (buildingdata, resources, mushrooms) =>
        this.onYardChanged(buildingdata, resources, mushrooms),
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
      // Compare (#9): the main yard's layouts beside the plan.
      ...(this.store && this.store.kind === "main"
        ? {
            save: this.store.save,
            compare: {
              start: (slotYard, labels) => this.startCompare(slotYard, labels),
              highlight: (visuals) => this.highlightCompare(visuals),
              end: () => this.endCompare(),
            },
          }
        : {}),
    });
    this.renderer.setLifeHidden(true);
    // The planner's constructor reports its own inset synchronously (via
    // `onInset` above), so `this.inset.top` is already the top bar's real
    // measured height here — that is what the notice dock tucks under
    // instead of the HUD, so it stops sitting partly behind the bar (#44).
    this.notices.setTopInset(this.inset.top);
    this.refreshPlannerButton();
    this.tellPresence();
    guideBus.emit("screen", {
      id: GuideScreen.PLANNER,
      root: context.overlay.content,
      header: context.overlay.content.querySelector<HTMLElement>(".planner-bar"),
    });
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
    const open = this.planner !== null;
    this.dock?.setLayout({
      disabled: this.access === PlannerAccess.LOCKED,
      open,
      label: open ? "Close layout" : this.access === PlannerAccess.READ_ONLY ? "View layout" : "Layout",
      title: open ? "Leave the layout planner (P)" : plannerEntryTooltip(this.access),
    });
    // Outside the planner the zoom is the rail on the right edge (#171); the
    // planner keeps the slider, Fit and the minimap along its bottom bar.
    this.viewTools?.classList.toggle("yard-viewtools--rail", !open);
    this.placeViewTools();
    this.refreshBuildButton();
  }

  /**
   * The yard the planner works on: the store's, plus every decoration in
   * storage as a building its drawer holds (#128,
   * `decorStorage.ts` `withStoredDecorations`). The store's own yard when
   * nothing is stored, or in an outpost, which has no storage.
   */
  private plannerYard(): Yard | null {
    const store = this.store;
    if (!store || store.kind === "outpost") return this.yard;
    const save = withStoredDecorations(store.save);
    return save === store.save ? store.yard : readYard(save);
  }

  /* ── Compare (#9) ───────────────────────────────────────────────────── */

  /**
   * Draws a saved layout beside the plan: the canvas splits in two, the
   * camera's viewport becomes the plan's pane, and a pointer over either pane
   * pans and zooms both. `labels` name the panes, plan's first.
   */
  private startCompare(yard: Yard, labels: readonly [string, string]): void {
    const context = this.context;
    const camera = this.camera;
    if (!context || !camera || this.compare) return;
    const compare = new CompareView({
      stage: context.stage,
      pixi: context.renderer,
      main: this.renderer,
      yard,
      view: this.renderer.view,
    });
    this.compare = compare;
    // The middle of what the player was looking at stays in the middle.
    const middle = camera.screenToWorld({ x: this.viewportWidth / 2, y: this.viewportHeight / 2 });
    camera.setPointerMap((point) => pointerInPlanPane(point, compare.layout));
    this.compareLabels = labels.map((text, index) => {
      const label = document.createElement("div");
      label.className = `compare-label compare-label--${index === 0 ? "plan" : "slot"}`;
      label.textContent = text;
      context.overlay.content.append(label);
      return label;
    });
    this.resize(this.canvasWidth, this.canvasHeight);
    camera.centreOn(middle);
    camera.dirty = true;
  }

  /** The slot pane's highlights. */
  private highlightCompare(visuals: CompareVisuals): void {
    this.compare?.setVisuals({
      selected: new Set(),
      moved: new Set(),
      invalid: new Set(),
      marquee: null,
      planned: visuals.planned,
      diff: visuals.diff,
    });
  }

  /** Back to one yard on the whole canvas. */
  private endCompare(): void {
    const compare = this.compare;
    if (!compare) return;
    const camera = this.camera;
    const middle = camera?.screenToWorld({ x: this.viewportWidth / 2, y: this.viewportHeight / 2 });
    this.compare = null;
    compare.destroy();
    for (const label of this.compareLabels) label.remove();
    this.compareLabels = [];
    camera?.setPointerMap(null);
    this.resize(this.canvasWidth, this.canvasHeight);
    if (camera && middle) {
      camera.centreOn(middle);
      camera.dirty = true;
    }
  }

  /** Puts each pane's name at the top of its pane, under the planner's bar. */
  private placeCompareLabels(): void {
    const compare = this.compare;
    if (!compare) return;
    compare.layout.forEach((pane, index) => {
      const label = this.compareLabels[index];
      if (!label) return;
      label.style.left = `${pane.x + 12}px`;
      label.style.top = `${Math.max(pane.y, this.inset.top) + 8}px`;
    });
  }

  private closePlanner(): void {
    this.endCompare();
    this.planner?.destroy();
    this.planner = null;
    this.chat?.setHidden(false);
    this.renderer.setLifeHidden(false);
    // The drawer's stored decorations had sprites of their own; the yard has not.
    const yard = this.store?.yard;
    if (yard && this.renderer.shown !== yard) {
      this.renderer.show(yard);
      this.minimap?.refreshBuildings();
    }
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
    this.tellPresence();
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
    storage: AppliedStorage,
  ): void {
    const store = this.store;
    if (!store || !this.context) return;

    this.closePlanner();

    // The pool comes back charged whenever Apply started anything, so it is
    // taken from the response rather than subtracted here: the server owns
    // what an upgrade cost, and the walk it ran is partial by design
    // (`docs/design/planner-upgrades.md` §5.5).
    store.mergeWrite({
      buildingdata,
      ...(resources ? { resources } : {}),
      // What Apply put into storage and took out of it (#128).
      ...(storage.researchdata ? { researchdata: storage.researchdata } : {}),
      ...(storage.buildinghealthdata ? { buildinghealthdata: storage.buildinghealthdata } : {}),
      // Mushrooms a building landed on have popped up elsewhere (#263).
      ...(storage.mushrooms ? { mushrooms: storage.mushrooms } : {}),
    });

    // Raised here rather than by the planner because the planner has just been
    // closed and clears its own notices on the way out (§8, Q4).
    const moveText = [
      `Moved ${moved} building${moved === 1 ? "" : "s"}.`,
      storageText(storage),
    ]
      .filter(Boolean)
      .join(" ");
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
  private onYardChanged(
    buildingdata: BuildingDataMap,
    resources: Resources,
    mushrooms?: MushroomSave,
  ): void {
    // The store's change does the rebuild and the `rebase` (`onStoreChange`).
    this.store?.mergeWrite({ buildingdata, resources, ...(mushrooms ? { mushrooms } : {}) });
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
      // The yard's title needs the outpost's cell, which the load lists.
      target: withCell(this.own, response),
      // What this load, or the map's load before it, finished while the
      // player was away (#135); the store announces it once it starts.
      away: takeAwayJobs(outpostBaseid(this.own)),
      onAuthFailure: () => {
        if (this.context === context) context.goTo(SceneName.LOGIN);
      },
      onUnderAttack: () => this.attackGuard?.refused(),
    });
    this.store = store;
    this.unsubscribeStore = store.subscribe((change) => this.onStoreChange(change));
    this.binding = {
      store,
      scene: {
        selectBuilding: (id) => this.focusBuilding(id),
        openMonsters: (tab, focus) => this.openMonsters(tab, focus),
        runBaiter: (run) => {
          setBaiterRun(run);
          this.context?.goTo(SceneName.BAITER);
        },
        watchBaiter: (run) => {
          setBaiterRun(run);
          this.context?.goTo(SceneName.BAITER_REPLAY);
        },
        showBaiterReport: (test) => {
          const modal = this.context?.overlay.modal;
          if (!modal) return;
          // The yard may have changed since, so the rows show nothing on it;
          // the replay plays the yard as it was.
          const report: TestReportPanel = new TestReportPanel({
            report: test.report,
            onReplay: () => {
              report.close();
              setBaiterRun(replayOf(test));
              this.context?.goTo(SceneName.BAITER_REPLAY);
            },
            onBack: () => report.close(),
            backLabel: "Close",
          }).mount(modal);
        },
        openShop: () => this.openShop(),
        startBank: (predicted) => this.startBank(predicted),
        markHatcheries: (marks) => this.markHatcheries(marks),
      },
      notices: this.notices,
      modal: context.overlay.modal,
    };
    this.hud?.bindYard(this.binding);
    this.dock?.bind(this.binding);
    this.mail?.setSaveUnread(store.save.unreadmessages);
    this.bell?.setSaveCount(store.save.notifications);
    // Mushrooms are picked in the main yard only (the route refuses an outpost).
    this.mushroomPicker =
      store.kind === "main" ? new MushroomPicker(store, this.mushroomView(context)) : null;
    return store;
  }

  /* ── The tutorial (issue #227) ─────────────────────────────────────── */

  /**
   * Mounts the tutorial's packages on the own yard (`yardPlugins.ts`) once
   * its store is up and the yard drawn, then says the yard screen opened.
   * Torn down with the store (`dropStore`).
   */
  private mountPlugins(store: YardStore, context: SceneContext): void {
    const binding = this.binding;
    const camera = this.camera;
    const dock = this.dock;
    const hud = this.hud;
    if (!binding || !camera || !dock || !hud) return;
    this.unmountPlugins?.();
    this.unmountPlugins = mountYardPlugins({
      store,
      binding,
      renderer: this.renderer,
      camera,
      canvas: context.canvas,
      overlay: context.overlay,
      dock,
      hud,
      notices: this.notices,
      scene: this.sceneControls(),
    });
    guideBus.emit("screen", { id: GuideScreen.YARD, root: context.overlay.content, header: null });
  }

  /** What a yard package may ask of this scene (`YardSceneControls`). */
  private sceneControls(): YardSceneControls {
    return {
      openBuildMenu: (type) => this.openBuildMenu(type),
      closeBuildMenu: () => {
        this.endPlacement();
        this.buildMenu?.close();
      },
      focusBuilding: (id) => this.focusBuilding(id),
      closePanel: () => this.select(null),
      selectedBuilding: () => this.selected?.id ?? null,
      openMap: () => this.openMap(),
      openMonsters: (tab, focus) => this.openMonsters(tab, focus),
      openShop: () => this.openShop(),
      centreOn: (x, y) => {
        const camera = this.camera;
        if (!camera) return;
        camera.centreOn(this.renderer.yardToWorld(x, y));
        camera.dirty = true;
      },
      plannerOpen: () => this.planner !== null,
      carrying: () => this.placement !== null,
      openRaid: () => this.context?.goTo(SceneName.RAID),
      reload: () => this.reloadOwnYard(),
    };
  }

  /**
   * Where the presence ping says the player is (#226): the own main yard, and
   * whether its Yard Planner is open, so the server knows when a wild monster
   * raid may come. A visit and an outpost are "elsewhere".
   */
  private tellPresence(): void {
    const ownMain = !this.target && this.own.kind === "main" && this.store !== null;
    presence.setScreen(ownMain ? { where: "yard", planner: this.planner !== null } : ELSEWHERE);
  }

  /**
   * The canvas things Bob can point at (`targets.ts`): any building by id
   * (`building:<id>`), and the building in hand (`carry-ghost`), each as its
   * footprint's box on screen with room above for the art.
   */
  private registerTargets(camera: Camera, context: SceneContext): void {
    for (const unregister of this.unregisterTargets.splice(0)) unregister();
    const onScreen = (box: { x: number; y: number; width: number; height: number }): TargetRect => {
      const canvas = context.canvas.getBoundingClientRect();
      // The art stands up off its footprint: half as high again.
      const lift = box.height * 0.5;
      const topLeft = camera.worldToScreen({ x: box.x, y: box.y - lift });
      return {
        left: canvas.left + topLeft.x,
        top: canvas.top + topLeft.y,
        width: box.width * camera.zoom,
        height: (box.height + lift) * camera.zoom,
      };
    };
    this.unregisterTargets.push(
      registerCanvasTarget(TutTarget.BUILDING, (param) => {
        const id = Number(param);
        const building = this.yard?.buildings.find((one) => one.id === id);
        return building && !this.planner ? onScreen(building.box) : null;
      }),
      registerCanvasTarget(TutTarget.CARRY_GHOST, () => {
        const spot = this.placement?.current;
        const yard = this.yard;
        if (!spot || !yard || !this.placement) return null;
        return onScreen(footprintBox(yard.bounds, this.placement.type, spot.x, spot.y));
      }),
    );
  }

  /* ── Own yards ──────────────────────────────────────────────────────── */

  /** "your yard", "your outpost" or "Name's yard", for the loading lines. */
  private whose(): string {
    if (this.target) return `${this.target.name}'s yard`;
    return this.own.kind === "outpost" ? "your outpost" : "your yard";
  }

  /**
   * The yard switcher picked another own yard: the yard screen opens again
   * on it. Not over the planner, whose unsaved plan the switch would drop.
   */
  /**
   * The own yard's lock while it is attacked (#275): a scrim and a banner on
   * the modal layer, over every door and panel, with the map still open.
   */
  private startAttackGuard(context: SceneContext): void {
    const lock = new UnderAttackLock({
      serverNow: () => this.store?.now() ?? yardAttack.serverNow(),
      onMap: () => this.openMap(),
    });
    this.attackGuard = new YardAttackGuard({
      watch: yardAttack,
      view: {
        show: (by, ends) => lock.show(context.overlay.modal, by, ends),
        hide: () => lock.hide(),
      },
      reload: () => this.reloadOwnYard(),
    });
  }

  /** Opens this own yard afresh, as the server has it now: after an attack (#275). */
  private reloadOwnYard(): void {
    const context = this.context;
    if (!context) return;
    if (this.own.kind === "outpost") {
      const { takenOver: _shown, ...again } = this.own;
      setOwnYardTarget(again);
    }
    context.goTo(SceneName.YARD);
  }

  private openOwnYard(target: OwnYardTarget): void {
    const context = this.context;
    if (!context || sameYard(target, this.own)) return;
    if (this.planner) {
      this.notices.show("yard-switch", "Close the layout planner before you switch yards.", {
        level: "info",
        timeoutMs: 4_000,
      });
      return;
    }
    setOwnYardTarget(target);
    context.goTo(SceneName.YARD);
  }

  /**
   * What an outpost says as it opens: Flash's "Veni, Vidi, Vici!" when it was
   * just taken over, and the empty-outpost hint while it holds only its core.
   */
  private arriveAtOutpost(store: YardStore, context: SceneContext): void {
    const takenOver = this.takenOver;
    this.takenOver = null;
    if (takenOver) showTakenOver(context.overlay.modal, takenOver.kind, takenOver.name);
    guideBus.emit("screen", { id: GuideScreen.OUTPOSTS, root: context.overlay.content, header: null });
    if (!isEmptyOutpost(store.yard)) return;
    // Stays until dismissed, or until the first building goes up (`onStoreChange`).
    this.notices.show(OUTPOST_HINT_NOTICE, EMPTY_OUTPOST_HINT, {
      level: "info",
      actionLabel: "Kits",
      onAction: () => this.openKits(),
    });
  }

  /**
   * Opens the Starter Kit picker on an own outpost (outposts WP9). Not over
   * the planner, and not while a building is in hand. A kit bought redraws
   * the yard through the store, and says what it did.
   */
  private openKits(): void {
    const binding = this.binding;
    const context = this.context;
    if (!binding || !context || binding.store.kind !== "outpost" || this.planner) return;
    if (this.kitPicker?.isOpen) return;
    this.endPlacement();
    this.buildMenu?.close();
    this.select(null);
    this.kitPicker = new StarterKitPicker({
      binding,
      onBought: (report, kit) => {
        if (this.binding !== binding) return;
        this.notices.clear(OUTPOST_HINT_NOTICE);
        this.notices.show(
          "starter-kit",
          report.pay === "shiny"
            ? `${kit.name} built: ${report.placed} buildings are ready.`
            : `${kit.name} placed: ${report.placed} buildings are building up, without your worker.`,
          { level: "info", timeoutMs: 8_000 },
        );
      },
      onClose: () => {
        this.kitPicker = null;
      },
    }).mount(context.overlay.modal);
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
    this.unmountPlugins?.();
    this.unmountPlugins = null;
    this.mushroomPicker = null;
    // The menu and the placement read the store they were made with.
    this.endPlacement();
    this.buildMenu?.destroy();
    this.buildMenu = null;
    this.monsters?.destroy();
    this.monsters = null;
    this.shop?.destroy();
    this.shop = null;
    this.kitPicker?.close();
    this.kitPicker = null;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.store?.destroy();
    this.store = null;
    this.binding = null;
    this.renderer.finishBank();
    this.hud?.bindYard(null);
    this.dock?.bind(null);
  }

  /**
   * Redraws the yard from the store: the sprites, the minimap, the HUD's pool,
   * the planner's base when it is open, and the open panel, re-pointed at the
   * same building in the new yard.
   *
   * `pending` only says which requests are running, which is the panel's and
   * the HUD's business through their own subscriptions, and `away` is the
   * HUD's notice about a yard already drawn; nothing here changes. `income`
   * moves only the pool (#207), so only the HUD's readouts follow it.
   */
  private onStoreChange(change: YardChange): void {
    const store = this.store;
    if (!store || !this.camera) return;
    // Monster jobs that finished out of the player's sight, for the Monsters
    // button's cyan count (#192); one that ends with the screen open is seen.
    if (!this.monsters?.isOpen) finishedMonstersJobs.add(change.completed);
    if (change.completed.length > 0) guideBus.emit("jobFinished", { jobs: change.completed });
    if (change.reason !== YardChangeReason.AWAY) this.bell?.jobsFinished(change.completed);
    if (change.reason === YardChangeReason.PENDING || change.reason === YardChangeReason.AWAY) return;
    if (change.reason === YardChangeReason.INCOME) {
      this.save = store.save;
      this.hud?.setResources(store.resources, store.credits, { float: false });
      return;
    }

    const yard = store.yard;
    const before = this.yard;
    this.yard = yard;
    this.save = store.save;
    this.mail?.setSaveUnread(store.save.unreadmessages);
    this.bell?.setSaveCount(store.save.notifications);
    // While the planner is open its drawer's stored decorations are drawn too.
    const shown = (this.planner && this.plannerYard()) || yard;
    // A mushroom a building landed on comes back somewhere else, and pops up there (#263).
    this.renderer.show(shown, { popNewMushrooms: true });
    if (before && before.expansionLevel !== yard.expansionLevel) this.onPlotResized(before, yard);
    this.renderer.setLife(yardLifeOf(store.save, yard));
    this.minimap?.refreshBuildings();
    this.hud?.setResources(store.resources, store.credits);
    this.planner?.rebase(shown);
    this.placement?.rebase(yard);
    if (!isEmptyOutpost(yard)) this.notices.clear(OUTPOST_HINT_NOTICE);

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

  /**
   * More Yardage (`ENL`, §8.2) was bought: the plot, and the world around it,
   * are bigger, and every world point moved with the plot's centre
   * (`yardBounds`). The camera learns the new bounds and keeps what the
   * player was looking at; the zoom floor follows the new fit.
   */
  private onPlotResized(before: Yard, after: Yard): void {
    const camera = this.camera;
    if (!camera) return;
    camera.setBounds({ width: after.bounds.width, height: after.bounds.height });
    camera.setPosition(
      camera.position.x + after.bounds.originX - before.bounds.originX,
      camera.position.y + after.bounds.originY - before.bounds.originY,
    );
    this.applyZoomLimits(this.viewportWidth, this.viewportHeight, camera);
    this.minimap?.markDirty();
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
    if (this.attackGuard?.locked) return;
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
    const own = this.store?.target;
    // A player reads whose yard this is and the planner's "Yard centre" (#54,
    // #56); the counts, the plot, the frame time and the selected id are a
    // developer's (#150).
    const parts = [
      ...(this.target ? [`${this.target.name}'s yard, read-only`] : []),
      ...(this.hint ? [this.hint] : []),
      ...(devDetails()
        ? [
            ...(own?.kind === "outpost" ? [yardTitle(own)] : []),
            `${buildings} buildings · ${yard.mushrooms.length} mushrooms`,
            `plot ${yard.bounds.yardWidth} x ${yard.bounds.yardHeight} (expansion ${yard.expansionLevel})`,
            `${this.frameCostMs.toFixed(1)} ms/frame`,
            ...(waiting > 0 ? [`${waiting} awaiting art`] : []),
            ...(this.selected ? [`selected #${this.selected.id}`] : []),
          ]
        : []),
    ];
    status.textContent = parts.join(" · ");
    status.hidden = parts.length === 0;
  }
}

/** What an Apply did with decorations, for its notice (#128); empty when nothing. */
export const storageText = (storage: AppliedStorage): string => {
  const parts: string[] = [];
  const stored = storage.stored.length;
  const placed = storage.placed.length;
  if (stored > 0) parts.push(`${stored} decoration${stored === 1 ? "" : "s"} put in storage.`);
  if (placed > 0) parts.push(`${placed} decoration${placed === 1 ? "" : "s"} placed from storage.`);
  return parts.join(" ");
};
