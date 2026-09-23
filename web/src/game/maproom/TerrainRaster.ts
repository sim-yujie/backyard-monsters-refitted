import { CanvasSource, Sprite, Texture } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { mapRoomGrid } from "@/game/HexGrid";
import { LOADING_COLOUR, rasterColour } from "./cellVisuals";
import type { ZoneRecord } from "./ZoneStore";

/**
 * The whole world as one texture, one texel per cell.
 *
 * This is the far level of detail. At minimum zoom the viewport covers all
 * 640,000 cells, and no amount of batching makes that many hexagons a sensible
 * per-frame geometry. A single 800 x 800 texture stretched over the world costs
 * one draw call whatever the zoom, and the half-row stagger between odd and
 * even columns is well under a pixel at the zoom levels this layer is used at,
 * so dropping it is invisible.
 *
 * Texels are written per zone as responses arrive, never by walking the world,
 * and the GPU upload happens at most once per frame.
 */
export class TerrainRaster {
  readonly sprite: Sprite;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly source: CanvasSource;
  private dirty = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = WORLD_WIDTH;
    this.canvas.height = WORLD_HEIGHT;

    const context = this.canvas.getContext("2d", { willReadFrequently: false });
    if (!context) throw new Error("Could not get a 2D context for the map raster");
    this.context = context;

    this.image = context.createImageData(WORLD_WIDTH, WORLD_HEIGHT);
    this.fill(LOADING_COLOUR);
    context.putImageData(this.image, 0, 0);

    // Nearest neighbour: a cell is a cell, not a smear of its neighbours.
    this.source = new CanvasSource({ resource: this.canvas, scaleMode: "nearest" });
    this.sprite = new Sprite(new Texture({ source: this.source }));

    // Line the texel grid up with the hex grid: texel (x, y) spans one column
    // step and one row step, centred on the cell's centre.
    this.sprite.position.set(-mapRoomGrid.colStep / 2, -mapRoomGrid.rowStep / 2);
    this.sprite.scale.set(mapRoomGrid.colStep, mapRoomGrid.rowStep);
  }

  /** Writes one area response into the texture. */
  applyZone(zone: ZoneRecord): void {
    for (const [xKey, column] of Object.entries(zone.data)) {
      const x = Number(xKey);
      if (x < 0 || x >= WORLD_WIDTH) continue;
      for (const [yKey, cell] of Object.entries(column)) {
        const y = Number(yKey);
        if (y < 0 || y >= WORLD_HEIGHT) continue;
        this.writeTexel(x, y, rasterColour(cell));
      }
    }
    this.dirty = true;
  }

  /** Uploads pending texel writes. Cheap and a no-op when nothing changed. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.context.putImageData(this.image, 0, 0);
    this.source.update();
  }

  destroy(): void {
    this.sprite.destroy();
    this.source.destroy();
  }

  private writeTexel(x: number, y: number, colour: number): void {
    const offset = (y * WORLD_WIDTH + x) * 4;
    const data = this.image.data;
    data[offset] = (colour >> 16) & 0xff;
    data[offset + 1] = (colour >> 8) & 0xff;
    data[offset + 2] = colour & 0xff;
    data[offset + 3] = 255;
  }

  private fill(colour: number): void {
    for (let index = 0; index < WORLD_WIDTH * WORLD_HEIGHT; index++) {
      const offset = index * 4;
      this.image.data[offset] = (colour >> 16) & 0xff;
      this.image.data[offset + 1] = (colour >> 8) & 0xff;
      this.image.data[offset + 2] = colour & 0xff;
      this.image.data[offset + 3] = 255;
    }
  }
}
