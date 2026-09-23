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
import type { TribeAvatars } from "./tribeAvatars";
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
  /** Draw camps as tribe portraits rather than tents. */
  avatars: boolean;
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

/**
 * Tribe portrait: how tall the creature is drawn, and the line it stands on.
 *
 * The height is of the *creature*, not of its PNG. tribeAvatars.ts crops the
 * transparent margin off each image as it loads, so all four read the same
 * size rather than the size the image model happened to draw them at.
 *
 * The baseline is the tent's lower edge, GLYPH_Y + tentRise * 0.6 * GLYPH_SCALE,
 * which is 0.055 of a cell below the centre. That is what keeps the portrait
 * clear of the name line, whose upper edge sits at 0.083 of a cell. Its top
 * reaches a little past the hex's upper edge, which is harmless: the cell
 * directly above is a whole cell height away, not half of one.
 */
const AVATAR_HEIGHT = CELL_HEIGHT * 0.62;
const AVATAR_BASE_Y = CELL_HEIGHT * 0.055;

/** A razed camp: faded and drained of colour, under the usual cross. */
const AVATAR_DESTROYED_ALPHA = 0.45;
const AVATAR_DESTROYED_TINT = 0x8b909c;

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
  /** Camp tents. Swapped out wholesale for `portraits` at the close tiers. */
  private readonly tents = new Container();
  /** Camp portraits, present only when the art had arrived by build time. */
  private readonly portraits = new Container();
  private readonly details = new Container();
  private readonly bases = new Container();
  private readonly labels: LabelLayer;

  private readonly outlineSprites: Sprite[] = [];
  private readonly requests: LabelRequest[] = [];
  private outlineTexture: Texture | null = null;
  private text: TextLevel = TextLevel.NONE;
  /**
   * Whether this chunk was built with the portrait art available.
   *
   * Not `avatars.ready`: a chunk built before the art loaded has no portrait
   * sprites to show, and asking the shared set would hide its tents in favour
   * of an empty layer. The renderer rebuilds every chunk once the art lands.
   */
  private hasPortraits = false;

  constructor(
    readonly ref: ChunkRef,
    private readonly atlas: MapAtlas,
    private readonly avatars: TribeAvatars,
    pool: TextPool,
  ) {
    this.labels = new LabelLayer(pool);
    this.container.interactiveChildren = false;
    this.container.addChild(
      this.terrain,
      this.outlines,
      this.tents,
      this.portraits,
      // Crosses and damage bars go over whichever of the two is showing.
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
    this.hasPortraits = this.avatars.ready;

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

    // Exactly one of the two camp layers is ever on screen.
    const portraits = view.avatars && this.hasPortraits;
    this.tents.visible = view.details && !portraits;
    this.portraits.visible = view.details && portraits;
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
    this.hasPortraits = false;
    this.terrain.removeChildren().forEach(destroyChild);
    this.outlines.removeChildren().forEach(destroyChild);
    this.tents.removeChildren().forEach(destroyChild);
    this.portraits.removeChildren().forEach(destroyChild);
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
    (isCamp ? this.tents : this.bases).addChild(sprite);
    if (isCamp) this.addPortrait(appearance, x, y);

    if (appearance.marker === CellMarker.CAMP_DESTROYED) {
      const cross = place(new Sprite(this.atlas.cross), x, y + GLYPH_Y, DAMAGE_COLOUR);
      cross.scale.set(GLYPH_SCALE);
      this.details.addChild(cross);
    }
  }

  /**
   * The tent's understudy at the close tiers.
   *
   * Anchored at the foot rather than the centre, so the creatures stand on one
   * baseline whatever their proportions. The four crops are not the same shape,
   * and centring them would leave the tall ones sitting lower than the wide.
   */
  private addPortrait(appearance: CellAppearance, x: number, y: number): void {
    const texture = this.avatars.textureFor(appearance.tribe);
    if (!texture) return;

    const destroyed = appearance.marker === CellMarker.CAMP_DESTROYED;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.setSize((AVATAR_HEIGHT * texture.width) / texture.height, AVATAR_HEIGHT);
    sprite.position.set(x, y + AVATAR_BASE_Y);
    sprite.tint = destroyed ? AVATAR_DESTROYED_TINT : 0xffffff;
    sprite.alpha = destroyed ? AVATAR_DESTROYED_ALPHA : 1;
    this.portraits.addChild(sprite);
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
