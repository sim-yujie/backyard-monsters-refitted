import { logout } from "@/api/auth";
import { loadOwnYard } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse, MapCell } from "@/api/types";
import { DEFAULT_ZOOM, WORLD_HEIGHT, WORLD_WIDTH, ZONE_STALE_SECONDS } from "@/config";
import {
  attackRefusal,
  ownCellsIn,
  rosterInRange,
  targetKind,
  targetName,
} from "@/game/attack/attackEntry";
import { setAttackTarget, type AttackRoster } from "@/game/attack/attackTarget";
import { Camera } from "@/game/Camera";
import { mapRoomGrid, type OffsetCell } from "@/game/HexGrid";
import { Bookmarks } from "@/game/maproom/Bookmarks";
import { MapInput } from "@/game/maproom/MapInput";
import { MapRenderer } from "@/game/maproom/MapRenderer";
import { ZoneStore, type ZoneError } from "@/game/maproom/ZoneStore";
import { inWorld, type CellRange } from "@/game/maproom/zones";
import { MapRoomUi } from "@/ui/maproom/MapRoomUi";
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

export class MapRoom2Scene implements Scene {
  private readonly camera = new Camera({
    bounds: mapRoomGrid.worldBounds(WORLD_WIDTH, WORLD_HEIGHT),
  });

  private readonly store = new ZoneStore({
    onZone: (zone) => this.renderer.applyZone(zone),
    onResources: (resources, credits) => this.ui?.setResources(resources, credits),
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
  private range: CellRange = { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 };
  /**
   * The own-yard load that found the home cell, kept for what an attack needs
   * of the player rather than of any one cell: champions, academy levels and
   * the catapult (`game/attack/attackEntry.ts`, `rosterInRange`).
   */
  private ownSave: BaseLoadResponse | null = null;

  /**
   * True once the home cell is known, or known to be unavailable.
   *
   * Nothing is fetched before this. The request queue is ordered by distance
   * from the viewport centre, and until the home cell arrives that centre is
   * the middle of the world — so fetching early would spend the opening burst
   * on zones the player is about to be moved away from.
   */
  private ready = false;

  // Starts at the interval so the first update after `ready` pumps at once.
  private sincePump = PUMP_INTERVAL_SECONDS;
  private sinceStaleCheck = 0;
  private sinceUiTick = 0;
  /** Rolling average of the scene's own per-frame cost, in milliseconds. */
  private frameCostMs = 0;

  async enter(context: SceneContext): Promise<void> {
    this.context = context;
    this.viewportWidth = context.width;
    this.viewportHeight = context.height;
    context.stage.addChild(this.renderer.root);
    // Bakes the sprite atlas the chunk renderer draws from.
    this.renderer.attach(context.renderer);
    // The tribe portraits are a network fetch, so they are started here and
    // not waited on: the map opens on tent glyphs and swaps them for the art
    // the moment it lands.
    void this.renderer.loadTribeAvatars();

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
        onViewYard: () => context.goTo(SceneName.YARD),
        attackRefusal: (payload) => this.attackRefusalFor(payload),
        onAttack: () => this.startAttack(),
        onZoom: (zoom) => this.zoomTo(zoom),
        onZoomStep: (direction) => this.zoomTo(this.camera.zoom * Math.pow(ZOOM_STEP, direction)),
        onZoomReset: () => this.fitWorld(),
        onCellPanelClose: () => this.clearSelection(),
      },
      SceneName.MAP_ROOM_2,
      [
        { id: SceneName.MAP_ROOM_2, label: "Map" },
        { id: SceneName.YARD, label: "Yard" },
        { id: SceneName.LOGIN, label: "Account" },
      ],
    ).mount(context.overlay.content);

    this.ui.setBookmarks(this.bookmarks.all);
    this.updateBookmarkTarget();
    this.ui.setZoom(this.camera.zoom);

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
      const base = await loadOwnYard();
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

      if (base.resources) this.ui?.setResources(base.resources, base.credits);
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
      // Either the camera is on the home cell or it is on the world centre.
      // Whichever it is, that is now the right place to start fetching from.
      this.ready = true;
      this.camera.dirty = true;
    }
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
    if (!cell) {
      this.ui?.setReadout("—");
      return;
    }
    const payload = this.store.getCell(cell.col, cell.row);
    this.ui?.setReadout(
      `x ${cell.col}  y ${cell.row}` +
        (payload ? `  h ${payload.i}` : "  loading") +
        (payload && "n" in payload ? `  ${String(payload.n)}` : ""),
    );
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

  /** The cell panel's Attack gate, for the cell it is showing. */
  private attackRefusalFor(payload: MapCell | undefined): string | null {
    const cell = this.selected;
    if (!cell) return "No cell is selected.";
    return attackRefusal(payload, this.rosterFor(cell), Date.now() / 1000);
  }

  /**
   * Hands the selected cell to the attack scene.
   *
   * The gate is asked once more here rather than trusted from the button,
   * because the zone under the panel may have refreshed since it was drawn.
   */
  private startAttack(): void {
    const cell = this.selected;
    const context = this.context;
    if (!cell || !context) return;

    const payload = this.store.getCell(cell.col, cell.row);
    const roster = this.rosterFor(cell);
    const refusal = attackRefusal(payload, roster, Date.now() / 1000);
    if (refusal || !payload) {
      this.ui?.notices.show("attack", refusal ?? "This cell cannot be attacked.", {
        level: "info",
        timeoutMs: 4_000,
      });
      return;
    }

    const kind = targetKind(payload);
    if (!kind || !("bid" in payload)) return;

    setAttackTarget({
      baseid: payload.bid,
      kind,
      cell,
      name: targetName(payload),
      roster,
    });
    context.goTo(SceneName.ATTACK);
  }

  /* ── Refresh and status ─────────────────────────────────────────────── */

  private refreshNow(): void {
    this.store.resume();
    this.store.refreshVisible();
    void this.store.pump();
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
