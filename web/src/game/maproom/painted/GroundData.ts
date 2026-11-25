import { BufferImageSource } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import type { ZoneRecord } from "../ZoneStore";
import type { CellRange } from "../zones";
import { DirtyRect, flushRegion } from "../regionUpload";
import { Ground, encodeCell } from "./groundKinds";

/** At most about this many cells are looked at when asking whether water is in sight. */
const WATER_PROBES = 4096;

/**
 * The painted ground's data texture: one texel per cell, the whole world (`groundKinds.ts`
 * `encodeCell` says what each channel holds). Written per zone as responses arrive, uploaded at
 * most once a frame, like `TerrainRaster`. Read by the shader with `texelFetch`, never filtered.
 */
export class GroundData {
  readonly bytes: Uint8Array;
  readonly source: BufferImageSource;
  /**
   * The cells that turned to or from fog since the clouds last looked (`CloudLayer.flush` takes
   * it), so the fog's distances are measured again only round them.
   */
  readonly fogChanges: DirtyRect;
  /** The texels written since the last upload, so only they go up (`regionUpload.ts`). */
  private readonly changes: DirtyRect;

  constructor(
    readonly width = WORLD_WIDTH,
    readonly height = WORLD_HEIGHT,
  ) {
    this.bytes = new Uint8Array(width * height * 4);
    this.fogChanges = new DirtyRect(width, height);
    this.changes = new DirtyRect(width, height);
    this.fillFog();
    this.source = new BufferImageSource({
      resource: this.bytes,
      width,
      height,
      format: "rgba8unorm",
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
      // Data, not a picture: Pixi's default premultiplies on upload, which scaled the height and
      // feature channels by the ground byte in alpha (heights read 0..15, so no hills, no cliffs,
      // and every sea cell read as deep).
      alphaMode: "no-premultiply-alpha",
    });
  }

  /** Writes one area response, noting the texels that changed (and those that turned to or from fog). */
  applyZone(zone: ZoneRecord): void {
    const bytes = this.bytes;
    for (const [xKey, column] of Object.entries(zone.data)) {
      const x = Number(xKey);
      if (!(x >= 0 && x < this.width)) continue;
      for (const [yKey, cell] of Object.entries(column)) {
        const y = Number(yKey);
        if (!(y >= 0 && y < this.height)) continue;
        const at = (y * this.width + x) * 4;
        const b0 = bytes[at]!;
        const b1 = bytes[at + 1]!;
        const b2 = bytes[at + 2]!;
        const b3 = bytes[at + 3]!;
        encodeCell(cell, bytes, at);
        if (b0 === bytes[at] && b1 === bytes[at + 1] && b2 === bytes[at + 2] && b3 === bytes[at + 3]) continue;
        this.changes.add(x, y, x, y);
        if (((b3 & 15) === Ground.FOG) !== ((bytes[at + 3]! & 15) === Ground.FOG)) this.fogChanges.add(x, y, x, y);
      }
    }
  }

  /** The ground a cell has been given, for tests. */
  groundAt(x: number, y: number): number {
    return this.bytes[(y * this.width + x) * 4 + 3]! & 15;
  }

  /**
   * Whether any water cell lies in this range (so the water clock needs to run). A large range is
   * probed on a sparser grid, which can miss a lone water cell far out; that only stills its surf.
   */
  hasWater(range: CellRange): boolean {
    const x0 = Math.max(0, Math.floor(range.minCol));
    const x1 = Math.min(this.width - 1, Math.ceil(range.maxCol));
    const y0 = Math.max(0, Math.floor(range.minRow));
    const y1 = Math.min(this.height - 1, Math.ceil(range.maxRow));
    if (x1 < x0 || y1 < y0) return false;
    const cells = (x1 - x0 + 1) * (y1 - y0 + 1);
    const stride = Math.max(1, Math.ceil(Math.sqrt(cells / WATER_PROBES)));
    for (let y = y0; y <= y1; y += stride) {
      for (let x = x0; x <= x1; x += stride) {
        const ground = this.bytes[(y * this.width + x) * 4 + 3]! & 15;
        if (ground === Ground.SHALLOWS || ground === Ground.DEEP) return true;
      }
    }
    return false;
  }

  /** Back to fog everywhere (the player's sight changed; `TerrainRaster.reset`). */
  reset(): void {
    this.fillFog();
    this.changes.addAll();
    this.fogChanges.addAll();
  }

  /** Uploads pending writes (only the box they touched); a no-op when nothing changed. */
  flush(): boolean {
    if (this.changes.empty) return false;
    flushRegion(this.source, this.changes.take());
    return true;
  }

  destroy(): void {
    this.source.destroy();
  }

  private fillFog(): void {
    for (let offset = 0; offset < this.bytes.length; offset += 4) {
      this.bytes[offset] = 0;
      this.bytes[offset + 1] = 0;
      this.bytes[offset + 2] = 0;
      this.bytes[offset + 3] = Ground.FOG;
    }
  }
}
