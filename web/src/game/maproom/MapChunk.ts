import { Container, NineSliceSprite, Sprite, type Texture } from "pixi.js";
import { CELL_HEIGHT, CELL_WIDTH } from "@/config";
import { mapRoomGrid } from "@/game/HexGrid";
import { chunkCells, type ChunkRef } from "./chunks";
import {
  CellMarker,
  DAMAGE_COLOUR,
  DIMMED_ALPHA,
  GRID_LINE_COLOUR,
  KIT_TINT,
  MARKER_FILL_COLOUR,
  OWN_PLATE_TEXT_COLOUR,
  RELATION_OTHER_COLOUR,
  OutpostKit,
  appearanceOf,
  hexWidthAt,
  type CellAppearance,
  type MapViewerContext,
} from "./cellVisuals";
import { LabelLayer, type LabelRequest, type TextPool } from "./LabelLayer";
import {
  DOME_ABOVE_FOOT,
  DOME_HEIGHT,
  DOME_WIDTH,
  ENVELOPE_HEIGHT,
  ENVELOPE_WIDTH,
  ICON_UNIT,
  MARKER_UNIT,
  SLIM_PLATE_HALF_HEIGHT,
  TICK_HEIGHT,
  TICK_WIDTH,
  WORKER_SIZE,
  type MapAtlas,
} from "./mapAtlas";
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
 * swords for a player who has attacked the viewer, see `cellVisuals.ts`).
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

/**
 * Flash's protection extras (#338) are all sized from one scale: our building's
 * height over Flash's outpost picture height (61 px). Flash's dome is then
 * 80 x 64 of those (a wide, low half-dome, 1.3x as wide and 1.05x as tall as
 * the tower), its truce tick 21 x 17 and its idle worker 28 x 28. Sizing from
 * the height only keeps the shape right although our tower is slimmer than
 * Flash's.
 */
const FLASH_TOWER_HEIGHT = 61;
/** The idle worker stands at the dome's right edge, this fraction of the dome height above the foot. */
const WORKER_Y_FRACTION = 0.3;

/** The gold level star every player cell wears (#334), tucked at the tower's upper left. */
const STAR_RADIUS = CELL_HEIGHT * 0.19;
const STAR_TEXT_SIZE = CELL_HEIGHT * 0.2;
const STAR_COLOUR = 0xf2c230;

/** Opacity of other players' labels. */
const PLATE_ALPHA = 0.92;

/**
 * Alpha on the hairline between cells: lighter than it was, so the grid
 * recedes behind the camps (#176).
 */
const GRID_ALPHA = 0.2;

/**
 * Flash-style slim name label (owner pick, 2026-10-08): a thin rectangle under
 * the tower, a small star at the tower's upper left, and the tower seated low
 * in its hex.
 */
const FOOT_Y = CELL_HEIGHT * 0.27;
const LABEL_Y = CELL_HEIGHT * 0.36;
const LABEL_TEXT_SIZE = 8;
const LABEL_PADDING = 3;
const STAR_SCALE = 0.58;
/** Dark text on the white label other players get. */
const LABEL_DARK_TEXT = 0x1b2733;
const GOLD_PLATE = 0xd4af37;

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
   * A cell under damage protection wears Flash's glass dome over its building
   * (#338), an active truce a small green tick, and the player's own outpost
   * with a free worker the little blue worker. All three are drawn in `bases`
   * so they sit over the building but under the star and the plate (both in
   * later layers), and dim with the rest of the cell under the kit filter.
   */
  private addPlayer(appearance: CellAppearance, x: number, y: number): void {
    const alpha = appearance.dimmed ? DIMMED_ALPHA : 1;
    const outpost = appearance.marker === CellMarker.OUTPOST;
    const footX = x;
    const footY = y + FOOT_Y;
    const flashScale = BUILDING_HEIGHT / FLASH_TOWER_HEIGHT;

    const texture = this.buildings.textureFor(
      outpost ? BuildingKind.OUTPOST : BuildingKind.YARD,
      appearance.hallLevel,
    );
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

      if (appearance.protected) {
        const dome = new Sprite(this.atlas.protectionDome);
        // The baked tile has 2 units of padding on every side; the foot is DOME_ABOVE_FOOT + 2 below its top.
        dome.anchor.set(0.5, (DOME_ABOVE_FOOT + 2) / (DOME_HEIGHT + 4));
        // Sized from the tower's full drawn bounds so the glass encloses it, spire and all.
        const { scaleX, scaleY } = domeScale(sprite.width, sprite.height);
        dome.setSize((DOME_WIDTH + 4) * scaleX, (DOME_HEIGHT + 4) * scaleY);
        dome.position.set(footX, footY);
        dome.alpha = alpha;
        this.bases.addChild(dome);
      }

      if (appearance.truce) {
        const tick = new Sprite(this.atlas.truceTick);
        tick.anchor.set(0.5);
        tick.setSize((TICK_WIDTH + 2) * flashScale, (TICK_HEIGHT + 2) * flashScale);
        tick.position.set(footX + sprite.width * 0.5, footY - sprite.height * 0.8);
        tick.alpha = alpha;
        this.bases.addChild(tick);
      }

      if (appearance.idleWorker) {
        const worker = new Sprite(this.atlas.idleWorker);
        worker.anchor.set(0.5);
        worker.setSize((WORKER_SIZE + 4) * flashScale, (WORKER_SIZE + 4) * flashScale);
        worker.position.set(footX + (DOME_WIDTH / 2) * flashScale, footY - DOME_ABOVE_FOOT * flashScale * WORKER_Y_FRACTION);
        worker.alpha = alpha;
        this.bases.addChild(worker);
      }
    }

    if (appearance.invitePending) {
      // Flash's open envelope, at the tower's upper left (the tick sits upper right, the worker lower right).
      const envelope = new Sprite(this.atlas.inviteEnvelope);
      envelope.anchor.set(0.5);
      envelope.setSize((ENVELOPE_WIDTH + 2) * flashScale, (ENVELOPE_HEIGHT + 2) * flashScale);
      envelope.position.set(footX - BUILDING_HEIGHT * 0.34, footY - BUILDING_HEIGHT * 0.66);
      envelope.rotation = 0.2; // Flash tilts it a little clockwise
      envelope.alpha = alpha;
      this.bases.addChild(envelope);
    }

    // The gold level star every player cell wears (#334).
    const starRadius = STAR_RADIUS * STAR_SCALE;
    const starX = footX - BUILDING_HEIGHT * 0.3;
    const starY = footY - BUILDING_HEIGHT * 0.82;
    const star = icon(this.atlas.star, starX, starY, starRadius, STAR_COLOUR);
    star.alpha = alpha;
    this.badgeDiscs.addChild(star);
    this.requests.push({
      text: appearance.star,
      x: starX,
      y: starY,
      size: STAR_TEXT_SIZE * STAR_SCALE,
      maxWidth: starRadius * 1.6,
      alpha,
    });

    if (appearance.plate === "") return;
    const py = y + LABEL_Y;
    const height = SLIM_PLATE_HALF_HEIGHT * 2;
    // Capped to the hex's width at the label's lower edge, so it never spills into a neighbour.
    const maxTotalWidth = hexWidthAt(py - y + SLIM_PLATE_HALF_HEIGHT * 0.5);
    const whiteLabel = appearance.plateColour === RELATION_OTHER_COLOUR;
    const gold = appearance.plateColour === GOLD_PLATE;
    this.requests.push({
      text: appearance.plate,
      x,
      y: py,
      size: LABEL_TEXT_SIZE,
      minSize: LABEL_TEXT_SIZE * 0.7,
      maxWidth: Math.max(maxTotalWidth - LABEL_PADDING * 2, height),
      alpha,
      light: true,
      dark: whiteLabel ? LABEL_DARK_TEXT : gold ? OWN_PLATE_TEXT_COLOUR : 0xffffff,
      measured: (width) => this.addLabel(x, py, width, maxTotalWidth, appearance, alpha),
    });
  }

  /** The thin rectangle behind a name: white for others, the relation colour otherwise. */
  private addLabel(
    x: number,
    y: number,
    textWidth: number,
    maxTotalWidth: number,
    appearance: CellAppearance,
    alpha: number,
  ): void {
    const height = SLIM_PLATE_HALF_HEIGHT * 2;
    const total = Math.min(Math.max(textWidth + LABEL_PADDING * 2, height * 1.5), maxTotalWidth);
    const plate = new NineSliceSprite({
      texture: this.atlas.plateRect,
      leftWidth: SLIM_PLATE_HALF_HEIGHT,
      rightWidth: SLIM_PLATE_HALF_HEIGHT,
      topHeight: SLIM_PLATE_HALF_HEIGHT,
      bottomHeight: SLIM_PLATE_HALF_HEIGHT,
    });
    plate.width = total;
    plate.height = height;
    plate.position.set(x - total / 2, y - SLIM_PLATE_HALF_HEIGHT);
    plate.tint = appearance.plateColour === RELATION_OTHER_COLOUR ? 0xffffff : appearance.plateColour;
    plate.alpha = (appearance.own ? 1 : PLATE_ALPHA) * alpha;
    this.plates.addChild(plate);
  }
}

/**
 * How big the protection dome's baked picture is drawn so the glass encloses
 * the whole tower (spire included) with a margin: tall enough for the full
 * drawn height, wide enough that the tower's upper body sits inside the
 * ellipse the picture draws (see `drawDome`).
 */
const domeScale = (towerWidth: number, towerHeight: number): { scaleX: number; scaleY: number } => {
  const floorCentre = 16; // units above the foot
  const domeRy = 35;
  const scaleY = (towerHeight * 1.1) / DOME_ABOVE_FOOT;
  // Probes down the tower: [half-width fraction of its width, height fraction].
  const probes: [number, number][] = [
    [0.5, 0.55],
    [0.4, 0.8],
    [0.2, 1],
  ];
  let scaleX = scaleY;
  for (const [widthFraction, heightFraction] of probes) {
    const dy = (towerHeight * heightFraction) / scaleY - floorCentre;
    const inside = 0.85 - (dy / domeRy) ** 2;
    if (inside <= 0.05) continue;
    scaleX = Math.max(scaleX, (towerWidth * widthFraction) / ((DOME_WIDTH / 2) * Math.sqrt(inside)));
  }
  return { scaleX, scaleY };
};

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
