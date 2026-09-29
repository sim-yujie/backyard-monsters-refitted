import type { Bookmark } from "@/api/bookmarks";
import type { TakeoverPayment } from "@/api/maproom";
import type { MapCell, PlayerCell, Resources, TakeoverQuoteResponse } from "@/api/types";
import { MAX_ZOOM, MIN_ZOOM } from "@/config";
import type { OffsetCell } from "@/game/HexGrid";
import type { RangeSource } from "@/game/maproom/attackRange";
import type { ZoneRecord } from "@/game/maproom/ZoneStore";
import type { CellRange } from "@/game/maproom/zones";
import type { TakeoverCandidate, TakeoverKind } from "@/game/maproom/takeover";
import type { OwnOutpost } from "@/game/yard/ownYards";
import { Hud } from "@/ui/Hud";
import { ZoomControl } from "@/ui/ZoomControl";
import { CellPanel, type OwnFlinger } from "./CellPanel";
import { Minimap } from "./Minimap";
import { NavPanel } from "./NavPanel";
import { Notices } from "./Notices";
import { RangeControl } from "./RangeControl";
import { TakeoverControl } from "./TakeoverControl";
import { showTakenOver } from "./TakeoverDialog";

/**
 * The map's own shape of the shared zoom control: a fixed range taken once
 * at construction (the whole world always fits the same way, so this never
 * calls `setRange` again), a "0.60×" factor readout instead of a percentage,
 * and the classes `maproom.css`'s `.zoom-controls` rules already style.
 */
const ZOOM_CLASSES = {
  root: "zoom-controls",
  slider: "zoom-controls__slider",
  readout: "zoom-controls__value",
  step: "btn btn--ghost btn--icon",
  fit: "btn btn--ghost btn--icon",
};
const ZOOM_LABELS = {
  out: "Zoom out",
  into: "Zoom in",
  fit: "Fit the whole world on screen",
  slider: "Zoom level",
};

/**
 * Every piece of DOM the map screen puts on the overlay, behind one object.
 *
 * The scene should be about the map: the camera, the cache and the clock that
 * keeps them in step. Without this the scene spends two hundred lines building
 * panels and remembering to take them down again. Nothing here knows what a
 * zone is — it reports intent and displays what it is given.
 *
 * The cell inspector is created on first use rather than up front, because a
 * map with nothing selected should not have an empty panel on it.
 */

export interface MapRoomUiHandlers {
  onSceneSelect: (id: string) => void;
  onSignOut: () => void;
  onHome: () => void;
  onRefresh: () => void;
  onJump: (cell: OffsetCell) => void;
  onBookmarkAdd: (name: string) => void;
  onBookmarkRemove: (index: number) => void;
  /** The cell inspector's own Bookmark button. */
  onBookmarkCell: (cell: OffsetCell) => void;
  canBookmark: () => boolean;
  /** The cell inspector's "View yard" button, on any cell with a yard. */
  onViewYard: () => void;
  /** The cell inspector's Attack gate and button; see `CellPanelOptions`. */
  attackRefusal: (payload: MapCell | undefined) => string | null;
  onAttack: () => void;
  /** The cell inspector's Take over action (issue #82); see `TakeoverControlOptions`. */
  takeoverQuote: (baseid: string) => Promise<TakeoverQuoteResponse>;
  takeOver: (baseid: string, payment: TakeoverPayment) => Promise<unknown>;
  onTakenOver: (
    cell: OffsetCell,
    candidate: TakeoverCandidate,
    quote: TakeoverQuoteResponse,
    payment: TakeoverPayment,
  ) => void;
  onZoom: (zoom: number) => void;
  onZoomStep: (direction: 1 | -1) => void;
  onZoomReset: () => void;
  onCellPanelClose: () => void;
  /** "My range" turned on or off (#177), from its button or the cell panel. */
  onRangeToggle: (on: boolean) => void;
  /** The cell panel's range chip (#174); see `CellPanelOptions.reach`. */
  reach: (cell: OffsetCell) => { text: string; inRange: boolean } | null;
  /** The cell panel's own-yard Flinger line (#174). */
  ownFlinger: (cell: OffsetCell, payload: PlayerCell) => OwnFlinger;
}

export class MapRoomUi {
  readonly notices = new Notices();

  private readonly hud: Hud;
  private readonly navPanel: NavPanel;
  private readonly minimap: Minimap;
  private readonly zoomControl: ZoomControl;
  private readonly rangeControl: RangeControl;
  private readonly readout: HTMLElement;
  private readonly docks: HTMLElement[] = [];

  private cellPanel: CellPanel | null = null;
  private rangeOn = false;
  private takeover: TakeoverControl | null = null;
  private container: HTMLElement | null = null;
  /** The overlay's modal layer, for the takeover dialogs. */
  private modal: HTMLElement | null = null;
  private readonly handlers: MapRoomUiHandlers;

  constructor(handlers: MapRoomUiHandlers, activeScene: string, scenes: { id: string; label: string }[]) {
    this.handlers = handlers;

    this.hud = new Hud({
      scenes,
      onSceneSelect: handlers.onSceneSelect,
      onSignOut: handlers.onSignOut,
    });
    this.hud.setActiveScene(activeScene);

    this.navPanel = new NavPanel({
      onHome: handlers.onHome,
      onRefresh: handlers.onRefresh,
      onJump: (x, y) => handlers.onJump({ col: x, row: y }),
      onBookmarkJump: (bookmark) => handlers.onJump({ col: bookmark.x, row: bookmark.y }),
      onBookmarkAdd: handlers.onBookmarkAdd,
      onBookmarkRemove: handlers.onBookmarkRemove,
    });

    this.minimap = new Minimap({ onJump: handlers.onJump });
    this.zoomControl = new ZoomControl({
      onZoom: handlers.onZoom,
      onStep: handlers.onZoomStep,
      onFit: handlers.onZoomReset,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      readout: "factor",
      classes: ZOOM_CLASSES,
      labels: ZOOM_LABELS,
    });

    this.rangeControl = new RangeControl({ onToggle: (on) => this.toggleRange(on) });

    this.readout = document.createElement("div");
    this.readout.className = "cell-readout";
    this.readout.textContent = "—";
  }

  mount(container: HTMLElement, modal?: HTMLElement): this {
    this.container = container;
    this.modal = modal ?? null;
    container.append(this.hud.element);
    this.notices.mount(container);

    this.navPanel.mount(this.dock("map-dock map-dock--left"));

    const bottomRight = this.dock("map-dock map-dock--bottom-right");
    bottomRight.append(this.rangeControl.legend);
    this.minimap.mount(bottomRight);
    const tools = document.createElement("div");
    tools.className = "mr2-toolrow";
    tools.append(this.rangeControl.button);
    this.zoomControl.mount(tools);
    bottomRight.append(tools);

    container.append(this.readout);
    return this;
  }

  destroy(): void {
    this.hud.destroy();
    this.navPanel.destroy();
    this.cellPanel?.close();
    this.cellPanel = null;
    this.takeover?.destroy();
    this.takeover = null;
    this.minimap.destroy();
    this.zoomControl.destroy();
    this.notices.destroy();
    this.readout.remove();
    for (const dock of this.docks) dock.remove();
    this.docks.length = 0;
    this.container = null;
    this.modal = null;
  }

  /* ── Display ────────────────────────────────────────────────────────── */

  setResources(resources: Resources, credits: number | undefined): void {
    this.hud.setResources(resources, credits);
  }

  setBookmarks(bookmarks: readonly Bookmark[]): void {
    this.navPanel.setBookmarks(bookmarks);
  }

  setBookmarkTarget(cell: OffsetCell | null, reason?: string): void {
    this.navPanel.setBookmarkTarget(cell, reason);
  }

  setStatus(text: string): void {
    this.navPanel.setStatus(text);
  }

  setZoom(zoom: number): void {
    this.zoomControl.setZoom(zoom);
  }

  setViewport(range: CellRange): void {
    this.minimap.setViewport(range);
  }

  setHome(cell: OffsetCell): void {
    this.minimap.setHome(cell);
  }

  /** The player's outposts, for the Navigate panel's buttons beside Home. */
  setOutposts(outposts: readonly OwnOutpost[]): void {
    this.navPanel.setOutposts(outposts);
  }

  /** "My range" as the player last left it. */
  setRangeOn(on: boolean): void {
    this.rangeOn = on;
    this.rangeControl.setOn(on);
    this.cellPanel?.setRangeOn(on);
  }

  /** The flingers the range is drawn from, for the legend (#177). */
  setRangeSources(sources: readonly RangeSource[], declareWar: boolean): void {
    this.rangeControl.setSources(sources, declareWar);
  }

  setZones(zones: Iterable<ZoneRecord>): void {
    this.minimap.setZones(zones);
  }

  drawMinimap(): void {
    this.minimap.draw();
  }

  setReadout(text: string): void {
    this.readout.textContent = text;
  }

  /* ── Cell inspector ─────────────────────────────────────────────────── */

  get shownCell(): OffsetCell | null {
    return this.cellPanel?.shownCell ?? null;
  }

  showCell(cell: OffsetCell, payload: MapCell | undefined): void {
    this.minimap.setSelected(cell);

    if (!this.cellPanel) {
      if (!this.container) return;
      this.takeover = new TakeoverControl({
        quote: this.handlers.takeoverQuote,
        takeOver: this.handlers.takeOver,
        onTaken: this.handlers.onTakenOver,
        modal: () => this.modal ?? this.container,
      });
      this.cellPanel = new CellPanel({
        onClose: this.handlers.onCellPanelClose,
        onBookmark: this.handlers.onBookmarkCell,
        canBookmark: this.handlers.canBookmark,
        onViewYard: this.handlers.onViewYard,
        attackRefusal: this.handlers.attackRefusal,
        onAttack: this.handlers.onAttack,
        reach: this.handlers.reach,
        ownFlinger: this.handlers.ownFlinger,
        onRangeToggle: (on) => this.toggleRange(on),
        extraAction: this.takeover,
      }).mount(this.dock("map-dock map-dock--right mr2-cell-dock"));
      this.cellPanel.setRangeOn(this.rangeOn);
    }
    this.cellPanel.show(cell, payload);
  }

  updateCell(payload: MapCell | undefined): void {
    this.cellPanel?.update(payload);
  }

  tickCell(nowSeconds: number): void {
    this.cellPanel?.tick(nowSeconds);
  }

  /** Asks the server again whether the shown cell can be taken over. */
  refreshTakeover(): void {
    this.takeover?.refresh();
  }

  /** Flash's "Veni, Vidi, Vici!" for a yard just taken over. */
  showTakenOver(kind: TakeoverKind, name: string): void {
    const container = this.modal ?? this.container;
    if (container) showTakenOver(container, kind, name);
  }

  closeCell(): void {
    this.cellPanel?.close();
    this.cellPanel = null;
    this.takeover?.destroy();
    this.takeover = null;
    this.minimap.setSelected(null);
  }

  /** Either switch for "My range" moved: keep both in step and tell the scene. */
  private toggleRange(on: boolean): void {
    this.setRangeOn(on);
    this.handlers.onRangeToggle(on);
  }

  private dock(className: string): HTMLElement {
    const element = document.createElement("div");
    element.className = className;
    this.container?.append(element);
    this.docks.push(element);
    return element;
  }
}
