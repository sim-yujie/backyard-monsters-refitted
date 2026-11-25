import { Graphics } from "pixi.js";
import { mapRoomGrid, type OffsetCell } from "@/game/HexGrid";
import { classicLook } from "@/game/classicLook";
import { isPhoneLayout } from "@/ui/phoneLayout";
import { liftCorners } from "../ground";
import { stepAt } from "../animationClock";
import { liveOptions, type LiveChangeKind, type LiveTier } from "./liveProto";

/**
 * PROTOTYPE (proto/live-map-ux): Q1 "cell changed", drawn on the ground under the markers.
 *
 * A: nothing moves except a 350 ms gold wash on the player's own cells and the selected one.
 * B: a colour-coded line just inside the hex (gold taken, orange attacked, green shield up, pale
 *    shield down), strength by how much the cell matters, 1.5 s per-cell cooldown, at most 6 at once
 *    (4 on a phone); the rest just snap.
 * C: a ring that grows 18 % out of the hex and fades (gold taken, orange attacked, pale otherwise),
 *    at most 4 at once.
 *
 * Costs nothing when idle: `animate` returns false and draws nothing unless a pulse is running,
 * and steps on the map's shared 30-a-second clock while one is.
 */

interface Pulse {
  readonly col: number;
  readonly row: number;
  readonly start: number;
  readonly duration: number;
  readonly hold: number;
  readonly colour: number;
  readonly peak: number;
  readonly width: number;
  readonly style: "wash" | "inner" | "ring";
  readonly rank: number;
}

const COLOURS: Record<"B" | "C", Partial<Record<LiveChangeKind, number>>> = {
  B: { taken: 0xf5b82e, attack: 0xf05228, shield: 0x38e09b, shieldEnd: 0xdceaf2 },
  C: { taken: 0xffd059, attack: 0xff5a2b, shield: 0xf2f6ff, shieldEnd: 0xf2f6ff, attackEnd: 0xf2f6ff },
};

const RANK: Record<LiveTier, number> = { own: 0, selected: 1, range: 2, far: 3 };
const COOLDOWN_MS = 1500;

export class CellPulses {
  readonly graphics = new Graphics();
  private pulses: Pulse[] = [];
  private readonly lastPulse = new Map<string, number>();
  private lastStep = -1;
  private drawn = false;
  /** Shots only: every pulse drawn at this fraction of its life, and none ever ends. */
  private frozen: number | null = null;
  /** Shots only: the clock stopped at this moment, each pulse held where it was. */
  private stoppedAt: number | null = null;

  constructor(private readonly liftAt: (col: number, row: number) => number) {
    this.graphics.eventMode = "none";
  }

  get active(): number {
    return this.pulses.length;
  }

  /** Holds every pulse at `fraction` (0..1) of its life, for stills; null lets them run again. */
  freeze(fraction: number | null): void {
    this.frozen = fraction;
    this.stoppedAt = null;
    this.lastStep = -1;
  }

  /** Stops the clock where it is (each pulse keeps its own phase), for stills of a busy moment. */
  stopClock(): void {
    this.stoppedAt = performance.now();
    this.frozen = null;
    this.lastStep = -1;
  }

  clear(): void {
    this.stoppedAt = null;
    this.frozen = null;
    this.pulses = [];
    this.lastPulse.clear();
    this.lastStep = -1;
  }

  /** A change on a cell. Returns whether a pulse was started (false: it just snaps). */
  add(cell: OffsetCell, kind: LiveChangeKind, tier: LiveTier, now: number = performance.now()): boolean {
    const option = liveOptions().q1;
    const key = `${cell.col},${cell.row}`;
    const rank = RANK[tier];
    let pulse: Omit<Pulse, "col" | "row" | "start" | "rank"> | null = null;

    if (option === "A") {
      if (kind === "minor" || rank > 1) return false;
      pulse = { duration: 350, hold: 0, colour: 0xfff4d0, peak: 0.85, width: 4, style: "wash" };
    } else if (option === "B") {
      const colour = COLOURS.B[kind];
      if (colour === undefined) return false;
      if (rank <= 1) pulse = { duration: 750, hold: 100, colour, peak: 0.9, width: 4, style: "inner" };
      else if (rank === 2) pulse = { duration: 650, hold: 100, colour, peak: 0.8, width: 3.5, style: "inner" };
      else if (kind === "taken" || kind === "attack") {
        pulse = { duration: 400, hold: 60, colour: 0xfff1d6, peak: 0.4, width: 2.5, style: "inner" };
      }
    } else {
      const colour = COLOURS.C[kind];
      if (colour === undefined) return false;
      pulse = { duration: 800, hold: 0, colour, peak: 0.8, width: rank <= 1 ? 4 : 3, style: "ring" };
    }
    if (!pulse) return false;

    if (option === "B") {
      const last = this.lastPulse.get(key);
      if (last !== undefined && now - last < COOLDOWN_MS) return false;
    }
    const cap = option === "A" ? 8 : option === "B" ? (isPhoneLayout() ? 4 : 6) : 4;
    this.expire(now);
    if (this.pulses.length >= cap) {
      // Keep the ones that matter more: drop the least important (newest of that rank) if it ranks below.
      let worst = -1;
      for (let index = 0; index < this.pulses.length; index += 1) {
        if (worst < 0 || this.pulses[index]!.rank >= this.pulses[worst]!.rank) worst = index;
      }
      if (worst < 0 || this.pulses[worst]!.rank <= rank) return false;
      this.pulses.splice(worst, 1);
    }
    this.pulses.push({ ...pulse, col: cell.col, row: cell.row, start: now, rank });
    this.lastPulse.set(key, now);
    this.lastStep = -1;
    return true;
  }

  /** Redraws while a pulse runs; true when it drew (a tilted map then redraws its picture). */
  animate(realNow: number, zoom: number): boolean {
    const now = this.stoppedAt ?? realNow;
    if (this.frozen === null) this.expire(now);
    if (this.pulses.length === 0) {
      if (!this.drawn) return false;
      this.graphics.clear();
      this.drawn = false;
      return true;
    }
    const step = stepAt(now, 1);
    if (step === this.lastStep) return false;
    if (this.stoppedAt !== null || this.frozen !== null) this.lastStep = step;
    this.lastStep = step;

    const g = this.graphics;
    g.clear();
    const classic = classicLook();
    const phone = isPhoneLayout();
    for (const pulse of this.pulses) {
      const life = this.frozen ?? Math.min(1, (now - pulse.start) / pulse.duration);
      const holdFraction = pulse.hold / pulse.duration;
      const fade = life <= holdFraction ? 1 : 1 - easeOut((life - holdFraction) / (1 - holdFraction));
      const alpha = pulse.peak * fade;
      if (alpha <= 0.01) continue;
      const corners = liftCorners(mapRoomGrid.writeCellCorners(pulse.col, pulse.row, []), this.liftAt(pulse.col, pulse.row));
      const width = (pulse.width + (phone ? 0.5 : 0)) / zoom;
      if (pulse.style === "wash") {
        g.poly(corners);
        g.fill({ color: pulse.colour, alpha: alpha * 0.55 });
        g.poly(corners);
        g.stroke({ width: (classic ? 3 : 4) / zoom, color: 0xffd35a, alpha });
      } else if (pulse.style === "inner") {
        const inner = scaleAbout(corners, 0.9);
        if (!classic) {
          // Modern: a soft glow under a bright line.
          g.poly(inner);
          g.fill({ color: pulse.colour, alpha: alpha * 0.18 });
          g.poly(inner);
          g.stroke({ width: width * 3.2, color: pulse.colour, alpha: alpha * 0.4 });
        }
        g.poly(inner);
        g.stroke({ width: classic ? (2.5 + (phone ? 0.5 : 0)) / zoom : width, color: pulse.colour, alpha });
      } else {
        const grow = 1 + 0.18 * easeOut(life);
        const ring = scaleAbout(corners, grow);
        if (!classic) {
          g.poly(ring);
          g.stroke({ width: width * 2.5, color: pulse.colour, alpha: alpha * 0.3 });
        }
        g.poly(ring);
        g.stroke({ width, color: pulse.colour, alpha });
      }
    }
    this.drawn = true;
    return true;
  }

  private expire(now: number): void {
    if (this.frozen !== null) return;
    this.pulses = this.pulses.filter((pulse) => now - pulse.start < pulse.duration);
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
