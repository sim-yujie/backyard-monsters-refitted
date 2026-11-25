import { isPlayerCell, type MapCell } from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";
import type { ZoneRecord, ZoneStore } from "../ZoneStore";
import { zoneChanges } from "./cellChanges";
import type { CellRings, RingTier } from "./CellRings";
import { CHECK_MS, LiveLink, MAX_WATCH, type LiveCellsFrame, type LiveLinkOptions } from "./liveLink";

/**
 * The live map in Map Room 2 (beta 9, stages 1-2), between the connection
 * (`liveLink.ts`), the zone cache and what the player sees: pushed cells go
 * straight into the cache (`ZoneStore.applyLiveCells`); zones a push could not
 * complete, and pushed versions without cells, become re-asks of only those
 * zones (`pumpLive`: on screen only, spread out, batched). A pushed change
 * rings its changed cells and, when the open panel's cell is one, updates
 * the panel at once. A hidden tab ignores pushes; when it comes back it
 * catches up from the server's log (and the version check).
 */
/** While the connection is down, visible zones older than this are asked again (owner: 3-5 min). */
export const DOWN_REFRESH_SECONDS = 240;

export interface LiveUpdatesOptions {
  store: Pick<ZoneStore, "applyVersions" | "watchList" | "getCell" | "pumpLive" | "applyLiveCells" | "applyOwnCells" | "reaskZones">;
  rings: Pick<CellRings, "add">;
  /** Ask `/worldmapv2/sight` again. */
  refreshSight: () => void;
  /** The open panel's cell, if any, and how to hand it a live payload. */
  shownCell: () => OffsetCell | null;
  updateShown: (payload: MapCell | undefined) => void;
  /** How much a cell matters to the player, for which rings to keep when many run. */
  tierOf: (cell: OffsetCell, payload: MapCell | undefined) => RingTier;
  token: () => string | null;
  link?: Partial<Pick<LiveLinkOptions, "socket" | "timers">>;
  /** True while the tab is hidden (default: `document.hidden`). */
  hidden?: () => boolean;
}

export class LiveUpdates {
  private link: LiveLink | null = null;
  private stopped = false;
  private sightTimer: ReturnType<typeof setInterval> | null = null;
  private readonly hidden: () => boolean;

  constructor(private readonly options: LiveUpdatesOptions) {
    this.hidden = options.hidden ?? (() => typeof document !== "undefined" && document.hidden);
  }

  /** True while connected: no timed re-asks then. */
  get up(): boolean {
    return this.link?.up ?? false;
  }

  /** Connects (once the own yard load said where the socket server is). */
  start(url: string): void {
    if (this.stopped || this.link) return;
    this.link = new LiveLink({
      url,
      token: this.options.token,
      watchList: () => this.options.store.watchList(MAX_WATCH),
      onVersions: (pairs, all) => this.versions(pairs, all),
      onCells: (frame) => this.cells(frame),
      onOwn: (cells) => {
        if (!this.stopped && !this.hidden()) this.options.store.applyOwnCells(cells);
      },
      onRedo: (zones) => {
        if (!this.stopped && this.options.store.reaskZones(zones) > 0) void this.options.store.pumpLive();
      },
      onSight: this.options.refreshSight,
      ...this.options.link,
    });
    this.link.start();
    // What only the clock changes in the fog (an ally's Flinger upgrade finishing) is written nowhere,
    // so nothing pushes it: the sight is asked again with each 5-minute version check.
    this.sightTimer = setInterval(() => {
      if (this.link?.up) this.options.refreshSight();
    }, CHECK_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.sightTimer) clearInterval(this.sightTimer);
    this.sightTimer = null;
    this.link?.stop();
    this.link = null;
  }

  viewChanged(): void {
    this.link?.viewChanged();
  }

  /** A version check now (the tab came back, the network came back). */
  check(): void {
    this.link?.check();
  }

  /** A zone answer arrived; `live` when a push asked for it. */
  zoneArrived(zone: ZoneRecord, previous: ZoneRecord | undefined, live: boolean): void {
    if (!live || !previous || this.stopped) return;
    const changes = zoneChanges(zone.originX, zone.originY, previous.data, zone.data);
    if (!changes.length) return;
    const shown = this.options.shownCell();
    for (const change of changes) {
      const cell = { col: change.col, row: change.row };
      const payload = this.options.store.getCell(change.col, change.row);
      this.options.rings.add(cell, change.kind, this.options.tierOf(cell, payload));
      if (shown && shown.col === change.col && shown.row === change.row) this.options.updateShown(payload);
    }
  }

  /**
   * Pushed cells (stage 2): applied at once, no request; only zones that missed a push or hold a
   * cell the map cannot complete are asked again. A hidden tab takes nothing (it draws nothing),
   * and catches up from the server's log when it comes back. False when not taken.
   */
  private cells(frame: LiveCellsFrame): boolean {
    if (this.stopped) return false;
    if (!frame.rp && this.hidden()) return false;
    const asked = this.options.store.applyLiveCells(frame.z, frame.c, frame.rz, frame.ad);
    if (asked > 0) void this.options.store.pumpLive();
    return true;
  }

  private versions(pairs: [number, number][], all: boolean): void {
    if (this.stopped) return;
    // A hidden tab asks nothing (the old polling paused too); its focus check catches up.
    if (!all && this.hidden()) return;
    // A watch's answer (the catch-up after a reconnect, the 5-minute check) is due at once;
    // a push waits a random moment.
    if (this.options.store.applyVersions(pairs, all) > 0) void this.options.store.pumpLive();
  }
}

/** The ring tier for a cell: the player's own, the selected one, one in range, or far. */
export const ringTier = (
  cell: OffsetCell,
  payload: MapCell | undefined,
  selected: OffsetCell | null,
  inRange: (cell: OffsetCell) => boolean,
): RingTier => {
  if (payload && isPlayerCell(payload) && payload.mine === 1) return "own";
  if (selected && selected.col === cell.col && selected.row === cell.row) return "selected";
  return inRange(cell) ? "range" : "far";
};
