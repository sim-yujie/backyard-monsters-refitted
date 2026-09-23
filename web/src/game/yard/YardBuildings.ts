import { Container, Sprite, Text, Texture } from "pixi.js";
import type { ResolvedArt, ResolvedImage } from "./buildingArt";
import { YardTextures } from "./YardTextures";
import type { YardArtAtlas } from "./yardAtlas";
import type { Rect } from "./YardGrid";
import { artFor, BuildingCondition, type Yard, type YardBuilding } from "./yardModel";

/**
 * The building sprites: one per building, built once and never rebuilt.
 *
 * A read-only yard never changes shape. Every position, footprint box and depth
 * key is computed when the save is parsed (`yardModel.ts`), so this makes the
 * whole draw list at open time in depth order and from then on a frame is
 * nothing but `visible` flags. Panning costs one transform on the parent rather
 * than 575 reprojections, which is what keeps a full yard at the vsync floor.
 *
 * Shadows live in their own container beneath every building rather than
 * interleaved by depth, which is what the Flash client did —
 * `MAP.DEPTH_SHADOW` is 1, below everything (`client/scripts/MAP.as:102`) — and
 * they are drawn with a multiply blend because the files are JPEGs with no
 * alpha channel (`client/scripts/BFOUNDATION.as:1108`).
 *
 * A building whose picture has not arrived, or never will, shows a diamond the
 * size of its footprint with its name on it. The yard is therefore never full
 * of holes, and a broken asset path is visible rather than silent.
 */

/** Culling margin in world pixels: art reaches well past its footprint box. */
const CULL_MARGIN = 160;

/**
 * Upper bound on placeholder labels.
 *
 * One `Text` per building would be 575 display objects with their own textures
 * if the asset server were down. The cap keeps the failure mode cheap; the
 * unlabelled placeholders still show, and the scene reports the real count.
 */
const MAX_PLACEHOLDER_LABELS = 60;

interface BuildingView {
  readonly building: YardBuilding;
  readonly art: ResolvedArt | null;
  readonly top: Sprite;
  readonly shadow: Sprite | null;
  /** Dropped once the real picture arrives. */
  label: Text | null;
  /** True once the real picture is on the sprite. */
  resolved: boolean;
  /**
   * True once the shadow is on its sprite, or immediately for a building that
   * has none.
   *
   * Tracked apart from `resolved` because the two images are separate fetches
   * that finish in either order: a single flag would stop asking for the shadow
   * the moment the building itself arrived.
   */
  shadowResolved: boolean;
}

export class YardBuildings {
  /** Beneath every building. Add to the scene before `tops`. */
  readonly shadows = new Container();
  /** The buildings themselves, in depth order. */
  readonly tops = new Container();
  /** Placeholder names, above everything. */
  readonly labels = new Container();
  /** Badges over anything with a countdown running. */
  readonly markers = new Container();

  private readonly textures: YardTextures;
  private views: BuildingView[] = [];
  /** Set when art has arrived and the sprites need another resolution pass. */
  private pending = true;

  constructor() {
    this.textures = new YardTextures(() => {
      this.pending = true;
    });
    for (const layer of [this.shadows, this.tops, this.markers]) layer.eventMode = "none";
  }

  /** Buildings still showing a placeholder. */
  get placeholderCount(): number {
    return this.views.reduce((count, view) => count + (view.resolved ? 0 : 1), 0);
  }

  /** Builds the sprites for a yard, replacing whatever was there. */
  show(yard: Yard, atlas: YardArtAtlas): void {
    this.clear();

    let labels = 0;

    for (const building of yard.buildings) {
      const art = artFor(building);

      const top = new Sprite(atlas.placeholder);
      fillBox(top, building.box);
      top.tint = placeholderTint(building);
      top.alpha = 0.55;
      this.tops.addChild(top);

      let shadow: Sprite | null = null;
      if (art?.shadow) {
        shadow = new Sprite(Texture.EMPTY);
        shadow.blendMode = "multiply";
        shadow.visible = false;
        this.shadows.addChild(shadow);
      }

      let label: Text | null = null;
      if (labels < MAX_PLACEHOLDER_LABELS) {
        labels++;
        label = new Text({
          text: building.name,
          style: { fontFamily: "Nunito, sans-serif", fontSize: 16, fill: 0xe8eef5 },
        });
        label.anchor.set(0.5);
        label.position.set(building.centreX, building.centreY);
        this.labels.addChild(label);
      }

      this.views.push({
        building,
        art,
        top,
        shadow,
        label,
        resolved: false,
        shadowResolved: shadow === null,
      });

      if (building.countdown) this.addCountdownMarker(building, atlas);
    }

    this.pending = true;
  }

  /**
   * Applies newly arrived art, then hides everything outside `visible`.
   *
   * The sprites stay in the scene graph either way: culling is a flag, so
   * nothing is created or destroyed while panning.
   */
  draw(visible: Rect): void {
    if (this.pending) {
      this.pending = false;
      this.resolveTextures();
    }

    const left = visible.x - CULL_MARGIN;
    const top = visible.y - CULL_MARGIN;
    const right = visible.x + visible.width + CULL_MARGIN;
    const bottom = visible.y + visible.height + CULL_MARGIN;

    for (const view of this.views) {
      const box = view.building.box;
      const on =
        box.x <= right && box.x + box.width >= left && box.y <= bottom && box.y + box.height >= top;
      view.top.visible = on;
      if (view.shadow) view.shadow.visible = on && view.shadowResolved;
      if (view.label) view.label.visible = on;
    }
  }

  /**
   * The building under a world point, or null.
   *
   * Walks the draw list backwards so the topmost building wins, and tests the
   * footprint diamond rather than its box so a click in the gap between two
   * towers does not pick one of them.
   */
  pick(worldX: number, worldY: number): YardBuilding | null {
    for (let i = this.views.length - 1; i >= 0; i--) {
      const building = this.views[i]?.building;
      if (!building) continue;
      const box = building.box;
      if (
        worldX < box.x ||
        worldX > box.x + box.width ||
        worldY < box.y ||
        worldY > box.y + box.height
      ) {
        continue;
      }
      if (inDiamond(building, worldX, worldY)) return building;
    }
    return null;
  }

  clear(): void {
    for (const layer of [this.shadows, this.tops, this.labels, this.markers]) {
      for (const child of layer.removeChildren()) child.destroy();
    }
    this.views = [];
  }

  destroy(): void {
    this.clear();
    this.textures.destroy();
  }

  /** Swaps in whichever pictures have arrived since the last pass. */
  private resolveTextures(): void {
    for (const view of this.views) {
      if (view.resolved && view.shadowResolved) continue;
      const art = view.art;
      if (!art) continue;

      if (!view.resolved) {
        const texture = this.textures.get(art.top);
        if (texture) {
          applyArt(view.top, texture, view.building, art.top);
          view.top.tint = 0xffffff;
          view.top.alpha = 1;
          view.resolved = true;

          view.label?.destroy();
          view.label = null;
        }
      }

      if (!view.shadowResolved && view.shadow && art.shadow) {
        const shadowTexture = this.textures.get(art.shadow);
        if (shadowTexture) {
          applyArt(view.shadow, shadowTexture, view.building, art.shadow);
          view.shadow.visible = true;
          view.shadowResolved = true;
        }
      }
    }
  }

  /** A badge over anything mid-build, mid-upgrade or mid-fortify. */
  private addCountdownMarker(building: YardBuilding, atlas: YardArtAtlas): void {
    const marker = new Sprite(atlas.working);
    marker.anchor.set(0.5, 1);
    marker.position.set(building.centreX, building.box.y - 6);
    marker.tint = building.countdown?.kind === "build" ? 0xffd479 : 0x8fd0ff;
    this.markers.addChild(marker);
  }
}

/** A placeholder fills its footprint box, whatever the picture would do. */
const fillBox = (sprite: Sprite, box: Rect): void => {
  sprite.anchor.set(0, 0);
  sprite.position.set(box.x, box.y);
  sprite.width = box.width;
  sprite.height = box.height;
};

/**
 * Puts a real picture on a sprite.
 *
 * The offset in the art table is the bitmap's top-left corner relative to the
 * building's isometric origin, which is exactly what the Flash client set on
 * its Bitmap (`client/scripts/BFOUNDATION.as:1109-1111`, `:1250-1252`). So the
 * anchor goes back to the top-left and the size back to native.
 */
const applyArt = (
  sprite: Sprite,
  texture: Texture,
  building: YardBuilding,
  image: ResolvedImage,
): void => {
  sprite.texture = texture;
  sprite.anchor.set(0, 0);
  sprite.scale.set(1);
  sprite.position.set(building.worldX + image.x, building.worldY + image.y);
};

/**
 * Whether a world point is inside a building's footprint diamond.
 *
 * The footprint rectangle starts at the building's origin and extends
 * positively on both axes (`client/scripts/BUILDING14.as:18`), so undoing the
 * isometric projection relative to that corner gives the two distances
 * directly.
 */
const inDiamond = (building: YardBuilding, worldX: number, worldY: number): boolean => {
  const [width, height] = building.footprint;
  const dx = worldX - building.worldX;
  const dy = worldY - building.worldY;
  const alongWidth = dy + dx / 2;
  const alongHeight = dy - dx / 2;
  return alongWidth >= 0 && alongWidth <= width && alongHeight >= 0 && alongHeight <= height;
};

/** Placeholder colour: enough to tell a wrecked building from a healthy one. */
const placeholderTint = (building: YardBuilding): number =>
  building.condition === BuildingCondition.DESTROYED
    ? 0x8a4a4a
    : building.condition === BuildingCondition.DAMAGED
      ? 0xb08a4a
      : 0x6f8fb0;
