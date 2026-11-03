import { BufferImageSource } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import type { ZoneRecord } from "../ZoneStore";
import { Ground, encodeCell } from "./groundKinds";

/**
 * The painted ground's data texture: one texel per cell, the whole world (`groundKinds.ts`
 * `encodeCell` says what each channel holds). Written per zone as responses arrive, uploaded at
 * most once a frame, like `TerrainRaster`. Read by the shader with `texelFetch`, never filtered.
 */
export class GroundData {
  readonly bytes: Uint8Array;
  readonly source: BufferImageSource;
  private dirty = false;

  constructor(
    readonly width = WORLD_WIDTH,
    readonly height = WORLD_HEIGHT,
  ) {
    this.bytes = new Uint8Array(width * height * 4);
    this.fillFog();
    this.source = new BufferImageSource({
      resource: this.bytes,
      width,
      height,
      format: "rgba8unorm",
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
    });
  }

  /** Writes one area response. */
  applyZone(zone: ZoneRecord): void {
    for (const [xKey, column] of Object.entries(zone.data)) {
      const x = Number(xKey);
      if (!(x >= 0 && x < this.width)) continue;
      for (const [yKey, cell] of Object.entries(column)) {
        const y = Number(yKey);
        if (!(y >= 0 && y < this.height)) continue;
        encodeCell(cell, this.bytes, (y * this.width + x) * 4);
      }
    }
    this.dirty = true;
  }

  /** The ground a cell has been given, for tests. */
  groundAt(x: number, y: number): number {
    return this.bytes[(y * this.width + x) * 4 + 3]! & 15;
  }

  /** Back to fog everywhere (the player's sight changed; `TerrainRaster.reset`). */
  reset(): void {
    this.fillFog();
    this.dirty = true;
  }

  /** Uploads pending writes; a no-op when nothing changed. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.source.update();
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
