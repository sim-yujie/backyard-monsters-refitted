import { Sprite, type Texture } from "pixi.js";
import { CELL_HEIGHT } from "@/config";
import { CellMarker } from "../cellVisuals";
import type { LiveChunk, LiveChunkLayer } from "./LiveChunk";

/**
 * Smoke rising over the places people and monsters live (MR2 part 1): a
 * thin wisp from each yard's Town Hall, and from each tribe camp's fire,
 * darker from a razed camp's embers.
 *
 * Each source is a few of Codex's painted puffs (`smoke`) on a loop, each
 * rising, swelling, drifting with the wind and fading, a fraction of the loop
 * apart. Built with the chunk; `step` only moves the puffs of the chunks on
 * screen, and nothing at all at the far zooms, where they would be specks.
 */

/** Below this zoom the smoke is hidden: a cell is under about 45 screen pixels across. */
export const SMOKE_MIN_ZOOM = 0.3;

/** Where the building stands and how tall it is drawn: `MapChunk`'s FOOT_Y and BUILDING_HEIGHT. */
const BUILDING_FOOT_Y = CELL_HEIGHT * 0.27;
const BUILDING_HEIGHT = CELL_HEIGHT * 0.85;
/** A camp's creature: `MapChunk`'s AVATAR_BASE_Y and AVATAR_HEIGHT. */
const CAMP_BASE_Y = CELL_HEIGHT * 0.24;
const CAMP_HEIGHT = CELL_HEIGHT * 0.55;

interface Kind {
  /** Where the smoke starts, from the cell's centre. */
  x: number;
  y: number;
  /** Seconds a puff takes from start to gone. */
  life: number;
  /** Puffs alive at once. */
  puffs: number;
  /** Width of a puff at its start and at its end, in world points. */
  from: number;
  to: number;
  /** How high a puff climbs over its life. */
  rise: number;
  alpha: number;
  tint: number;
}

const CHIMNEY: Kind = {
  x: BUILDING_HEIGHT * 0.24,
  y: BUILDING_FOOT_Y - BUILDING_HEIGHT * 0.84,
  life: 4.2,
  puffs: 5,
  from: 10,
  to: 30,
  rise: 20,
  alpha: 0.8,
  tint: 0xffffff,
};
const CAMPFIRE: Kind = {
  x: -CAMP_HEIGHT * 0.45,
  y: CAMP_BASE_Y - CAMP_HEIGHT * 0.55,
  life: 3.8,
  puffs: 4,
  from: 8,
  to: 24,
  rise: 18,
  alpha: 0.7,
  tint: 0xf2ece4,
};
const EMBERS: Kind = {
  x: 0,
  y: CAMP_BASE_Y - CAMP_HEIGHT * 0.5,
  life: 4.4,
  puffs: 4,
  from: 9,
  to: 26,
  rise: 18,
  alpha: 0.65,
  tint: 0x5a5550,
};

/**
 * The wind, in world points a puff drifts over its life: the same way the
 * clouds go. A cell's building fills most of its height, so smoke that rose
 * straight up would stand in front of the building behind; leaning it into
 * the gap between the columns keeps it reading as this cell's.
 */
const WIND_X = 46;

interface Source {
  kind: Kind;
  x: number;
  y: number;
  /** Where in its loop this source starts, so neighbours do not puff in step. */
  offset: number;
  sprites: Sprite[];
}

export class SmokeLayer implements LiveChunkLayer {
  private readonly sources = new Map<number, Source[]>();

  constructor(private readonly puffs: readonly Texture[]) {}

  build(chunk: LiveChunk): void {
    if (this.puffs.length === 0) return;
    const sources: Source[] = [];
    for (const cell of chunk.cells) {
      const { marker, dimmed } = cell.appearance;
      if (dimmed) continue;
      // Yards, not outposts: an outpost is a tower with nothing to burn, and the outposts of one
      // player often stand in a block, where a wisp on each would be a smog.
      const kind =
        marker === CellMarker.YARD
          ? CHIMNEY
          : marker === CellMarker.CAMP
            ? CAMPFIRE
            : marker === CellMarker.CAMP_DESTROYED
              ? EMBERS
              : null;
      if (!kind) continue;

      const seed = hash(cell.col, cell.row);
      const source: Source = {
        kind,
        x: cell.centre.x + kind.x,
        y: cell.centre.y + kind.y,
        offset: (seed % 1000) / 1000,
        sprites: [],
      };
      for (let index = 0; index < kind.puffs; index++) {
        const sprite = new Sprite(this.puffs[(seed + index) % this.puffs.length]!);
        sprite.anchor.set(0.5);
        sprite.tint = kind.tint;
        sprite.alpha = 0;
        source.sprites.push(sprite);
        chunk.overlay.addChild(sprite);
      }
      sources.push(source);
    }
    this.sources.set(chunk.ref.id, sources);
  }

  step(timeSeconds: number, visible: Iterable<LiveChunk>, zoom: number): void {
    if (zoom < SMOKE_MIN_ZOOM) return;
    for (const chunk of visible) {
      for (const source of this.sources.get(chunk.ref.id) ?? []) move(source, timeSeconds);
    }
  }

  forget(chunk: LiveChunk): void {
    // The sprites go with the chunk's overlay.
    this.sources.delete(chunk.ref.id);
  }

  destroy(): void {
    this.sources.clear();
  }
}

const move = (source: Source, timeSeconds: number): void => {
  const { kind, sprites } = source;
  for (let index = 0; index < sprites.length; index++) {
    const sprite = sprites[index]!;
    const t = fract(timeSeconds / kind.life + source.offset + index / sprites.length);
    // Rises fast, then slows as it spreads; sways a little as it goes.
    const climb = 1 - (1 - t) * (1 - t);
    const sway = Math.sin((timeSeconds + index * 1.7 + source.offset * 9) * 1.3) * 2.2 * t;
    sprite.position.set(source.x + WIND_X * (0.6 * t + 0.4 * t * t) + sway, source.y - kind.rise * climb);
    const width = kind.from + (kind.to - kind.from) * t;
    sprite.scale.set(width / sprite.texture.width);
    // In quickly, out slowly.
    sprite.alpha = kind.alpha * Math.min(1, t * 6) * (1 - t) * (1 - t * 0.3);
  }
};

const fract = (value: number): number => value - Math.floor(value);

const hash = (col: number, row: number): number => {
  let h = (Math.imul(col, 374761393) + Math.imul(row, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};
