import { Container, Sprite, Text, Texture } from "pixi.js";
import type { ResolvedArt } from "./buildingArt";
import { applyArt, fillBox, inDiamond, placeholderTint } from "./yardPlacement";
import {
  advanceAnimLayers,
  buildAnimLayers,
  resolveAnimLayers,
  type AnimLayer,
} from "./YardAnimations";
import { YardTextures } from "./YardTextures";
import type { YardArtAtlas } from "./yardAtlas";
import type { Rect } from "./YardGrid";
import { artFor, type Yard, type YardBuilding } from "./yardModel";

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
 *
 * The one thing here that does change frame to frame is the animation layers —
 * a turret's gun, a mill's wheel. They go into the same container as the tops,
 * immediately after the building they belong to, which puts them above it and
 * below the next building along. They are advanced only while on screen, so a
 * yard scrolled off its towers costs nothing for them. `YardAnimations.ts` owns
 * the rest.
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
  /** In stacking order; empty for the 78 types that never animate. */
  readonly anims: readonly AnimLayer[];
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
  /** True while any animation strip is still on its way. */
  animsPending: boolean;
  /**
   * True when the still top is only cell 0 of the first strip, so it has to go
   * once that strip is playing. Types 22, 53, 105 and 129.
   */
  readonly topIsAnim: boolean;
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

      // Straight after their own top, so depth order still reads down the list.
      const anims = art ? buildAnimLayers(building, art) : [];
      for (const layer of anims) this.tops.addChild(layer.sprite);

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
        anims,
        label,
        resolved: false,
        shadowResolved: shadow === null,
        animsPending: anims.length > 0,
        topIsAnim: art?.topIsAnim === true,
      });

      if (building.countdown) this.addCountdownMarker(building, atlas);
    }

    this.pending = true;
  }

  /**
   * Applies newly arrived art, advances the animations, then hides everything
   * outside `visible`.
   *
   * The sprites stay in the scene graph either way: culling is a flag, so
   * nothing is created or destroyed while panning. An animation off screen is
   * not advanced at all — it picks up wherever it was left, which nobody can
   * see, and a yard looking at its grass pays nothing for its towers.
   */
  draw(visible: Rect, deltaSeconds = 0): void {
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
      // A building drawn entirely from its first strip keeps its still top only
      // until that strip is playing; both at once would show cell 0 through the
      // transparent parts of every other cell.
      view.top.visible = on && !(view.topIsAnim && view.anims[0]?.resolved === true);
      if (view.shadow) view.shadow.visible = on && view.shadowResolved;
      if (view.label) view.label.visible = on;

      if (view.anims.length === 0) continue;
      for (const layer of view.anims) layer.sprite.visible = on && layer.resolved;
      if (on && deltaSeconds > 0) advanceAnimLayers(view.anims, deltaSeconds);
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
      if (view.resolved && view.shadowResolved && !view.animsPending) continue;
      const art = view.art;
      if (!art) continue;

      if (view.animsPending) {
        view.animsPending = resolveAnimLayers(view.anims, this.textures);
      }

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
