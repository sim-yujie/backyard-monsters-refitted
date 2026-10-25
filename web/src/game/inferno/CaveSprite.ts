import { Assets, Container, Sprite, type Texture } from "pixi.js";
import { ArtState, resolveArt, type ResolvedImage } from "@/game/yard/buildingArt";
import { depthKey, yardToWorld, type YardBounds } from "@/game/yard/YardGrid";
import { CAVE_FOOTPRINT, CAVE_SPOT, CAVE_TYPE } from "./cave";

/**
 * Moloch's cave drawn on the main yard (WP 1.10), in Flash's own art
 * (`server/public/assets/buildings/iportal/`, the type 127 row of
 * `buildingArtData.ts`): it is no building of the save (Flash never exported
 * it, `INFERNOPORTAL.Export`), so it stands among the buildings as a guest
 * (`YardRenderer.standAmongBuildings`) rather than in the draw list.
 *
 * Level 0 is hidden, as Flash hides it until Moloch's first words
 * (`INFERNO_EMERGENCE_EVENT.SetupPortal`).
 */
export class CaveSprite {
  readonly view = new Container();
  private readonly shadow = new Sprite();
  private readonly top = new Sprite();
  private level = 0;
  private bounds: YardBounds | null = null;
  private destroyed = false;

  constructor() {
    this.view.eventMode = "none";
    this.view.visible = false;
    this.shadow.blendMode = "multiply";
    this.view.addChild(this.shadow, this.top);
  }

  /** Puts the cave on the yard's grass: its fixed spot in this yard's world. */
  place(bounds: YardBounds): void {
    if (bounds === this.bounds) return;
    this.bounds = bounds;
    const origin = yardToWorld(bounds, CAVE_SPOT.x, CAVE_SPOT.y);
    this.view.position.set(origin.x, origin.y);
    const centre = yardToWorld(
      bounds,
      CAVE_SPOT.x + CAVE_FOOTPRINT.width / 2,
      CAVE_SPOT.y + CAVE_FOOTPRINT.height / 2,
    );
    // The buildings' own key (`YardBuildings.resortByDepth`); far behind them all.
    this.view.zIndex = depthKey(centre.x, centre.y, 0) * 8;
  }

  /** Shows the cave at a level, 1-5; 0 hides it. */
  setLevel(level: number): void {
    this.level = level;
    if (level <= 0) {
      this.view.visible = false;
      return;
    }
    const art = resolveArt(CAVE_TYPE, level, ArtState.DEFAULT);
    if (!art) return;
    void this.paint(this.top, art.top, level);
    if (art.shadow) void this.paint(this.shadow, art.shadow, level);
    else this.shadow.visible = false;
  }

  /** Whether a world point is on the cave's picture. */
  contains(worldX: number, worldY: number): boolean {
    if (!this.view.visible || !this.top.texture || this.top.width <= 1) return false;
    const x = worldX - this.view.x - this.top.x;
    const y = worldY - this.view.y - this.top.y;
    return x >= 0 && y >= 0 && x <= this.top.width && y <= this.top.height;
  }

  destroy(): void {
    this.destroyed = true;
    this.view.destroy({ children: true });
  }

  private async paint(sprite: Sprite, image: ResolvedImage, level: number): Promise<void> {
    let texture: Texture;
    try {
      texture = await Assets.load<Texture>(image.url);
    } catch (error) {
      console.error("The Inferno cave's art did not load:", image.url, error);
      return;
    }
    // A later level or a teardown got here first.
    if (this.destroyed || level !== this.level) return;
    sprite.texture = texture;
    sprite.position.set(image.x, image.y);
    sprite.visible = true;
    this.view.visible = true;
  }
}
