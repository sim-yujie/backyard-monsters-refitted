import { isPlayerCell, type MapCell } from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";
import type { ZoneRecord, ZoneStore } from "../ZoneStore";
import { zoneChanges } from "./cellChanges";
import type { CellRings, RingTier } from "./CellRings";
import { LiveLink, MAX_WATCH, type LiveLinkOptions } from "./liveLink";

/**
 * The live map in Map Room 2 (beta 9, stage 1), between the connection
 * (`liveLink.ts`), the zone cache and what the player sees: pushed zone
 * versions become re-asks of only those zones, each spread over up to
 * {@link PUSH_JITTER_MS} so everyone watching a zone does not ask in the same
 * instant; an answer that came from a push rings its changed cells and, when
 * the open panel's cell is one, updates the panel at once.
 */

/** Pushed re-asks are spread over this much time (still well inside the owner's 1-2 s). */
export const PUSH_JITTER_MS = 400;
/** While the connection is down, visible zones older than this are asked again (owner: 3-5 min). */
export const DOWN_REFRESH_SECONDS = 240;

export interface LiveUpdatesOptions {
  store: Pick<ZoneStore, "applyVersions" | "watchList" | "getCell" | "pump">;
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
  random?: () => number;
  delay?: (fn: () => void, ms: number) => void;
}

export class LiveUpdates {
  private link: LiveLink | null = null;
  private stopped = false;
  private readonly random: () => number;
  private readonly delay: (fn: () => void, ms: number) => void;

  constructor(private readonly options: LiveUpdatesOptions) {
    this.random = options.random ?? Math.random;
    this.delay = options.delay ?? ((fn, ms) => void setTimeout(fn, ms));
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
  }

  stop(): void {
    this.stopped = true;
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
    // A watch's answer (the catch-up after a reconnect, the 5-minute check) asks at once;
    // a push is spread out a little.
    const apply = () => {
      if (this.stopped) return;
      if (this.options.store.applyVersions(pairs) > 0) void this.options.store.pump();
    };
    if (all) apply();
    else this.delay(apply, Math.floor(this.random() * PUSH_JITTER_MS));
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
