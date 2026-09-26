import { BitmapFontManager, BitmapText, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Point, Rect } from "../YardGrid";
import { yardSize } from "../YardGrid";
import {
  ArtState,
  resolveArt,
  type ResolvedAnim,
  type ResolvedArt,
  type ResolvedImage,
} from "../buildingArt";
import type { YardTextures } from "../YardTextures";
import type { Yard, YardBuilding } from "../yardModel";
import {
  BLUEPRINT_WORLD,
  blueprintToWorld,
  centredRect,
  MIN_NAMED_WIDTH,
  OBSTACLE_COLOURS,
  rectContains,
  rectCorners,
  stackBoxes,
  TILE_COLOURS,
  tileCategory,
  tileLabel,
  tileRect,
  tileShowsIcon,
} from "./blueprint";
import type { Corners } from "./marquee";
import { DECORATION_HEIGHT, DECORATION_WIDTH, isDecoration } from "./placement";
import { dashedRect } from "./PlannerOverlay";

/**
 * The blueprint view's scene graph: flat ground, a grid, the plot and its next
 * expansion, one tile per building and one blob per mushroom.
 *
 * A tile is its footprint in category colour with the building's own picture
 * shrunk onto it and a level pill in the corner. "Picture" is the whole stack
 * the isometric view draws — a Railgun's base *and* its gun — fitted as one
 * group so the parts stay in register. The images come from the yard's texture
 * cache, so opening the planner on a yard that is already drawn costs no
 * fetches; until they arrive — or for good, on a type the art table does not
 * know — the tile wears the shortened name instead.
 *
 * Built lazily the first time the view is shown, because most visits to the
 * yard never open the planner and a 575-tile scene is not free. After that it
 * is never rebuilt for a move: a tile is a container, and moving a building is
 * setting its position. The selection chrome is not drawn here — the planner
 * overlay draws it from `cornersOf`, the same way it does for the isometric
 * diamonds — so the two views share every outline.
 *
 * Colours after `PlannerDesignView.as` (grass 0x669633, plot 25% white with a
 * white edge, next expansion dashed) and `BuildingItem` (category tints).
 */

const GRASS = 0x669633;
const PLOT_EDGE = 0xffffff;
const GRID_LINE = 0xffffff;
/** Yard units between the faint guide lines. */
const GRID_SPACING = 100;

const FONT = "BlueprintLabel";
const FONT_PX = 24;
let fontInstalled = false;

/** Installs the one bitmap font every tile label shares; see LabelLayer. */
const installFont = (): void => {
  if (fontInstalled) return;
  fontInstalled = true;
  BitmapFontManager.install({
    name: FONT,
    style: {
      fontFamily: "Nunito",
      fontSize: FONT_PX,
      fontWeight: "700",
      fill: 0xffffff,
      stroke: { color: 0x101418, width: 4, join: "round" },
    },
    resolution: 2,
    chars: PRINTABLE_ASCII + "…",
  });
};

/** Every printable ASCII character, plus the ellipsis `tileLabel` uses. */
const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(
  "",
);

/** Mushroom footprint, `client/scripts/BUILDING7.as:9-10`. */
const MUSHROOM_SIZE = 30;

/** Tiles narrower than this get no level either. Walls. */
const MIN_LEVELLED_WIDTH = 40;

/**
 * Zoom below which the tile labels are hidden.
 *
 * The label is 9 px and the name is 11 px, and text under about 6 screen pixels
 * is a smear rather than a word: 6 / 11 is 0.55. The icons stay on past this,
 * because a silhouette survives being shrunk in a way that lettering does not.
 */
const LABEL_MIN_ZOOM = 0.55;

/**
 * Zoom below which the icons go too, leaving plain colour blocks.
 *
 * A 70 unit tile is 20 screen pixels here, which is about where a building
 * stops being a shape and starts being a speck. Hiding them is also what keeps
 * a whole-yard pan cheap: at this zoom every one of the 575 tiles is on screen
 * at once, and a hidden sprite is skipped before it reaches the batcher.
 */
const ICON_MIN_ZOOM = 0.28;

/** The level pill: inset from the tile's corner, and padding around its text. */
const PILL_INSET = 2;
const PILL_PAD_X = 3;
const PILL_PAD_Y = 1;
const PILL_FILL = 0x101418;
const PILL_ALPHA = 0.72;

/**
 * One layer of a building's art: a still picture, or cell 0 of an animation
 * strip.
 *
 * The two are fetched differently — `YardTextures.get` against
 * `YardTextures.strip` — but are drawn the same way, so the tile keeps them in
 * one list in stacking order and asks `textureOf` for whichever applies.
 */
type ArtPart =
  | { readonly kind: "image"; readonly image: ResolvedImage }
  | { readonly kind: "anim"; readonly anim: ResolvedAnim };

/**
 * The layers of a building at rest, bottom to top: its top picture and then
 * each animation strip's first cell.
 *
 * This is the stack `YardBuildings` builds, minus the shadow — the top sprite
 * with the strips added straight after it, which is what puts a Railgun's gun
 * over its base. A building whose still top is only cell 0 of its first strip
 * (types 22, 53, 105 and 129) contributes that strip once rather than twice,
 * exactly as the isometric view hides the top the moment the strip is playing.
 */
const partsOf = (art: ResolvedArt): ArtPart[] => {
  const parts: ArtPart[] = art.topIsAnim ? [] : [{ kind: "image", image: art.top }];
  for (const anim of art.anims) parts.push({ kind: "anim", anim });
  return parts;
};

interface Tile {
  readonly building: YardBuilding;
  readonly root: Container;
  /** The shortened name: the stand-in shown until an icon arrives, if ever. */
  nameText: BitmapText | null;
  /** The level pill, background and text together; null when unlevelled. */
  readonly badge: Container | null;
  /** The pill's background, redrawn when a plan makes the text wider. */
  readonly pill: Graphics | null;
  /** The level text alone, which a planned upgrade rewrites; null when absent. */
  readonly levelText: BitmapText | null;
  /** What that text says with nothing planned, so the arrow can be taken off. */
  readonly levelBase: string;
  /** The pictures this tile wants, bottom to top; empty when it wants none. */
  readonly art: readonly ArtPart[];
  /** Those pictures, drawn together, once they have all settled. */
  icon: Container | null;
  /** Where the tile is drawn right now, in yard units. */
  x: number;
  y: number;
}

export class BlueprintLayer {
  readonly root = new Container();

  private readonly ground = new Graphics();
  private readonly obstacles = new Graphics();
  /**
   * The planner's decals in this view: range discs and the centre mark.
   *
   * Between the ground and the tiles, so a disc tints the grass and never the
   * buildings, the same place the isometric view puts it. Over the tiles, 23
   * overlapping discs washed the towers in the middle of a base out of sight.
   * Only the tiles are ever rebuilt, so whatever the planner hangs here stays.
   */
  readonly decals = new Container();
  private readonly tiles = new Container();
  private readonly byId = new Map<number, Tile>();
  /** Draw order, so `pick` can walk it backwards. */
  private order: Tile[] = [];

  /** Tiles whose picture has been asked for but has not arrived yet. */
  private awaiting: Tile[] = [];
  /** Drops the texture-cache subscription when the layer goes away. */
  private readonly unwatch: () => void;
  /** Set while a sweep of `awaiting` is already queued for this tick. */
  private sweeping = false;

  private yard: Yard | null = null;
  private built = false;
  /** Whether the labels are showing; `setZoom` is the only thing that sets it. */
  private labelsVisible = true;
  /** Whether the icons are showing. Hidden further out than the labels. */
  private iconsVisible = true;
  /**
   * Planned target level by building id, or null when the planner is closed.
   *
   * Held rather than applied and forgotten, because the tiles are rebuilt
   * whenever the yard is — a batch wall upgrade does exactly that with the
   * planner still open — and a badge that vanished on a rebuild would look
   * like the plan had been lost.
   */
  private planned: ReadonlyMap<number, number> | null = null;

  /**
   * @param textures The yard's texture cache, shared rather than duplicated:
   * the blueprint draws the same pictures the isometric view does, and by the
   * time the planner is open most of them are already in it.
   */
  constructor(private readonly textures: YardTextures) {
    this.root.visible = false;
    this.root.eventMode = "none";
    this.decals.eventMode = "none";
    this.root.addChild(this.ground, this.obstacles, this.decals, this.tiles);
    this.unwatch = textures.watch(() => {
      this.scheduleSweep();
    });
  }

  /** Remembers the yard; the scene is built on the first `setActive(true)`. */
  show(yard: Yard): void {
    this.yard = yard;
    this.built = false;
    this.clearTiles();
  }

  setActive(active: boolean): void {
    if (active && !this.built) this.build();
    this.root.visible = active;
  }

  /**
   * Tells the layer the camera's zoom, which decides how much of a tile is
   * worth drawing: name and level pill, then the icon, then nothing but colour.
   *
   * Only a crossing costs anything: both flags are compared first, so the loop
   * over the tiles runs twice in a zoom from the plot to a single building
   * rather than once per wheel notch.
   */
  setZoom(zoom: number): void {
    const labels = zoom >= LABEL_MIN_ZOOM;
    const icons = zoom >= ICON_MIN_ZOOM;
    if (labels === this.labelsVisible && icons === this.iconsVisible) return;
    this.labelsVisible = labels;
    this.iconsVisible = icons;
    for (const tile of this.byId.values()) {
      if (tile.nameText) tile.nameText.visible = labels;
      if (tile.badge) tile.badge.visible = labels;
      if (tile.icon) tile.icon.visible = icons;
    }
  }

  /**
   * Marks the tiles of buildings with a planned upgrade, and clears the rest.
   *
   * The blueprint is where the level is already written, so a plan is a suffix
   * on that number — "3→5" — rather than a second mark to look for
   * (`docs/design/planner-upgrades.md` §5.4). The canvas badge is the chevron
   * `PlannerOverlay` draws; between them the plan is visible in both views and
   * in two channels, neither of them colour alone.
   *
   * A tile with no level text — a wall, or anything still building — gets
   * nothing here and keeps the chevron as its only mark.
   */
  setPlanned(planned: ReadonlyMap<number, number> | null): void {
    this.planned = planned;
    for (const tile of this.byId.values()) this.labelPlan(tile);
  }

  /** The world extent the camera roams: the decoration area plus margin. */
  worldSize(): { width: number; height: number } {
    return { width: BLUEPRINT_WORLD.width, height: BLUEPRINT_WORLD.height };
  }

  /** What "zoom to fit" frames: the plot, with a little air around it. */
  fitRect(): Rect {
    const [width, height] = yardSize(this.yard?.expansionLevel ?? 0);
    return centredRect(width / 2 + 40, height / 2 + 40);
  }

  /** The plot outline in world pixels, clockwise from the top-left. */
  plotCorners(): Corners {
    const [width, height] = yardSize(this.yard?.expansionLevel ?? 0);
    return rectCorners(centredRect(width / 2, height / 2));
  }

  /** Draws a building's tile at a yard position. */
  place(id: number, x: number, y: number): void {
    const tile = this.byId.get(id);
    if (!tile || (tile.x === x && tile.y === y)) return;
    tile.x = x;
    tile.y = y;
    const world = blueprintToWorld(x, y);
    tile.root.position.set(world.x, world.y);
  }

  /** Puts every tile back where the save had its building, and shows them all. */
  reset(): void {
    for (const tile of this.byId.values()) {
      tile.root.visible = true;
      this.place(tile.building.id, tile.building.x, tile.building.y);
    }
  }

  /**
   * Shows or hides one tile, for the planner's drawer.
   *
   * A stored building is not on the plot, so the blueprint — which is a
   * drawing of the plot and nothing else — simply does not draw it.
   */
  setHidden(id: number, hidden: boolean): void {
    const tile = this.byId.get(id);
    if (tile) tile.root.visible = !hidden;
  }

  /** The topmost building whose tile is under a world point, or null. */
  pick(worldX: number, worldY: number): YardBuilding | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const tile = this.order[i];
      if (!tile || !tile.root.visible) continue;
      if (rectContains(this.rectOf(tile), worldX, worldY)) return tile.building;
    }
    return null;
  }

  /** A building's tile corners where it is drawn now, or null. */
  cornersOf(id: number): Corners | null {
    const tile = this.byId.get(id);
    return tile ? rectCorners(this.rectOf(tile)) : null;
  }

  /** The middle of a building's tile where it is drawn now, or null. */
  centreOf(id: number): Point | null {
    const tile = this.byId.get(id);
    if (!tile) return null;
    const rect = this.rectOf(tile);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  destroy(): void {
    this.unwatch();
    this.clearTiles();
    this.root.destroy({ children: true });
  }

  /* ── Building the scene ─────────────────────────────────────────────── */

  private rectOf(tile: Tile): Rect {
    return tileRect(tile.building.type, tile.x, tile.y);
  }

  private build(): void {
    const yard = this.yard;
    if (!yard) return;
    this.built = true;
    installFont();
    this.drawGround(yard);
    this.drawObstacles(yard);
    this.clearTiles();
    for (const building of yard.buildings) this.addTile(building);
  }

  private drawGround(yard: Yard): void {
    const g = this.ground;
    g.clear();

    const area = centredRect(DECORATION_WIDTH / 2, DECORATION_HEIGHT / 2);
    g.rect(area.x, area.y, area.width, area.height).fill({ color: GRASS });

    // Guide lines every GRID_SPACING units, measured from the plot centre so a
    // line always runs through the origin.
    for (let x = area.x; x <= area.x + area.width; x += GRID_SPACING) {
      g.moveTo(x, area.y).lineTo(x, area.y + area.height);
    }
    for (let y = area.y; y <= area.y + area.height; y += GRID_SPACING) {
      g.moveTo(area.x, y).lineTo(area.x + area.width, y);
    }
    g.stroke({ width: 1, color: GRID_LINE, alpha: 0.08 });

    // The next expansion, if there is one, as a dashed outline behind the plot.
    const [width, height] = yardSize(yard.expansionLevel);
    const [nextWidth, nextHeight] = yardSize(yard.expansionLevel + 1);
    if (nextWidth > width) {
      const next = centredRect(nextWidth / 2, nextHeight / 2);
      g.rect(next.x, next.y, next.width, next.height).fill({ color: 0xffffff, alpha: 0.08 });
      dashedRect(g, next, { color: 0xeeeeee, alpha: 0.7, width: 2 });
    }

    const plot = centredRect(width / 2, height / 2);
    g.rect(plot.x, plot.y, plot.width, plot.height)
      .fill({ color: 0xffffff, alpha: 0.25 })
      .stroke({ width: 2, color: PLOT_EDGE, alpha: 1 });
  }

  private drawObstacles(yard: Yard): void {
    const g = this.obstacles;
    g.clear();
    let any = false;
    for (const mushroom of yard.mushrooms) {
      const origin = blueprintToWorld(mushroom.x, mushroom.y);
      g.roundRect(origin.x, origin.y, MUSHROOM_SIZE, MUSHROOM_SIZE, 8);
      any = true;
    }
    if (any) {
      g.fill({ color: OBSTACLE_COLOURS.fill }).stroke({
        width: 2,
        color: OBSTACLE_COLOURS.edge,
      });
    }
  }

  private addTile(building: YardBuilding): void {
    const [width, height] = building.footprint;
    const category = tileCategory(building.type, isDecoration(building.type));
    const colours = TILE_COLOURS[category];

    const root = new Container();
    const world = blueprintToWorld(building.x, building.y);
    root.position.set(world.x, world.y);

    const shape = new Graphics();
    shape
      .rect(1, 1, width - 2, height - 2)
      .fill({ color: colours.fill })
      .stroke({ width: 2, color: colours.edge, alignment: 1 });
    root.addChild(shape);

    // Walls and traps stay flat colour; everything wide enough asks the shared
    // cache for its pictures, which usually answers at once because the
    // isometric yard has already fetched them.
    const resolved = tileShowsIcon(category, width, height)
      ? resolveArt(building.type, building.level, ArtState.DEFAULT)
      : null;
    const art = resolved ? partsOf(resolved) : [];

    const label = tileLabel(building.name, building.level, width);

    // A stack is drawn all at once or not at all: a base without its gun, then
    // the gun popping in a moment later, reads as the tile changing shape.
    const gathered = this.gather(art);
    const draws = !gathered.waiting && gathered.ready.length > 0;

    // The name is the icon's understudy: built only while there is no picture
    // on the tile, and thrown away the moment one turns up.
    let nameText: BitmapText | null = null;
    if (label.name && !draws) {
      nameText = new BitmapText({
        text: label.name,
        style: { fontFamily: FONT, fontSize: 11 },
      });
      nameText.anchor.set(0.5, 0.5);
      nameText.position.set(width / 2, height / 2);
      nameText.visible = this.labelsVisible;
      root.addChild(nameText);
    }

    // The level lives in a pill in the bottom-right corner, where it sits over
    // the edge of the picture rather than across its middle.
    let badge: Container | null = null;
    let pill: Graphics | null = null;
    let levelText: BitmapText | null = null;
    let levelBase = "";
    if (label.level && width >= MIN_LEVELLED_WIDTH) {
      // "Lv 3" needs room the narrow tiles have not got, so they carry the
      // bare number, exactly as they did when the level was centred.
      levelBase = width >= MIN_NAMED_WIDTH ? `Lv ${label.level}` : label.level;
      levelText = new BitmapText({
        text: levelBase,
        style: { fontFamily: FONT, fontSize: 9 },
      });
      levelText.anchor.set(1, 1);
      levelText.position.set(width - PILL_INSET - PILL_PAD_X, height - PILL_INSET - PILL_PAD_Y);
      pill = new Graphics();
      badge = new Container();
      badge.visible = this.labelsVisible;
      badge.addChild(pill, levelText);
      root.addChild(badge);
    }

    this.tiles.addChild(root);
    const tile: Tile = {
      building,
      root,
      nameText,
      badge,
      pill,
      levelText,
      levelBase,
      art,
      icon: null,
      x: building.x,
      y: building.y,
    };
    this.byId.set(building.id, tile);
    this.order.push(tile);
    this.labelPlan(tile);

    if (draws) this.attachIcon(tile, gathered.ready);
    else if (gathered.waiting) this.awaiting.push(tile);
  }

  /* ── Icons ──────────────────────────────────────────────────────────── */

  /** The texture for one layer, or null until it arrives. Starts the fetch. */
  private textureOf(part: ArtPart): Texture | null {
    if (part.kind === "image") return this.textures.get(part.image);
    return this.textures.strip(part.anim)?.[0] ?? null;
  }

  /** True once this layer is known not to be coming. */
  private isPartMissing(part: ArtPart): boolean {
    return part.kind === "image"
      ? this.textures.isMissing(part.image)
      : this.textures.isStripMissing(part.anim);
  }

  /** Where a layer's bitmap sits relative to the building's isometric origin. */
  private static offsetOf(part: ArtPart): { x: number; y: number } {
    return part.kind === "image" ? part.image : part.anim;
  }

  /**
   * The layers of a stack that have arrived, and whether any are still coming.
   *
   * Nine strips in the props table name a file the game server does not have,
   * so "settled" is arrived *or* known missing: a Railgun whose gun is on disk
   * and a building whose third layer is not both end up drawn, the second one
   * with the layers it has.
   */
  private gather(art: readonly ArtPart[]): {
    ready: { part: ArtPart; texture: Texture }[];
    waiting: boolean;
  } {
    const ready: { part: ArtPart; texture: Texture }[] = [];
    let waiting = false;
    for (const part of art) {
      const texture = this.textureOf(part);
      if (texture) ready.push({ part, texture });
      else if (!this.isPartMissing(part)) waiting = true;
    }
    return { ready, waiting };
  }

  /**
   * Draws a tile's picture — every layer of it — fitted inside its footprint.
   *
   * The layers keep their offsets relative to each other and are scaled
   * together, so the stack lands on the tile as the same drawing the isometric
   * view shows, only smaller. They go into one container directly above the
   * coloured rectangle and below the pill, so the category is still readable
   * around the edges and the level is never hidden behind a tower.
   */
  private attachIcon(tile: Tile, ready: readonly { part: ArtPart; texture: Texture }[]): void {
    const [width, height] = tile.building.footprint;
    const boxes = stackBoxes(
      width,
      height,
      ready.map(({ part, texture }) => {
        const offset = BlueprintLayer.offsetOf(part);
        return { x: offset.x, y: offset.y, width: texture.width, height: texture.height };
      }),
    );
    if (!boxes) return;

    const icon = new Container();
    ready.forEach(({ texture }, index) => {
      const box = boxes[index];
      if (!box) return;
      const sprite = new Sprite(texture);
      sprite.position.set(box.x, box.y);
      sprite.width = box.width;
      sprite.height = box.height;
      icon.addChild(sprite);
    });
    icon.visible = this.iconsVisible;
    // Index 1: above the tile's own rectangle, under the name and the pill.
    tile.root.addChildAt(icon, 1);
    tile.icon = icon;

    tile.nameText?.destroy();
    tile.nameText = null;
  }

  /**
   * Queues one pass over the tiles still waiting for a picture.
   *
   * A yard's art arrives in bursts — a dozen textures resolving in the same
   * tick is normal — so the sweep is deferred to the end of it and the list is
   * walked once rather than a dozen times.
   */
  private scheduleSweep(): void {
    if (this.sweeping || this.awaiting.length === 0) return;
    this.sweeping = true;
    queueMicrotask(() => {
      this.sweeping = false;
      this.sweepAwaiting();
    });
  }

  /** Gives a picture to every waiting tile whose whole stack has turned up. */
  private sweepAwaiting(): void {
    if (this.awaiting.length === 0) return;
    const still: Tile[] = [];
    for (const tile of this.awaiting) {
      if (tile.icon) continue;
      const gathered = this.gather(tile.art);
      if (gathered.waiting) {
        still.push(tile);
        continue;
      }
      // Nothing more is coming: draw whatever arrived, or leave the tile with
      // its name and stop asking about it.
      if (gathered.ready.length > 0) this.attachIcon(tile, gathered.ready);
    }
    this.awaiting = still;
  }

  /* ── Labels ─────────────────────────────────────────────────────────── */

  /** Writes "3→5" on a planned tile's level, or the plain level on the rest. */
  private labelPlan(tile: Tile): void {
    const text = tile.levelText;
    if (!text) return;
    const target = this.planned?.get(tile.building.id);
    text.text = target === undefined ? tile.levelBase : `${tile.levelBase}→${target}`;
    this.drawPill(tile);
  }

  /** Sizes the pill to whatever the level text now says. */
  private drawPill(tile: Tile): void {
    const pill = tile.pill;
    const text = tile.levelText;
    if (!pill || !text) return;
    const [tileWidth, tileHeight] = tile.building.footprint;
    const width = text.width + PILL_PAD_X * 2;
    const height = text.height + PILL_PAD_Y * 2;
    pill
      .clear()
      .roundRect(
        tileWidth - PILL_INSET - width,
        tileHeight - PILL_INSET - height,
        width,
        height,
        Math.min(4, height / 2),
      )
      .fill({ color: PILL_FILL, alpha: PILL_ALPHA });
  }

  private clearTiles(): void {
    for (const child of this.tiles.removeChildren()) child.destroy({ children: true });
    this.byId.clear();
    this.order = [];
    this.awaiting = [];
  }
}
