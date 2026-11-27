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
 * The props round the plot in an event's dress-up: at Thanksgiving
 * (`thanksgivingSkin.ts`) painted hay bales, corn shocks, pumpkin piles and
 * cornucopias in the Modern look, or Flash's own scarecrow, pumpkins, acorns
 * and pinecones in the Classic look; at Christmas (`winterSkin.ts`) snowmen,
 * present piles and Christmas trees, each look its own pictures.
 *
 * They stand just outside the plot's edge, among the buildings by depth (so
 * one in front of the plot's bottom edge is drawn over a building's foot, and
 * one behind the top edge under it), take no clicks, and never move: a few
 * dozen still sprites, laid once per yard.
 */

/** One picture of a prop: a whole file, or a `frame` of it, drawn at `scale`, offset from the spot. */
export interface DressPiece {
  readonly url: string;
  readonly frame?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly dx: number;
  readonly dy: number;
  readonly scale: number;
}

/** An event's props: which stand where along the plot edge, and each one's pictures by look. */
export interface DressUpSet<P extends string = string> {
  /** Names the set, so a redraw of the same yard keeps what is laid. */
  readonly id: string;
  /** The props laid along the plot edge, in turn, and the gap between them (world px): `propSpots`. */
  readonly props: { readonly pattern: readonly P[]; readonly spacing: number };
  /** Each prop's pictures, in the Classic look or the Modern. */
  readonly pieces: (classic: boolean) => Readonly<Record<P, readonly DressPiece[]>>;
}

/** Thanksgiving's props as a {@link DressUpSet}: the painted sheet (Modern) or Flash's decorations (Classic). */
export const thanksgivingDressUp = (skin: ThanksgivingSkin): DressUpSet<PropName> => ({
  id: `thanksgiving-${skin.id}`,
  props: skin.props,
  pieces: (classic) => {
    const out = {} as Record<PropName, readonly DressPiece[]>;
    for (const name of ["hay", "corn", "pumpkins", "cornucopia"] as const) {
      out[name] = classic
        ? CLASSIC_PROPS[name].map((one) => ({ ...one, scale: 1 }))
        : [{ url: PROPS_ART, frame: PROP_BOXES[name], dx: 0, dy: 0, scale: PROP_SCALE }];
    }
    return out;
  },
});

interface Placed {
  readonly sprite: Sprite;
}

export class YardDressUp {
  private placed: Placed[] = [];
  /** The files that loaded, by URL. */
  private readonly files = new Map<string, Texture>();
  /** Framed pieces of them, by URL and frame. */
  private readonly frames = new Map<string, Texture>();
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
   * Lays the set's props round a plot, or takes them away (`set` null: no
   * event dress-up, or an Inferno yard). A no-op when the same yard, set and
   * look are already laid; otherwise the pictures load first.
   */
  async layout(bounds: YardBounds | null, seed: number, set: DressUpSet | null, classic: boolean): Promise<void> {
    const want = bounds && set ? `${set.id}:${classic ? "c" : "m"}:${seed}:${bounds.corners.map((p) => `${p.x},${p.y}`).join(";")}` : "";
    if (want === this.laidFor) {
      // The yard redrew and emptied the building layer: stand them back.
      for (const { sprite } of this.placed) this.stage.addGuest(sprite);
      return;
    }
    const generation = ++this.generation;
    this.clear();
    this.laidFor = want;
    if (!bounds || !set) return;

    const spots = propSpots(set, bounds.corners, seed);
    if (spots.length === 0) return;
    const pieces = set.pieces(classic);
    await this.load([...new Set(spots.flatMap((spot) => pieces[spot.prop]!.map((one) => one.url)))]);
    if (generation !== this.generation) return;

    spots.forEach((spot, index) => {
      for (const one of pieces[spot.prop]!) {
        const texture = this.textureOf(one);
        if (texture) this.stand(texture, spot.x + one.dx, spot.y + one.dy, one.scale, index);
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

  /** The piece's picture: the whole file, or its frame of it; null if the file did not load. */
  private textureOf(one: DressPiece): Texture | null {
    const file = this.files.get(one.url);
    if (!file || !one.frame) return file ?? null;
    const { x, y, w, h } = one.frame;
    const key = `${one.url}#${x},${y},${w},${h}`;
    let framed = this.frames.get(key);
    if (!framed) {
      framed = new Texture({ source: file.source, frame: new Rectangle(x, y, w, h) });
      this.frames.set(key, framed);
    }
    return framed;
  }

  private async load(urls: readonly string[]): Promise<void> {
    await Promise.all(
      urls
        .filter((url) => !this.files.has(url))
        .map((url) =>
          Assets.load<Texture>(url).then(
            (texture) => void this.files.set(url, texture),
            (caught: unknown) => console.warn(`Yard prop ${url} did not load; that prop is left out.`, caught),
          ),
        ),
    );
  }
}
