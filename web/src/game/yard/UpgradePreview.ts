import {
  Assets,
  BlurFilter,
  ColorMatrixFilter,
  Container,
  Graphics,
  Sprite,
  Text,
  type Texture,
} from "pixi.js";
import { cellTexture } from "@/game/textureLimit";
import type { ResolvedArt } from "./buildingArt";
import type { Corners } from "./planner/marquee";
import { yardArtUrl } from "./retryLoad";
import { previewLayers } from "./upgradeLook";
import type { YardBuilding } from "./yardModel";
import { jobBarScale } from "./YardJobBars";

/**
 * The upgrade preview's ghost (beta 8, owner 15 Nov 2026, option A of the
 * mock-ups): the building's next look drawn over its own spot, see-through
 * and blue, with a soft glow round it, a blue footprint diamond under it and
 * a small "Lv N" tag above it. The building itself is drawn faded underneath
 * (`YardBuildings.setFaded`); the renderer (`YardRenderer.setUpgradePreview`)
 * says when. The ghost stands still: an animated building shows its resting
 * look (`previewLayers`).
 */

/** The preview's blue: the footprint, the glow and the tag. */
export const PREVIEW_BLUE = 0x5ab4ff;

/**
 * The ghost's colour matrix: each pixel's brightness turned into a blue, dark
 * parts a deep blue and light parts a pale cyan, so the shape and its details
 * still read; at 72% of its own opacity, so the faded building shows through.
 */
// prettier-ignore
export const GHOST_MATRIX = [
  0.45 * 0.3, 0.45 * 0.59, 0.45 * 0.11, 0, 0.12,
  0.55 * 0.3, 0.55 * 0.59, 0.55 * 0.11, 0, 0.42,
  0.3 * 0.3, 0.3 * 0.59, 0.3 * 0.11, 0, 0.85,
  0, 0, 0, 0.72, 0,
] as const;

/** The glow's: the same shape in one flat light blue, blurred behind the ghost. */
// prettier-ignore
export const GLOW_MATRIX = [
  0, 0, 0, 0, 0.4,
  0, 0, 0, 0, 0.75,
  0, 0, 0, 0, 1,
  0, 0, 0, 0.6, 0,
] as const;

/** The tag's height in world px at 1:1. */
const TAG_HEIGHT = 20;

/** How far the glow spreads, in Pixi blur strength. */
const GLOW_BLUR = 8;

/** What is asked to be drawn: a building, the look and level it would upgrade to, and where its footprint is. */
export interface UpgradePreviewRequest {
  readonly building: YardBuilding;
  readonly art: ResolvedArt;
  readonly level: number;
  readonly corners: Corners;
}

/** Same building, same spot, same picture and level: nothing to redraw. */
export const previewKey = (request: UpgradePreviewRequest): string =>
  `${request.building.id}:${request.level}:${request.building.worldX},${request.building.worldY}:${request.art.top.url}`;

export class UpgradePreview {
  readonly root = new Container();
  private readonly footprint = new Graphics();
  private readonly glow = new Container();
  private readonly body = new Container();
  private readonly tag = new Container();
  /** Bumped by every show and clear, so a picture that loads after either is dropped. */
  private generation = 0;
  private key: string | null = null;
  private shownId: number | null = null;
  /** The filters, made on first use: a filter wants a GPU context, which a yard that never previews does not need. */
  private ghostFilter: ColorMatrixFilter | null = null;
  private glowFilters: [ColorMatrixFilter, BlurFilter] | null = null;
  private zoom = 1;
  private destroyed = false;

  constructor() {
    this.root.eventMode = "none";
    this.root.visible = false;
    this.root.addChild(this.footprint, this.glow, this.body, this.tag);
  }

  /** The building the ghost stands on, or null when none is shown. */
  get buildingId(): number | null {
    return this.shownId;
  }

  /**
   * Draws the ghost of `request`. The footprint and the tag go up at once and
   * the pictures when they have loaded; asking again for what is already up
   * redraws nothing, which the window asks every time it redraws.
   */
  show(request: UpgradePreviewRequest): void {
    if (this.destroyed) return;
    const key = previewKey(request);
    if (key === this.key) return;
    this.clear();
    this.key = key;
    this.shownId = request.building.id;
    const generation = this.generation;
    this.drawFootprint(request.corners);
    this.drawTag(request);
    this.root.visible = true;
    void this.loadArt(request, generation);
  }

  /** Takes the ghost away. */
  clear(): void {
    this.generation++;
    this.key = null;
    this.shownId = null;
    this.root.visible = false;
    this.footprint.clear();
    for (const layer of [this.glow, this.body, this.tag]) {
      for (const child of layer.removeChildren()) child.destroy();
    }
  }

  /** Keeps the tag one size on screen, as the job bars' counters are (`jobBarScale`). */
  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.tag.scale.set(jobBarScale(zoom));
  }

  destroy(): void {
    this.clear();
    this.destroyed = true;
    this.ghostFilter?.destroy();
    this.ghostFilter = null;
    for (const filter of this.glowFilters ?? []) filter.destroy();
    this.glowFilters = null;
    this.root.destroy({ children: true });
  }

  private drawFootprint(corners: Corners): void {
    this.footprint
      .clear()
      .poly(corners.flatMap(([x, y]) => [x, y]))
      .fill({ color: PREVIEW_BLUE, alpha: 0.22 })
      .stroke({ width: 2, color: PREVIEW_BLUE, alpha: 0.95 });
  }

  /** "Lv N" on a dark pill, centred over the footprint and standing on the top of the picture. */
  private drawTag(request: UpgradePreviewRequest): void {
    const { building, art, level, corners } = request;
    const xs = corners.map(([x]) => x);
    const centreX = xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : building.worldX;
    const tops = previewLayers(art).map((layer) => building.worldY + layer.y);
    const topY = tops.length > 0 ? Math.min(...tops) : building.worldY;

    const label = new Text({
      text: `Lv ${level}`,
      style: {
        // Titan One (#223) has one weight, already bold.
        fontFamily: "Titan One, sans-serif",
        fontSize: 13,
        fill: 0xffffff,
      },
      // The yard is often looked at closer than 1:1, where a 1x glyph is soft.
      resolution: 2,
    });
    label.anchor.set(0.5, 0.5);
    label.position.set(0, -TAG_HEIGHT / 2);
    // Sized from the characters, not measured: "Lv 10" at most, and no text measuring off screen.
    const width = 16 + 8.5 * label.text.length;
    const pill = new Graphics()
      .roundRect(-width / 2, -TAG_HEIGHT, width, TAG_HEIGHT, TAG_HEIGHT / 2)
      .fill({ color: 0x0b2a4a, alpha: 0.88 })
      .stroke({ width: 1.5, color: PREVIEW_BLUE, alpha: 1 });
    this.tag.addChild(pill, label);
    this.tag.position.set(centreX, topY - 2);
    this.tag.scale.set(jobBarScale(this.zoom));
  }

  private async loadArt(request: UpgradePreviewRequest, generation: number): Promise<void> {
    const { building } = request;
    const layers = previewLayers(request.art);
    let textures: Texture[];
    try {
      textures = await Promise.all(
        layers.map((layer) => Assets.load<Texture>(yardArtUrl(layer.url))),
      );
    } catch {
      // No picture: the footprint and the tag still say what is coming.
      return;
    }
    if (this.destroyed || generation !== this.generation) return;
    layers.forEach((layer, index) => {
      const texture = textures[index];
      if (!texture) return;
      const frame = layer.frame;
      // A strip bigger than the graphics card holds is cut (`cellTexture`), not drawn black.
      const shown = frame
        ? cellTexture(texture.source, { x: 0, y: 0, width: frame.width, height: frame.height })
            .texture
        : texture;
      for (const into of [this.glow, this.body]) {
        const sprite = new Sprite(shown);
        sprite.position.set(building.worldX + layer.x, building.worldY + layer.y);
        into.addChild(sprite);
      }
    });
    // One filter over all the layers, so a gun stacked on its base does not show the base through it.
    if (!this.ghostFilter) {
      this.ghostFilter = new ColorMatrixFilter({ resolution: "inherit" });
      this.ghostFilter.matrix = [...GHOST_MATRIX];
    }
    if (!this.glowFilters) {
      const tint = new ColorMatrixFilter({ resolution: "inherit" });
      tint.matrix = [...GLOW_MATRIX];
      this.glowFilters = [
        tint,
        new BlurFilter({ strength: GLOW_BLUR, quality: 3, resolution: "inherit" }),
      ];
    }
    this.body.filters = [this.ghostFilter];
    this.glow.filters = this.glowFilters;
  }
}
