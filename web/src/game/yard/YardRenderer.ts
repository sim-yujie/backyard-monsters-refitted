import { Container, Graphics, Sprite, type Renderer } from "pixi.js";
import { YardBuildings } from "./YardBuildings";
import { YardGround } from "./YardGround";
import { yardArtAtlas, type YardArtAtlas } from "./yardAtlas";
import type { Rect } from "./YardGrid";
import type { Yard, YardBuilding } from "./yardModel";

/**
 * The yard's scene graph: ground, mushrooms, buildings and the selection
 * chrome, stacked in that order.
 *
 * This is composition and layer order only. The buildings — far and away the
 * expensive part — are `YardBuildings`, the tiled ground is `YardGround`, and
 * the glyphs everything else is drawn from are `yardAtlas`. What is left here
 * is which container sits above which, and the hover and selection outlines,
 * which belong to neither.
 *
 * The chrome is one `Graphics` redrawn only when the selection changes, rather
 * than a sprite per building, because at most two outlines exist at a time.
 */

export class YardRenderer {
  readonly root = new Container();

  private readonly ground = new YardGround();
  private readonly buildings = new YardBuildings();
  private readonly mushroomLayer = new Container();
  private readonly chrome = new Graphics();

  private atlas: YardArtAtlas | null = null;

  private hovered: YardBuilding | null = null;
  private selected: YardBuilding | null = null;
  private chromeDirty = true;

  constructor() {
    this.mushroomLayer.eventMode = "none";
    this.root.addChild(
      this.ground.root,
      this.buildings.shadows,
      this.mushroomLayer,
      this.buildings.tops,
      this.chrome,
      this.buildings.markers,
      this.buildings.labels,
    );
  }

  /** Bakes the vector glyphs. Call once, before the first `show`. */
  attach(renderer: Renderer): void {
    this.atlas ??= yardArtAtlas(renderer);
  }

  /** Buildings still waiting on, or missing, their picture. */
  get placeholderCount(): number {
    return this.buildings.placeholderCount;
  }

  /** Replaces what is on screen with a yard. */
  show(yard: Yard): void {
    const atlas = this.atlas;
    if (!atlas) return;

    this.clearMushrooms();
    this.setHovered(null);
    this.setSelected(null);

    // The base seed keeps one yard's grass the same between visits.
    this.ground.layout(yard.bounds, yard.savedAt || 1);
    void this.ground.loadTiles();

    this.buildings.show(yard, atlas);

    for (const mushroom of yard.mushrooms) {
      const sprite = new Sprite(mushroom.golden ? atlas.mushroomGolden : atlas.mushroom);
      sprite.anchor.set(0.5, 0.85);
      sprite.position.set(mushroom.worldX, mushroom.worldY);
      this.mushroomLayer.addChild(sprite);
    }
  }

  /** Advances one frame: `visible` is the world rectangle on screen. */
  draw(visible: Rect): void {
    this.buildings.draw(visible);

    if (this.chromeDirty) {
      this.chromeDirty = false;
      this.drawChrome();
    }
  }

  setHovered(building: YardBuilding | null): void {
    if (this.hovered?.id === building?.id) return;
    this.hovered = building;
    this.chromeDirty = true;
  }

  setSelected(building: YardBuilding | null): void {
    if (this.selected?.id === building?.id) return;
    this.selected = building;
    this.chromeDirty = true;
  }

  /** The building under a world point, or null. */
  pick(worldX: number, worldY: number): YardBuilding | null {
    return this.buildings.pick(worldX, worldY);
  }

  destroy(): void {
    this.clearMushrooms();
    this.buildings.destroy();
    this.atlas?.destroy();
    this.atlas = null;
    this.ground.destroy();
    this.root.destroy({ children: true });
  }

  private drawChrome(): void {
    this.chrome.clear();

    // The hover outline is suppressed on the selected building, so the two do
    // not stack into a brighter, heavier shape than either on its own.
    if (this.hovered && this.hovered.id !== this.selected?.id) {
      this.chrome
        .poly(diamondPath(this.hovered))
        .fill({ color: 0xffffff, alpha: 0.12 })
        .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
    }

    if (this.selected) {
      this.chrome
        .poly(diamondPath(this.selected))
        .fill({ color: 0x7ec8ff, alpha: 0.16 })
        .stroke({ width: 3, color: 0x7ec8ff, alpha: 0.95 });
    }
  }

  private clearMushrooms(): void {
    for (const child of this.mushroomLayer.removeChildren()) child.destroy();
  }
}

/**
 * The footprint diamond as a flat point list, for `Graphics.poly`.
 *
 * The origin is the diamond's top corner; `+width` goes down-right and
 * `+height` down-left, each half as far vertically as horizontally.
 */
const diamondPath = (building: YardBuilding): number[] => {
  const [width, height] = building.footprint;
  const { worldX: x, worldY: y } = building;
  return [
    x,
    y,
    x + width,
    y + width / 2,
    x + width - height,
    y + (width + height) / 2,
    x - height,
    y + height / 2,
  ];
};
