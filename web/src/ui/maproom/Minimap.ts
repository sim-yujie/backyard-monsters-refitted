import { AREA_ZONE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import type { OffsetCell } from "@/game/HexGrid";
import type { ZoneRecord } from "@/game/maproom/ZoneStore";
import type { CellRange } from "@/game/maproom/zones";

/**
 * A world-scale locator.
 *
 * Drawn in *cell* space rather than world-pixel space, so the canvas is square
 * even though the hex grid is 1.5 times wider than it is tall. That makes the
 * viewport rectangle an actual rectangle and a click an exact cell, which is
 * the whole job: show where you are in 800 x 800 and let you go somewhere else.
 *
 * Colours are read from the CSS custom properties rather than hardcoded, so the
 * light theme works without a second palette here.
 */

const SIZE = 176;

export interface MinimapOptions {
  /** Called with the cell the player clicked. */
  onJump: (cell: OffsetCell) => void;
}

export class Minimap {
  readonly element: HTMLCanvasElement;

  private readonly context: CanvasRenderingContext2D;
  private readonly scale = SIZE / WORLD_WIDTH;

  private home: OffsetCell | null = null;
  private selected: OffsetCell | null = null;
  private viewport: CellRange | null = null;
  private zones: Iterable<ZoneRecord> = [];
  private dirty = true;

  constructor(options: MinimapOptions) {
    this.element = document.createElement("canvas");
    this.element.className = "minimap";
    this.element.width = SIZE;
    this.element.height = SIZE;
    this.element.style.width = `${SIZE}px`;
    this.element.style.height = `${SIZE}px`;
    this.element.tabIndex = 0;
    this.element.title = "Click to jump";
    this.element.setAttribute("role", "button");
    this.element.setAttribute("aria-label", "World map. Click to jump to a location.");

    const context = this.element.getContext("2d");
    if (!context) throw new Error("Could not get a 2D context for the minimap");
    this.context = context;

    this.element.addEventListener("pointerdown", (event) => {
      const rect = this.element.getBoundingClientRect();
      const cell = {
        col: clampInt((event.clientX - rect.left) / this.scale, WORLD_WIDTH),
        row: clampInt((event.clientY - rect.top) / this.scale, WORLD_HEIGHT),
      };
      options.onJump(cell);
    });
  }

  setHome(cell: OffsetCell | null): void {
    this.home = cell;
    this.dirty = true;
  }

  setSelected(cell: OffsetCell | null): void {
    this.selected = cell;
    this.dirty = true;
  }

  setViewport(range: CellRange): void {
    this.viewport = range;
    this.dirty = true;
  }

  setZones(zones: Iterable<ZoneRecord>): void {
    this.zones = zones;
    this.dirty = true;
  }

  /** Repaints if anything changed. Cheap enough to call every frame. */
  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const palette = this.palette();
    const context = this.context;

    context.clearRect(0, 0, SIZE, SIZE);
    context.fillStyle = palette.sunken;
    context.fillRect(0, 0, SIZE, SIZE);

    // Loaded coverage, so it is obvious which parts of the world are known.
    const zoneSize = Math.max(AREA_ZONE_SIZE * this.scale, 1);
    context.fillStyle = palette.loaded;
    for (const zone of this.zones) {
      context.fillRect(
        zone.originX * this.scale,
        zone.originY * this.scale,
        zoneSize,
        zoneSize,
      );
    }

    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);

    if (this.home) this.dot(this.home, palette.accent, 3);
    if (this.selected) this.dot(this.selected, palette.text, 2.5);

    if (this.viewport) {
      const left = this.viewport.minCol * this.scale;
      const top = this.viewport.minRow * this.scale;
      const width = Math.max((this.viewport.maxCol - this.viewport.minCol + 1) * this.scale, 3);
      const height = Math.max((this.viewport.maxRow - this.viewport.minRow + 1) * this.scale, 3);

      context.strokeStyle = palette.text;
      context.lineWidth = 1.5;
      context.strokeRect(left, top, width, height);
    }
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  destroy(): void {
    this.element.remove();
  }

  private dot(cell: OffsetCell, colour: string, radius: number): void {
    this.context.beginPath();
    this.context.arc(cell.col * this.scale, cell.row * this.scale, radius, 0, Math.PI * 2);
    this.context.fillStyle = colour;
    this.context.fill();
  }

  /** Current token values, so a theme switch is picked up on the next repaint. */
  private palette(): {
    sunken: string;
    border: string;
    accent: string;
    text: string;
    loaded: string;
  } {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;

    return {
      sunken: token("--colour-surface-sunken", "#11141a"),
      border: token("--colour-border", "#3a4256"),
      accent: token("--colour-accent", "#f0a12e"),
      text: token("--colour-text", "#eef1f7"),
      // The strong border token rather than a surface one: against the sunken
      // background the surface tokens are only a few levels lighter and the
      // coverage patch was invisible at 2 px per zone.
      loaded: token("--colour-border-strong", "#4d5875"),
    };
  }
}

const clampInt = (value: number, size: number): number =>
  Math.min(Math.max(Math.floor(value), 0), size - 1);
