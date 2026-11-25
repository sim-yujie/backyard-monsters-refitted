import { Graphics } from "pixi.js";
import { mapRoomGrid, type OffsetCell } from "@/game/HexGrid";
import { classicLook } from "@/game/classicLook";
import { isPhoneLayout } from "@/ui/phoneLayout";
import { liftCorners } from "../ground";
import { stepAt } from "../animationClock";
import type { LiveChangeKind } from "./cellChanges";

/**
 * The live map's "this cell just changed" mark (beta 9; owner's choice C on
 * the desk card live-cell, 25 Nov 2026): a ring that grows a tenth out of the
 * hex and fades in 0.8 s, gold when the cell was taken, ember when an attack
 * started, pale otherwise. At most {@link MAX_RINGS} at once, the player's own
 * and selected cells kept over the rest; anything more simply snaps.
 *
 * Costs nothing when idle: `animate` draws nothing unless a ring runs, and
 * steps on the map's shared 30-a-second clock while one does.
 */

export type RingTier = "own" | "selected" | "range" | "far";

interface Ring {
  readonly col: number;
  readonly row: number;
  readonly start: number;
  readonly colour: number;
  readonly width: number;
  readonly rank: number;
}

export const RING_MS = 800;
export const MAX_RINGS = 4;

const COLOURS: Record<LiveChangeKind, number> = {
  taken: 0xffd059,
  attack: 0xff5a2b,
  shield: 0xa8ecff,
  shieldEnd: 0xf2f6ff,
  attackEnd: 0xf2f6ff,
  minor: 0xf2f6ff,
};

const RANK: Record<RingTier, number> = { own: 0, selected: 1, range: 2, far: 3 };

export class CellRings {
  readonly graphics = new Graphics();
  private rings: Ring[] = [];
  private lastStep = -1;
  private drawn = false;
  /** Pictures only: every ring held at this fraction of its life, none ever ends. */
  private frozen: number | null = null;

  constructor(private readonly liftAt: (col: number, row: number) => number) {
    this.graphics.eventMode = "none";
  }

  get active(): number {
    return this.rings.length;
  }

  /** Holds every ring at `fraction` (0..1) of its life, for stills; null lets them run again. */
  freeze(fraction: number | null): void {
    this.frozen = fraction;
    this.lastStep = -1;
  }

  clear(): void {
    this.rings = [];
    this.frozen = null;
    this.lastStep = -1;
  }

  /** A change on a cell; false when it only snaps (too many rings already, all mattering more). */
  add(cell: OffsetCell, kind: LiveChangeKind, tier: RingTier, now: number = performance.now()): boolean {
    const rank = RANK[tier];
    this.expire(now);
    this.rings = this.rings.filter((ring) => ring.col !== cell.col || ring.row !== cell.row);
    if (this.rings.length >= MAX_RINGS) {
      let worst = -1;
      for (let index = 0; index < this.rings.length; index += 1) {
        if (worst < 0 || this.rings[index]!.rank >= this.rings[worst]!.rank) worst = index;
      }
      if (worst < 0 || this.rings[worst]!.rank <= rank) return false;
      this.rings.splice(worst, 1);
    }
    this.rings.push({ col: cell.col, row: cell.row, start: now, colour: COLOURS[kind], width: rank <= 1 ? 4 : 3, rank });
    this.lastStep = -1;
    return true;
  }

  /** Redraws while a ring runs; true when it drew (a tilted map then redraws its picture). */
  animate(now: number, zoom: number): boolean {
    if (this.frozen === null) this.expire(now);
    if (this.rings.length === 0) {
      if (!this.drawn) return false;
      this.graphics.clear();
      this.drawn = false;
      return true;
    }
    const step = stepAt(now, 1);
    if (step === this.lastStep) return false;
    this.lastStep = step;

    const g = this.graphics;
    g.clear();
    const classic = classicLook();
    const phone = isPhoneLayout();
    for (const ring of this.rings) {
      const life = this.frozen ?? Math.min(1, (now - ring.start) / RING_MS);
      const alpha = 0.8 * (1 - easeOut(life));
      if (alpha <= 0.01) continue;
      const corners = liftCorners(mapRoomGrid.writeCellCorners(ring.col, ring.row, []), this.liftAt(ring.col, ring.row));
      const width = (ring.width + (phone ? 0.5 : 0)) / zoom;
      const shape = scaleAbout(corners, 1 + 0.1 * easeOut(life));
      if (!classic) {
        // Modern: a soft glow under the line.
        g.poly(shape);
        g.stroke({ width: width * 2.5, color: ring.colour, alpha: alpha * 0.3 });
      }
      g.poly(shape);
      g.stroke({ width, color: ring.colour, alpha });
    }
    this.drawn = true;
    return true;
  }

  private expire(now: number): void {
    if (this.frozen !== null) return;
    this.rings = this.rings.filter((ring) => now - ring.start < RING_MS);
  }
}

const easeOut = (t: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

/** The polygon scaled about its own centre. */
const scaleAbout = (corners: number[], factor: number): number[] => {
  let cx = 0;
  let cy = 0;
  const count = corners.length / 2;
  for (let index = 0; index < corners.length; index += 2) {
    cx += corners[index]!;
    cy += corners[index + 1]!;
  }
  cx /= count;
  cy /= count;
  const out = new Array<number>(corners.length);
  for (let index = 0; index < corners.length; index += 2) {
    out[index] = cx + (corners[index]! - cx) * factor;
    out[index + 1] = cy + (corners[index + 1]! - cy) * factor;
  }
  return out;
};
