import { logout } from "@/api/auth";
import { loadOwnYard } from "@/api/base";
import {
  cellAt,
  declineTakeover,
  getArea,
  getTakeoverQuote,
  moveMainYard,
  takeOverCell,
  transferMonsters,
  zoneOrigin,
  type TakeoverPayment,
} from "@/api/maproom";
import { takePrimedOwnYard } from "@/game/maproom/mapRoute";
import { ApiError, NetworkError } from "@/api/http";
import {
  CellType,
  type BaseLoadResponse,
  type MapCell,
  type Resources,
  type TakeoverQuoteResponse,
} from "@/api/types";
import { CELL_WIDTH, DEFAULT_ZOOM, WORLD_HEIGHT, WORLD_WIDTH, ZONE_STALE_SECONDS } from "@/config";
import {
  attackRefusal,
  hasDeclareWar,
  outpostsToLoad,
  ownCellsIn,
  rosterInRange,
  targetKind,
  targetName,
} from "@/game/attack/attackEntry";
import {
  setAttackTarget,
  setViewTarget,
  type AttackRoster,
  type AttackTarget,
} from "@/game/attack/attackTarget";
import { Camera } from "@/game/Camera";
import { mapRoomGrid, type OffsetCell } from "@/game/HexGrid";
import {
  rangeSources,
  reachText,
  reachTo,
  type RangeSource,
} from "@/game/maproom/attackRange";
import { mainYardRange, outpostRange, withDeclareWar } from "@/game/maproom/rules/range";
import { Bookmarks } from "@/game/maproom/Bookmarks";
import { consumeMapFocus, type MapFocus } from "@/game/maproom/mapFocus";
import {
  TRANSFER_TEXT,
  housedOf,
  relocateAffordable,
  spaceOf,
  type TransferYard,
} from "@/game/maproom/moveYards";
import { academyLevel } from "@/game/monsters/housing";
import { housingSpace } from "@/game/monsters/monsterCatalogue";
import { takenOverResources, type TakeoverCandidate } from "@/game/maproom/takeover";
import { MapInput } from "@/game/maproom/MapInput";
import { MapRenderer } from "@/game/maproom/MapRenderer";
import { ZoneStore, type ZoneError } from "@/game/maproom/ZoneStore";
import { inWorld, type CellRange } from "@/game/maproom/zones";
import {
  MAIN_YARD_TITLE,
  outpostTitle,
  outpostsOf,
  outpostTarget,
  setOwnYardTarget,
} from "@/game/yard/ownYards";
import { hoverContentFor } from "@/ui/maproom/HoverCard";
import { MapRoomUi } from "@/ui/maproom/MapRoomUi";
import { RelocateDialog } from "@/ui/maproom/RelocateDialog";
import { TransferDialog, type TransferChoice } from "@/ui/maproom/TransferDialog";
import { formatSpan } from "@/ui/attack/EndAttackPanel";
import { previewEndTakeover, type EndTakeoverPreviewOptions } from "@/ui/attack/endTakeoverPreview";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";

/**
 * Map Room 2.
 *
 * Wiring only. The zone cache, the renderer, the camera and the overlay each
 * own their own behaviour; this decides when they talk to each other.
 *
 * The one piece of policy that lives here is the refresh clock — how often
 * stale zones are re-requested and what a regained tab focus means — because it
 * is a product decision rather than a property of any one part.
 */

/**
 * One press of the zoom control's minus or plus button, matching a couple of
 * wheel notches. The keyboard's own step (`MapInput`'s onZoomStep) uses the
 * same ratio, so the two agree.
 */
const ZOOM_STEP = 1.5;

/** How often the request queue is drained. Faster than this just burns budget. */
const PUMP_INTERVAL_SECONDS = 0.25;
/** How often visible zones are checked for staleness. */
const STALE_CHECK_INTERVAL_SECONDS = 5;
/** How often countdowns, the status line and the open cell panel are refreshed. */
const UI_TICK_SECONDS = 1;

/** Where "My range" remembers whether it was on (#177): this browser only. */
const RANGE_ON_KEY = "bymr.map.showRange";

export class MapRoom2Scene implements Scene {
  private readonly camera = new Camera({
    bounds: mapRoomGrid.worldBounds(WORLD_WIDTH, WORLD_HEIGHT),
  });

  private readonly store = new ZoneStore({
    onZone: (zone) => this.renderer.applyZone(zone),
    onResources: (resources, credits) => this.showResources(resources, credits),
    onError: (error) => this.reportError(error),
    onAuthFailure: () => this.context?.goTo(SceneName.LOGIN),
  });

  private readonly renderer = new MapRenderer(this.store);

  private readonly bookmarks = new Bookmarks({
    onError: (message) => this.ui?.notices.show("bookmarks", message, { level: "warning" }),
    onChange: () => this.ui?.setBookmarks(this.bookmarks.all),
  });

  private context: SceneContext | null = null;
  private ui: MapRoomUi | null = null;
  private input: MapInput | null = null;

  /**
   * The current viewport size in CSS px. `SceneContext.width`/`height` are a
   * one-time snapshot taken at `enter`, never updated after — `resize` is the
   * only place the manager hands us a live size, so it is mirrored here for
   * every other method that needs "the viewport right now" (the keyboard zoom
   * anchor). Reading `this.context.width` instead is the bug that leaves the
   * zoom anchored at the size the scene opened at.
   */
  private viewportWidth = 0;
  private viewportHeight = 0;

  private home: OffsetCell | null = null;
  private selected: OffsetCell | null = null;
  /** The cell under the pointer, for the hover card (#176). */
  private hovered: OffsetCell | null = null;
  /**
   * Whether this device has a real pointer to hover with. A touch screen gets
   * no hover card: a tap opens the cell panel, which says the same and more.
   */
  private readonly canHover =
    typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;
  private range: CellRange = { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 };
  /**
   * The own-yard load that found the home cell, kept for what an attack needs
   * of the player rather than of any one cell: champions, academy levels and
   * the catapult (`game/attack/attackEntry.ts`, `rosterInRange`).
   */
  private ownSave: BaseLoadResponse | null = null;
  /** The pool the HUD shows, so a takeover can take its price off at once. */
  private resources: Resources | null = null;
  private credits: number | undefined;
  /**
   * Where the map should open instead of the home cell: the target of the
   * attack just finished, or the outpost just taken over (`mapFocus.ts`).
   */
  private pendingFocus: MapFocus | null = null;

  /**
   * True once the home cell is known, or known to be unavailable.
   *
   * Nothing is fetched before this. The request queue is ordered by distance
   * from the viewport centre, and until the home cell arrives that centre is
   * the middle of the world — so fetching early would spend the opening burst
   * on zones the player is about to be moved away from.
   */
  private ready = false;

  /** "My range" is on (#177), and the flingers the range is drawn from. */
  private rangeOn = readRangeOn();
  private rangeSources: RangeSource[] = [];

  // Starts at the interval so the first update after `ready` pumps at once.
  private sincePump = PUMP_INTERVAL_SECONDS;
  private sinceStaleCheck = 0;
  private sinceUiTick = 0;
  /** Rolling average of the scene's own per-frame cost, in milliseconds. */
  private frameCostMs = 0;

  async enter(context: SceneContext): Promise<void> {
    this.context = context;
    this.pendingFocus = consumeMapFocus();
    this.viewportWidth = context.width;
    this.viewportHeight = context.height;
    context.stage.addChild(this.renderer.root);
    // Bakes the sprite atlas the chunk renderer draws from.
    this.renderer.attach(context.renderer);
    // The tribe portraits and players' critters are a network fetch, so they
    // are started here and not waited on: the map opens on tent glyphs and
    // plain markers and swaps in the art the moment it lands.
    void this.renderer.loadPictures();

    this.camera.resize(context.width, context.height);
    this.camera.attach(context.canvas);

    this.ui = new MapRoomUi(
      {
        onSceneSelect: (id) => context.goTo(id),
        onSignOut: () => {
          logout();
          context.goTo(SceneName.LOGIN);
        },
        onHome: () => this.goHome(),
        onRefresh: () => this.refreshNow(),
        onJump: (cell) => this.jumpTo(cell),
        onBookmarkAdd: (name) => this.addBookmark(name),
        onBookmarkRemove: (index) => {
          this.bookmarks.remove(index);
          this.ui?.setBookmarks(this.bookmarks.all);
          this.updateBookmarkTarget();
        },
        onBookmarkCell: (cell) => this.addBookmark("", cell),
        canBookmark: () => !this.bookmarks.isFull,
        onViewYard: () => this.viewYard(),
        attackRefusal: (payload) => this.attackRefusalFor(payload),
        onAttack: () => this.startAttack(),
        takeoverQuote: (baseid) => getTakeoverQuote(baseid),
        takeOver: (baseid, payment) => takeOverCell(baseid, payment),
        declineTakeover: (baseid) => declineTakeover(baseid),
        onTakeoverDeclined: (cell, protectedUntil) => {
          this.store.invalidateCell(cell.col, cell.row);
          void this.store.pump();
          const left = (protectedUntil ?? 0) - Date.now() / 1000;
          this.ui?.notices.show(
            "takeover",
            left > 0
              ? `You turned the offer down. The outpost is now under damage protection for ${formatSpan(left)}.`
              : "You turned the offer down.",
            { level: "info", timeoutMs: 6_000 },
          );
        },
        onTakenOver: (cell, candidate, quote, payment) => this.tookOver(cell, candidate, quote, payment),
        onZoom: (zoom) => this.zoomTo(zoom),
        onZoomStep: (direction) => this.zoomTo(this.camera.zoom * Math.pow(ZOOM_STEP, direction)),
        onZoomReset: () => this.fitWorld(),
        onCellPanelClose: () => this.clearSelection(),
        onRangeToggle: (on) => {
          this.rangeOn = on;
          writeRangeOn(on);
          this.updateRange();
        },
        reach: (cell) => {
          const answer = reachTo(cell, this.rangeSources);
          const text = reachText(answer);
          return text ? { text, inRange: answer.inRange } : null;
        },
        ownFlinger: (_cell, payload) => {
          const own = payload.b === CellType.OUTPOST ? outpostRange(payload.f) : mainYardRange(payload.f);
          const reach = withDeclareWar(own, this.declareWar);
          return { level: payload.f, reach, bonus: reach - own };
        },
        ownMoves: (_cell, payload) => ({
          // Flash offered the transfer only to a player with an outpost
          // (`PopupInfoMine.as:80-84`); relocating is an own outpost's alone.
          monsters: this.ownSave !== null && outpostsOf(this.ownSave).length > 0,
          relocate: payload.b === CellType.OUTPOST,
        }),
        onMoveMonsters: (_cell, payload) => this.openTransfer(payload.bid),
        onRelocate: (cell, payload) => this.openRelocate(cell, payload),
      },
      SceneName.MAP_ROOM_2,
      [
        { id: SceneName.MAP_ROOM_2, label: "Map" },
        { id: SceneName.YARD, label: "Yard" },
      ],
    ).mount(context.overlay.content, context.overlay.modal);

    this.ui.setBookmarks(this.bookmarks.all);
    this.updateBookmarkTarget();
    this.ui.setZoom(this.camera.zoom);
    this.ui.setRangeOn(this.rangeOn);

    this.input = new MapInput({
      camera: this.camera,
      canvas: context.canvas,
      onHover: (cell) => this.handleHover(cell),
      onSelect: (cell) => this.selectCell(cell),
      onZoomToCell: (cell) => this.zoomToCell(cell),
      onZoomStep: (direction) => this.zoomTo(this.camera.zoom * Math.pow(ZOOM_STEP, direction)),
      onZoomReset: () => this.fitWorld(),
      onCancel: () => this.clearSelection(),
    });
    this.input.attach();

    if (import.meta.env.DEV) {
      // The end panel's takeover offer, without finishing a real attack (#82).
      (globalThis as Record<string, unknown>)["__takeoverPreview"] = {
        endPanel: (options: EndTakeoverPreviewOptions) => previewEndTakeover(context.overlay.modal, options),
      };
    }

    window.addEventListener("focus", this.handleFocus);
    document.addEventListener("visibilitychange", this.handleFocus);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);

    // A sensible view before the network answers, replaced by the home cell.
    this.camera.centreOn(mapRoomGrid.cellToPixel(WORLD_WIDTH / 2, WORLD_HEIGHT / 2));
    await this.loadOwnCell();
  }

  exit(): void {
    this.input?.detach();
    this.input = null;
    this.camera.detach();

    window.removeEventListener("focus", this.handleFocus);
    document.removeEventListener("visibilitychange", this.handleFocus);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    if (import.meta.env.DEV) delete (globalThis as Record<string, unknown>)["__takeoverPreview"];

    this.ui?.destroy();
    this.ui = null;
    this.renderer.destroy();
    this.context = null;
  }

  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.camera.resize(width, height);
  }

  update(deltaSeconds: number): void {
    const started = performance.now();

    if (this.camera.dirty) {
      this.camera.dirty = false;
      this.applyCamera();
      this.range = this.visibleRange();
      if (this.ready) this.store.ensureVisible(this.range);
      this.ui?.setViewport(this.range);
      this.ui?.setZoom(this.camera.zoom);
      // The card follows its cell as the map moves under a still pointer.
      this.showHoverCard();
    }

    this.renderer.draw(this.range, this.camera.zoom);
    this.ui?.drawMinimap();

    if (this.ready) {
      this.sincePump += deltaSeconds;
      if (this.sincePump >= PUMP_INTERVAL_SECONDS) {
        this.sincePump = 0;
        void this.store.pump();
      }

      this.sinceStaleCheck += deltaSeconds;
      if (this.sinceStaleCheck >= STALE_CHECK_INTERVAL_SECONDS) {
        this.sinceStaleCheck = 0;
        this.store.refreshStale(ZONE_STALE_SECONDS);
      }
    }

    this.sinceUiTick += deltaSeconds;
    if (this.sinceUiTick >= UI_TICK_SECONDS) {
      this.sinceUiTick = 0;
      this.refreshUi();
    }

    // Exponential moving average: one slow frame should show, but not dominate.
    this.frameCostMs += (performance.now() - started - this.frameCostMs) * 0.1;
  }

  /**
   * Loads the caller's own yard to find the home cell, then centres on it.
   *
   * Centring before anything is fetched matters: the queue is ordered by
   * distance from the viewport centre, so the home zone and its neighbours go
   * out first and the screen fills from the middle outwards.
   */
  private async loadOwnCell(): Promise<void> {
    try {
      // The load that chose this map, when there was one (issue #162).
      const base = takePrimedOwnYard() ?? (await loadOwnYard());
      this.ownSave = base;

      const home = base.homebase;
      if (home) {
        // `homebase` arrives as a pair of strings, not numbers.
        const cell = { col: Number(home[0]), row: Number(home[1]) };
        if (inWorld(cell.col, cell.row)) {
          this.home = cell;
          this.ui?.setHome(cell);
          this.jumpTo(cell, DEFAULT_ZOOM);
        }
      }

      // worldsize is [height, width], the server's WORLD_SIZE order.
      const size = base.worldsize;
      if (size && (size[1] !== WORLD_WIDTH || size[0] !== WORLD_HEIGHT)) {
        console.warn(
          `Server world is ${size[1]} x ${size[0]}; this client is built for ${WORLD_WIDTH} x ${WORLD_HEIGHT}`,
        );
      }

      if (base.resources) this.showResources(base.resources, base.credits);
      this.ui?.setOutposts(outpostsOf(base));
      // Every outpost's zone, so the attack roster counts it wherever it is (#187).
      for (const cell of outpostsToLoad(outpostsOf(base), (col, row) => !!this.store.getCell(col, row))) {
        this.store.invalidateCell(cell.col, cell.row);
      }
      this.updateRange();
    } catch (caught) {
      if (caught instanceof ApiError && caught.isAuthFailure) {
        this.context?.goTo(SceneName.LOGIN);
        return;
      }
      this.ui?.notices.show(
        "own-yard",
        caught instanceof NetworkError
          ? "Could not reach the server to find your yard."
          : "Could not load your yard, so the map opened at the world centre.",
        { level: "warning", actionLabel: "Retry", onAction: () => void this.loadOwnCell() },
      );
    } finally {
      this.applyFocus();
      // Either the camera is on the home cell or it is on the world centre.
      // Whichever it is, that is now the right place to start fetching from.
      this.ready = true;
      this.camera.dirty = true;
    }
  }

  /**
   * Opens on the cell handed over by the screen before (`mapFocus.ts`)
   * instead of the home cell: the attack's target, or the outpost just
   * taken over, which also gets its "Veni, Vidi, Vici!".
   */
  private applyFocus(): void {
    const focus = this.pendingFocus;
    this.pendingFocus = null;
    if (!focus || !inWorld(focus.cell.col, focus.cell.row)) return;
    this.jumpTo(focus.cell, DEFAULT_ZOOM);
    if (focus.takenOver) this.ui?.showTakenOver(focus.takenOver.kind, focus.takenOver.name);
  }

  private showResources(resources: Resources, credits: number | undefined): void {
    this.resources = resources;
    this.credits = credits;
    this.ui?.setResources(resources, credits);
  }

  /* ── Camera ─────────────────────────────────────────────────────────── */

  /**
   * Moves the whole world container rather than re-projecting every vertex, so
   * panning and zooming cost one transform, not a geometry rebuild.
   */
  private applyCamera(): void {
    const { zoom, position } = this.camera;
    this.renderer.root.scale.set(zoom);
    this.renderer.root.position.set(-position.x * zoom, -position.y * zoom);
  }

  /** The inclusive cell range covering the viewport, with a small margin. */
  private visibleRange(): CellRange {
    const view = this.camera.visibleWorldRect();
    const topLeft = mapRoomGrid.pixelToCell(view.left, view.top);
    const bottomRight = mapRoomGrid.pixelToCell(view.right, view.bottom);

    return {
      minCol: clamp(topLeft.col - 1, WORLD_WIDTH),
      maxCol: clamp(bottomRight.col + 1, WORLD_WIDTH),
      // Two rows of margin vertically: the odd-column stagger means a column
      // reaches half a cell further up and down than its neighbour.
      minRow: clamp(topLeft.row - 2, WORLD_HEIGHT),
      maxRow: clamp(bottomRight.row + 2, WORLD_HEIGHT),
    };
  }

  private zoomTo(zoom: number): void {
    this.camera.zoomAt(zoom, { x: this.viewportWidth / 2, y: this.viewportHeight / 2 });
  }

  /** Double click: zoom in a step and put that cell in the middle. */
  private zoomToCell(cell: OffsetCell): void {
    this.camera.zoom = Math.min(this.camera.zoom * 2, this.camera.maxZoom);
    this.camera.centreOn(mapRoomGrid.cellToPixel(cell.col, cell.row));
    this.selectCell(cell);
  }

  /** Keyboard `0` and the Fit button: pull back until the world is on screen. */
  private fitWorld(): void {
    this.camera.zoom = this.camera.minZoom;
    this.camera.centreOn(mapRoomGrid.cellToPixel(WORLD_WIDTH / 2, WORLD_HEIGHT / 2));
    this.camera.dirty = true;
  }

  private jumpTo(cell: OffsetCell, zoom?: number): void {
    if (!inWorld(cell.col, cell.row)) return;
    if (zoom !== undefined) this.camera.zoom = zoom;
    this.camera.centreOn(mapRoomGrid.cellToPixel(cell.col, cell.row));
    this.camera.dirty = true;
    this.selectCell(cell);
  }

  private goHome(): void {
    if (!this.home) {
      this.ui?.notices.show("own-yard", "Your home cell is not known yet.", {
        level: "info",
        timeoutMs: 4_000,
      });
      return;
    }
    this.jumpTo(this.home);
  }

  /* ── Selection ──────────────────────────────────────────────────────── */

  private handleHover(cell: OffsetCell | null): void {
    this.renderer.setHovered(cell);
    this.hovered = cell;
    this.showHoverCard();
  }

  /**
   * Names the hovered cell beside it: the map writes no names (#176), so this
   * card is where a camp's tribe and a yard's owner are read.
   */
  private showHoverCard(): void {
    const ui = this.ui;
    const cell = this.hovered;
    if (!ui) return;
    const content =
      cell && this.canHover && !this.camera.isInteracting
        ? hoverContentFor(this.store.getCell(cell.col, cell.row), reachTo(cell, this.rangeSources))
        : null;
    if (!cell || !content) {
      ui.hideHover();
      return;
    }
    const centre = this.camera.worldToScreen(mapRoomGrid.cellToPixel(cell.col, cell.row));
    const half = (CELL_WIDTH / 2) * this.camera.zoom;
    ui.showHover(content, { left: centre.x - half, right: centre.x + half, middle: centre.y });
  }

  private selectCell(cell: OffsetCell): void {
    this.selected = cell;
    this.renderer.setSelected(cell);
    this.updateBookmarkTarget();
    this.ui?.showCell(cell, this.store.getCell(cell.col, cell.row));
  }

  private clearSelection(): void {
    this.selected = null;
    this.renderer.setSelected(null);
    this.ui?.closeCell();
    this.updateBookmarkTarget();
  }

  private addBookmark(name: string, cell: OffsetCell | null = this.selected): void {
    if (!cell) return;
    const refused = this.bookmarks.add(cell.col, cell.row, name);
    if (refused) {
      this.ui?.notices.show("bookmarks", refused, { level: "info", timeoutMs: 4_000 });
      return;
    }
    this.ui?.setBookmarks(this.bookmarks.all);
    this.updateBookmarkTarget();
  }

  private updateBookmarkTarget(): void {
    const cell = this.selected;
    const reason = !cell
      ? undefined
      : this.bookmarks.isFull
        ? "You already have the maximum of 8 bookmarks."
        : this.bookmarks.has(cell.col, cell.row)
          ? "This cell is already bookmarked."
          : undefined;
    this.ui?.setBookmarkTarget(cell, reason);
  }

  /* ── Attack ─────────────────────────────────────────────────────────── */

  /**
   * What the player could fling at `cell` right now, read off the own cells
   * in the loaded zones and the own-yard load.
   *
   * Only loaded zones are consulted. An own outpost whose zone has not arrived
   * yet is simply not counted, which errs toward refusing; the server runs the
   * same range rule over every owned cell and is the one that decides.
   */
  private rosterFor(cell: OffsetCell): AttackRoster {
    return rosterInRange(cell, ownCellsIn(this.store.loadedZoneRefs()), this.ownSave);
  }

  /** Whether the player's alliance has Declare War running, from the own-yard load. */
  private get declareWar(): boolean {
    return hasDeclareWar(this.ownSave?.powerups);
  }

  /**
   * The flingers the player's range is drawn from (#177): every own cell in
   * the loaded zones, with the home cell stood in for from the own-yard load
   * until its zone arrives. Cheap, and the overlay rebuilds only when they
   * change, so it runs on the UI tick and picks up an outpost's zone arriving.
   */
  private updateRange(): void {
    const sources = rangeSources(
      ownCellsIn(this.store.loadedZoneRefs()),
      this.declareWar,
      this.home ? { cell: this.home, flinger: this.ownSave?.flinger } : null,
    );
    this.rangeSources = sources;
    this.renderer.setRange(this.rangeOn ? sources : null);
    this.ui?.setRangeSources(sources, this.declareWar);
  }

  /** The cell panel's Attack gate, for the cell it is showing. */
  private attackRefusalFor(payload: MapCell | undefined): string | null {
    const cell = this.selected;
    if (!cell) return "No cell is selected.";
    return attackRefusal(payload, this.rosterFor(cell), Date.now() / 1000);
  }

  /**
   * The attack the selected cell could receive right now, or the reason it
   * cannot.
   *
   * The gate is asked here rather than trusted from the button, because the
   * zone under the panel may have refreshed since it was drawn.
   */
  private attackFor(
    cell: OffsetCell,
    payload: MapCell | undefined,
  ): { attack: AttackTarget | null; refusal: string | null } {
    const roster = this.rosterFor(cell);
    const refusal = attackRefusal(payload, roster, Date.now() / 1000);
    const kind = payload ? targetKind(payload) : null;
    if (refusal || !payload || !kind || !("bid" in payload)) {
      return { attack: null, refusal: refusal ?? "This cell cannot be attacked." };
    }
    return {
      attack: { baseid: payload.bid, kind, cell, name: targetName(payload), roster },
      refusal: null,
    };
  }

  /** Hands the selected cell to the attack scene. */
  private startAttack(): void {
    const cell = this.selected;
    const context = this.context;
    if (!cell || !context) return;

    const { attack, refusal } = this.attackFor(cell, this.store.getCell(cell.col, cell.row));
    if (!attack) {
      this.ui?.notices.show("attack", refusal ?? "This cell cannot be attacked.", {
        level: "info",
        timeoutMs: 4_000,
      });
      return;
    }

    setAttackTarget(attack);
    context.goTo(SceneName.ATTACK);
  }

  /**
   * Opens the yard screen on the selected cell.
   *
   * The player's own cell opens editable: the home cell as it always has (no
   * target, so the yard scene loads the main yard), an own outpost by its
   * `baseid` (#146; Flash's "Open", `PopupInfoMine.as:220-234`). Any other
   * cell with a yard becomes a read-only visit, carrying the attack it could
   * turn into so the yard's own Attack button needs nothing from the map
   * (`docs/design/attack-flow.md` §F1).
   */
  private viewYard(): void {
    const cell = this.selected;
    const context = this.context;
    if (!cell || !context) return;

    const payload = this.store.getCell(cell.col, cell.row);
    if (!payload || !("bid" in payload)) return;
    if ("mine" in payload && payload.mine === 1) {
      if (payload.b === CellType.OUTPOST) setOwnYardTarget(outpostTarget(payload.bid, cell));
      context.goTo(SceneName.YARD);
      return;
    }

    const kind = targetKind(payload);
    if (!kind) return;
    const { attack, refusal } = this.attackFor(cell, payload);
    const own = this.ownSave
      ? { resources: this.ownSave.resources ?? null, credits: this.ownSave.credits }
      : undefined;
    setViewTarget({
      baseid: payload.bid,
      kind,
      cell,
      name: targetName(payload),
      attack,
      refusal,
      own,
    });
    context.goTo(SceneName.YARD);
  }

  /* ── Take over ──────────────────────────────────────────────────────── */

  /**
   * The server has made the cell the player's outpost (issue #82). Its zone
   * is fetched again so the map draws it as theirs next time; the HUD takes
   * off the price at once (`PopupTakeover.as:140-159`) until the outpost's
   * own load brings the server's figures; and the new outpost opens with
   * Flash's "Veni, Vidi, Vici!", as Flash opened it (`BASE.as:2292-2319`;
   * outposts WP5).
   */
  private tookOver(
    cell: OffsetCell,
    candidate: TakeoverCandidate,
    quote: TakeoverQuoteResponse,
    payment: TakeoverPayment,
  ): void {
    this.store.invalidateCell(cell.col, cell.row);
    void this.store.pump();
    if (this.resources) {
      const next = takenOverResources(this.resources, this.credits, quote, payment);
      this.showResources(next.resources, next.credits);
    }
    const context = this.context;
    if (!context) return;
    setOwnYardTarget({
      ...outpostTarget(candidate.baseid, cell),
      takenOver: { kind: candidate.kind, name: candidate.name },
    });
    context.goTo(SceneName.YARD);
  }

  /* ── Moving between own yards (outposts WP7, #186) ──────────────────── */

  /** The player's yards, main yard first, with where each is. */
  private ownYards(): { choice: TransferChoice; cell: OffsetCell }[] {
    const save = this.ownSave;
    if (!save) return [];
    const yards: { choice: TransferChoice; cell: OffsetCell }[] = [];
    if (this.home) {
      yards.push({
        choice: { baseid: String(save.baseid), label: MAIN_YARD_TITLE, main: true },
        cell: this.home,
      });
    }
    for (const outpost of outpostsOf(save)) {
      yards.push({
        choice: { baseid: outpost.baseid, label: outpostTitle(outpost.cell), main: false },
        cell: outpost.cell,
      });
    }
    return yards;
  }

  /**
   * One cell as the server has it now, fetched afresh rather than read from the
   * zone cache: a transfer sends both yards' whole rosters, so they must be
   * current (Flash waited for any pending zone request, `MapRoom.as:889-893`).
   */
  private async freshCell(cell: OffsetCell) {
    const area = await getArea(zoneOrigin(cell.col), zoneOrigin(cell.row));
    return cellAt(area, cell.col, cell.row);
  }

  /** "Move monsters" from one of the player's yards. */
  private openTransfer(from: string): void {
    const save = this.ownSave;
    const yards = this.ownYards();
    if (!save || yards.length < 2) {
      this.ui?.notices.show("transfer", TRANSFER_TEXT.noOutposts, { level: "info", timeoutMs: 4_000 });
      return;
    }
    const cells = new Map(yards.map(({ choice, cell }) => [choice.baseid, cell]));
    this.ui?.openDialog(
      new TransferDialog({
        yards: yards.map(({ choice }) => choice),
        from,
        load: async (baseid): Promise<TransferYard> => {
          const cell = cells.get(baseid);
          const payload = cell ? await this.freshCell(cell) : undefined;
          return { baseid, housed: housedOf(payload), space: spaceOf(payload) };
        },
        sizeOf: (id) => housingSpace(id, academyLevel(save.academy, id)) ?? 1,
        send: (fromId, toId, rosters) => transferMonsters(fromId, toId, rosters),
        onMoved: (fromId, toId, message) => {
          for (const id of [fromId, toId]) {
            const cell = cells.get(id);
            if (cell) this.store.invalidateCell(cell.col, cell.row);
          }
          void this.store.pump();
          // A fresh line for each move (#191): the same words written over the
          // last move's line change nothing on screen and are not announced.
          this.ui?.notices.clear("transfer");
          this.ui?.notices.show("transfer", message, { level: "info", timeoutMs: 8_000 });
        },
      }),
    );
  }

  /**
   * "Move main yard here" on an own outpost. On success the map reloads the
   * player's own yard, which moves home and drops the outpost from the list,
   * and jumps there.
   */
  private openRelocate(cell: OffsetCell, payload: { bid: string } & MapCell): void {
    const oldHome = this.home;
    this.ui?.openDialog(
      new RelocateDialog({
        lost: housedOf(payload),
        affordable: relocateAffordable(this.resources, this.credits),
        move: (payment) => moveMainYard(payload.bid, payment),
        onMoved: () => {
          if (oldHome) this.store.invalidateCell(oldHome.col, oldHome.row);
          this.store.invalidateCell(cell.col, cell.row);
          void this.store.pump();
          this.ui?.notices.show("relocate", "Your main yard has moved here.", {
            level: "info",
            timeoutMs: 5_000,
          });
          void this.loadOwnCell();
        },
      }),
    );
  }

  /* ── Refresh and status ─────────────────────────────────────────────── */

  private refreshNow(): void {
    this.store.resume();
    this.store.refreshVisible();
    void this.store.pump();
    this.ui?.refreshTakeover();
    this.ui?.notices.show("refresh", "Refetching the visible map.", {
      level: "info",
      timeoutMs: 2_000,
    });
  }

  /**
   * Regaining focus refetches everything visible.
   *
   * A backgrounded tab is throttled to roughly one frame a second, so the stale
   * clock keeps running but what the player comes back to is whatever was last
   * drawn. Refetching on focus makes "look away, look back" mean "current".
   */
  private readonly handleFocus = (): void => {
    if (document.visibilityState === "hidden") return;
    this.store.resume();
    this.store.refreshVisible();
    void this.store.pump();
  };

  private readonly handleOffline = (): void => {
    this.ui?.notices.show("network", "You are offline. The map will stop updating.", {
      level: "warning",
    });
  };

  private readonly handleOnline = (): void => {
    this.ui?.notices.clear("network");
    this.store.resume();
    void this.store.pump();
  };

  private refreshUi(): void {
    const ui = this.ui;
    if (!ui) return;

    this.updateRange();
    ui.tickCell(Date.now() / 1000);
    const shown = ui.shownCell;
    if (shown) ui.updateCell(this.store.getCell(shown.col, shown.row));

    ui.setZones(this.store.loadedZoneRefs());
    ui.setStatus(
      `${this.store.loadedZones} zones · ${this.store.pendingRequests} queued · ` +
        `${this.frameCostMs.toFixed(1)} ms/frame · ` +
        `${this.renderer.lastBuildMs.toFixed(2)} ms/chunk`,
    );
  }

  private reportError(error: ZoneError): void {
    if (error.kind === "auth") return; // The scene switch is the message.
    this.ui?.notices.show(
      `zone-${error.kind}`,
      error.message,
      error.kind === "network"
        ? { level: "warning", actionLabel: "Retry", onAction: () => this.refreshNow() }
        : { level: "warning", timeoutMs: 8_000 },
    );
  }
}

const clamp = (value: number, size: number): number =>
  Math.min(Math.max(value, 0), size - 1);

/** Whether "My range" was on when the player last left the map. Off at first. */
const readRangeOn = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(RANGE_ON_KEY) === "1";
  } catch {
    return false;
  }
};

const writeRangeOn = (on: boolean): void => {
  try {
    globalThis.localStorage?.setItem(RANGE_ON_KEY, on ? "1" : "0");
  } catch {
    // Private windows and full storage: the choice lasts this visit only.
  }
};
