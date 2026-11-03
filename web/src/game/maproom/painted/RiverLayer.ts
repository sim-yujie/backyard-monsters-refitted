import { Container, Graphics } from "pixi.js";
import { mapRoomGrid } from "@/game/HexGrid";
import { quality, type Quality } from "@/game/quality";
import type { CellRange } from "../zones";
import { ribbonOutline, riverPaths, type RiverCells, type RiverPath } from "./riverPaths";

/**
 * Map Room 2 rivers, drawn (look plan step 7): a winding water ribbon along
 * the cell edges with soft banks, from `riverPaths.ts`'s shapes. Its own
 * layer over the ground and under the cells' markers, so it sits the same on
 * today's tiles and, later, on the painted ground.
 *
 * Look only. Nothing is drawn unless the server sent rivers (`rv`, switch
 * `MR2_RIVERS`) and the renderer shows the layer (Modern only; Classic is
 * always Flash's map).
 *
 * Quality (`quality.ts`):
 * - High: grassy bank shadow, pebble-and-mud bank, shallow edge water, deeper
 *   middle, broken glints on the water.
 * - Medium: mud bank, shallow edge water, deeper middle.
 * - Low: the water alone, one colour.
 *
 * Built for the cells on screen plus a margin, again only when the view
 * leaves that, a zone arrives, or the quality changes; panning costs nothing.
 */

/** Cells built past each side of the view, so a short pan does not rebuild. */
const MARGIN = 6;

/** Bank widths past the water each side, as shares of the cell width. */
const GRASS_BANK_SHARE = 0.05;
const MUD_BANK_SHARE = 0.022;

const COLOURS = {
  grassBank: 0x4f7a2c,
  mudBank: 0xa89464,
  shallow: 0x62b6dc,
  deep: 0x2f82c8,
  glint: 0xe8f7ff,
} as const;

/** The deeper middle's share of the water's width. */
const DEEP_SHARE = 0.58;

export class RiverLayer {
  readonly container = new Container();

  private readonly grassBank = new Graphics();
  private readonly mudBank = new Graphics();
  private readonly shallow = new Graphics();
  private readonly deep = new Graphics();
  private readonly glints = new Graphics();

  private built: CellRange | null = null;
  private builtQuality: Quality | null = null;
  private stale = true;

  constructor() {
    this.container.interactiveChildren = false;
    this.container.addChild(this.grassBank, this.mudBank, this.shallow, this.deep, this.glints);
  }

  /** A zone arrived (new rivers or heights): rebuilt on the next `update`. */
  invalidate(): void {
    this.stale = true;
  }

  /**
   * Shows the rivers round `range`, or hides the layer. Returns whether it
   * rebuilt, so the renderer can count it as work.
   */
  update(range: CellRange, shown: boolean, cells: RiverCells): boolean {
    this.container.visible = shown;
    if (!shown) return false;
    const level = quality();
    const built = this.built;
    if (
      !this.stale &&
      level === this.builtQuality &&
      built &&
      range.minCol >= built.minCol &&
      range.maxCol <= built.maxCol &&
      range.minRow >= built.minRow &&
      range.maxRow <= built.maxRow
    ) {
      return false;
    }
    const around: CellRange = {
      minCol: range.minCol - MARGIN,
      maxCol: range.maxCol + MARGIN,
      minRow: range.minRow - MARGIN,
      maxRow: range.maxRow + MARGIN,
    };
    this.draw(riverPaths(around, cells), level);
    this.built = around;
    this.builtQuality = level;
    this.stale = false;
    return true;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private draw(paths: RiverPath[], level: Quality): void {
    for (const graphics of [this.grassBank, this.mudBank, this.shallow, this.deep, this.glints]) graphics.clear();
    const cellWidth = mapRoomGrid.cellWidth;
    const grass = GRASS_BANK_SHARE * cellWidth;
    const mud = MUD_BANK_SHARE * cellWidth;

    // Every path's bank first, then every path's water, so where two rivers
    // meet the water joins over both banks.
    if (level === "high") this.fillAll(this.grassBank, paths, grass, 1, COLOURS.grassBank);
    if (level !== "low") this.fillAll(this.mudBank, paths, mud, 1, COLOURS.mudBank);
    this.fillAll(this.shallow, paths, 0, 1, level === "low" ? COLOURS.deep : COLOURS.shallow);
    if (level !== "low") this.fillAll(this.deep, paths, 0, DEEP_SHARE, COLOURS.deep);
    if (level === "high") this.drawGlints(paths);
    // The grass bank is a soft shade, not a stripe.
    this.grassBank.alpha = 0.45;
  }

  /** Each path's outline, `extra` wider each side, plus round caps at its ends so joins close. */
  private fillAll(graphics: Graphics, paths: RiverPath[], extra: number, scale: number, colour: number): void {
    for (const path of paths) {
      graphics.poly(ribbonOutline(path.points, extra, scale)).fill({ color: colour });
      for (const end of [path.points[0]!, path.points[path.points.length - 1]!]) {
        graphics.circle(end.x, end.y, end.half * scale + extra).fill({ color: colour });
      }
    }
  }

  /** Short light streaks off the middle of the water, broken at a steady rhythm. */
  private drawGlints(paths: RiverPath[]): void {
    const width = Math.max(1, mapRoomGrid.cellWidth * 0.009);
    for (const path of paths) {
      const points = path.points;
      for (let i = 2; i + 3 < points.length; i += 7) {
        const a = points[i]!;
        const b = points[i + 3]!;
        // A third of the way to one bank, alternating sides.
        const side = (i / 7) % 2 < 1 ? 0.3 : -0.3;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const nx = (-dy / length) * a.half * side;
        const ny = (dx / length) * a.half * side;
        this.glints.moveTo(a.x + nx, a.y + ny).lineTo(b.x + nx, b.y + ny);
      }
    }
    this.glints.stroke({ color: COLOURS.glint, width, alpha: 0.55, cap: "round" });
  }
}
