import { Container, Sprite, Texture } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";

/**
 * A health bar over every damaged enemy building (issue #64).
 *
 * The Flash client's `BuildingOverlay` drew a 51 x 6 bar at (-26, -14) from
 * the building's origin — the footprint's top corner — and showed it only while
 * `0 < health < maxHealth` (`com/monsters/display/BuildingOverlay.as:79-92`,
 * `:186-203`). The strip it blitted from ran twenty rows from green to red;
 * this tints one white sprite the same way rather than fetch the strip.
 *
 * The bars are a readout, not a thing in the yard, so they sit in the battle
 * overlay above every building. Each is two sprites, made on the first frame a
 * building is hurt and hidden again at zero health. The engine's health map
 * only lists buildings below full health, so a yard with nothing damaged
 * costs nothing here.
 */

export const BAR_WIDTH = 51;
export const BAR_HEIGHT = 6;
/** From the building's origin (`BuildingOverlay.as:86-88`). */
export const BAR_OFFSET: Point = { x: -26, y: -14 };

const BACK_COLOUR = 0x1a0d0d;
const INSET = 1;

/**
 * Green at full, through amber, to red near empty: the strip's twenty rows
 * as a blend, so a bar at 0.5 is the colour the middle row was.
 */
export const barColour = (fraction: number): number => {
  const clamped = Math.max(0, Math.min(1, fraction));
  const red = Math.round(clamped < 0.5 ? 0xe8 : 0xe8 * (1 - (clamped - 0.5) * 2) + 0x4c * (clamped - 0.5) * 2);
  const green = Math.round(clamped < 0.5 ? 0x28 + (0xd6 - 0x28) * clamped * 2 : 0xd6);
  const blue = 0x2c;
  return (red << 16) | (green << 8) | blue;
};

/** Whether a bar shows for a health fraction: strictly between empty and full. */
export const barVisible = (fraction: number): boolean =>
  Number.isFinite(fraction) && fraction > 0 && fraction < 1;

interface Bar {
  readonly back: Sprite;
  readonly front: Sprite;
}

export class BuildingBars {
  /** Add to the battle overlay; every bar is a child. */
  readonly root = new Container();
  private readonly bars = new Map<number, Bar>();

  /**
   * `anchorOf` is a building's origin in world px, or null for one that must
   * not be drawn — a trap still concealed, an id the yard does not know.
   * `maxHpOf` is its full health, or undefined for a type with no ladder.
   */
  constructor(
    private readonly anchorOf: (id: number) => Point | null,
    private readonly maxHpOf: (id: number) => number | undefined,
  ) {
    this.root.eventMode = "none";
  }

  /** How many bars are showing. */
  get visibleCount(): number {
    let count = 0;
    for (const bar of this.bars.values()) if (bar.back.visible) count += 1;
    return count;
  }

  /**
   * Matches the bars to the engine's health map: `id -> health` for every
   * building below full, fired traps at 0.
   */
  sync(health: Readonly<Record<string, number>>): void {
    for (const bar of this.bars.values()) {
      bar.back.visible = false;
      bar.front.visible = false;
    }
    for (const [key, hp] of Object.entries(health)) {
      const id = Number(key);
      const maxHp = this.maxHpOf(id);
      if (maxHp === undefined || maxHp <= 0) continue;
      const fraction = hp / maxHp;
      if (!barVisible(fraction)) continue;
      const anchor = this.anchorOf(id);
      if (!anchor) continue;
      this.show(id, anchor, fraction);
    }
  }

  destroy(): void {
    for (const bar of this.bars.values()) {
      bar.back.destroy();
      bar.front.destroy();
    }
    this.bars.clear();
    this.root.destroy({ children: true });
  }

  private show(id: number, anchor: Point, fraction: number): void {
    let bar = this.bars.get(id);
    if (!bar) {
      const back = new Sprite(Texture.WHITE);
      back.tint = BACK_COLOUR;
      back.alpha = 0.85;
      back.width = BAR_WIDTH;
      back.height = BAR_HEIGHT;
      const front = new Sprite(Texture.WHITE);
      front.height = BAR_HEIGHT - INSET * 2;
      this.root.addChild(back, front);
      bar = { back, front };
      this.bars.set(id, bar);
    }
    const x = anchor.x + BAR_OFFSET.x;
    const y = anchor.y + BAR_OFFSET.y;
    bar.back.position.set(x, y);
    bar.front.position.set(x + INSET, y + INSET);
    bar.front.width = Math.max(1, (BAR_WIDTH - INSET * 2) * fraction);
    bar.front.tint = barColour(fraction);
    bar.back.visible = true;
    bar.front.visible = true;
  }
}
