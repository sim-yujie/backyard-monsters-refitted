import type { MapCell } from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";

/**
 * When an own outpost's build, upgrade or fortify ends, the map asks for that
 * cell again so its construction badge and the yard card's "Worker: Building"
 * go at that moment, not when the player next opens the yard (owner, 12 Nov
 * 2026). The server sends the end as `wf` (Unix seconds, its clock) with `wb`.
 */

/** Seconds past `wf` before asking: the server's clock is only known to the second. */
export const FINISH_GRACE_SECONDS = 1;
/** Seconds between asks while the server still says busy for the same `wf`. */
export const RETRY_SECONDS = 5;
/** Asks for one `wf` before giving up until the next stale refresh. */
export const MAX_TRIES = 3;

interface Asked {
  wf: number;
  at: number;
  tries: number;
}

/** A busy worker's finish time (`wf` while `wb`), the watch's default reading. */
export const workerFinishOf = (payload: MapCell | undefined): number | undefined => {
  const cell = payload as { wb?: number; wf?: number } | undefined;
  return cell?.wb === 1 ? cell.wf : undefined;
};

/** When the next monster hatches on an own cell (`nh`, live map beta 9). */
export const hatchFinishOf = (payload: MapCell | undefined): number | undefined =>
  (payload as { nh?: number } | undefined)?.nh;

export class WorkerFinishWatch {
  private readonly asked = new Map<string, Asked>();

  /**
   * `finishOf`: the time a cell is due to change by itself (a worker by default, or a hatch).
   * `minGapSeconds`: never ask one cell again sooner than this (a paused hatchery's next hatch
   * moves on with every answer, so without it the cell would be asked every countdown).
   */
  constructor(
    private readonly finishOf: (payload: MapCell | undefined) => number | undefined = workerFinishOf,
    private readonly minGapSeconds = 0,
  ) {}

  /**
   * The cells among `cells` whose busy worker is due to be free by `now`
   * (server seconds), and that are worth asking the server about again.
   */
  due(cells: readonly OffsetCell[], cellAt: (col: number, row: number) => MapCell | undefined, now: number): OffsetCell[] {
    const out: OffsetCell[] = [];
    for (const cell of cells) {
      const key = `${cell.col},${cell.row}`;
      const wf = this.finishOf(cellAt(cell.col, cell.row));
      if (typeof wf !== "number") {
        this.asked.delete(key);
        continue;
      }
      if (now < wf + FINISH_GRACE_SECONDS) continue;
      const last = this.asked.get(key);
      if (last && this.minGapSeconds > 0 && now < last.at + this.minGapSeconds) continue;
      if (last && last.wf === wf) {
        if (last.tries >= MAX_TRIES || now < last.at + RETRY_SECONDS) continue;
        last.tries += 1;
        last.at = now;
      } else {
        this.asked.set(key, { wf, at: now, tries: 1 });
      }
      out.push(cell);
    }
    return out;
  }
}
