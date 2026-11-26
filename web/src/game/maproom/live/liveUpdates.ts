import { isPlayerCell, type MapCell } from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";
import type { ZoneRecord, ZoneStore } from "../ZoneStore";
import { zoneChanges } from "./cellChanges";
import type { CellRings, RingTier } from "./CellRings";
import { CHECK_MS, LiveLink, MAX_WATCH, type LiveLinkOptions } from "./liveLink";

/**
 * The live map in Map Room 2 (beta 9, stage 1), between the connection
 * (`liveLink.ts`), the zone cache and what the player sees: pushed zone
 * versions become re-asks of only those zones (`ZoneStore.applyVersions`,
 * `pumpLive`: on screen only, spread out, batched); an answer that came from a
 * push rings its changed cells and, when the open panel's cell is one,
 * updates the panel at once. A hidden tab ignores pushes; the version check
 * when it comes back catches up.
 */
/** While the connection is down, visible zones older than this are asked again (owner: 3-5 min). */
export const DOWN_REFRESH_SECONDS = 240;

export interface LiveUpdatesOptions {
  store: Pick<ZoneStore, "applyVersions" | "watchList" | "getCell" | "pumpLive">;
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
