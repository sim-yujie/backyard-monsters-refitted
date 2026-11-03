import { PerspectiveMesh, RenderTexture, Texture, type Container, type Renderer } from "pixi.js";
import type { Point } from "@/game/HexGrid";
import { quality as currentQuality, type Quality } from "@/game/quality";
import { tiltTextureResolution, type Tilt } from "./tilt";

/**
 * Shows the map through the tilted camera (`tilt.ts`, MR2 look plan step 4).
 *
 * The flat map (the renderer's root container, untouched) is drawn into a
 * texture covering everything the tilted screen can see, which is more than
 * the screen at the top; that texture then goes on a `PerspectiveMesh` whose
 * four corners are where the tilt puts the texture's corners. The mesh is the
 * only thing on the stage.
 *
 * Speed: the texture is redrawn only on a frame where something changed (the
 * camera, the screen size, or anything inside the map: a chunk built, a
 * picture landed, the highlight moved, an animation stepped), read from the
 * map's own render group (`mapChanged`). While the map is still, the mesh
 * shows the last picture and costs one textured quad a frame. Quality Low
 * draws the texture at half resolution (owner, MR2 plan question 2).
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

/**
 * Grid of the mesh. The warp is exact at the vertices and straight between
 * them; at 48 the drawn map is within about half a pixel of the maths that
 * picks cells, even at the strong tilt (24 left it 1.7 px out).
 */
const MESH_VERTICES = 48;

/**
 * The longest the picture is kept without a redraw while nothing seems to have
 * changed: a safety net for changes Pixi's lists do not see, such as new
 * pixels written into a canvas texture (the far-zoom terrain raster). One
 * extra draw a second while the map is still.
 */
const MAX_STILL_MS = 1000;

/** Largest texture side we ask for; the strong tilt at 4K stays under it. */
const MAX_TEXTURE_SIDE = 8192;

export class TiltView {
  readonly mesh: PerspectiveMesh;
  private texture: RenderTexture | null = null;
  private textureKey = "";
  /** What the last picture was drawn for; a different key redraws it. */
  private viewKey = "";
  private drawnAt = 0;

  constructor(
    private readonly resolution: number,
    private readonly quality: () => Quality = () => currentQuality(),
  ) {
    this.mesh = new PerspectiveMesh({ texture: Texture.EMPTY, verticesX: MESH_VERTICES, verticesY: MESH_VERTICES });
    this.mesh.eventMode = "none";
  }

  /**
   * Draws `root` (already laid out for the flat camera: scaled by zoom and
   * moved by -position·zoom) into the texture, then warps it, when anything
   * changed since the last picture. `root` must not be on the stage. Returns
   * whether it drew.
   */
  render(
    renderer: Renderer,
    root: Container,
    tilt: Tilt,
    zoom: number,
    position: Point,
    nowMs: number = performance.now(),
  ): boolean {
    const bounds = tilt.flatBounds();
    const left = Math.floor(bounds.left);
    const top = Math.floor(bounds.top);
    const width = Math.ceil(bounds.right) - left;
    const height = Math.ceil(bounds.bottom) - top;
    const textureKey = this.textureKey;
    const texture = this.ensureTexture(width, height);

    const viewKey = `${tilt.pitchDeg}|${tilt.width}x${tilt.height}|${zoom}|${position.x},${position.y}`;
    const still = viewKey === this.viewKey && this.textureKey === textureKey && nowMs - this.drawnAt < MAX_STILL_MS;
    if (still && !mapChanged(root)) return false;
    this.viewKey = viewKey;
    this.drawnAt = nowMs;

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
    return true;
  }

  /** Makes the next `render` draw even if nothing seems to have changed. */
  invalidate(): void {
    this.viewKey = "";
  }

  destroy(): void {
    this.mesh.destroy();
    this.texture?.destroy(true);
    this.texture = null;
  }

  private ensureTexture(width: number, height: number): RenderTexture {
    const base = tiltTextureResolution(this.resolution, this.quality());
    const scale = Math.min(1, MAX_TEXTURE_SIDE / (Math.max(width, height) * base));
    const resolution = base * scale;
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

/**
 * The parts of a Pixi render group that say something in it changed since it
 * was last drawn; Pixi clears them as it draws (`RenderGroupSystem`). Not in
 * Pixi's public types, so read defensively: a group without them counts as
 * changed.
 */
interface ChangeLists {
  structureDidChange?: boolean;
  childrenToUpdate?: Record<string, { index: number } | undefined>;
  childrenRenderablesToUpdate?: { index: number };
  renderGroupChildren?: ChangeLists[];
}

/**
 * Whether anything inside `root` changed since it was last drawn: a child
 * added, removed, moved, shown or hidden, or a sprite's texture, a text or a
 * graphic redrawn. Pixi makes `root` a render group the first time it is
 * drawn on its own and keeps these lists for it; nested render groups (chunks
 * may be) keep their own. Before that first draw it counts as changed.
 */
export const mapChanged = (root: Container): boolean => {
  const group = (root as unknown as { renderGroup?: ChangeLists | null }).renderGroup;
  return !group || groupChanged(group);
};

const groupChanged = (group: ChangeLists): boolean => {
  if (group.structureDidChange !== false) return true;
  if (!group.childrenRenderablesToUpdate || group.childrenRenderablesToUpdate.index > 0) return true;
  const byDepth = group.childrenToUpdate;
  if (!byDepth) return true;
  for (const depth in byDepth) {
    if ((byDepth[depth]?.index ?? 0) > 0) return true;
  }
  return (group.renderGroupChildren ?? []).some(groupChanged);
};
