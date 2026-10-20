import { Graphics, GraphicsContext, type Container } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";

/**
 * The three fading rings on the ground a splash, a Bolt's hop or a quake
 * leaves (issue #222, #352), made cheap enough for a crowd (fix/bandito-lag).
 * Drawing only: nothing here reaches the battle.
 *
 * A ring used to be a fresh `Graphics` each time, cut into triangles, given
 * its own buffers and its own draw call every frame, then thrown away. A
 * crowd of Banditos swinging on the same tick made dozens at once, and that
 * frame stalled. Now every ring of one size and colour shares one drawing
 * (a `GraphicsContext`, triangulated once, its buffers on the GPU once), and
 * the ring objects are pooled. A ring is still its own draw call, but a cheap
 * one over the shared buffers. (Forcing the drawing into Pixi's batches was
 * slower: it copies every ring's points on the CPU each frame.) The rings
 * look exactly as before.
 */
export class RingFx {
  /** One drawing per radius and colour; the radii come from a few move levels. */
  private readonly shapes = new Map<string, GraphicsContext>();
  private readonly pool: Graphics[] = [];
  private made = 0;

  constructor(private readonly parent: Container) {}

  /** A ring at `at`, `radius` wide, on top of the parent; give it back with {@link release}. */
  take(at: Point, radius: number, colour: number): Graphics {
    const shape = this.shapeOf(radius, colour);
    let ring = this.pool.pop();
    if (ring) ring.context = shape;
    else {
      ring = new Graphics(shape);
      ring.eventMode = "none";
      this.made += 1;
    }
    ring.alpha = 1;
    ring.scale.set(1);
    ring.position.set(at.x, at.y);
    this.parent.addChild(ring);
    return ring;
  }

  /** Back to the pool: off the parent, its shared drawing kept. */
  release(ring: Graphics): void {
    ring.parent?.removeChild(ring);
    this.pool.push(ring);
  }

  /** Drawings made so far, for tests: one per radius and colour. */
  get shapeCount(): number {
    return this.shapes.size;
  }

  /** Ring objects ever made, for tests: the most alive at once, not one per ring. */
  get madeCount(): number {
    return this.made;
  }

  destroy(): void {
    // A ring still on the parent goes with it; the shared drawings are this one's.
    for (const ring of this.pool) ring.destroy();
    this.pool.length = 0;
    for (const shape of this.shapes.values()) shape.destroy();
    this.shapes.clear();
  }

  private shapeOf(radius: number, colour: number): GraphicsContext {
    const key = `${colour}:${radius}`;
    let shape = this.shapes.get(key);
    if (!shape) {
      shape = new GraphicsContext();
      for (const share of [1, 0.8, 0.6]) {
        shape.ellipse(0, 0, radius * share, (radius * share) / 2);
      }
      shape.stroke({ color: colour, width: 2, alpha: 0.9 });
      this.shapes.set(key, shape);
    }
    return shape;
  }
}
