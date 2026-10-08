import { BitmapFontManager, BitmapText, Container } from "pixi.js";

/**
 * The text on the map: camps' level badges and players' name plates.
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
 * Since the calm map (#176, R-MR2-Map-A) no camp carries a name: its level
 * sits on a round badge on its picture, and only players, who are few and
 * whose names matter, keep a plate under their marker. The chunk decides
 * where each piece of text goes; this only sets it and sizes it.
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

/**
 * The same face without the outline, for dark words on the player's own cyan
 * plate (#176): tinting the outlined font dark would thicken it into a blot.
 */
const PLAIN_FONT = "MapRoomLabelPlain";

/** Thinner, regular-weight faces for the slim ?plateStyle options: plain, and outlined. */
const LIGHT_PLAIN_FONT = "MapRoomLabelLightPlain";
const LIGHT_FONT = "MapRoomLabelLight";
const LIGHT_FAMILY = "Segoe UI, Arial, sans-serif";

let fontInstalled = false;

const installFont = (): void => {
  if (fontInstalled) return;
  fontInstalled = true;
  BitmapFontManager.install({
    name: PLAIN_FONT,
    style: { fontFamily: "Titan One, sans-serif", fontSize: ATLAS_FONT_PX, fill: 0xffffff },
    resolution: 2,
    chars: BitmapFontManager.ASCII,
  });
  BitmapFontManager.install({
    name: LIGHT_PLAIN_FONT,
    style: { fontFamily: LIGHT_FAMILY, fontSize: ATLAS_FONT_PX, fontWeight: "600", fill: 0xffffff },
    resolution: 2,
    chars: BitmapFontManager.ASCII,
  });
  BitmapFontManager.install({
    name: LIGHT_FONT,
    style: {
      fontFamily: LIGHT_FAMILY,
      fontSize: ATLAS_FONT_PX,
      fontWeight: "600",
      fill: 0xffffff,
      stroke: { color: 0x0d1017, width: 5, join: "round" },
    },
    resolution: 2,
    chars: BitmapFontManager.ASCII,
  });
  BitmapFontManager.install({
    name: MAP_FONT,
    style: {
      fontFamily: "Titan One, sans-serif",
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

/** One piece of text: what, where, how big, and at most how wide. */
export interface LabelRequest {
  text: string;
  /** Centre of the text, in world units. */
  x: number;
  y: number;
  /** Line height it is drawn at, in world units. */
  size: number;
  /** Widest it may be, in world units; it shrinks to fit. */
  maxWidth: number;
  /**
   * Smallest line height it may shrink to, in world units. Past that it keeps
   * this size and is cut short with "..." instead, so a long name stays
   * readable. Absent: it shrinks as far as it takes.
   */
  minSize?: number;
  /**
   * Dark words for the player's own cyan plate: the face without its outline,
   * tinted this colour.
   */
  dark?: number;
  /** Regular-weight face instead of the heavy one (slim ?plateStyle options). */
  light?: boolean;
  /** Colours the outlined face (b option: relation colour on bare text). */
  tint?: number;
  /** Hears how wide the text came out, so a name plate can be sized behind it. */
  measured?: (width: number) => void;
  /** Faded alongside its sprites when the kit filter dims this cell (#334). Default 1. */
  alpha?: number;
}

/**
 * `text` cut from the end, with "..." (the map's ASCII font has no ellipsis
 * character), until `widthOf` says it fits `maxWidth`. Text that already fits
 * comes back as it was; at the very least one letter and the dots remain.
 */
export const truncateToFit = (text: string, widthOf: (s: string) => number, maxWidth: number): string => {
  if (widthOf(text) <= maxWidth) return text;
  for (let keep = text.length - 1; keep > 1; keep--) {
    const cut = `${text.slice(0, keep).trimEnd()}...`;
    if (widthOf(cut) <= maxWidth) return cut;
  }
  return `${text.slice(0, 1)}...`;
};

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
    text.tint = 0xffffff;
    text.alpha = 1;
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
  /** Camps' level badges and players' plate text, shown from the badge tier up. */
  readonly badges = new Container();

  private readonly borrowed: BitmapText[] = [];

  constructor(private readonly pool: TextPool) {
    this.badges.interactiveChildren = false;
  }

  /** Replaces the whole layer's text. Cheap to call; it recycles as it goes. */
  layOut(items: readonly LabelRequest[]): void {
    this.release();
    for (const item of items) this.place(item);
  }

  /** Returns every object to the pool and empties the layer. */
  release(): void {
    this.badges.removeChildren();
    for (const text of this.borrowed) this.pool.give(text);
    this.borrowed.length = 0;
  }

  private place(item: LabelRequest): void {
    const text = this.pool.take();
    this.borrowed.push(text);
    const plain = item.dark !== undefined;
    text.style.fontFamily = item.light ? (plain ? LIGHT_PLAIN_FONT : LIGHT_FONT) : plain ? PLAIN_FONT : MAP_FONT;
    text.text = item.text;
    text.tint = item.dark ?? item.tint ?? 0xffffff;
    text.alpha = item.alpha ?? 1;

    // Measured at the atlas size, then scaled to the world size it wants, or
    // smaller when that would overhang its space.
    text.scale.set(1);
    const natural = text.width;
    const wanted = item.size / ATLAS_FONT_PX;
    let scale = natural > 0 ? Math.min(wanted, item.maxWidth / natural) : wanted;
    if (item.minSize !== undefined && scale < item.minSize / ATLAS_FONT_PX) {
      // Too long even at the smallest readable size: keep that size and cut the name.
      scale = item.minSize / ATLAS_FONT_PX;
      text.text = truncateToFit(
        item.text,
        (candidate) => {
          text.text = candidate;
          return text.width;
        },
        item.maxWidth / scale,
      );
    }
    text.scale.set(scale);

    text.position.set(item.x, item.y);
    this.badges.addChild(text);
    item.measured?.(text.width);
  }
}
