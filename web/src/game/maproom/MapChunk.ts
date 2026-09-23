import { Container, Sprite, type Texture } from "pixi.js";
import { CELL_HEIGHT, CELL_WIDTH } from "@/config";
import { mapRoomGrid } from "@/game/HexGrid";
import { chunkCells, type ChunkRef } from "./chunks";
import {
  CellMarker,
  DAMAGE_COLOUR,
  GRID_LINE_COLOUR,
  OWN_COLOUR,
  SHIELD_COLOUR,
  appearanceOf,
  type CellAppearance,
} from "./cellVisuals";
import { LabelLayer, type LabelRequest, type TextPool } from "./LabelLayer";
import type { MapAtlas } from "./mapAtlas";
import type { ZoneStore } from "./ZoneStore";

/**
 * One 10 x 10 block of the map, built once as sprites.
 *
 * A chunk is the unit of rebuild. It is built when it first comes on screen and
 * torn down when it has been off screen long enough; in between, panning and
 * zooming only move its parent's transform and toggle the visibility of its
 * layers. Nothing in here recomputes geometry.
 *
 * Text is the exception to "built once": the badge and name lines cost far more
 * than a sprite, and at the far tiers there are far more chunks on screen, so
 * they are added the first time a chunk is actually shown at a tier that wants
 * them (`ensureText`).
 */

/** Detail a chunk has been asked to carry. */
export const TextLevel = {
  NONE: 0,
  BADGES: 1,
  NAMES: 2,
} as const;
export type TextLevel = (typeof TextLevel)[keyof typeof TextLevel];

/** Which layers a chunk should show, decided once per frame by the renderer. */
export interface ChunkView {
  /** Outline texture for the current tier, or null to hide the outlines. */
  outline: Texture | null;
  /** Camp glyphs, crosses and damage bars. */
  details: boolean;
  badges: boolean;
  names: boolean;
}

/**
 * Glyphs are lifted and shrunk from their vector sizes to clear the text.
 *
 * The two label lines need the lower half of the hex, and a glyph centred on
 * the cell reached well into it. Three quarters of the old size, raised by
 * 0.17 of a cell, puts every glyph's lower edge above the damage bar.
 */
const GLYPH_SCALE = 0.75;
const GLYPH_Y = -CELL_HEIGHT * 0.17;

/** Damage bar: just under the glyph, just above the first line of text. */
const BAR_WIDTH = CELL_WIDTH * 0.3;
const BAR_HEIGHT = CELL_HEIGHT * 0.05;
const BAR_Y = CELL_HEIGHT * 0.025;

/** Alpha on the hairline between cells, matching the old vector grid. */
const GRID_ALPHA = 0.35;

export class MapChunk {
  readonly container = new Container();

  private readonly terrain = new Container();
  private readonly outlines = new Container();
  private readonly details = new Container();
  private readonly bases = new Container();
  private readonly labels: LabelLayer;

  private readonly outlineSprites: Sprite[] = [];
  private readonly requests: LabelRequest[] = [];
  private outlineTexture: Texture | null = null;
  private text: TextLevel = TextLevel.NONE;

  constructor(
    readonly ref: ChunkRef,
    private readonly atlas: MapAtlas,
    pool: TextPool,
  ) {
    this.labels = new LabelLayer(pool);
    this.container.interactiveChildren = false;
    this.container.addChild(
      this.terrain,
      this.outlines,
      this.details,
      this.bases,
      this.labels.badges,
      this.labels.names,
    );
  }

  /** How much text this chunk is carrying, for the renderer's budget. */
  get textLevel(): TextLevel {
    return this.text;
  }

  /**
   * Builds every sprite in the chunk from the store.
   *
   * `nowSeconds` only decides whether a truce has expired. A chunk therefore
   * freezes that judgement until it is rebuilt, which the zone refresh clock
   * (ZONE_STALE_SECONDS) guarantees happens within the minute.
   */
  build(store: ZoneStore, nowSeconds: number): void {
    this.clear();

    const cells = chunkCells(this.ref);
    for (let col = cells.minCol; col <= cells.maxCol; col++) {
      for (let row = cells.minRow; row <= cells.maxRow; row++) {
        const appearance = appearanceOf(store.getCell(col, row), nowSeconds);
        const centre = mapRoomGrid.cellToPixel(col, row);

        this.terrain.addChild(
          place(new Sprite(this.atlas.hex), centre.x, centre.y, appearance.terrain),
        );

        const outline = place(
          new Sprite(this.atlas.outlineFine),
          centre.x,
          centre.y,
          GRID_LINE_COLOUR,
        );
        outline.alpha = GRID_ALPHA;
        this.outlineSprites.push(outline);
        this.outlines.addChild(outline);

        this.addGlyph(appearance, centre.x, centre.y);
        this.addDecoration(appearance, centre.x, centre.y);

        if (appearance.badge !== "") {
          this.requests.push({ badge: appearance.badge, name: appearance.label, centre });
        }
      }
    }

    this.outlineTexture = this.atlas.outlineFine;
  }

  /** Adds the text this chunk is missing. A no-op once it is already there. */
  ensureText(level: TextLevel): void {
    if (level <= this.text) return;
    this.text = level;
    this.labels.layOut(this.requests, level >= TextLevel.NAMES);
  }

  /** Hands this chunk's text back to the pool, keeping its sprites. */
  releaseText(): void {
    if (this.text === TextLevel.NONE) return;
    this.labels.release();
    this.text = TextLevel.NONE;
  }

  /** Shows and hides layers for the current tier. No geometry work. */
  applyView(view: ChunkView): void {
    if (view.outline && view.outline !== this.outlineTexture) {
      this.outlineTexture = view.outline;
      for (const sprite of this.outlineSprites) sprite.texture = view.outline;
    }
    this.outlines.visible = view.outline !== null;
    this.details.visible = view.details;
    this.labels.badges.visible = view.badges;
    this.labels.names.visible = view.names;
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }

  private clear(): void {
    this.labels.release();
    this.text = TextLevel.NONE;
    this.requests.length = 0;
    this.outlineSprites.length = 0;
    this.terrain.removeChildren().forEach(destroyChild);
    this.outlines.removeChildren().forEach(destroyChild);
    this.details.removeChildren().forEach(destroyChild);
    this.bases.removeChildren().forEach(destroyChild);
  }

  private addGlyph(appearance: CellAppearance, x: number, y: number): void {
    const texture = this.glyphTexture(appearance.marker);
    if (!texture) return;

    const sprite = place(new Sprite(texture), x, y + GLYPH_Y, appearance.markerColour);
    sprite.scale.set(GLYPH_SCALE);

    // Player yards and outposts stay visible below the glyph threshold; camps
    // do not, because below it almost every land cell is one.
    const isCamp =
      appearance.marker === CellMarker.CAMP || appearance.marker === CellMarker.CAMP_DESTROYED;
    (isCamp ? this.details : this.bases).addChild(sprite);

    if (appearance.marker === CellMarker.CAMP_DESTROYED) {
      const cross = place(new Sprite(this.atlas.cross), x, y + GLYPH_Y, DAMAGE_COLOUR);
      cross.scale.set(GLYPH_SCALE);
      this.details.addChild(cross);
    }
  }

  private addDecoration(appearance: CellAppearance, x: number, y: number): void {
    if (appearance.shielded) {
      this.bases.addChild(place(new Sprite(this.atlas.shieldRing), x, y, SHIELD_COLOUR));
    }
    if (appearance.own) {
      this.bases.addChild(place(new Sprite(this.atlas.ownRing), x, y, OWN_COLOUR));
    }
    if (appearance.damage <= 0) return;

    const left = x - BAR_WIDTH / 2;
    const top = y + BAR_Y;
    this.details.addChild(bar(this.atlas.bar, left, top, BAR_WIDTH, 0x000000, 0.45));
    this.details.addChild(
      bar(this.atlas.bar, left, top, BAR_WIDTH * appearance.damage, DAMAGE_COLOUR, 1),
    );
  }

  private glyphTexture(marker: CellMarker): Texture | null {
    switch (marker) {
      case CellMarker.CAMP:
        return this.atlas.tent;
      case CellMarker.CAMP_DESTROYED:
        return this.atlas.tentDestroyed;
      case CellMarker.YARD:
        return this.atlas.house;
      case CellMarker.OUTPOST:
        return this.atlas.outpost;
      default:
        return null;
    }
  }
}

const place = (sprite: Sprite, x: number, y: number, tint: number): Sprite => {
  sprite.anchor.set(0.5, 0.5);
  sprite.position.set(x, y);
  sprite.tint = tint;
  return sprite;
};

const bar = (
  texture: Texture,
  left: number,
  top: number,
  width: number,
  tint: number,
  alpha: number,
): Sprite => {
  const sprite = new Sprite(texture);
  sprite.position.set(left, top);
  sprite.setSize(width, BAR_HEIGHT);
  sprite.tint = tint;
  sprite.alpha = alpha;
  return sprite;
};

/** Sprites share the atlas, so a child is destroyed without its texture. */
const destroyChild = (child: Container): void => child.destroy();
