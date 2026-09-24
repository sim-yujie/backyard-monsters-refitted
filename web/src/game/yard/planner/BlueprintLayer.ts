import { BitmapFontManager, BitmapText, Container, Graphics } from "pixi.js";
import type { Point, Rect } from "../YardGrid";
import { yardSize } from "../YardGrid";
import type { Yard, YardBuilding } from "../yardModel";
import {
  BLUEPRINT_WORLD,
  blueprintToWorld,
  centredRect,
  OBSTACLE_COLOURS,
  rectContains,
  rectCorners,
  TILE_COLOURS,
  tileCategory,
  tileLabel,
  tileRect,
} from "./blueprint";
import type { Corners } from "./marquee";
import { DECORATION_HEIGHT, DECORATION_WIDTH, isDecoration } from "./placement";
import { dashedRect } from "./PlannerOverlay";

/**
 * The blueprint view's scene graph: flat ground, a grid, the plot and its next
 * expansion, one tile per building and one blob per mushroom.
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
 * The smaller of the two label sizes is 9 px and the name is 11 px, and text
 * under about 6 screen pixels is a smear rather than a word: 6 / 11 is 0.55.
 * Pulled back past that the tiles are read as coloured blocks anyway, which is
 * what a whole-yard overview is for.
 */
const LABEL_MIN_ZOOM = 0.55;

interface Tile {
  readonly building: YardBuilding;
  readonly root: Container;
  /** The name and level text, or null when the tile carries neither. */
  readonly labels: Container | null;
  /** The level text alone, which a planned upgrade rewrites; null when absent. */
  readonly levelText: BitmapText | null;
  /** What that text says with nothing planned, so the arrow can be taken off. */
  readonly levelBase: string;
  /** Where the tile is drawn right now, in yard units. */
  x: number;
  y: number;
}

export class BlueprintLayer {
  readonly root = new Container();

  private readonly ground = new Graphics();
  private readonly obstacles = new Graphics();
  private readonly tiles = new Container();
  private readonly byId = new Map<number, Tile>();
  /** Draw order, so `pick` can walk it backwards. */
  private order: Tile[] = [];

  private yard: Yard | null = null;
  private built = false;
  /** Whether the labels are showing; `setZoom` is the only thing that sets it. */
  private labelsVisible = true;
  /**
   * Planned target level by building id, or null when the planner is closed.
   *
   * Held rather than applied and forgotten, because the tiles are rebuilt
   * whenever the yard is — a batch wall upgrade does exactly that with the
   * planner still open — and a badge that vanished on a rebuild would look
   * like the plan had been lost.
   */
  private planned: ReadonlyMap<number, number> | null = null;

  constructor() {
    this.root.visible = false;
    this.root.eventMode = "none";
    this.root.addChild(this.ground, this.obstacles, this.tiles);
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
   * Tells the layer the camera's zoom, which decides whether the tile labels
   * are worth drawing.
   *
   * Only the crossing costs anything: the flag is compared first, so the loop
   * over the tiles runs twice in a zoom from the plot to a single building
   * rather than once per wheel notch.
   */
  setZoom(zoom: number): void {
    const visible = zoom >= LABEL_MIN_ZOOM;
    if (visible === this.labelsVisible) return;
    this.labelsVisible = visible;
    for (const tile of this.byId.values()) {
      if (tile.labels) tile.labels.visible = visible;
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

  /** Puts every tile back where the save had its building. */
  reset(): void {
    for (const tile of this.byId.values()) {
      this.place(tile.building.id, tile.building.x, tile.building.y);
    }
  }

  /** The topmost building whose tile is under a world point, or null. */
  pick(worldX: number, worldY: number): YardBuilding | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const tile = this.order[i];
      if (!tile) continue;
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
    const colours = TILE_COLOURS[tileCategory(building.type, isDecoration(building.type))];

    const root = new Container();
    const world = blueprintToWorld(building.x, building.y);
    root.position.set(world.x, world.y);

    const shape = new Graphics();
    shape
      .rect(1, 1, width - 2, height - 2)
      .fill({ color: colours.fill })
      .stroke({ width: 2, color: colours.edge, alignment: 1 });
    root.addChild(shape);

    // The text goes in a container of its own so a zoom change is one
    // `visible` write per tile rather than a walk of its children.
    const labels = new Container();
    const label = tileLabel(building.name, building.level, width);
    let levelText: BitmapText | null = null;
    let levelBase = "";
    if (label.name) {
      const name = new BitmapText({
        text: label.name,
        style: { fontFamily: FONT, fontSize: 11 },
      });
      name.anchor.set(0.5, 0.5);
      name.position.set(width / 2, height / 2 - (label.level ? 5 : 0));
      labels.addChild(name);
    }
    if (label.level && width >= MIN_LEVELLED_WIDTH) {
      levelBase = label.name ? `Lv ${label.level}` : label.level;
      const level = new BitmapText({
        text: levelBase,
        style: { fontFamily: FONT, fontSize: label.name ? 9 : 11 },
      });
      level.anchor.set(0.5, 0.5);
      level.position.set(width / 2, label.name ? height / 2 + 8 : height / 2);
      labels.addChild(level);
      levelText = level;
    }

    const lettered = labels.children.length > 0;
    if (lettered) {
      labels.visible = this.labelsVisible;
      root.addChild(labels);
    } else {
      labels.destroy();
    }

    this.tiles.addChild(root);
    const tile: Tile = {
      building,
      root,
      labels: lettered ? labels : null,
      levelText,
      levelBase,
      x: building.x,
      y: building.y,
    };
    this.byId.set(building.id, tile);
    this.order.push(tile);
    this.labelPlan(tile);
  }

  /** Writes "3→5" on a planned tile's level, or the plain level on the rest. */
  private labelPlan(tile: Tile): void {
    const text = tile.levelText;
    if (!text) return;
    const target = this.planned?.get(tile.building.id);
    text.text = target === undefined ? tile.levelBase : `${tile.levelBase}→${target}`;
  }

  private clearTiles(): void {
    for (const child of this.tiles.removeChildren()) child.destroy({ children: true });
    this.byId.clear();
    this.order = [];
  }
}
