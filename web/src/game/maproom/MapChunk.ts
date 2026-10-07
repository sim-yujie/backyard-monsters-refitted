import { Container, NineSliceSprite, Sprite, type Texture } from "pixi.js";
import { CELL_HEIGHT, CELL_WIDTH } from "@/config";
import { mapRoomGrid } from "@/game/HexGrid";
import { chunkCells, type ChunkRef } from "./chunks";
import {
  CellMarker,
  DAMAGE_COLOUR,
  DIMMED_ALPHA,
  GRID_LINE_COLOUR,
  INVITE_COLOUR,
  KIT_TINT,
  MARKER_FILL_COLOUR,
  OWN_PLATE_TEXT_COLOUR,
  OutpostKit,
  SHIELD_COLOUR,
  appearanceOf,
  hexWidthAt,
  type CellAppearance,
  type MapViewerContext,
} from "./cellVisuals";
import { LabelLayer, type LabelRequest, type TextPool } from "./LabelLayer";
import { ICON_UNIT, MARKER_UNIT, PLATE_HALF_HEIGHT, type MapAtlas } from "./mapAtlas";
import { BuildingKind, type BuildingAvatars } from "./buildingAvatars";
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
 * What it draws is the approved "one calm look" (#176, R-MR2-Map-A) for camps:
 * each its tribe's picture with the level on a round badge ringed in the
 * tribe's colour, and no name. A player cell is Flash-faithful instead (#334,
 * owner decision 2026-10-07): the Town Hall or outpost picture standing on the
 * hex, a gold level star, and a rounded name plate coloured and iconed by how
 * the cell relates to the viewer (gold+house for the viewer's own, green+
 * shield for an alliance-mate, plain blue for everyone else - red+crossed
 * swords for an attacker is drawn but never reached yet, see `cellVisuals.ts`).
 * An outpost's tower also carries its Starter Kit's tint, and every sprite a
 * cell draws dims together when the kit filter excludes it.
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

/**
 * A player's hex wears its Town Hall or outpost picture (#334), foot-anchored
 * like a camp's portrait (`AVATAR_HEIGHT`/`AVATAR_BASE_Y` above), but taller:
 * it is now the whole hex's identity, not a small critter. Needs tuning
 * against the reference screenshot once it is on screen.
 */
const BUILDING_HEIGHT = CELL_HEIGHT * 0.85;
/** Where the building's foot sits: a little above the plate, so they overlap slightly. */
const BUILDING_FOOT_Y = CELL_HEIGHT * 0.12;
/** Nominal half-height used only to place the invite dot near the building's edge. */
const BUILDING_INVITE_RADIUS = BUILDING_HEIGHT * 0.4;

/**
 * The faint shield bubble over a protected or truced cell's building (#334,
 * owner decision 2026-10-07): a little larger than the building picture so it
 * reads as a bubble round it, not a patch on it.
 */
const SHIELD_BUBBLE_SCALE = 1.2;
const SHIELD_BUBBLE_ALPHA = 0.4;

/** The dot on the player's own outpost while an invitation to move onto it waits (#205). */
const INVITE_DOT_RADIUS = CELL_HEIGHT * 0.11;
/** Where on the rim: to the right, a little above the middle, clear of the plate of the cell above. */
const INVITE_DOT_ANGLE = -Math.PI / 10;

/** The gold level star every player cell wears, top-left of the hex (#334). */
const STAR_RADIUS = CELL_HEIGHT * 0.19;
const STAR_X = -CELL_WIDTH * 0.32;
const STAR_Y = -CELL_HEIGHT * 0.28;
const STAR_TEXT_SIZE = CELL_HEIGHT * 0.2;
const STAR_COLOUR = 0xf2c230;

/** A relation icon (house/shield/swords), drawn inside the plate's left end (#334). */
const RELATION_ICON_RADIUS = CELL_HEIGHT * 0.13;
const RELATION_ICON_PAD = CELL_WIDTH * 0.015;

/**
 * A player's name plate, placed low in the hex so the width it has to work
 * with (`hexWidthAt`) is enough to hold a name without spilling into the
 * hex's neighbour (#334) - this offset is the geometry's load-bearing
 * constant, not just a layout nicety; moving it changes how much width the
 * plate is allowed.
 */
const PLATE_HEIGHT = PLATE_HALF_HEIGHT * 2;
const PLATE_Y_OFFSET = CELL_HEIGHT * 0.28;
const PLATE_TEXT_SIZE = PLATE_HEIGHT * 0.6;
const PLATE_PADDING = CELL_WIDTH * 0.07;
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
    private readonly buildings: BuildingAvatars,
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
  build(store: ZoneStore, nowSeconds: number, context: MapViewerContext): void {
    this.clear();
    this.hasPortraits = this.avatars.ready;

    const cells = chunkCells(this.ref);
    for (let col = cells.minCol; col <= cells.maxCol; col++) {
      for (let row = cells.minRow; row <= cells.maxRow; row++) {
        const appearance = appearanceOf(store.getCell(col, row), nowSeconds, context, { x: col, y: row });
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

  /**
   * A wild monster camp: its tent, its portrait, and its level on a badge.
   * Dims along with the rest of the map under the kit filter (#334).
   */
  private addCamp(appearance: CellAppearance, x: number, y: number): void {
    const destroyed = appearance.marker === CellMarker.CAMP_DESTROYED;
    if (appearance.marker !== CellMarker.CAMP && !destroyed) return;
    const alpha = appearance.dimmed ? DIMMED_ALPHA : 1;

    const tent = place(
      new Sprite(destroyed ? this.atlas.tentDestroyed : this.atlas.tent),
      x,
      y + GLYPH_Y,
      appearance.markerColour,
    );
    tent.scale.set(GLYPH_SCALE);
    tent.alpha = alpha;
    this.tents.addChild(tent);

    const portrait = this.addPortrait(appearance, x, y, destroyed, alpha);

    if (destroyed) {
      // The cross sits on the picture the close tiers show, or on the tent.
      const cross = place(
        new Sprite(this.atlas.cross),
        x,
        y + (portrait ? PORTRAIT_CROSS_Y : GLYPH_Y),
        DAMAGE_COLOUR,
      );
      cross.scale.set(GLYPH_SCALE);
      cross.alpha = alpha;
      this.details.addChild(cross);
    }

    if (appearance.badge === "") return;
    const bx = x + BADGE_X;
    const by = y + BADGE_Y;
    const badgeDisc = disc(this.atlas.disc, bx, by, BADGE_RADIUS, MARKER_FILL_COLOUR);
    const badgeRing = disc(this.atlas.ring, bx, by, BADGE_RADIUS, appearance.markerColour);
    badgeDisc.alpha = alpha;
    badgeRing.alpha = alpha;
    this.badgeDiscs.addChild(badgeDisc, badgeRing);
    this.requests.push({
      text: appearance.badge,
      x: bx,
      y: by,
      size: BADGE_TEXT_SIZE,
      maxWidth: BADGE_RADIUS * 1.6,
      alpha,
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
    alpha: number,
  ): boolean {
    const texture = this.avatars.textureFor(appearance.tribe);
    if (!texture) return false;

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.setSize((AVATAR_HEIGHT * texture.width) / texture.height, AVATAR_HEIGHT);
    sprite.position.set(x, y + AVATAR_BASE_Y);
    sprite.tint = destroyed ? AVATAR_DESTROYED_TINT : 0xffffff;
    sprite.alpha = (destroyed ? AVATAR_DESTROYED_ALPHA : 1) * alpha;
    this.portraits.addChild(sprite);
    return true;
  }

  /**
   * A player's yard or outpost (#334, Flash-faithful redraw): the Town Hall or
   * outpost picture standing on the hex (tinted by the outpost's Starter Kit),
   * a gold level star top-left, and a name plate below it, coloured and iconed
   * by how the cell relates to the viewer. The player's own outpost wears an
   * amber dot while an invitation to move onto it waits (#205). The kit
   * filter dims every sprite this draws together when the cell does not match
   * it.
   *
   * A cell under damage protection or an active truce (`appearance.shielded`)
   * wears a faint blue bubble over its building picture (#334, owner decision
   * 2026-10-07) - the earlier redraw dropped the old vector ring with no
   * replacement; this is that replacement, drawn in `bases` so it sits over
   * the building but under the star and the plate (both in later layers), and
   * dims with the rest of the cell under the kit filter.
   */
  private addPlayer(appearance: CellAppearance, x: number, y: number): void {
    const alpha = appearance.dimmed ? DIMMED_ALPHA : 1;
    const outpost = appearance.marker === CellMarker.OUTPOST;
    const footX = x;
    const footY = y + BUILDING_FOOT_Y;

    const texture = this.buildings.textureFor(outpost ? BuildingKind.OUTPOST : BuildingKind.YARD);
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.setSize((BUILDING_HEIGHT * texture.width) / texture.height, BUILDING_HEIGHT);
      sprite.position.set(footX, footY);
      if (appearance.kit !== null && appearance.kit !== OutpostKit.NONE) {
        sprite.tint = KIT_TINT[appearance.kit];
      }
      sprite.alpha = alpha;
      this.bases.addChild(sprite);

      if (appearance.shielded) {
        const bubble = new Sprite(this.atlas.shieldBubble);
        bubble.anchor.set(0.5, 1);
        bubble.setSize(sprite.width * SHIELD_BUBBLE_SCALE, sprite.height * SHIELD_BUBBLE_SCALE);
        bubble.position.set(footX, footY);
        bubble.tint = SHIELD_COLOUR;
        bubble.alpha = SHIELD_BUBBLE_ALPHA * alpha;
        this.bases.addChild(bubble);
      }
    }

    if (appearance.invitePending) {
      // Near the building's upper-right edge, drawn over it.
      const dx = footX + BUILDING_INVITE_RADIUS * Math.cos(INVITE_DOT_ANGLE);
      const dy = footY - BUILDING_HEIGHT * 0.5 + BUILDING_INVITE_RADIUS * Math.sin(INVITE_DOT_ANGLE);
      const dot = disc(this.atlas.disc, dx, dy, INVITE_DOT_RADIUS, INVITE_COLOUR);
      const dotRing = disc(this.atlas.ring, dx, dy, INVITE_DOT_RADIUS, MARKER_FILL_COLOUR);
      dot.alpha = alpha;
      dotRing.alpha = alpha;
      this.bases.addChild(dot, dotRing);
    }

    // The gold level star every player cell wears (#334).
    const starX = x + STAR_X;
    const starY = y + STAR_Y;
    const star = icon(this.atlas.star, starX, starY, STAR_RADIUS, STAR_COLOUR);
    star.alpha = alpha;
    this.badgeDiscs.addChild(star);
    this.requests.push({
      text: appearance.star,
      x: starX,
      y: starY,
      size: STAR_TEXT_SIZE,
      maxWidth: STAR_RADIUS * 1.6,
      alpha,
    });

    if (appearance.plate === "") return;
    const py = y + PLATE_Y_OFFSET;
    // Capped to the hex's actual width at py, so the plate never spills into
    // the neighbour hex sharing that edge (#334).
    const maxTotalWidth = hexWidthAt(py - y);
    this.requests.push({
      text: appearance.plate,
      x,
      y: py,
      size: PLATE_TEXT_SIZE,
      maxWidth: Math.max(maxTotalWidth - PLATE_PADDING * 2, PLATE_HEIGHT),
      alpha,
      ...(appearance.own ? { dark: OWN_PLATE_TEXT_COLOUR } : {}),
      measured: (width) => this.addPlate(x, py, width, maxTotalWidth, appearance, alpha),
    });
  }

  /**
   * The rounded bar behind a name, as wide as the name it holds (but never
   * wider than the hex it sits in, #334), tinted and iconed by the cell's
   * relation to the viewer.
   */
  private addPlate(
    x: number,
    y: number,
    textWidth: number,
    maxTotalWidth: number,
    appearance: CellAppearance,
    alpha: number,
  ): void {
    const plate = new NineSliceSprite({
      texture: this.atlas.plate,
      leftWidth: PLATE_HALF_HEIGHT,
      rightWidth: PLATE_HALF_HEIGHT,
      topHeight: PLATE_HALF_HEIGHT,
      bottomHeight: PLATE_HALF_HEIGHT,
    });
    const width = Math.min(Math.max(textWidth + PLATE_PADDING * 2, PLATE_HEIGHT * 1.5), maxTotalWidth);
    plate.width = width;
    plate.height = PLATE_HEIGHT;
    plate.position.set(x - width / 2, y - PLATE_HALF_HEIGHT);
    plate.tint = appearance.plateColour;
    plate.alpha = (appearance.own ? 1 : PLATE_ALPHA) * alpha;
    this.plates.addChild(plate);

    const iconTexture = this.relationIconTexture(appearance.relationIcon);
    if (iconTexture) {
      const iconX = x - width / 2 + RELATION_ICON_RADIUS + RELATION_ICON_PAD;
      const iconSprite = icon(iconTexture, iconX, y, RELATION_ICON_RADIUS, 0xffffff);
      iconSprite.alpha = alpha;
      this.plates.addChild(iconSprite);
    }
  }

  /** The atlas texture for a relation icon, or null for `"none"`. */
  private relationIconTexture(icon: CellAppearance["relationIcon"]): Texture | null {
    switch (icon) {
      case "house":
        return this.atlas.houseIcon;
      case "shield":
        return this.atlas.shieldIcon;
      case "swords":
        return this.atlas.swordsIcon;
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

/** A disc or ring from the atlas, at a radius. */
const disc = (texture: Texture, x: number, y: number, radius: number, tint: number): Sprite => {
  const sprite = place(new Sprite(texture), x, y, tint);
  sprite.scale.set(radius / MARKER_UNIT);
  return sprite;
};

/** The star or a relation icon from the atlas (#334), baked at `ICON_UNIT` rather than `MARKER_UNIT`. */
const icon = (texture: Texture, x: number, y: number, radius: number, tint: number): Sprite => {
  const sprite = place(new Sprite(texture), x, y, tint);
  sprite.scale.set(radius / ICON_UNIT);
  return sprite;
};

/** Sprites share the atlas, so a child is destroyed without its texture. */
const destroyChild = (child: Container): void => child.destroy();
