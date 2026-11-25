import { CellType, isFogCell, isPlayerCell, isWaterCell, type MapCell, type PlayerCell } from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";
import type { MapRenderer } from "../MapRenderer";
import type { ZoneRecord, ZoneStore } from "../ZoneStore";
import type { CellRange } from "../zones";
import { liveOptions, setLiveOptions, type LiveChangeKind, type LiveOptions, type LiveTier } from "./liveProto";

/**
 * PROTOTYPE (proto/live-map-ux, dev builds only): fakes the server's live pushes on this browser's
 * map, so the three live-map looks can be seen and filmed with no server work.
 *
 * In the browser console on the map (`npm run dev`):
 *   __liveDemo.use({ q1: "B", q2: "A", q3: "A" })   pick the look per question (or ?live1=B&live2=A&live3=A)
 *   __liveDemo.taken(241, 207)                      a cell is taken (camp or yard becomes another player's outpost)
 *   __liveDemo.attack(241, 207) / .attackEnd(...)   someone starts / stops attacking a player's cell
 *   __liveDemo.shield(241, 207) / .shieldEnd(...)   a damage shield comes up / ends
 *   __liveDemo.storm({ count: 12, seconds: 4 })     a busy zone: many cells on screen change in a few seconds
 *   __liveDemo.drop() / .restore()                  the live connection goes down (mark after 5 s) / comes back
 *   __liveDemo.freeze(0.2) / .freeze(null)          hold every pulse and highlight still, for screenshots
 *   __liveDemo.reset()                              forget the fake changes (the next re-ask brings the real cells)
 */

export interface LiveDemoHost {
  readonly store: ZoneStore;
  readonly renderer: MapRenderer;
  range(): CellRange;
  selected(): OffsetCell | null;
  select(cell: OffsetCell): void;
  deselect(): void;
  view(cell: OffsetCell, zoom: number): void;
  inRange(cell: OffsetCell): boolean;
  /** A batch of changed cells reached the map: the open panel looks again. */
  changed(cells: readonly OffsetCell[]): void;
  setConnection(down: boolean, instant: boolean): void;
  showBack(): void;
  optionsChanged(options: LiveOptions): void;
}

const FLUSH_MS = 200;

export class LiveDemo {
  private readonly dirtyZones = new Map<number, ZoneRecord>();
  private readonly dirtyCells: OffsetCell[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Each changed cell as it was before the first fake change, for `reset`. */
  private readonly originals = new Map<string, { cell: OffsetCell; payload: MapCell }>();

  constructor(private readonly host: LiveDemoHost) {}

  /** The console object (`__liveDemo`). */
  api(): Record<string, unknown> {
    const at = (kind: LiveChangeKind) => (col: number, row: number) => this.change({ col, row }, kind);
    return {
      use: (options: Partial<LiveOptions>) => {
        const next = setLiveOptions(options);
        this.host.optionsChanged(next);
        return next;
      },
      options: () => liveOptions(),
      change: (col: number, row: number, kind: LiveChangeKind) => this.change({ col, row }, kind),
      taken: at("taken"),
      attack: at("attack"),
      attackEnd: at("attackEnd"),
      shield: at("shield"),
      shieldEnd: at("shieldEnd"),
      minor: at("minor"),
      storm: (options?: { count?: number; seconds?: number; seed?: number }) => this.storm(options),
      cells: () =>
        this.visibleCells().map(({ cell, payload }) => ({
          ...cell,
          kind: kindOf(payload),
          inRange: this.host.inRange(cell),
          name: isPlayerCell(payload) ? payload.n : "",
        })),
      select: (col: number, row: number) => this.host.select({ col, row }),
      deselect: () => this.host.deselect(),
      view: (col: number, row: number, zoom: number) => this.host.view({ col, row }, zoom),
      freeze: (fraction: number | null) => this.freeze(fraction),
      stop: () => {
        this.host.renderer.pulses.stopClock();
        document.documentElement.dataset["liveFreeze"] = "1";
      },
      drop: (options?: { instant?: boolean }) => this.host.setConnection(true, options?.instant ?? false),
      restore: (options?: { instant?: boolean }) => this.host.setConnection(false, options?.instant ?? false),
      back: () => this.host.showBack(),
      pulses: () => this.host.renderer.pulses.active,
      reset: () => this.reset(),
    };
  }

  destroy(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** One pushed change on one cell. False when the cell is not loaded or cannot change that way. */
  change(cell: OffsetCell, kind: LiveChangeKind): boolean {
    const { store, renderer } = this.host;
    const before = store.getCell(cell.col, cell.row);
    if (!before || isWaterCell(before) || isFogCell(before)) return false;
    const after = this.changed(cell, before, kind);
    if (!after) return false;
    const key = `${cell.col},${cell.row}`;
    if (!this.originals.has(key)) this.originals.set(key, { cell, payload: before });
    const zone = store.patchCell(cell.col, cell.row, after);
    if (!zone) return false;
    renderer.pulses.add(cell, kind, this.tierOf(cell, before, after));
    this.dirtyZones.set(zone.id, zone);
    this.dirtyCells.push(cell);
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
    return true;
  }

  /** A busy zone: `count` cells on screen change over `seconds` (0: all at once), the same cells for a seed. */
  storm(options: { count?: number; seconds?: number; seed?: number } = {}): number {
    const count = options.count ?? 12;
    const seconds = options.seconds ?? 4;
    const random = seeded(options.seed ?? 1);
    const cells = this.visibleCells();
    // A fixed order for a seed, so A, B and C show the same cells changing.
    for (let index = cells.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [cells[index], cells[other]] = [cells[other]!, cells[index]!];
    }
    const picked = cells.slice(0, count);
    picked.forEach(({ cell, payload }, index) => {
      const kind = stormKind(payload, index);
      const delay = count <= 1 || seconds === 0 ? 0 : (index / (count - 1)) * seconds * 1000;
      if (delay === 0) {
        this.change(cell, kind);
        return;
      }
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.change(cell, kind);
      }, delay);
      this.timers.add(timer);
    });
    return picked.length;
  }

  private freeze(fraction: number | null): void {
    this.host.renderer.pulses.freeze(fraction);
    if (fraction === null) delete document.documentElement.dataset["liveFreeze"];
    else document.documentElement.dataset["liveFreeze"] = "1";
  }

  private reset(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const zones = new Map<number, ZoneRecord>();
    for (const { cell, payload } of this.originals.values()) {
      const zone = this.host.store.patchCell(cell.col, cell.row, payload);
      if (zone) zones.set(zone.id, zone);
    }
    this.host.store.clearPatches();
    this.originals.clear();
    this.host.renderer.pulses.clear();
    this.freeze(null);
    for (const zone of zones.values()) this.host.renderer.applyZone(zone);
    this.host.changed([]);
  }

  private flush(): void {
    this.flushTimer = null;
    for (const zone of this.dirtyZones.values()) this.host.renderer.applyZone(zone);
    this.dirtyZones.clear();
    const cells = this.dirtyCells.splice(0);
    this.host.changed(cells);
  }

  private tierOf(cell: OffsetCell, before: MapCell, after: MapCell): LiveTier {
    if ((isPlayerCell(before) && before.mine === 1) || (isPlayerCell(after) && after.mine === 1)) return "own";
    const selected = this.host.selected();
    if (selected && selected.col === cell.col && selected.row === cell.row) return "selected";
    return this.host.inRange(cell) ? "range" : "far";
  }

  private changed(cell: OffsetCell, before: MapCell, kind: LiveChangeKind): MapCell | null {
    const now = Date.now() / 1000;
    if (kind === "taken") {
      if (isWaterCell(before) || isFogCell(before)) return null;
      const owner = this.newOwnerFor(before);
      if (!owner) return null;
      const taken: PlayerCell = {
        ...owner,
        b: CellType.OUTPOST,
        i: before.i,
        bid: before.bid,
        mine: 0,
        dm: 0,
        d: 0,
        lo: 0,
        p: 0,
        pi: 0,
        th: 0,
        kit: 0,
      };
      delete taken.atk;
      delete taken.pe;
      delete taken.wi;
      delete taken.wb;
      delete taken.wf;
      delete taken.r;
      delete taken.m;
      delete taken.f;
      delete taken.c;
      if ("lf" in before && before.lf !== undefined) taken.lf = before.lf;
      else delete taken.lf;
      if ("rv" in before && before.rv !== undefined) taken.rv = before.rv;
      else delete taken.rv;
      void cell;
      return taken;
    }
    if (!isPlayerCell(before)) {
      if (kind !== "minor" || !("dm" in before)) return null;
      return { ...before, dm: Math.min(89, before.dm + 15) };
    }
    switch (kind) {
      case "attack":
        return { ...before, atk: 1, lo: 1 };
      case "attackEnd": {
        const next: PlayerCell = { ...before, lo: 0, dm: Math.min(89, before.dm + 20) };
        delete next.atk;
        return next;
      }
      case "shield": {
        const next: PlayerCell = { ...before, p: 1, pe: now + 6 * 3600 };
        delete next.atk;
        return next;
      }
      case "shieldEnd": {
        const next: PlayerCell = { ...before, p: 0 };
        delete next.pe;
        return next;
      }
      default:
        return { ...before, dm: Math.min(89, before.dm + 10) };
    }
  }

  /**
   * Who takes a cell: a real player already on the loaded map (never the viewer, never the cell's
   * own owner), so the name and picture are real.
   */
  private newOwnerFor(before: MapCell): PlayerCell | null {
    const currentOwner = isPlayerCell(before) ? before.uid : -1;
    let fallback: PlayerCell | null = null;
    for (const zone of this.host.store.loadedZoneRefs()) {
      for (const column of Object.values(zone.data)) {
        for (const cell of Object.values(column)) {
          if (!isPlayerCell(cell) || cell.mine === 1 || cell.uid === currentOwner) continue;
          if (cell.b === CellType.HOME_CELL) return cell;
          fallback ??= cell;
        }
      }
    }
    return fallback;
  }

  private visibleCells(): { cell: OffsetCell; payload: MapCell }[] {
    const range = this.host.range();
    const out: { cell: OffsetCell; payload: MapCell }[] = [];
    // A cell of margin inside the view, so every change is on screen.
    for (let col = range.minCol + 2; col <= range.maxCol - 2; col += 1) {
      for (let row = range.minRow + 2; row <= range.maxRow - 2; row += 1) {
        const payload = this.host.store.getCell(col, row);
        if (!payload || isWaterCell(payload) || isFogCell(payload)) continue;
        out.push({ cell: { col, row }, payload });
      }
    }
    return out;
  }
}

const kindOf = (payload: MapCell): string =>
  isPlayerCell(payload) ? (payload.mine === 1 ? "own" : payload.b === CellType.OUTPOST ? "outpost" : "yard") : "camp";

/** A storm's mix: camps get taken or hit, yards get attacked or shielded. */
const stormKind = (payload: MapCell, index: number): LiveChangeKind => {
  if (!isPlayerCell(payload)) return index % 3 === 2 ? "minor" : "taken";
  if (payload.mine === 1) return "attack";
  return index % 2 === 0 ? "attack" : "shield";
};

/** A small seeded random (mulberry32). */
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
