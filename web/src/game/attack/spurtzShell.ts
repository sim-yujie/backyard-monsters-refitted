import { Assets, Rectangle, Sprite, Texture, type Container } from "pixi.js";

/**
 * The Spurtz Cannon's shell sheet (issue #313, `SPRITES.as:90`): 32 headings
 * across, one 34 x 27 px cell each, five rows of which Flash shows two.
 */
export const SHELL_SHEET_URL = "/assets/buildings/ispurtz_cannon/spurtz_projectile.png";
const CELL_WIDTH = 34;
const CELL_HEIGHT = 27;
const HEADINGS = 32;

/**
 * The cell a shell heading `degrees` (screen, `atan2` of where it flies) shows
 * on its `frame`th tick of flight: Flash truncates the angle to whole degrees,
 * turns a negative one positive (`SPRITES.as:127-129`), takes one of 32
 * headings and swaps between rows 1 and 2 every 8 frames (`:361-365`).
 */
export const shellCell = (degrees: number, frame: number): { column: number; row: number } => {
  // `|| 0`: a heading just under 0 truncates to -0, which is 0.
  let angle = Math.trunc(degrees) || 0;
  if (angle < 0) angle += 360;
  return {
    column: Math.min(HEADINGS - 1, Math.trunc(angle / 11.25)),
    row: Math.trunc(((frame / 8) % 2) + 1),
  };
};

/**
 * The shells in flight, each a sprite off the sheet, centred on its point
 * (`FIREBALL.as:83-86`) and drawn at its shot's scale (`SpurtzCannon.as:204-208`).
 * A shell is keyed by any object that stays the same while it flies.
 */
export class ShellSprites {
  private sheet: Texture | null = null;
  private asked = false;
  private readonly cells = new Map<string, Texture>();
  private readonly sprites = new Map<object, Sprite>();
  private readonly drawn = new Set<object>();

  constructor(
    private readonly layer: () => Container,
    private readonly load: (url: string) => Promise<Texture> = (url) => Assets.load<Texture>(url),
  ) {}

  /** Starts the sheet's fetch, so the first shell is drawn from it. */
  preload(): void {
    if (this.asked) return;
    this.asked = true;
    this.load(SHELL_SHEET_URL)
      .then((texture) => {
        this.sheet = texture;
      })
      .catch((caught: unknown) => {
        // Asked once: the caller keeps drawing its plain shell.
        console.warn("Spurtz shell sheet did not load.", caught);
      });
  }

  /**
   * Draws shell `key` at `x`, `y` (the layer's px). False while the sheet is
   * not in, so the caller draws something else this frame.
   */
  draw(key: object, x: number, y: number, degrees: number, frame: number, scale: number): boolean {
    this.preload();
    const texture = this.cell(shellCell(degrees, frame));
    if (!texture) return false;
    let sprite = this.sprites.get(key);
    if (!sprite) {
      sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.eventMode = "none";
      this.layer().addChild(sprite);
      this.sprites.set(key, sprite);
    }
    sprite.texture = texture;
    sprite.position.set(x, y);
    sprite.scale.set(scale);
    this.drawn.add(key);
    return true;
  }

  /** Takes away every shell not drawn since the last sweep. */
  sweep(): void {
    for (const [key, sprite] of this.sprites) {
      if (this.drawn.has(key)) continue;
      sprite.destroy();
      this.sprites.delete(key);
    }
    this.drawn.clear();
  }

  destroy(): void {
    this.drawn.clear();
    this.sweep();
    for (const texture of this.cells.values()) texture.destroy(false);
    this.cells.clear();
  }

  private cell({ column, row }: { column: number; row: number }): Texture | null {
    const sheet = this.sheet;
    if (!sheet) return null;
    const id = `${column}:${row}`;
    let texture = this.cells.get(id);
    if (!texture) {
      texture = new Texture({
        source: sheet.source,
        frame: new Rectangle(column * CELL_WIDTH, row * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT),
      });
      this.cells.set(id, texture);
    }
    return texture;
  }
}
