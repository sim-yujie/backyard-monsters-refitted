import { PerspectiveMesh, RenderTexture, Texture, type Container, type Renderer } from "pixi.js";
import type { Point } from "@/game/HexGrid";
import type { Tilt } from "./tilt";

/**
 * Shows the map through the tilted camera (`tilt.ts`, MR2_TILT prototype).
 *
 * Each frame the flat map (the renderer's root container, untouched) is drawn
 * into a texture covering everything the tilted screen can see, which is more
 * than the screen at the top; that texture then goes on a `PerspectiveMesh`
 * whose four corners are where the tilt puts the texture's corners. The mesh
 * is the only thing on the stage.
 *
 * Why a texture and not a projected scene: Pixi's transforms are 2D affine,
 * so a true perspective of every sprite would need a custom shader on every
 * sprite, text and graphics batch. Drawing flat and warping once keeps all of
 * today's map code and its picking exactly as they are, and the warp is one
 * known homography that input can undo exactly.
 *
 * The far edge is shrunk up to about three times, so the texture keeps
 * mipmaps (rebuilt each frame) to stop the cell outlines shimmering there.
 */

/** Grid of the mesh; the warp is exact at the vertices and near enough between. */
const MESH_VERTICES = 24;

/** Largest texture side we ask for; the strong tilt at 4K stays under it. */
const MAX_TEXTURE_SIDE = 8192;

export class TiltView {
  readonly mesh: PerspectiveMesh;
  private texture: RenderTexture | null = null;
  private textureKey = "";

  constructor(private readonly resolution: number) {
    this.mesh = new PerspectiveMesh({ texture: Texture.EMPTY, verticesX: MESH_VERTICES, verticesY: MESH_VERTICES });
    this.mesh.eventMode = "none";
  }

  /**
   * Draws `root` (already laid out for the flat camera: scaled by zoom and
   * moved by -position·zoom) into the texture, then warps it. `root` must not
   * be on the stage.
   */
  render(renderer: Renderer, root: Container, tilt: Tilt, zoom: number, position: Point): void {
    const bounds = tilt.flatBounds();
    const left = Math.floor(bounds.left);
    const top = Math.floor(bounds.top);
    const width = Math.ceil(bounds.right) - left;
    const height = Math.ceil(bounds.bottom) - top;
    const texture = this.ensureTexture(width, height);

    root.scale.set(zoom);
    root.position.set(-position.x * zoom - left, -position.y * zoom - top);
    renderer.render({ container: root, target: texture, clear: true, clearColor: [0, 0, 0, 0] });
    texture.source.updateMipmaps();

    const corner = (x: number, y: number): Point => tilt.toScreen({ x, y });
    const a = corner(left, top);
    const b = corner(left + width, top);
    const c = corner(left + width, top + height);
    const d = corner(left, top + height);
    this.mesh.setCorners(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
  }

  destroy(): void {
    this.mesh.destroy();
    this.texture?.destroy(true);
    this.texture = null;
  }

  private ensureTexture(width: number, height: number): RenderTexture {
    const scale = Math.min(1, MAX_TEXTURE_SIDE / (Math.max(width, height) * this.resolution));
    const resolution = this.resolution * scale;
    const key = `${width}x${height}@${resolution}`;
    if (this.texture && key === this.textureKey) return this.texture;
    this.texture?.destroy(true);
    this.texture = RenderTexture.create({
      width,
      height,
      resolution,
      antialias: false,
      autoGenerateMipmaps: true,
      scaleMode: "linear",
      mipmapFilter: "linear",
      // A tilted plane is shrunk far more top to bottom than across, which
      // is what anisotropic filtering is for.
      maxAnisotropy: 8,
    });
    this.textureKey = key;
    this.mesh.texture = this.texture;
    return this.texture;
  }
}
