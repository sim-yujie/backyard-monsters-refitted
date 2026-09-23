import type { Bookmark } from "@/api/bookmarks";
import type { MapCell, Resources } from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";
import type { ZoneRecord } from "@/game/maproom/ZoneStore";
import type { CellRange } from "@/game/maproom/zones";
import { Hud } from "@/ui/Hud";
import { CellPanel } from "./CellPanel";
import { Minimap } from "./Minimap";
import { NavPanel } from "./NavPanel";
import { Notices } from "./Notices";
import { ZoomControls } from "./ZoomControls";

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
  /** The cell inspector's "View yard" button, on the caller's own cell. */
  onViewYard: () => void;
  onZoom: (zoom: number) => void;
  onZoomReset: () => void;
  onCellPanelClose: () => void;
}

export class MapRoomUi {
  readonly notices = new Notices();

  private readonly hud: Hud;
  private readonly navPanel: NavPanel;
  private readonly minimap: Minimap;
  private readonly zoomControls: ZoomControls;
  private readonly readout: HTMLElement;
  private readonly docks: HTMLElement[] = [];

  private cellPanel: CellPanel | null = null;
  private container: HTMLElement | null = null;
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
    this.zoomControls = new ZoomControls({
      onZoom: handlers.onZoom,
      onReset: handlers.onZoomReset,
    });

    this.readout = document.createElement("div");
    this.readout.className = "cell-readout";
    this.readout.textContent = "—";
  }

  mount(container: HTMLElement): this {
    this.container = container;
    container.append(this.hud.element);
    this.notices.mount(container);

    this.navPanel.mount(this.dock("map-dock map-dock--left"));

    const bottomRight = this.dock("map-dock map-dock--bottom-right");
    this.minimap.mount(bottomRight);
    this.zoomControls.mount(bottomRight);

    container.append(this.readout);
    return this;
  }

  destroy(): void {
    this.hud.destroy();
    this.navPanel.destroy();
    this.cellPanel?.close();
    this.cellPanel = null;
    this.minimap.destroy();
    this.zoomControls.destroy();
    this.notices.destroy();
    this.readout.remove();
    for (const dock of this.docks) dock.remove();
    this.docks.length = 0;
    this.container = null;
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
    this.zoomControls.setZoom(zoom);
  }

  setViewport(range: CellRange): void {
    this.minimap.setViewport(range);
  }

  setHome(cell: OffsetCell): void {
    this.minimap.setHome(cell);
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
      this.cellPanel = new CellPanel({
        onClose: this.handlers.onCellPanelClose,
        onBookmark: this.handlers.onBookmarkCell,
        canBookmark: this.handlers.canBookmark,
        onViewYard: this.handlers.onViewYard,
      }).mount(this.dock("map-dock map-dock--right"));
    }
    this.cellPanel.show(cell, payload);
  }

  updateCell(payload: MapCell | undefined): void {
    this.cellPanel?.update(payload);
  }

  tickCell(nowSeconds: number): void {
    this.cellPanel?.tick(nowSeconds);
  }

  closeCell(): void {
    this.cellPanel?.close();
    this.cellPanel = null;
    this.minimap.setSelected(null);
  }

  private dock(className: string): HTMLElement {
    const element = document.createElement("div");
    element.className = className;
    this.container?.append(element);
    this.docks.push(element);
    return element;
  }
}
