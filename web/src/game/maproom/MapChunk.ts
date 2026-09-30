import { Container, NineSliceSprite, Sprite, type Texture } from "pixi.js";
import { CELL_HEIGHT, CELL_WIDTH } from "@/config";
import { mapRoomGrid } from "@/game/HexGrid";
import { chunkCells, type ChunkRef } from "./chunks";
import {
  CellMarker,
  DAMAGE_COLOUR,
  GRID_LINE_COLOUR,
  INVITE_COLOUR,
  MARKER_FILL_COLOUR,
  OWN_COLOUR,
  OWN_PLATE_TEXT_COLOUR,
  PLAYER_RING_COLOUR,
  SHIELD_COLOUR,
  appearanceOf,
  type CellAppearance,
} from "./cellVisuals";
import { LabelLayer, type LabelRequest, type TextPool } from "./LabelLayer";
import { MARKER_UNIT, PLATE_HALF_HEIGHT, type MapAtlas } from "./mapAtlas";
import type { PlayerAvatars } from "./playerAvatars";
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
 * Text is the exception to "built once": the badge and plate text costs far
 * more than a sprite, and at the far tiers there are far more chunks on
 * screen, so it is added the first time a chunk is actually shown at a tier
 * that wants it (`ensureText`).
 *
 * What it draws is the approved "one calm look" (#176, R-MR2-Map-A): toned
 * ground and light grid lines; each camp its tribe's picture with the level on
 * a round badge ringed in the tribe's colour, and no name; each player a round
 * marker with their critter, ringed white (cyan for the player's own), and a
 * name plate under it.
 */

/** Detail a chunk has been asked to carry. */
export const TextLevel = {
  NONE: 0,
  BADGES: 1,
} as const;
export type TextLevel = (typeof TextLevel)[keyof typeof TextLevel];

/** Which layers a chunk should show, decided once per frame by the renderer. */
export interface ChunkView {
  /** Outline texture for the current tier, or null to hide the outlines. */
  outline: Texture | null;
  /** Camp glyphs and the crosses over razed camps. */
  details: boolean;
  /** Draw camps as tribe portraits rather than tents. */
  avatars: boolean;
  /** Camps' level badges and players' name plates. */
  badges: boolean;
}

/**
 * Tents at the far tiers are lifted and shrunk from their vector sizes, as
 * they always were, so a razed camp's cross sits on its tent.
 */
const GLYPH_SCALE = 0.75;
const GLYPH_Y = -CELL_HEIGHT * 0.17;

/**
 * Tribe portrait: how tall the creature is drawn, and the line it stands on.
 *
 * The height is of the *creature*, not of its PNG: tribeAvatars.ts crops the
 * transparent margin off each image as it loads, so all four read the same
 * size. A little smaller than it was, and centred in the hex now that no name
 * line needs the lower half.
 */
const AVATAR_HEIGHT = CELL_HEIGHT * 0.55;
const AVATAR_BASE_Y = CELL_HEIGHT * 0.24;

/** Where a razed camp's cross sits over its portrait. */
const PORTRAIT_CROSS_Y = AVATAR_BASE_Y - AVATAR_HEIGHT / 2;

/** A razed camp: faded and drained of colour, under the usual cross. */
const AVATAR_DESTROYED_ALPHA = 0.45;
const AVATAR_DESTROYED_TINT = 0x8b909c;

/** A camp's level badge: on the lower right of its picture. */
const BADGE_RADIUS = CELL_HEIGHT * 0.19;
const BADGE_X = CELL_WIDTH * 0.12;
const BADGE_Y = CELL_HEIGHT * 0.15;
const BADGE_TEXT_SIZE = CELL_HEIGHT * 0.21;

/** A player's marker: a round critter, a little larger for the player's own yard. */
const MARKER_RADIUS = CELL_HEIGHT * 0.38;
const OWN_MARKER_RADIUS = CELL_HEIGHT * 0.44;
const MARKER_Y = -CELL_HEIGHT * 0.14;
/** The ring's share of the radius; the picture fills the rest. */
const MARKER_RING_SHARE = 6 / MARKER_UNIT;

/** The dot on the player's own outpost while an invitation to move onto it waits (#205). */
const INVITE_DOT_RADIUS = CELL_HEIGHT * 0.1;
const INVITE_DOT_OFFSET = Math.SQRT1_2;

/** A player's name plate, just overlapping the foot of the marker. */
const PLATE_HEIGHT = PLATE_HALF_HEIGHT * 2;
const PLATE_OVERLAP = CELL_HEIGHT * 0.05;
const PLATE_TEXT_SIZE = PLATE_HEIGHT * 0.6;
const PLATE_PADDING = CELL_WIDTH * 0.07;
const PLATE_MAX_TEXT = CELL_WIDTH * 1.3;
const PLATE_ALPHA = 0.92;

/**
 * Alpha on the hairline between cells: lighter than it was, so the grid
 * recedes behind the camps (#176).
 */
const GRID_ALPHA = 0.2;

export class MapChunk {
  /** The ground and the camps' pictures. */
  readonly container = new Container();
  /**
   * What stands over the ground: badges, players' markers and their plates.
   *
   * A separate container the renderer keeps above every chunk's ground, because
   * a plate or a badge reaches past its own cell and would otherwise be hidden
   * under the next chunk's hexes.
   */
  readonly top = new Container();

  private readonly terrain = new Container();
  private readonly outlines = new Container();
  /** Camp tents. Swapped out wholesale for `portraits` at the close tiers. */
  private readonly tents = new Container();
  /** Camp portraits, present only when the art had arrived by build time. */
  private readonly portraits = new Container();
  private readonly details = new Container();
  /** The discs and rings behind camps' level numbers. */
  private readonly badgeDiscs = new Container();
  /** Players' markers, shown at every chunked tier. */
  private readonly bases = new Container();
  /** The rounded bars behind players' names, sized when their text is laid out. */
  private readonly plates = new Container();
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
    private readonly players: PlayerAvatars,
    pool: TextPool,
  ) {
    this.labels = new LabelLayer(pool);
    this.container.interactiveChildren = false;
    this.top.interactiveChildren = false;
    this.container.addChild(
      this.terrain,
      this.outlines,
      this.tents,
      this.portraits,
      // Crosses go over whichever of the two is showing.
      this.details,
    );
    this.top.addChild(this.badgeDiscs, this.bases, this.plates, this.labels.badges);
  }

  /** Shows or hides the whole chunk, ground and top alike. */
  set visible(visible: boolean) {
    this.container.visible = visible;
    this.top.visible = visible;
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

        if (appearance.marker === CellMarker.YARD || appearance.marker === CellMarker.OUTPOST) {
          this.addPlayer(appearance, centre.x, centre.y);
        } else {
          this.addCamp(appearance, centre.x, centre.y);
        }
      }
    }

    this.outlineTexture = this.atlas.outlineFine;
  }

  /** Adds the text this chunk is missing. A no-op once it is already there. */
  ensureText(level: TextLevel): void {
    if (level <= this.text) return;
    this.text = level;
    this.clearPlates();
    this.labels.layOut(this.requests);
  }

  /** Hands this chunk's text back to the pool, keeping its sprites. */
  releaseText(): void {
    if (this.text === TextLevel.NONE) return;
    this.labels.release();
    this.clearPlates();
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
    this.badgeDiscs.visible = view.badges;
    this.plates.visible = view.badges;
    this.labels.badges.visible = view.badges;
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
    this.top.destroy({ children: true });
  }

  private clear(): void {
    this.labels.release();
    this.text = TextLevel.NONE;
    this.requests.length = 0;
    this.outlineSprites.length = 0;
    this.hasPortraits = false;
    this.clearPlates();
    for (const layer of [
      this.terrain,
      this.outlines,
      this.tents,
      this.portraits,
      this.details,
      this.badgeDiscs,
      this.bases,
    ]) {
      layer.removeChildren().forEach(destroyChild);
    }
  }

  private clearPlates(): void {
    this.plates.removeChildren().forEach(destroyChild);
  }

  /** A wild monster camp: its tent, its portrait, and its level on a badge. */
  private addCamp(appearance: CellAppearance, x: number, y: number): void {
    const destroyed = appearance.marker === CellMarker.CAMP_DESTROYED;
    if (appearance.marker !== CellMarker.CAMP && !destroyed) return;

    const tent = place(
      new Sprite(destroyed ? this.atlas.tentDestroyed : this.atlas.tent),
      x,
      y + GLYPH_Y,
      appearance.markerColour,
    );
    tent.scale.set(GLYPH_SCALE);
    this.tents.addChild(tent);

    const portrait = this.addPortrait(appearance, x, y, destroyed);

    if (destroyed) {
      // The cross sits on the picture the close tiers show, or on the tent.
      const cross = place(
        new Sprite(this.atlas.cross),
        x,
        y + (portrait ? PORTRAIT_CROSS_Y : GLYPH_Y),
        DAMAGE_COLOUR,
      );
      cross.scale.set(GLYPH_SCALE);
      this.details.addChild(cross);
    }

    if (appearance.badge === "") return;
    const bx = x + BADGE_X;
    const by = y + BADGE_Y;
    this.badgeDiscs.addChild(
      disc(this.atlas.disc, bx, by, BADGE_RADIUS, MARKER_FILL_COLOUR),
      disc(this.atlas.ring, bx, by, BADGE_RADIUS, appearance.markerColour),
    );
    this.requests.push({
      text: appearance.badge,
      x: bx,
      y: by,
      size: BADGE_TEXT_SIZE,
      maxWidth: BADGE_RADIUS * 1.6,
    });
  }

  /**
   * The tent's understudy at the close tiers.
   *
   * Anchored at the foot rather than the centre, so the creatures stand on one
   * baseline whatever their proportions. The four crops are not the same shape,
   * and centring them would leave the tall ones sitting lower than the wide.
   */
  private addPortrait(
    appearance: CellAppearance,
    x: number,
    y: number,
    destroyed: boolean,
  ): boolean {
    const texture = this.avatars.textureFor(appearance.tribe);
    if (!texture) return false;

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.setSize((AVATAR_HEIGHT * texture.width) / texture.height, AVATAR_HEIGHT);
    sprite.position.set(x, y + AVATAR_BASE_Y);
    sprite.tint = destroyed ? AVATAR_DESTROYED_TINT : 0xffffff;
    sprite.alpha = destroyed ? AVATAR_DESTROYED_ALPHA : 1;
    this.portraits.addChild(sprite);
    return true;
  }

  /**
   * A player's yard or outpost: a round marker with their critter, ringed
   * white, cyan for the player's own and blue under protection or a truce, and
   * a name plate under it ("Bramblefoot  24", or "You" and "Outpost"). The
   * player's own outpost wears an amber dot while an invitation to move onto
   * it waits (#205).
   */
  private addPlayer(appearance: CellAppearance, x: number, y: number): void {
    const ownYard = appearance.own && appearance.marker === CellMarker.YARD;
    const radius = ownYard ? OWN_MARKER_RADIUS : MARKER_RADIUS;
    const cy = y + MARKER_Y;
    const ring = appearance.own
      ? OWN_COLOUR
      : appearance.shielded
        ? SHIELD_COLOUR
        : PLAYER_RING_COLOUR;

    this.bases.addChild(disc(this.atlas.disc, x, cy, radius, MARKER_FILL_COLOUR));
    const picture = this.players.textureFor(appearance.avatar);
    if (picture) {
      const inner = radius * (1 - MARKER_RING_SHARE);
      const sprite = new Sprite(picture);
      sprite.anchor.set(0.5, 0.5);
      sprite.setSize(inner * 2, inner * 2);
      sprite.position.set(x, cy);
      this.bases.addChild(sprite);
    }
    this.bases.addChild(disc(this.atlas.ring, x, cy, radius, ring));

    if (appearance.invitePending) {
      // On the marker's rim, upper right, with the badges: it tells at a distance, like them.
      const dx = x + radius * INVITE_DOT_OFFSET;
      const dy = cy - radius * INVITE_DOT_OFFSET;
      this.badgeDiscs.addChild(
        disc(this.atlas.disc, dx, dy, INVITE_DOT_RADIUS, INVITE_COLOUR),
        disc(this.atlas.ring, dx, dy, INVITE_DOT_RADIUS, MARKER_FILL_COLOUR),
      );
    }

    if (appearance.plate === "") return;
    const own = appearance.own;
    const py = cy + radius + PLATE_HALF_HEIGHT - PLATE_OVERLAP;
    this.requests.push({
      text: appearance.plate,
      x,
      y: py,
      size: PLATE_TEXT_SIZE,
      maxWidth: PLATE_MAX_TEXT,
      ...(own ? { dark: OWN_PLATE_TEXT_COLOUR } : {}),
      measured: (width) => this.addPlate(x, py, width, own),
    });
  }

  /** The rounded bar behind a name, as wide as the name it holds. */
  private addPlate(x: number, y: number, textWidth: number, own: boolean): void {
    const plate = new NineSliceSprite({
      texture: this.atlas.plate,
      leftWidth: PLATE_HALF_HEIGHT,
      rightWidth: PLATE_HALF_HEIGHT,
      topHeight: PLATE_HALF_HEIGHT,
      bottomHeight: PLATE_HALF_HEIGHT,
    });
    const width = Math.max(textWidth + PLATE_PADDING * 2, PLATE_HEIGHT * 1.5);
    plate.width = width;
    plate.height = PLATE_HEIGHT;
    plate.position.set(x - width / 2, y - PLATE_HALF_HEIGHT);
    plate.tint = own ? OWN_COLOUR : MARKER_FILL_COLOUR;
    plate.alpha = own ? 1 : PLATE_ALPHA;
    this.plates.addChild(plate);
  }
}

const place = (sprite: Sprite, x: number, y: number, tint: number): Sprite => {
  sprite.anchor.set(0.5, 0.5);
  sprite.position.set(x, y);
  sprite.tint = tint;
  return sprite;
};

/** A disc or ring from the atlas, at a radius. */
const disc = (texture: Texture, x: number, y: number, radius: number, tint: number): Sprite => {
  const sprite = place(new Sprite(texture), x, y, tint);
  sprite.scale.set(radius / MARKER_UNIT);
  return sprite;
};

/** Sprites share the atlas, so a child is destroyed without its texture. */
const destroyChild = (child: Container): void => child.destroy();
