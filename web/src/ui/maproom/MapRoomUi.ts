import type { AutoAttackPlanResponse } from "@/api/autoAttack";
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
import type { AchievementsDoor } from "@/ui/achievements/AchievementsDoor";
import { Hud } from "@/ui/Hud";
import { ZoomControl } from "@/ui/ZoomControl";
import { CellPanel, type OwnFlinger, type OwnMoves } from "./CellPanel";
import { FindControl } from "./FindControl";
import { HoverCard, type HoverCardContent } from "./HoverCard";
import { Minimap } from "./Minimap";
import { NavPanel } from "./NavPanel";
import { Notices } from "./Notices";
import { RangeControl } from "./RangeControl";
import { AutoAttackControl } from "./AutoAttackControl";
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
  /** Before the Account menu's achievements screen opens (#204): it docks where the cell panel does. */
  onAchievementsOpen?: () => void;
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
  /** Turns a player outpost's single chance down from the map (#187); see `TakeoverControlOptions`. */
  declineTakeover: (baseid: string) => Promise<{ protectedUntil?: number }>;
  onTakeoverDeclined: (cell: OffsetCell, protectedUntil: number | undefined) => void;
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
  /** Moves between the player's yards on an own cell (#186); see `CellPanelOptions`. */
  ownMoves: (cell: OffsetCell, payload: PlayerCell) => OwnMoves;
  onMoveMonsters: (cell: OffsetCell, payload: PlayerCell) => void;
  onRelocate: (cell: OffsetCell, payload: PlayerCell) => void;
  /** The cell panel's Message on another player's yard (#193). */
  onMessage?: (payload: PlayerCell) => void;
  /** Proposes a truce to another player's yard's owner (#203). */
  onTruce?: (payload: PlayerCell) => void;
  /** Invitations to move (#205): see `CellPanelOptions`. */
  onInvite?: (cell: OffsetCell, payload: PlayerCell) => void;
  onWithdrawInvite?: (cell: OffsetCell, payload: PlayerCell) => void;
  onInviteToOutpost?: (payload: PlayerCell) => void;
  canInviteToOutpost?: (payload: PlayerCell) => boolean;
  /**
   * The cell inspector's Repeat attack on a wild camp (issue #221); see
   * `AutoAttackControlOptions`. Absent: no Repeat attack.
   */
  autoAttackPlan?: (baseid: string) => Promise<AutoAttackPlanResponse>;
  onRepeatAttack?: (cell: OffsetCell, baseid: string, answer: AutoAttackPlanResponse) => void;
}

export class MapRoomUi {
  readonly notices = new Notices();

  private readonly hud: Hud;
  private readonly navPanel: NavPanel;
  private readonly find: FindControl;
  private readonly hover = new HoverCard();
  private readonly minimap: Minimap;
  private readonly zoomControl: ZoomControl;
  private readonly rangeControl: RangeControl;
  private readonly docks: HTMLElement[] = [];
  /** The tool row, bottom right: Range and the zoom, and what `placeTool` puts first. */
  private tools: HTMLElement | null = null;

  private cellPanel: CellPanel | null = null;
  private rangeOn = false;
  private takeover: TakeoverControl | null = null;
  private autoAttack: AutoAttackControl | null = null;
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
      ...(handlers.onAchievementsOpen ? { onAchievementsOpen: handlers.onAchievementsOpen } : {}),
    });
    this.hud.setActiveScene(activeScene);

    // Going somewhere from Find closes it: the place found is what matters.
    const went = (go: () => void): void => {
      go();
      this.find.setOpen(false);
    };
    this.navPanel = new NavPanel({
      onHome: () => went(handlers.onHome),
      onRefresh: handlers.onRefresh,
      onFit: () => went(handlers.onZoomReset),
      onJump: (x, y) => went(() => handlers.onJump({ col: x, row: y })),
      onBookmarkJump: (bookmark) => went(() => handlers.onJump({ col: bookmark.x, row: bookmark.y })),
      onBookmarkAdd: handlers.onBookmarkAdd,
      onBookmarkRemove: handlers.onBookmarkRemove,
    });

    this.minimap = new Minimap({ onJump: handlers.onJump });
    // The Navigate panel and the world map sit behind one Find button (#176).
    const world = document.createElement("div");
    world.className = "mr2-find__world";
    this.minimap.mount(world);
    this.navPanel.prepend(world);
    this.find = new FindControl(this.navPanel, (open) => {
      if (open) this.minimap.draw();
    });
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
  }

  mount(container: HTMLElement, modal?: HTMLElement): this {
    this.container = container;
    this.modal = modal ?? null;
    container.append(this.hud.element);
    this.notices.mount(container);

    this.hover.mount(container);
    this.find.mount(this.dock("map-dock mr2-find-dock"));

    const bottomRight = this.dock("map-dock map-dock--bottom-right mr2-tools-dock");
    bottomRight.append(this.rangeControl.legend);
    const tools = document.createElement("div");
    tools.className = "mr2-toolrow";
    tools.append(this.rangeControl.button);
    this.zoomControl.mount(tools);
    bottomRight.append(tools);
    this.tools = tools;
    return this;
  }

  /** Puts a tool button at the head of the tool row: the Mail button (#193). */
  placeTool(element: HTMLElement): void {
    this.tools?.prepend(element);
  }

  destroy(): void {
    this.hud.destroy();
    this.find.destroy();
    this.hover.destroy();
    this.cellPanel?.close();
    this.cellPanel = null;
    this.takeover?.destroy();
    this.takeover = null;
    this.autoAttack?.destroy();
    this.autoAttack = null;
    this.minimap.destroy();
    this.zoomControl.destroy();
    this.notices.destroy();
    for (const dock of this.docks) dock.remove();
    this.docks.length = 0;
    this.container = null;
    this.modal = null;
  }

  /* ── Display ────────────────────────────────────────────────────────── */

  setResources(
    resources: Resources,
    credits: number | undefined,
    options: { float?: boolean } = {},
  ): void {
    this.hud.setResources(resources, credits, options);
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

  /** Redraws the world map, while the Find panel that holds it is open. */
  drawMinimap(): void {
    if (this.find.isOpen) this.minimap.draw();
  }

  /** Names the cell under the pointer beside it (#176); see `HoverCard`. */
  showHover(content: HoverCardContent, at: { left: number; right: number; middle: number }): void {
    this.hover.show(content, at);
  }

  hideHover(): void {
    this.hover.hide();
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
        decline: this.handlers.declineTakeover,
        onDeclined: this.handlers.onTakeoverDeclined,
        modal: () => this.modal ?? this.container,
      });
      const { autoAttackPlan, onRepeatAttack } = this.handlers;
      this.autoAttack =
        autoAttackPlan && onRepeatAttack
          ? new AutoAttackControl({ plan: autoAttackPlan, onRepeat: onRepeatAttack })
          : null;
      this.cellPanel = new CellPanel({
        onClose: this.handlers.onCellPanelClose,
        onBookmark: this.handlers.onBookmarkCell,
        canBookmark: this.handlers.canBookmark,
        onViewYard: this.handlers.onViewYard,
        attackRefusal: this.handlers.attackRefusal,
        onAttack: this.handlers.onAttack,
        reach: this.handlers.reach,
        ownFlinger: this.handlers.ownFlinger,
        ownMoves: this.handlers.ownMoves,
        onMoveMonsters: this.handlers.onMoveMonsters,
        onRelocate: this.handlers.onRelocate,
        ...(this.handlers.onMessage ? { onMessage: this.handlers.onMessage } : {}),
        ...(this.handlers.onTruce ? { onTruce: this.handlers.onTruce } : {}),
        ...(this.handlers.onInvite ? { onInvite: this.handlers.onInvite } : {}),
        ...(this.handlers.onWithdrawInvite ? { onWithdrawInvite: this.handlers.onWithdrawInvite } : {}),
        ...(this.handlers.onInviteToOutpost ? { onInviteToOutpost: this.handlers.onInviteToOutpost } : {}),
        ...(this.handlers.canInviteToOutpost ? { canInviteToOutpost: this.handlers.canInviteToOutpost } : {}),
        onRangeToggle: (on) => this.toggleRange(on),
        extraAction: this.autoAttack ? [this.autoAttack, this.takeover] : this.takeover,
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

  /** Asks the server again what the shown camp's Repeat attack would do (#221). */
  refreshAutoAttack(): void {
    this.autoAttack?.refresh();
  }

  /** The overlay's modal layer, where the auto-attack sheets open (#221). */
  modalLayer(): HTMLElement | null {
    return this.modal ?? this.container;
  }

  /** Opens a dialog on the overlay's modal layer: Move monsters, Move main yard here (#186). */
  openDialog(dialog: { mount: (container: HTMLElement) => unknown }): void {
    const container = this.modal ?? this.container;
    if (container) dialog.mount(container);
  }

  /** Flash's "Veni, Vidi, Vici!" for a yard just taken over. */
  showTakenOver(kind: TakeoverKind, name: string): void {
    const container = this.modal ?? this.container;
    if (container) showTakenOver(container, kind, name);
  }

  /** Where the open cell panel sits on screen, or null when none is open. */
  cellPanelRect(): DOMRect | null {
    return this.cellPanel?.element.getBoundingClientRect() ?? null;
  }

  /** The bottom edge of the HUD: the map shows nothing above it. */
  /** The achievements screen behind the HUD's Account menu (#204). */
  get achievements(): AchievementsDoor | null {
    return this.hud.achievements;
  }

  hudBottom(): number {
    return this.hud.element.getBoundingClientRect().bottom;
  }

  closeCell(): void {
    this.cellPanel?.close();
    this.cellPanel = null;
    this.takeover?.destroy();
    this.takeover = null;
    this.autoAttack?.destroy();
    this.autoAttack = null;
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
