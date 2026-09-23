import { BitmapFontManager, BitmapText, Container } from "pixi.js";
import { CELL_HEIGHT, CELL_WIDTH } from "@/config";
import type { Point } from "@/game/HexGrid";

/**
 * The text on the map: level badges and owner or tribe names.
 *
 * One of these belongs to each chunk, so text is laid out when a chunk is
 * built and never again while the player pans. The objects themselves come
 * from a pool shared by every chunk, because a `BitmapText` is the most
 * expensive thing on this screen to construct and an evicted chunk's text is
 * exactly what the next chunk needs.
 *
 * BitmapText rather than Text: bitmap text shares one dynamically generated
 * font atlas, so a screen full of labels is a handful of draw calls instead of
 * a texture upload per string.
 *
 * ## Fitting the hex
 *
 * The text budget is the hex's inner width, `CELL_WIDTH * 0.7`. That is not an
 * arbitrary fraction: a flat-top hex narrows by one unit of half-width for
 * every unit below the centre line, and the name line's lower edge sits
 * 22.25 units down, where the hex is 105.5 across against a 105 budget. So a
 * name that fits the budget fits the shape, at the widest point it occupies.
 *
 * Name and level go on separate lines, centred in the lower half of the hex
 * below the glyph, which is what keeps "Dreadnaut 44" inside its own cell
 * instead of over its neighbour's.
 */

/**
 * Font size the bitmap atlas is generated at.
 *
 * Text is drawn far smaller than this and scaled down. Generating the atlas at
 * the size it is drawn would leave it soft at MAX_ZOOM, where a 16 unit name is
 * 40 screen pixels tall.
 */
const ATLAS_FONT_PX = 32;

/**
 * The installed font every label shares.
 *
 * Pixi keys a dynamically generated bitmap font by the *style object* as soon
 * as the style carries a stroke, so handing each `BitmapText` an inline style
 * would rasterise a new font atlas per label — several hundred of them on one
 * screen. Installing one under a name puts every label on the same atlas, and
 * `BitmapText` then only has to name it.
 */
const MAP_FONT = "MapRoomLabel";

let fontInstalled = false;

const installFont = (): void => {
  if (fontInstalled) return;
  fontInstalled = true;
  BitmapFontManager.install({
    name: MAP_FONT,
    style: {
      fontFamily: "Nunito",
      fontSize: ATLAS_FONT_PX,
      fill: 0xffffff,
      // Baked into the atlas, so it costs nothing per label and keeps white
      // text legible over sand and grass alike.
      stroke: { color: 0x0d1017, width: 4, join: "round" },
    },
    // Twice the nominal size, because a 16 unit name is 40 screen pixels at
    // MAX_ZOOM and more again on a high density display.
    resolution: 2,
    chars: BitmapFontManager.ASCII,
  });
};

/** Widest a line of text may be, in world units. */
const INNER_WIDTH = CELL_WIDTH * 0.7;

/** Name line: world size and the offset of its centre below the cell centre. */
const NAME_SIZE = 16;
const NAME_Y = CELL_HEIGHT * 0.19;

/** Level line, under the name. */
const BADGE_SIZE = 12;
const BADGE_Y = CELL_HEIGHT * 0.4;

/** Level on its own, when names are above the current level of detail. */
const BADGE_ONLY_SIZE = 16;
const BADGE_ONLY_Y = CELL_HEIGHT * 0.3;

/** Owner names longer than this are cut, because no font size would fit them. */
const MAX_NAME_CHARS = 12;

export interface LabelRequest {
  /** Short text, usually a level. Always shown when the layer is visible. */
  badge: string;
  /** Long text, shown only when `withNames` is set. */
  name: string;
  centre: Point;
}

/**
 * Shared store of idle `BitmapText` objects.
 *
 * One per renderer, handed to every chunk. Steady-state panning builds and
 * evicts chunks at the same rate, so after the first screenful this never
 * constructs anything.
 */
export class TextPool {
  private readonly idle: BitmapText[] = [];
  private live = 0;

  /** How many objects are checked out, for the renderer's text budget. */
  get inUse(): number {
    return this.live;
  }

  take(): BitmapText {
    this.live += 1;
    const existing = this.idle.pop();
    if (existing) return existing;

    installFont();
    const text = new BitmapText({
      text: "",
      style: { fontFamily: MAP_FONT, fontSize: ATLAS_FONT_PX },
    });
    text.anchor.set(0.5, 0.5);
    return text;
  }

  give(text: BitmapText): void {
    this.live -= 1;
    text.text = "";
    this.idle.push(text);
  }

  destroy(): void {
    for (const text of this.idle) text.destroy();
    this.idle.length = 0;
    this.live = 0;
  }
}

/** One chunk's worth of map text. */
export class LabelLayer {
  /** Level badges, shown from the badge tier up. */
  readonly badges = new Container();
  /** Owner and tribe names, shown only at the label tier. */
  readonly names = new Container();

  private readonly borrowed: BitmapText[] = [];

  constructor(private readonly pool: TextPool) {
    this.badges.interactiveChildren = false;
    this.names.interactiveChildren = false;
  }

  /** Replaces the whole layer's text. Cheap to call; it recycles as it goes. */
  layOut(items: readonly LabelRequest[], withNames: boolean): void {
    this.release();

    for (const item of items) {
      if (withNames && item.name !== "") {
        this.place(this.names, truncate(item.name), NAME_SIZE, item.centre, NAME_Y);
        this.place(this.badges, item.badge, BADGE_SIZE, item.centre, BADGE_Y);
      } else {
        this.place(this.badges, item.badge, BADGE_ONLY_SIZE, item.centre, BADGE_ONLY_Y);
      }
    }
  }

  /** Returns every object to the pool and empties both containers. */
  release(): void {
    this.badges.removeChildren();
    this.names.removeChildren();
    for (const text of this.borrowed) this.pool.give(text);
    this.borrowed.length = 0;
  }

  private place(
    into: Container,
    content: string,
    worldSize: number,
    centre: Point,
    offsetY: number,
  ): void {
    const text = this.pool.take();
    this.borrowed.push(text);
    text.text = content;

    // Measured at the atlas size, then scaled to the world size it wants, or
    // smaller when that would overhang the hex.
    text.scale.set(1);
    const natural = text.width;
    const wanted = worldSize / ATLAS_FONT_PX;
    text.scale.set(natural > 0 ? Math.min(wanted, INNER_WIDTH / natural) : wanted);

    text.position.set(centre.x, centre.y + offsetY);
    into.addChild(text);
  }
}

const truncate = (value: string): string =>
  value.length > MAX_NAME_CHARS ? `${value.slice(0, MAX_NAME_CHARS)}…` : value;
