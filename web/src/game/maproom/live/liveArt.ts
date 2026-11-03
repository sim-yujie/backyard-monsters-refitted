import { Assets, Rectangle, Texture } from "pixi.js";
import type { LivePlan } from "./liveLevel";

/**
 * The living map's painted art (Codex, `web/tools/mr2-live-kit`), fetched
 * only for the levels that draw it: Low and Classic fetch nothing, Medium the
 * half-size copies and no clouds or birds.
 */
const BASE = `${import.meta.env.BASE_URL}maproom/live/`;

/** The three clouds' widths in `clouds.webp` (256 tall), left to right; `build.py` prints them. */
const CLOUD_WIDTHS = [268, 370, 750] as const;

export interface LiveTextures {
  /** The sea's glints: white, the shape in alpha, a seamless tile. */
  water: Texture | null;
  /** Shore foam, the same way. */
  foam: Texture | null;
  /** Three clouds seen from above. */
  clouds: Texture[];
  /** Four smoke puffs. */
  smoke: Texture[];
  /** A gull from above, wings spread. */
  bird: Texture | null;
}

const empty = (): LiveTextures => ({ water: null, foam: null, clouds: [], smoke: [], bird: null });

const fetch = async (file: string): Promise<Texture | null> => {
  try {
    return await Assets.load<Texture>(BASE + file);
  } catch (caught) {
    console.warn(`The living map's ${file} did not load; that part of it stays still.`, caught);
    return null;
  }
};

/** Cuts a sheet into frames, given each frame's rectangle in the sheet's points. */
const cut = (sheet: Texture, frames: readonly Rectangle[]): Texture[] =>
  frames.map((frame) => new Texture({ source: sheet.source, frame }));

export const loadLiveArt = async (plan: LivePlan): Promise<LiveTextures> => {
  if (plan.level === "off") return empty();
  const suffix = plan.artSuffix;
  const [water, foam, clouds, smoke, bird] = await Promise.all([
    plan.water ? fetch(`water-glints${suffix}.webp`) : null,
    plan.foam ? fetch(`foam${suffix}.webp`) : null,
    plan.clouds ? fetch("clouds.webp") : null,
    plan.smoke ? fetch(`smoke${suffix}.webp`) : null,
    plan.birds ? fetch("bird.webp") : null,
  ]);

  for (const tile of [water, foam]) {
    if (!tile) continue;
    // Sampled past its edges by the water sheet's shader, so it must wrap.
    tile.source.addressMode = "repeat";
  }

  const art = empty();
  art.water = water;
  art.foam = foam;
  art.bird = bird;
  if (clouds) {
    const frames: Rectangle[] = [];
    let x = 0;
    for (const width of CLOUD_WIDTHS) {
      frames.push(new Rectangle(x, 0, Math.min(width, clouds.width - x), clouds.height));
      x += width;
    }
    art.clouds = cut(clouds, frames);
  }
  if (smoke) {
    const half = smoke.width / 2;
    art.smoke = cut(smoke, [
      new Rectangle(0, 0, half, half),
      new Rectangle(half, 0, half, half),
      new Rectangle(0, half, half, half),
      new Rectangle(half, half, half, half),
    ]);
  }
  return art;
};

/** Drops the frames cut from the sheets; the sheets stay in `Assets`' cache. */
export const destroyLiveArt = (art: LiveTextures): void => {
  for (const frame of [...art.clouds, ...art.smoke]) frame.destroy(false);
  art.clouds = [];
  art.smoke = [];
};
