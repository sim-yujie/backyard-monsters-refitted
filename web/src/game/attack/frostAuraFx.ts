import { Container, Graphics } from "pixi.js";
import type { FrostArea } from "@/game/combat/rules";
import type { Point } from "@/game/yard/YardGrid";

/**
 * Frost on the ground (beta 10): the frost areas frost Eye-ras leave. Krampus's
 * own aura draws nothing (owner, 28 Nov 2026: "The aura should be invisible
 * like fomor"). Drawing only; the slow itself is the engine's.
 *
 * A radius is in yard units (the engine's range space); on screen a yard
 * circle is an ellipse √2 wide and √2/2 tall per unit (`toIso`).
 */
const ICE = 0x9fe4ff;
const RIM = 0xe8fbff;

/** The ellipse's half-axes on screen for a radius in yard units. */
export const auraEllipse = (radius: number): { rx: number; ry: number } => ({
  rx: radius * Math.SQRT2,
  ry: (radius * Math.SQRT2) / 2,
});

/**
 * The frost areas frost Eye-ras leave where they burst (beta 10, owner 27 Nov
 * 2026: "a frost AOE that slows towers upon exploding"): an icy disc
 * on the ground, frosting over in its first half
 * second and melting away in its last second. Drawing only; the towers it
 * slows are the engine's (`engine.ts`, `frostArea`).
 */
export class FrostAreaFx {
  private readonly discs = new Map<string, Graphics>();
  readonly root = new Container();

  constructor(private readonly world: (ix: number, iy: number) => Point) {
    this.root.eventMode = "none";
  }

  /** Every area still on the ground, placed and faded by `tick`; the melted ones dropped. */
  update(areas: readonly FrostArea[], tick: number): void {
    const seen = new Set<string>();
    for (const area of areas) {
      if (tick >= area.until) continue;
      const key = `${area.from}:${area.ix}:${area.iy}`;
      seen.add(key);
      let disc = this.discs.get(key);
      if (!disc) {
        disc = drawRing(area.radius);
        const at = this.world(area.ix, area.iy);
        disc.position.set(at.x, at.y);
        this.discs.set(key, disc);
        this.root.addChild(disc);
      }
      // 40 ticks (half a second) to frost over, 80 (a second) to melt.
      const grow = Math.min(1, Math.max(0, (tick - area.from) / 40));
      const melt = Math.min(1, Math.max(0, (area.until - tick) / 80));
      disc.scale.set(0.6 + 0.4 * grow);
      disc.alpha = Math.min(grow, melt);
    }
    for (const [key, disc] of this.discs) {
      if (seen.has(key)) continue;
      disc.destroy();
      this.discs.delete(key);
    }
  }

  /** How many areas are on the ground (for tests). */
  get count(): number {
    return this.discs.size;
  }

  destroy(): void {
    for (const disc of this.discs.values()) disc.destroy();
    this.discs.clear();
    this.root.destroy({ children: true });
  }
}

/** A disc of frost with a bright rim and a few frost marks round it, centred on 0,0. */
const drawRing = (radius: number): Graphics => {
  const { rx, ry } = auraEllipse(radius);
  const ring = new Graphics();
  ring.eventMode = "none";
  ring.ellipse(0, 0, rx, ry).fill({ color: ICE, alpha: 0.14 });
  ring.ellipse(0, 0, rx * 0.97, ry * 0.97).stroke({ width: 6, color: ICE, alpha: 0.35 });
  ring.ellipse(0, 0, rx, ry).stroke({ width: 2.5, color: RIM, alpha: 0.9 });
  // Short frost spikes on the rim, every 30 degrees.
  for (let step = 0; step < 12; step += 1) {
    const angle = (step / 12) * Math.PI * 2;
    const x = Math.cos(angle) * rx;
    const y = Math.sin(angle) * ry;
    ring.moveTo(x, y).lineTo(x * 0.9, y * 0.9).stroke({ width: 2, color: RIM, alpha: 0.75 });
  }
  return ring;
};
