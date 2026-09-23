import { BitmapText, Container } from "pixi.js";
import { MAX_TEXT_OBJECTS } from "@/config";
import { mapRoomGrid, type Point } from "@/game/HexGrid";

/**
 * The text on the map: level badges and owner or tribe names.
 *
 * Text is the expensive part of this screen. Every string is its own display
 * object with its own transform, so the layer keeps a pool and rewrites the
 * objects it already has rather than building new ones each rebuild.
 *
 * BitmapText rather than Text: bitmap text shares one dynamically generated
 * font atlas, so a screen full of labels is a handful of draw calls instead of
 * a texture upload per string.
 */

export interface LabelRequest {
  /** Short text, usually a level. Always shown when the layer is visible. */
  badge: string;
  /** Long text, shown only when `withNames` is set. */
  name: string;
  centre: Point;
}

export class LabelLayer {
  readonly container = new Container();

  private readonly pool: BitmapText[] = [];

  constructor() {
    // Nothing here is clickable; the canvas underneath handles selection.
    this.container.interactiveChildren = false;
  }

  set visible(value: boolean) {
    this.container.visible = value;
  }

  /** Rewrites the pool from `items`, hiding whatever is left over. */
  layOut(items: LabelRequest[], withNames: boolean): void {
    const limit = Math.min(items.length, MAX_TEXT_OBJECTS);

    for (let index = 0; index < limit; index++) {
      const item = items[index]!;
      const text = this.at(index);
      text.text = withNames && item.name !== "" ? `${item.name} ${item.badge}` : item.badge;
      text.visible = true;
      text.position.set(item.centre.x, item.centre.y + mapRoomGrid.cellHeight * 0.34);
    }

    for (let index = limit; index < this.pool.length; index++) {
      this.pool[index]!.visible = false;
    }
  }

  private at(index: number): BitmapText {
    const existing = this.pool[index];
    if (existing) return existing;

    const text = new BitmapText({
      text: "",
      style: { fontFamily: "Nunito", fontSize: 18, fill: 0xffffff },
    });
    text.anchor.set(0.5, 0);
    this.pool.push(text);
    this.container.addChild(text);
    return text;
  }
}
