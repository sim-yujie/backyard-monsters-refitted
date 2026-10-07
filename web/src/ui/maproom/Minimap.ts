import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import type { OffsetCell } from "@/game/HexGrid";
import { RELATION_ALLIANCE_COLOUR, RELATION_ATTACKER_COLOUR } from "@/game/maproom/cellVisuals";
import type { CellRange } from "@/game/maproom/zones";
import type { SightSource } from "@/api/types";

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

/** Cells the keyboard marker moves per arrow press, and with Shift held. */
const KEY_STEP = 10;
const KEY_STEP_BIG = 50;

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

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
  /** The viewer's fog of war sight (#331), painted as filled circles instead of the old "loaded zones" shading. */
  private sources: readonly SightSource[] = [];
  /** The player's own outposts (#331): a dot each, like home's but smaller. */
  private outposts: readonly OffsetCell[] = [];
  /** Revealed attacker bases (#331): the player's own bases and outposts are never in this list (the scene already subtracts them). */
  private attackers: readonly OffsetCell[] = [];
  /**
   * The keyboard's marker (issue #153): where Enter or Space jumps to. It
   * starts on the viewport's centre each time the map takes focus, and the
   * arrow keys move it.
   */
  private cursor: OffsetCell | null = null;
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
    this.element.setAttribute("aria-label", LABEL);

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

    this.element.addEventListener("focus", () => {
      this.cursor = this.viewportCentre();
      this.dirty = true;
      this.draw();
    });
    this.element.addEventListener("blur", () => {
      this.cursor = null;
      this.element.setAttribute("aria-label", LABEL);
      this.dirty = true;
      this.draw();
    });
    this.element.addEventListener("keydown", (event) => {
      const arrow = ARROWS[event.key];
      if (arrow) {
        event.preventDefault();
        this.moveCursor(arrow[0], arrow[1], event.shiftKey ? KEY_STEP_BIG : KEY_STEP);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      options.onJump(this.cursor ?? this.viewportCentre());
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

  /** The viewer's fog of war sight (#331): own and alliance circles, two tints. */
  setSight(sources: readonly SightSource[]): void {
    this.sources = sources;
    this.dirty = true;
  }

  /** The player's own outposts (#331), each a small dot beside home's. */
  setOutposts(outposts: readonly OffsetCell[]): void {
    this.outposts = outposts;
    this.dirty = true;
  }

  /** Revealed attacker bases (#331): own bases and outposts already excluded by the caller. */
  setAttackers(cells: readonly OffsetCell[]): void {
    this.attackers = cells;
    this.dirty = true;
  }

  /** Repaints if anything changed. Cheap enough to call every frame. */
  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const palette = this.palette();
    const context = this.context;

    context.clearRect(0, 0, SIZE, SIZE);
    context.fillStyle = palette.ground;
    context.fillRect(0, 0, SIZE, SIZE);

    // The viewer's fog of war sight (#331), instead of the old "loaded
    // zones" shading: own and alliance circles in two tints, so it is
    // obvious which parts of the world are visible and whose sight it is.
    context.globalAlpha = 0.35;
    for (const source of this.sources) {
      this.circle(source, source.kind === "own" ? palette.accent : palette.ally);
    }
    context.globalAlpha = 1;

    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);

    if (this.home) this.dot(this.home, palette.accent, 3);
    for (const outpost of this.outposts) this.dot(outpost, palette.accent, 2);
    for (const cell of this.attackers) this.dot(cell, palette.attacker, 2.5);
    if (this.selected) this.dot(this.selected, palette.text, 2.5);
    if (this.cursor) this.marker(this.cursor, palette.accent);

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

  /** The keyboard marker: a ring with a cross, so it reads apart from the dots. */
  private marker(cell: OffsetCell, colour: string): void {
    const x = cell.col * this.scale;
    const y = cell.row * this.scale;
    const context = this.context;
    context.strokeStyle = colour;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(x, y, 6, 0, Math.PI * 2);
    context.moveTo(x - 9, y);
    context.lineTo(x + 9, y);
    context.moveTo(x, y - 9);
    context.lineTo(x, y + 9);
    context.stroke();
  }

  private moveCursor(dx: number, dy: number, step: number): void {
    const from = this.cursor ?? this.viewportCentre();
    this.cursor = {
      col: clampInt(from.col + dx * step, WORLD_WIDTH),
      row: clampInt(from.row + dy * step, WORLD_HEIGHT),
    };
    this.element.setAttribute("aria-label", `${LABEL} Marker at ${this.cursor.col}, ${this.cursor.row}.`);
    this.dirty = true;
    this.draw();
  }

  /** The middle of the viewport's rectangle, or the world's before there is one. */
  private viewportCentre(): OffsetCell {
    const view = this.viewport;
    if (!view) return { col: Math.floor(WORLD_WIDTH / 2), row: Math.floor(WORLD_HEIGHT / 2) };
    return {
      col: Math.floor((view.minCol + view.maxCol) / 2),
      row: Math.floor((view.minRow + view.maxRow) / 2),
    };
  }

  private dot(cell: OffsetCell, colour: string, radius: number): void {
    this.context.beginPath();
    this.context.arc(cell.col * this.scale, cell.row * this.scale, radius, 0, Math.PI * 2);
    this.context.fillStyle = colour;
    this.context.fill();
  }

  /** One sight circle (#331): cell-space treated as square, same simplification the old "loaded zones" patches used. */
  private circle(source: SightSource, colour: string): void {
    this.context.beginPath();
    this.context.arc(
      source.x * this.scale,
      source.y * this.scale,
      Math.max(source.reach * this.scale, 1),
      0,
      Math.PI * 2,
    );
    this.context.fillStyle = colour;
    this.context.fill();
  }

  /** Current token values, so a theme switch is picked up on the next repaint. */
  private palette(): {
    ground: string;
    border: string;
    accent: string;
    text: string;
    /** An alliance-mate's sight circle, `cellVisuals.ts`'s `RELATION_ALLIANCE_COLOUR` (#331) — not a theme token, like every other relation colour the map draws. */
    ally: string;
    /** A revealed attacker's dot, `RELATION_ATTACKER_COLOUR` (#331). */
    attacker: string;
  } {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;

    return {
      // The opaque ground: the card and tray surfaces are see-through washes.
      ground: token("--colour-surface-base", "#0f141c"),
      border: token("--colour-border", "rgb(255 255 255 / 9%)"),
      accent: token("--colour-accent", "#3dd6f5"),
      text: token("--colour-text", "#edf1f5"),
      ally: cssColour(RELATION_ALLIANCE_COLOUR),
      attacker: cssColour(RELATION_ATTACKER_COLOUR),
    };
  }
}

/** A Pixi-style numeric colour as a CSS hex string, the same conversion `CellPanel.ts`/`HoverCard.ts` use. */
const cssColour = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;

const LABEL =
  "World map. Click to jump to a place, or move the marker with the arrow keys (Shift for bigger steps) and press Enter.";

const clampInt = (value: number, size: number): number =>
  Math.min(Math.max(Math.floor(value), 0), size - 1);
