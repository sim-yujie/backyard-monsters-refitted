import { Assets, Rectangle, Texture } from "pixi.js";
import { classicLook } from "@/game/classicLook";
import { sheetAtQuality } from "@/game/quality";
import { LAND_ART_BASE } from "./landArt";
import { PROP_SHEET_COLUMNS, PROP_SHEET_ROWS } from "./landProps";

/**
 * The painted props of the Map Room 2 land features (forest trees, rocks,
 * marsh goo and reeds, resource piles), one sheet of 8 x 4 frames painted with
 * Codex and keyed by `web/tools/land-art/build.py`.
 *
 * Painted at 4x (`land-props@4x.webp`); the Quality setting picks the @2x
 * copy on Medium and the 1x copy on Low (`game/quality.ts`), and Pixi reads the
 * size from the name so a prop is the same size on the map at every level.
 *
 * Modern look only: with the Classic look on nothing is loaded and the map
 * stays Flash's; the feature still shows in the cell pop-up.
 */
export const LAND_PROPS_URL = `${LAND_ART_BASE}land-props@4x.webp`;

/** A prop's foot on its frame: the bottom centre, 4 px (at 4x) above the edge (`build.py`). */
export const PROP_ANCHOR_X = 0.5;
export const PROP_ANCHOR_Y = 188 / 192;

export class LandSprites {
  private readonly frames: Texture[] = [];
  private pending: Promise<boolean> | null = null;

  /** `loaded` is told when the sheet arrives, so the chunks built without it are rebuilt. */
  constructor(private readonly loaded: () => void = () => {}) {}

  /** Whether the props are here to draw. */
  get ready(): boolean {
    return this.frames.length > 0;
  }

  /** A frame of the sheet (`PROP_FRAMES` in `landProps.ts`), or null before it loads. */
  frame(index: number): Texture | null {
    return this.frames[index] ?? null;
  }

  /** Fetches the sheet once; true when it arrived (never with the Classic look). */
  load(): Promise<boolean> {
    this.pending ??= this.loadOnce().then((ok) => {
      if (ok) this.loaded();
      return ok;
    });
    return this.pending;
  }

  destroy(): void {
    for (const frame of this.frames) frame.destroy();
    this.frames.length = 0;
  }

  private async loadOnce(): Promise<boolean> {
    if (classicLook()) return false;
    const url = sheetAtQuality(LAND_PROPS_URL);
    try {
      const sheet = await Assets.load<Texture>(url);
      // In points: Pixi has already divided the source by its @Nx.
      const width = sheet.source.width / PROP_SHEET_COLUMNS;
      const height = sheet.source.height / PROP_SHEET_ROWS;
      for (let index = 0; index < PROP_SHEET_COLUMNS * PROP_SHEET_ROWS; index++) {
        const frame = new Rectangle(
          (index % PROP_SHEET_COLUMNS) * width,
          Math.floor(index / PROP_SHEET_COLUMNS) * height,
          width,
          height,
        );
        this.frames.push(new Texture({ source: sheet.source, frame }));
      }
      return true;
    } catch (caught) {
      console.warn(`The map's land props (${url}) did not load.`, caught);
      return false;
    }
  }
}
