import { Assets, Rectangle, Sprite, Texture } from "pixi.js";
import {
  CLASSIC_PROPS,
  PROP_BOXES,
  PROP_SCALE,
  PROPS_ART,
  propSpots,
  type PropName,
  type ThanksgivingSkin,
} from "./thanksgivingSkin";
import type { TurkeyStage } from "./YardTurkeys";
import { depthKey, type YardBounds } from "./YardGrid";

/**
 * The Thanksgiving props round the plot (`thanksgivingSkin.ts`): painted hay
 * bales, corn shocks, pumpkin piles and cornucopias in the Modern look, or
 * Flash's own scarecrow, pumpkins, acorns and pinecones in the Classic look.
 *
 * They stand just outside the plot's edge, among the buildings by depth (so
 * one in front of the plot's bottom edge is drawn over a building's foot, and
 * one behind the top edge under it), take no clicks, and never move: a few
 * dozen still sprites, laid once per yard.
 */

interface Placed {
  readonly sprite: Sprite;
}

export class YardDressUp {
  private placed: Placed[] = [];
  private painted: Partial<Record<PropName, Texture>> | null = null;
  private readonly flash = new Map<string, Texture>();
  /** What is laid now, so a redraw of the same yard keeps it. */
  private laidFor = "";
  /** A newer `layout` makes an older one's late pictures moot. */
  private generation = 0;

  constructor(private readonly stage: TurkeyStage) {}

  /** How many sprites stand round the plot. */
  get count(): number {
    return this.placed.length;
  }

  /**
   * Lays the look's props round a plot, or takes them away (`skin` null: not
   * Thanksgiving, or an Inferno yard). A no-op when the same yard, look and
   * art style are already laid; otherwise the pictures load first.
   */
  async layout(bounds: YardBounds | null, seed: number, skin: ThanksgivingSkin | null, classic: boolean): Promise<void> {
    const want = bounds && skin ? `${skin.id}:${classic ? "c" : "m"}:${seed}:${bounds.corners.map((p) => `${p.x},${p.y}`).join(";")}` : "";
    if (want === this.laidFor) {
      // The yard redrew and emptied the building layer: stand them back.
      for (const { sprite } of this.placed) this.stage.addGuest(sprite);
      return;
    }
    const generation = ++this.generation;
    this.clear();
    this.laidFor = want;
    if (!bounds || !skin) return;

    const spots = propSpots(skin, bounds.corners, seed);
    if (classic) {
      const urls = [...new Set(spots.flatMap((spot) => CLASSIC_PROPS[spot.prop].map((piece) => piece.url)))];
      await this.loadFlash(urls);
    } else {
      await this.loadPainted();
    }
    if (generation !== this.generation) return;

    spots.forEach((spot, index) => {
      if (classic) {
        for (const piece of CLASSIC_PROPS[spot.prop]) {
          const texture = this.flash.get(piece.url);
          if (texture) this.stand(texture, spot.x + piece.dx, spot.y + piece.dy, 1, index);
        }
      } else {
        const texture = this.painted?.[spot.prop];
        if (texture) this.stand(texture, spot.x, spot.y, PROP_SCALE, index);
      }
    });
  }

  /** Takes every prop away. */
  clear(): void {
    for (const { sprite } of this.placed) {
      this.stage.removeGuest(sprite);
      sprite.destroy();
    }
    this.placed = [];
    this.laidFor = "";
  }

  destroy(): void {
    this.generation++;
    this.clear();
  }

  private stand(texture: Texture, x: number, y: number, scale: number, index: number): void {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.92);
    sprite.scale.set(scale);
    sprite.position.set(Math.round(x), Math.round(y));
    sprite.eventMode = "none";
    sprite.zIndex = depthKey(Math.round(x), Math.round(y), 900 + (index % 100)) * 8;
    this.stage.addGuest(sprite);
    this.placed.push({ sprite });
  }

  private async loadPainted(): Promise<void> {
    if (this.painted) return;
    try {
      const sheet = await Assets.load<Texture>(PROPS_ART);
      const painted: Partial<Record<PropName, Texture>> = {};
      for (const name of ["hay", "corn", "pumpkins", "cornucopia"] as const) {
        const box = PROP_BOXES[name];
        painted[name] = new Texture({ source: sheet.source, frame: new Rectangle(box.x, box.y, box.w, box.h) });
      }
      this.painted = painted;
    } catch (caught) {
      console.warn("The Thanksgiving props did not load; the plot edge stays bare.", caught);
    }
  }

  private async loadFlash(urls: readonly string[]): Promise<void> {
    await Promise.all(
      urls
        .filter((url) => !this.flash.has(url))
        .map((url) =>
          Assets.load<Texture>(url).then(
            (texture) => void this.flash.set(url, texture),
            (caught: unknown) => console.warn(`Flash decoration ${url} did not load.`, caught),
          ),
        ),
    );
  }
}
