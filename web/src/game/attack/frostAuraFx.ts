import { Container, Graphics } from "pixi.js";
import { KRAMPUS_ID, krampusAuraRadius, type CreepSnapshot } from "@/game/combat/rules";
import type { Point } from "@/game/yard/YardGrid";

/**
 * Krampus's frost aura on the ground (beta 10, owner 27 Nov 2026: "frost aura
 * slows nearby towers AND monsters"): a pale icy disc with a bright frost rim,
 * exactly the aura's reach, following Krampus and breathing slowly. Drawing
 * only; the slow itself is the engine's (`engine.ts`, `tickFrostAura`).
 *
 * The aura's radius is in yard units (the engine's range space); on screen a
 * yard circle is an ellipse √2 wide and √2/2 tall per unit (`toIso`).
 */
const ICE = 0x9fe4ff;
const RIM = 0xe8fbff;

/** The ellipse's half-axes on screen for a radius in yard units. */
export const auraEllipse = (radius: number): { rx: number; ry: number } => ({
  rx: radius * Math.SQRT2,
  ry: (radius * Math.SQRT2) / 2,
});

export class FrostAuraFx {
  private readonly rings = new Map<number, { ring: Graphics; level: number }>();
  readonly root = new Container();

  constructor(private readonly world: (ix: number, iy: number) => Point) {
    this.root.eventMode = "none";
  }

  /** Each live Krampus's ring, placed; the rest dropped. `tick` breathes them. */
  update(creeps: readonly CreepSnapshot[], tick: number): void {
    const seen = new Set<number>();
    for (const creep of creeps) {
      if (creep.monsterId !== KRAMPUS_ID || creep.hp <= 0) continue;
      seen.add(creep.id);
      let entry = this.rings.get(creep.id);
      if (!entry || entry.level !== creep.level) {
        entry?.ring.destroy();
        entry = { ring: drawRing(krampusAuraRadius(creep.level)), level: creep.level };
        this.rings.set(creep.id, entry);
        this.root.addChild(entry.ring);
      }
      const at = this.world(creep.ix, creep.iy);
      entry.ring.position.set(at.x, at.y);
      entry.ring.alpha = 0.8 + 0.2 * Math.sin(tick / 20);
    }
    for (const [id, entry] of this.rings) {
      if (seen.has(id)) continue;
      entry.ring.destroy();
      this.rings.delete(id);
    }
  }

  /** How many rings are on the ground (for tests). */
  get count(): number {
    return this.rings.size;
  }

  destroy(): void {
    for (const entry of this.rings.values()) entry.ring.destroy();
    this.rings.clear();
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
